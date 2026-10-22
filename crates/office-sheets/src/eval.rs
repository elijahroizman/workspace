//! Working formulas out: Excel's values and how they turn into one another, references
//! through a [`Book`], and the functions people use most.

use std::collections::{HashMap, HashSet};

use office_core::model::{format_number, Value};

use crate::dates::{self, DateSystem};
use crate::formula::{Expr, Op, RefPart, Reference};

/// A value while a formula is worked out.
#[derive(Clone, Debug, PartialEq)]
pub enum V {
    Num(f64),
    Text(String),
    Bool(bool),
    Err(&'static str),
    Empty,
    /// A range's values, rows of columns.
    Range(Vec<Vec<V>>),
}

impl V {
    pub fn from_value(v: &Value) -> V {
        match v {
            Value::Empty => V::Empty,
            Value::Number(n) => V::Num(*n),
            Value::Text(_) | Value::Rich(_) => V::Text(v.display()),
            Value::Bool(b) => V::Bool(*b),
            Value::Error(e) => V::Err(error_name(e)),
        }
    }

    /// The value a cell holds after its formula: a range's top-left value, as Excel shows it
    /// without spilling.
    pub fn to_value(&self) -> Value {
        match self {
            V::Num(n) => Value::Number(*n),
            V::Text(t) => Value::Text(t.clone()),
            V::Bool(b) => Value::Bool(*b),
            V::Err(e) => Value::Error(e.to_string()),
            // A formula that comes to an empty cell shows 0.
            V::Empty => Value::Number(0.0),
            V::Range(r) => r.first().and_then(|row| row.first()).map(V::to_value).unwrap_or(Value::Number(0.0)),
        }
    }
}

const ERRORS: [&str; 8] = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA"];

fn error_name(e: &str) -> &'static str {
    ERRORS.iter().find(|x| x.eq_ignore_ascii_case(e)).copied().unwrap_or("#VALUE!")
}

/// What formulas can reach.
pub trait Book {
    /// A cell's value, working its formula out first if it has one. `sheet` is `None` for the
    /// formula's own sheet.
    fn cell(&mut self, sheet: Option<&str>, row: u32, col: u32) -> V;
    /// The last row and column a sheet uses, to bound whole-column and whole-row ranges.
    fn extent(&self, sheet: Option<&str>) -> Option<(u32, u32)>;
    /// A defined name's formula, from the formula's own sheet's point of view.
    fn name(&self, name: &str) -> Option<Expr>;
    fn date_system(&self) -> DateSystem;
    /// Now, as a serial number, for NOW() and TODAY(); `None` makes them #N/A.
    fn now(&self) -> Option<f64>;
}

type R = Result<V, &'static str>;

/// Evaluation state for names. Cell evaluation can re-enter through Book, so the depth
/// guard is shared by nested evaluators on this thread as well.
struct Context<'a> {
    book: &'a mut dyn Book,
    names: HashSet<String>,
}

impl Book for Context<'_> {
    fn cell(&mut self, sheet: Option<&str>, row: u32, col: u32) -> V {
        self.book.cell(sheet, row, col)
    }
    fn extent(&self, sheet: Option<&str>) -> Option<(u32, u32)> {
        self.book.extent(sheet)
    }
    fn name(&self, name: &str) -> Option<Expr> {
        self.book.name(name)
    }
    fn date_system(&self) -> DateSystem {
        self.book.date_system()
    }
    fn now(&self) -> Option<f64> {
        self.book.now()
    }
}

thread_local! { static DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
pub(crate) fn depth() -> usize {
    DEPTH.with(std::cell::Cell::get)
}
struct Depth;
impl Depth {
    fn enter() -> Result<Self, &'static str> {
        if DEPTH.with(|d| {
            if d.get() >= 128 {
                false
            } else {
                d.set(d.get() + 1);
                true
            }
        }) {
            Ok(Self)
        } else {
            Err("#REF!")
        }
    }
}
impl Drop for Depth {
    fn drop(&mut self) {
        DEPTH.with(|d| d.set(d.get() - 1));
    }
}

/// Works out `expr`.
pub fn eval(expr: &Expr, book: &mut dyn Book) -> V {
    eval_inner(expr, &mut Context { book, names: HashSet::new() }).unwrap_or_else(V::Err)
}

fn eval_inner(expr: &Expr, book: &mut Context<'_>) -> R {
    let _depth = Depth::enter()?;
    let value = eval_unchecked(expr, book)?;
    match value {
        V::Num(n) => finite(n),
        other => Ok(other),
    }
}

fn eval_unchecked(expr: &Expr, book: &mut Context<'_>) -> R {
    Ok(match expr {
        Expr::Number(n) => V::Num(*n),
        Expr::Text(t) => V::Text(t.clone()),
        Expr::Bool(b) => V::Bool(*b),
        Expr::Error(e) => V::Err(error_name(e)),
        Expr::Missing => V::Empty,
        Expr::Ref(r) => reference(r, book)?,
        Expr::Name(n) => {
            let key = n.to_uppercase();
            if !book.names.insert(key.clone()) {
                return Err("#REF!");
            }
            let value = match book.name(n) {
                Some(e) => eval_inner(&e, book),
                None => Err("#NAME?"),
            };
            book.names.remove(&key);
            value?
        }
        Expr::Binary(Op::Range | Op::Intersect | Op::Union, _, _) => {
            let refs = references(expr, book)?;
            let mut rows = Vec::new();
            for r in refs {
                match reference(&r, book)? {
                    V::Range(r) => rows.extend(r),
                    v => rows.push(vec![v]),
                }
            }
            V::Range(rows)
        }
        Expr::Neg(e) => V::Num(-num(&scalar(eval_inner(e, book)?))?),
        Expr::Percent(e) => V::Num(num(&scalar(eval_inner(e, book)?))? / 100.0),
        Expr::Binary(op, a, b) => eval_chain(*op, a, b, book)?,
        Expr::Array(rows) => {
            let width = rows.first().map_or(0, Vec::len);
            if rows.iter().any(|r| r.len() != width) {
                return Err("#VALUE!");
            }
            V::Range(rows.iter().map(|r| r.iter().map(|e| eval_inner(e, book).unwrap_or_else(V::Err)).collect()).collect())
        }
        Expr::Call(name, args) => call(name, args, book)?,
    })
}

/// `A1+A2+...+A130` is left-nested, and each `eval_inner` used to take one depth
/// slot, so the sum came out as `#REF!`. A chain is not nested: walk its left
/// spine in a loop. The leftmost operand still runs first, and an error there
/// still skips every operand to its right. Range, intersection and union stay
/// on the recursive path.
fn eval_chain(op: Op, left: &Expr, right: &Expr, book: &mut Context<'_>) -> R {
    let mut spine = vec![(op, right)];
    let mut left = left;
    while let Expr::Binary(next, lower, rhs) = left {
        if matches!(next, Op::Range | Op::Intersect | Op::Union) {
            break;
        }
        spine.push((*next, rhs.as_ref()));
        left = lower.as_ref();
    }
    let mut acc = scalar(eval_inner(left, book)?);
    for (op, rhs) in spine.into_iter().rev() {
        acc = binary(op, &acc, &scalar(eval_inner(rhs, book)?))?;
    }
    Ok(acc)
}

fn reference(r: &Reference, book: &mut Context<'_>) -> R {
    let sheet = r.sheet.as_deref();
    let Some(end) = r.end else {
        let (row, col) = (r.start.row.ok_or("#REF!")?, r.start.col.ok_or("#REF!")?);
        return Ok(book.cell(sheet, row, col));
    };
    // A whole column (or row) runs to the last row (or column) the sheet uses; only those need
    // the sheet's extent.
    let open = [r.start.row, r.start.col, end.row, end.col].iter().any(Option::is_none);
    let (last_row, last_col) = if open { book.extent(sheet).unwrap_or((0, 0)) } else { (0, 0) };
    let span = |a: Option<u32>, b: Option<u32>, last: u32| match (a, b) {
        (Some(a), Some(b)) => (a.min(b), a.max(b)),
        _ => (0, last),
    };
    let bound = |a: &RefPart, b: &RefPart| (span(a.row, b.row, last_row), span(a.col, b.col, last_col));
    let ((r0, r1), (c0, c1)) = bound(&r.start, &end);
    if (r1 - r0 + 1) as u64 * (c1 - c0 + 1) as u64 > 10_000_000 {
        return Err("#NUM!");
    }
    Ok(V::Range((r0..=r1).map(|row| (c0..=c1).map(|col| book.cell(sheet, row, col)).collect()).collect()))
}

/// A single value from what may be a range: its top-left one.
fn scalar(v: V) -> V {
    match v {
        V::Range(r) => r.into_iter().next().and_then(|row| row.into_iter().next()).unwrap_or(V::Empty),
        v => v,
    }
}

/// A value as a number, the way arithmetic takes it: text that reads as a number is one,
/// TRUE is 1, an empty cell 0.
fn num(v: &V) -> Result<f64, &'static str> {
    match v {
        V::Num(n) => Ok(*n),
        V::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
        V::Empty => Ok(0.0),
        V::Text(t) => t.trim().parse::<f64>().ok().or_else(|| percent_text(t)).ok_or("#VALUE!"),
        V::Err(e) => Err(e),
        V::Range(_) => num(&scalar(v.clone())),
    }
}

fn percent_text(t: &str) -> Option<f64> {
    t.trim().strip_suffix('%')?.trim().parse::<f64>().ok().map(|n| n / 100.0)
}

pub fn text(v: &V) -> Result<String, &'static str> {
    match v {
        V::Num(n) => Ok(crate::numfmt::general(*n)),
        V::Text(t) => Ok(t.clone()),
        V::Bool(b) => Ok(if *b { "TRUE" } else { "FALSE" }.into()),
        V::Empty => Ok(String::new()),
        V::Err(e) => Err(e),
        V::Range(_) => text(&scalar(v.clone())),
    }
}

fn truthy(v: &V) -> Result<bool, &'static str> {
    match v {
        V::Bool(b) => Ok(*b),
        V::Num(n) => Ok(*n != 0.0),
        V::Empty => Ok(false),
        V::Text(t) if t.eq_ignore_ascii_case("TRUE") => Ok(true),
        V::Text(t) if t.eq_ignore_ascii_case("FALSE") => Ok(false),
        V::Text(_) => Err("#VALUE!"),
        V::Err(e) => Err(e),
        V::Range(_) => truthy(&scalar(v.clone())),
    }
}

/// Excel's order for comparing: numbers, then text (ignoring case), then booleans.
fn compare(a: &V, b: &V) -> Result<std::cmp::Ordering, &'static str> {
    use std::cmp::Ordering;
    let rank = |v: &V| match v {
        V::Num(_) | V::Empty => 0,
        V::Text(_) => 1,
        V::Bool(_) => 2,
        _ => 3,
    };
    if let V::Err(e) = a {
        return Err(e);
    }
    if let V::Err(e) = b {
        return Err(e);
    }
    // An empty cell compares as whatever it's compared with: 0, "" or FALSE.
    let (a, b) = match (a, b) {
        (V::Empty, V::Text(_)) => (&V::Text(String::new()), b),
        (V::Text(_), V::Empty) => (a, &V::Text(String::new())),
        (V::Empty, V::Bool(_)) => (&V::Bool(false), b),
        (V::Bool(_), V::Empty) => (a, &V::Bool(false)),
        _ => (a, b),
    };
    Ok(match (a, b) {
        (V::Text(x), V::Text(y)) => x.to_lowercase().cmp(&y.to_lowercase()),
        (V::Bool(x), V::Bool(y)) => x.cmp(y),
        _ if rank(a) != rank(b) => rank(a).cmp(&rank(b)),
        _ => num(a)?.partial_cmp(&num(b)?).unwrap_or(Ordering::Equal),
    })
}

fn binary(op: Op, a: &V, b: &V) -> R {
    use std::cmp::Ordering::*;
    Ok(match op {
        Op::Concat => V::Text(text(a)? + &text(b)?),
        Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => {
            let o = compare(a, b)?;
            V::Bool(match op {
                Op::Eq => o == Equal,
                Op::Ne => o != Equal,
                Op::Lt => o == Less,
                Op::Le => o != Greater,
                Op::Gt => o == Greater,
                _ => o != Less,
            })
        }
        _ => {
            let (x, y) = (num(a)?, num(b)?);
            let n = match op {
                Op::Add => x + y,
                Op::Sub => x - y,
                Op::Mul => x * y,
                Op::Div if y == 0.0 => return Err("#DIV/0!"),
                Op::Div => x / y,
                _ if x == 0.0 && y < 0.0 => return Err("#DIV/0!"),
                _ => x.powf(y),
            };
            finite(n)?
        }
    })
}

fn finite(n: f64) -> R {
    if n.is_finite() {
        Ok(V::Num(n))
    } else {
        Err("#NUM!")
    }
}

fn is_reference(expr: &Expr, book: &Context<'_>, depth: usize) -> bool {
    match expr {
        Expr::Ref(_) | Expr::Binary(Op::Range | Op::Intersect | Op::Union, _, _) => true,
        Expr::Name(n) if depth < 128 => book.name(n).is_some_and(|e| is_reference(&e, book, depth + 1)),
        _ => false,
    }
}

/// Resolve reference operators before fetching cells, so intersection never materializes
/// the non-overlapping parts of either operand.
fn references(expr: &Expr, book: &mut Context<'_>) -> Result<Vec<Reference>, &'static str> {
    let _depth = Depth::enter()?;
    match expr {
        Expr::Ref(r) => Ok(vec![r.clone()]),
        Expr::Name(n) => {
            let key = n.to_uppercase();
            if !book.names.insert(key.clone()) {
                return Err("#REF!");
            }
            let result = book.name(n).ok_or("#NAME?").and_then(|e| references(&e, book));
            book.names.remove(&key);
            result
        }
        Expr::Binary(op @ (Op::Range | Op::Intersect | Op::Union), a, b) => {
            let mut a = references(a, book)?;
            let b = references(b, book)?;
            if *op == Op::Union {
                a.extend(b);
                return Ok(a);
            }
            let bounds = |r: &Reference| {
                let end = r.end.unwrap_or(r.start);
                let extent = if [r.start.row, r.start.col, end.row, end.col].iter().any(Option::is_none) {
                    book.extent(r.sheet.as_deref()).unwrap_or((0, 0))
                } else {
                    (0, 0)
                };
                (
                    r.start.row.unwrap_or(0).min(end.row.unwrap_or(0)),
                    r.start.row.unwrap_or(extent.0).max(end.row.unwrap_or(extent.0)),
                    r.start.col.unwrap_or(0).min(end.col.unwrap_or(0)),
                    r.start.col.unwrap_or(extent.1).max(end.col.unwrap_or(extent.1)),
                )
            };
            let mut out = Vec::new();
            for x in &a {
                for y in &b {
                    if x.sheet != y.sheet {
                        continue;
                    }
                    let (xr0, xr1, xc0, xc1) = bounds(x);
                    let (yr0, yr1, yc0, yc1) = bounds(y);
                    let (r0, r1, c0, c1) = if *op == Op::Intersect {
                        (xr0.max(yr0), xr1.min(yr1), xc0.max(yc0), xc1.min(yc1))
                    } else {
                        (xr0.min(yr0), xr1.max(yr1), xc0.min(yc0), xc1.max(yc1))
                    };
                    if r0 <= r1 && c0 <= c1 {
                        let part = |r, c| RefPart { row: Some(r), col: Some(c), row_abs: false, col_abs: false };
                        out.push(Reference { sheet: x.sheet.clone(), start: part(r0, c0), end: Some(part(r1, c1)) });
                    }
                }
            }
            if out.is_empty() {
                Err("#NULL!")
            } else {
                Ok(out)
            }
        }
        _ => Err("#VALUE!"),
    }
}

/// Every value in the arguments, ranges flattened, with whether each came from a range (range
/// cells and direct arguments count differently in SUM, COUNT and the like).
fn flatten(args: &[Expr], book: &mut Context<'_>) -> Result<Vec<(V, bool)>, &'static str> {
    let mut out = Vec::new();
    for a in args {
        match eval_inner(a, book)? {
            V::Range(rows) => out.extend(rows.into_iter().flatten().map(|v| (v, true))),
            v => out.push((v, is_reference(a, book, 0))),
        }
    }
    Ok(out)
}

/// The numbers SUM, AVERAGE, MIN and MAX use: in ranges only numbers; as direct arguments,
/// numbers, booleans and numeric text. An error anywhere is the answer.
fn numbers(args: &[Expr], book: &mut Context<'_>) -> Result<Vec<f64>, &'static str> {
    let mut out = Vec::new();
    for (v, in_range) in flatten(args, book)? {
        match (&v, in_range) {
            (V::Err(e), _) => return Err(e),
            (V::Num(n), _) => out.push(*n),
            (_, true) | (V::Empty, false) => {}
            (v, false) => out.push(num(v)?),
        }
    }
    Ok(out)
}

/// Rows of values from an argument that should be a range (or a single value, as a 1×1).
fn grid(arg: &Expr, book: &mut Context<'_>) -> Result<Vec<Vec<V>>, &'static str> {
    Ok(match eval_inner(arg, book)? {
        V::Range(r) => r,
        V::Err(e) => return Err(e),
        v => vec![vec![v]],
    })
}

/// A criterion as SUMIF and COUNTIF take one: `">5"`, `"<>x"`, `"=a*"`, `"apple"`, 3.
fn matches_criterion(v: &V, criterion: &V) -> bool {
    let (op, operand) = match criterion {
        V::Text(t) => {
            let t = t.as_str();
            let op = ["<=", ">=", "<>", "<", ">", "="].into_iter().find(|o| t.starts_with(o)).unwrap_or("");
            let rest = &t[op.len()..];
            let operand = match rest.parse::<f64>() {
                Ok(n) => V::Num(n),
                Err(_) if rest.eq_ignore_ascii_case("TRUE") => V::Bool(true),
                Err(_) if rest.eq_ignore_ascii_case("FALSE") => V::Bool(false),
                Err(_) => V::Text(rest.to_string()),
            };
            (if op.is_empty() { "=" } else { op }, operand)
        }
        other => ("=", other.clone()),
    };
    // Equality with text uses wildcards; numbers compare only with numbers.
    match (&operand, v) {
        (V::Text(pattern), _) if op == "=" || op == "<>" => {
            let s = match v {
                V::Text(s) => s.clone(),
                V::Empty => String::new(),
                _ => return op == "<>",
            };
            let m = wildcard(&pattern.to_lowercase(), &s.to_lowercase());
            if op == "=" {
                m
            } else {
                !m
            }
        }
        (V::Num(_), V::Num(_)) | (V::Bool(_), V::Bool(_)) | (V::Text(_), V::Text(_)) => match compare(v, &operand) {
            Ok(o) => match op {
                "=" => o.is_eq(),
                "<>" => o.is_ne(),
                "<" => o.is_lt(),
                "<=" => o.is_le(),
                ">" => o.is_gt(),
                _ => o.is_ge(),
            },
            Err(_) => false,
        },
        _ => op == "<>",
    }
}

/// `*` any run, `?` any one character, `~` escapes.
fn wildcard(pattern: &str, s: &str) -> bool {
    let s: Vec<char> = s.chars().collect();
    let mut matched = vec![false; s.len() + 1];
    matched[0] = true;
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        if c == '*' {
            for i in 1..=s.len() {
                matched[i] |= matched[i - 1];
            }
        } else {
            let literal = if c == '~' { chars.next().unwrap_or('~') } else { c };
            for i in (1..=s.len()).rev() {
                matched[i] = matched[i - 1] && (c == '?' || s[i - 1] == literal);
            }
            matched[0] = false;
        }
    }
    matched[s.len()]
}

fn round_to(n: f64, digits: i32, how: fn(f64) -> f64) -> f64 {
    let f = 10f64.powi(digits);
    // Excel rounds what it shows: 2.675 to 2 places is 2.68, though 2.675 is a hair under.
    let scaled = (n * f * 1e9).round() / 1e9;
    how(scaled) / f
}

fn round_half_away(x: f64) -> f64 {
    x.signum() * (x.abs() + 0.5).floor()
}

fn call(name: &str, args: &[Expr], book: &mut Context<'_>) -> R {
    let arg = |i: usize, book: &mut Context<'_>| -> R { args.get(i).map(|a| eval_inner(a, book).map(scalar)).unwrap_or(Ok(V::Empty)) };
    let n_arg = |i: usize, book: &mut Context<'_>| -> Result<f64, &'static str> { num(&arg(i, book)?) };
    let need = |min: usize, max: usize| if args.len() < min || args.len() > max { Err("#VALUE!") } else { Ok(()) };
    let sys = book.date_system();
    Ok(match name {
        // ---- maths ----
        "SUM" => V::Num(numbers(args, book)?.iter().sum()),
        "PRODUCT" => V::Num(numbers(args, book)?.iter().product()),
        "AVERAGE" => {
            let n = numbers(args, book)?;
            if n.is_empty() {
                return Err("#DIV/0!");
            }
            V::Num(n.iter().sum::<f64>() / n.len() as f64)
        }
        "MIN" => V::Num(numbers(args, book)?.into_iter().reduce(f64::min).unwrap_or(0.0)),
        "MAX" => V::Num(numbers(args, book)?.into_iter().reduce(f64::max).unwrap_or(0.0)),
        "COUNT" => V::Num(
            flatten(args, book)?
                .iter()
                .filter(|(v, in_range)| matches!(v, V::Num(_)) || !in_range && num(v).is_ok() && !matches!(v, V::Empty))
                .count() as f64,
        ),
        "COUNTA" => V::Num(flatten(args, book)?.iter().filter(|(v, _)| !matches!(v, V::Empty)).count() as f64),
        "COUNTBLANK" => {
            V::Num(flatten(args, book)?.iter().filter(|(v, _)| matches!(v, V::Empty) || matches!(v, V::Text(t) if t.is_empty())).count()
                as f64)
        }
        "ABS" => V::Num(n_arg(0, book)?.abs()),
        "INT" => V::Num(n_arg(0, book)?.floor()),
        "SIGN" => V::Num(n_arg(0, book)?.signum()),
        "SQRT" => {
            let n = n_arg(0, book)?;
            if n < 0.0 {
                return Err("#NUM!");
            }
            V::Num(n.sqrt())
        }
        "POWER" => binary(Op::Pow, &arg(0, book)?, &arg(1, book)?)?,
        "MOD" => {
            let (n, d) = (n_arg(0, book)?, n_arg(1, book)?);
            if d == 0.0 {
                return Err("#DIV/0!");
            }
            // The result has the divisor's sign, as in Excel.
            V::Num(n - d * (n / d).floor())
        }
        "ROUND" | "ROUNDUP" | "ROUNDDOWN" => {
            need(1, 2)?;
            let (n, d) = (n_arg(0, book)?, n_arg(1, book)? as i32);
            let how: fn(f64) -> f64 = match name {
                "ROUNDUP" => |x| x.signum() * x.abs().ceil(),
                "ROUNDDOWN" => f64::trunc,
                _ => round_half_away,
            };
            V::Num(round_to(n, d, how))
        }
        "PI" => V::Num(std::f64::consts::PI),
        "LN" | "LOG10" | "EXP" => {
            let n = n_arg(0, book)?;
            finite(match name {
                "EXP" => n.exp(),
                _ if n <= 0.0 => return Err("#NUM!"),
                "LN" => n.ln(),
                _ => n.log10(),
            })?
        }
        "SUMPRODUCT" => {
            let grids: Vec<Vec<Vec<V>>> = args.iter().map(|a| grid(a, book)).collect::<Result<_, _>>()?;
            let shape = grids.first().map(|g| (g.len(), g.first().map_or(0, Vec::len))).unwrap_or((0, 0));
            if grids.iter().any(|g| g.len() != shape.0 || g.iter().any(|r| r.len() != shape.1)) {
                return Err("#VALUE!");
            }
            for v in grids.iter().flatten().flatten() {
                if let V::Err(e) = v {
                    return Err(e);
                }
            }
            let mut total = 0.0;
            for r in 0..shape.0 {
                for c in 0..shape.1 {
                    total += grids.iter().map(|g| if let V::Num(n) = g[r][c] { n } else { 0.0 }).product::<f64>();
                }
            }
            V::Num(total)
        }
        "SUMIF" | "COUNTIF" | "AVERAGEIF" => {
            let range = grid(args.first().ok_or("#VALUE!")?, book)?;
            let criterion = arg(1, book)?;
            let values = if args.len() > 2 && name != "COUNTIF" { grid(&args[2], book)? } else { range.clone() };
            let mut picked = Vec::new();
            for (r, row) in range.iter().enumerate() {
                for (c, v) in row.iter().enumerate() {
                    if matches_criterion(v, &criterion) {
                        picked.push(values.get(r).and_then(|x| x.get(c)).cloned().unwrap_or(V::Empty));
                    }
                }
            }
            match name {
                "COUNTIF" => V::Num(picked.len() as f64),
                _ => {
                    let nums: Vec<f64> = picked.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect();
                    if name == "SUMIF" {
                        V::Num(nums.iter().sum())
                    } else if nums.is_empty() {
                        return Err("#DIV/0!");
                    } else {
                        V::Num(nums.iter().sum::<f64>() / nums.len() as f64)
                    }
                }
            }
        }
        // ---- logic ----
        "IF" => {
            need(1, 3)?;
            if truthy(&arg(0, book)?)? {
                if args.len() > 1 {
                    arg(1, book)?
                } else {
                    V::Bool(true)
                }
            } else if args.len() > 2 {
                arg(2, book)?
            } else {
                V::Bool(false)
            }
        }
        "IFERROR" => match arg(0, book) {
            Ok(V::Err(_)) | Err(_) => arg(1, book)?,
            Ok(v) => v,
        },
        "IFNA" => match arg(0, book) {
            Ok(V::Err("#N/A")) | Err("#N/A") => arg(1, book)?,
            Ok(v) => v,
            Err(e) => return Err(e),
        },
        "AND" | "OR" | "XOR" => {
            let vals: Vec<bool> = flatten(args, book)?
                .iter()
                .filter(|(v, in_range)| !(*in_range && matches!(v, V::Text(_) | V::Empty)))
                .map(|(v, _)| truthy(v))
                .collect::<Result<_, _>>()?;
            if vals.is_empty() {
                return Err("#VALUE!");
            }
            V::Bool(match name {
                "AND" => vals.iter().all(|b| *b),
                "OR" => vals.iter().any(|b| *b),
                _ => vals.iter().filter(|b| **b).count() % 2 == 1,
            })
        }
        "NOT" => V::Bool(!truthy(&arg(0, book)?)?),
        "TRUE" => V::Bool(true),
        "FALSE" => V::Bool(false),
        "ISBLANK" => V::Bool(matches!(arg(0, book), Ok(V::Empty))),
        "ISNUMBER" => V::Bool(matches!(arg(0, book), Ok(V::Num(_)))),
        "ISTEXT" => V::Bool(matches!(arg(0, book), Ok(V::Text(_)))),
        "ISNONTEXT" => V::Bool(!matches!(arg(0, book), Ok(V::Text(_)))),
        "ISLOGICAL" => V::Bool(matches!(arg(0, book), Ok(V::Bool(_)))),
        "ISERR" => V::Bool(matches!(arg(0, book), Ok(V::Err(e)) | Err(e) if e != "#N/A")),
        "ISERROR" => V::Bool(matches!(arg(0, book), Ok(V::Err(_)) | Err(_))),
        "ISNA" => V::Bool(matches!(arg(0, book), Ok(V::Err("#N/A")) | Err("#N/A"))),
        "NA" => return Err("#N/A"),
        // ---- text ----
        "CONCATENATE" | "CONCAT" => {
            let mut s = String::new();
            for (v, _) in flatten(args, book)? {
                s.push_str(&text(&v)?);
            }
            V::Text(s)
        }
        "TEXTJOIN" => {
            let sep = text(&arg(0, book)?)?;
            let skip_empty = truthy(&arg(1, book)?)?;
            let parts: Vec<String> = flatten(&args[2.min(args.len())..], book)?.iter().map(|(v, _)| text(v)).collect::<Result<_, _>>()?;
            V::Text(parts.into_iter().filter(|p| !(skip_empty && p.is_empty())).collect::<Vec<_>>().join(&sep))
        }
        "LEN" => V::Num(text(&arg(0, book)?)?.chars().count() as f64),
        "UPPER" => V::Text(text(&arg(0, book)?)?.to_uppercase()),
        "LOWER" => V::Text(text(&arg(0, book)?)?.to_lowercase()),
        "PROPER" => {
            let s = text(&arg(0, book)?)?;
            let mut out = String::new();
            let mut start = true;
            for c in s.chars() {
                out.extend(if start { c.to_uppercase().collect::<Vec<_>>() } else { c.to_lowercase().collect() });
                start = !c.is_alphabetic();
            }
            V::Text(out)
        }
        // Excel's TRIM also squeezes runs of spaces inside.
        "TRIM" => V::Text(text(&arg(0, book)?)?.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")),
        "LEFT" | "RIGHT" => {
            let s: Vec<char> = text(&arg(0, book)?)?.chars().collect();
            let n = if args.len() > 1 { n_arg(1, book)? } else { 1.0 };
            if n < 0.0 {
                return Err("#VALUE!");
            }
            let n = (n as usize).min(s.len());
            V::Text(if name == "LEFT" { s[..n].iter().collect() } else { s[s.len() - n..].iter().collect() })
        }
        "MID" => {
            let s: Vec<char> = text(&arg(0, book)?)?.chars().collect();
            let (start, len) = (n_arg(1, book)?, n_arg(2, book)?);
            if start < 1.0 || len < 0.0 {
                return Err("#VALUE!");
            }
            let from = (start as usize - 1).min(s.len());
            V::Text(s[from..from.saturating_add(len as usize).min(s.len())].iter().collect())
        }
        "FIND" | "SEARCH" => {
            let (needle, hay) = (text(&arg(0, book)?)?, text(&arg(1, book)?)?);
            let start = if args.len() > 2 { n_arg(2, book)? as usize } else { 1 };
            let chars: Vec<char> = hay.chars().collect();
            if start < 1 || start > chars.len() + 1 {
                return Err("#VALUE!");
            }
            let rest: String = chars[start - 1..].iter().collect();
            let at = if name == "FIND" {
                rest.find(&needle).map(|b| rest[..b].chars().count())
            } else {
                let pattern = format!("{}*", needle.to_lowercase());
                (0..=rest.chars().count()).find(|&i| wildcard(&pattern, &rest.chars().skip(i).collect::<String>().to_lowercase()))
            };
            V::Num((at.ok_or("#VALUE!")? + start) as f64)
        }
        "SUBSTITUTE" => {
            let (s, old, new) = (text(&arg(0, book)?)?, text(&arg(1, book)?)?, text(&arg(2, book)?)?);
            if old.is_empty() {
                V::Text(s)
            } else if args.len() > 3 {
                let nth = n_arg(3, book)? as usize;
                match s.match_indices(&old).nth(nth.saturating_sub(1)) {
                    Some((i, _)) => V::Text(format!("{}{}{}", &s[..i], new, &s[i + old.len()..])),
                    None => V::Text(s),
                }
            } else {
                V::Text(s.replace(&old, &new))
            }
        }
        "REPT" => {
            let (s, n) = (text(&arg(0, book)?)?, n_arg(1, book)?.max(0.0) as usize);
            // Excel's limit on a cell's text.
            if s.chars().count().saturating_mul(n) > 32_767 {
                return Err("#VALUE!");
            }
            V::Text(s.repeat(n))
        }
        "VALUE" => V::Num(num(&V::Text(text(&arg(0, book)?)?))?),
        "TEXT" => {
            let v = arg(0, book)?;
            let code = text(&arg(1, book)?)?;
            let value = match &v {
                V::Text(t) => t.trim().parse::<f64>().map(Value::Number).unwrap_or_else(|_| Value::Text(t.clone())),
                other => other.to_value(),
            };
            V::Text(crate::numfmt::format(&value, &code, sys).text)
        }
        "CHAR" => {
            V::Text(char::from_u32(n_arg(0, book)? as u32).filter(|c| (1..=255).contains(&(*c as u32))).ok_or("#VALUE!")?.to_string())
        }
        "CODE" => V::Num(text(&arg(0, book)?)?.chars().next().ok_or("#VALUE!")? as u32 as f64),
        "EXACT" => V::Bool(text(&arg(0, book)?)? == text(&arg(1, book)?)?),
        // ---- lookup ----
        "VLOOKUP" | "HLOOKUP" => {
            need(3, 4)?;
            let key = arg(0, book)?;
            let mut table = grid(&args[1], book)?;
            if name == "HLOOKUP" {
                table = transpose(table);
            }
            let index = n_arg(2, book)? as usize;
            let approximate = args.len() < 4 || truthy(&arg(3, book)?)?;
            if index < 1 || table.first().is_none_or(|r| index > r.len()) {
                return Err(if index < 1 { "#VALUE!" } else { "#REF!" });
            }
            let column: Vec<V> = table.iter().map(|r| r[0].clone()).collect();
            let row = lookup(&key, &column, if approximate { 1 } else { 0 })?;
            table[row][index - 1].clone()
        }
        "MATCH" => {
            let key = arg(0, book)?;
            let g = grid(args.get(1).ok_or("#N/A")?, book)?;
            let list: Vec<V> = if g.len() == 1 {
                g.into_iter().next().unwrap()
            } else {
                g.into_iter().map(|r| r.into_iter().next().unwrap_or(V::Empty)).collect()
            };
            let kind = if args.len() > 2 { n_arg(2, book)? as i32 } else { 1 };
            V::Num((lookup(&key, &list, kind)? + 1) as f64)
        }
        "INDEX" => {
            let g = grid(args.first().ok_or("#VALUE!")?, book)?;
            let (r, c) =
                (if args.len() > 1 { n_arg(1, book)? as usize } else { 1 }, if args.len() > 2 { n_arg(2, book)? as usize } else { 0 });
            // INDEX(column, n) and INDEX(row, n) both pick the nth.
            let (r, c) = match (g.len(), c) {
                (1, 0) => (1, r),
                (_, 0) => (r, 1),
                _ => (r, c),
            };
            g.get(r.wrapping_sub(1)).and_then(|row| row.get(c.wrapping_sub(1))).cloned().ok_or("#REF!")?
        }
        "CHOOSE" => {
            let i = n_arg(0, book)? as usize;
            if i < 1 || i >= args.len() {
                return Err("#VALUE!");
            }
            arg(i, book)?
        }
        "ROWS" | "COLUMNS" => {
            let g = grid(args.first().ok_or("#VALUE!")?, book)?;
            V::Num(if name == "ROWS" { g.len() } else { g.first().map_or(0, Vec::len) } as f64)
        }
        // ---- dates ----
        "DATE" => finite(dates::date(n_arg(0, book)? as i64, n_arg(1, book)? as i64, n_arg(2, book)? as i64, sys))?,
        "YEAR" | "MONTH" | "DAY" | "WEEKDAY" | "HOUR" | "MINUTE" | "SECOND" => {
            let dt = dates::from_serial(n_arg(0, book)?, sys).ok_or("#NUM!")?;
            V::Num(match name {
                "YEAR" => dt.year as f64,
                "MONTH" => dt.month as f64,
                "DAY" => dt.day as f64,
                // Sunday is 1, as WEEKDAY's default has it.
                "WEEKDAY" => (dt.weekday() % 7 + 1) as f64,
                "HOUR" => dt.hour as f64,
                "MINUTE" => dt.minute as f64,
                _ => dt.second as f64,
            })
        }
        "TIME" => V::Num((n_arg(0, book)? * 3600.0 + n_arg(1, book)? * 60.0 + n_arg(2, book)?).rem_euclid(86_400.0) / 86_400.0),
        "NOW" => V::Num(book.now().ok_or("#N/A")?),
        "TODAY" => V::Num(book.now().ok_or("#N/A")?.floor()),
        _ => return Err("#NAME?"),
    })
}

fn transpose(g: Vec<Vec<V>>) -> Vec<Vec<V>> {
    let cols = g.first().map_or(0, Vec::len);
    (0..cols).map(|c| g.iter().map(|r| r.get(c).cloned().unwrap_or(V::Empty)).collect()).collect()
}

/// Where `key` is in `list`: exactly (kind 0, with wildcards for text), or the last value not
/// greater (kind 1, list ascending) or not smaller (kind -1, descending).
fn lookup(key: &V, list: &[V], kind: i32) -> Result<usize, &'static str> {
    if kind == 0 {
        return list
            .iter()
            .position(|v| match (key, v) {
                (V::Text(k), V::Text(s)) => wildcard(&k.to_lowercase(), &s.to_lowercase()),
                _ => compare(v, key).is_ok_and(|o| o.is_eq()) && std::mem::discriminant(v) == std::mem::discriminant(key),
            })
            .ok_or("#N/A");
    }
    let mut best = None;
    for (i, v) in list.iter().enumerate() {
        if matches!(v, V::Empty) || std::mem::discriminant(v) != std::mem::discriminant(key) {
            continue;
        }
        let Ok(o) = compare(v, key) else { continue };
        if o.is_eq() || (kind > 0 && o.is_lt()) || (kind < 0 && o.is_gt()) {
            best = Some(i);
        } else {
            break;
        }
    }
    best.ok_or("#N/A")
}

/// A [`Book`] over plain values, for evaluating formulas without a workbook (and for tests).
#[derive(Default)]
pub struct Values {
    pub cells: HashMap<(u32, u32), V>,
    pub names: HashMap<String, Expr>,
}

impl Book for Values {
    fn cell(&mut self, _sheet: Option<&str>, row: u32, col: u32) -> V {
        self.cells.get(&(row, col)).cloned().unwrap_or(V::Empty)
    }
    fn extent(&self, _sheet: Option<&str>) -> Option<(u32, u32)> {
        let rows = self.cells.keys().map(|k| k.0).max()?;
        let cols = self.cells.keys().map(|k| k.1).max()?;
        Some((rows, cols))
    }
    fn name(&self, name: &str) -> Option<Expr> {
        self.names.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, e)| e.clone())
    }
    fn date_system(&self) -> DateSystem {
        DateSystem::From1900
    }
    fn now(&self) -> Option<f64> {
        None
    }
}

/// The text a value shows as in a formula's result, with no number format.
pub fn plain(v: &V) -> String {
    match v {
        V::Num(n) => format_number(*n),
        V::Err(e) => e.to_string(),
        other => text(other).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::parse;

    fn book() -> Values {
        let mut b = Values::default();
        // A1:A5 = 1..5, B1:B5 = fruit, C1 = "3", D1 = TRUE.
        for (r, fruit) in ["apple", "banana", "cherry", "apple", "date"].iter().enumerate() {
            b.cells.insert((r as u32, 0), V::Num(r as f64 + 1.0));
            b.cells.insert((r as u32, 1), V::Text(fruit.to_string()));
        }
        b.cells.insert((0, 2), V::Text("3".into()));
        b.cells.insert((0, 3), V::Bool(true));
        b.names.insert("Rate".into(), parse("0.2").unwrap());
        b
    }

    fn ev(f: &str) -> V {
        eval(&parse(f).unwrap(), &mut book())
    }

    /// A book that counts how often a formula asks how big a sheet is.
    struct Counting(Values, std::cell::Cell<usize>);

    impl Book for Counting {
        fn cell(&mut self, sheet: Option<&str>, row: u32, col: u32) -> V {
            self.0.cell(sheet, row, col)
        }
        fn extent(&self, sheet: Option<&str>) -> Option<(u32, u32)> {
            self.1.set(self.1.get() + 1);
            self.0.extent(sheet)
        }
        fn name(&self, name: &str) -> Option<Expr> {
            self.0.name(name)
        }
        fn date_system(&self) -> DateSystem {
            self.0.date_system()
        }
        fn now(&self) -> Option<f64> {
            None
        }
    }

    #[test]
    fn only_whole_columns_measure_the_sheet() {
        // Measuring a sheet means looking at every row, so a formula with an ordinary range
        // (most of them) mustn't: with thousands of formulas, recalculation would be quadratic.
        let mut b = Counting(book(), Default::default());
        assert_eq!(eval(&parse("SUM(A1:A3)").unwrap(), &mut b), V::Num(6.0));
        assert_eq!(b.1.get(), 0);
        assert!(matches!(eval(&parse("SUM(A:A)").unwrap(), &mut b), V::Num(_)));
        assert_eq!(b.1.get(), 1);
    }

    #[test]
    fn arithmetic_and_coercion() {
        assert_eq!(ev("1+2*3"), V::Num(7.0));
        assert_eq!(ev("-2^2"), V::Num(4.0));
        assert_eq!(ev("10%"), V::Num(0.1));
        assert_eq!(ev("C1+1"), V::Num(4.0), "numeric text is a number in arithmetic");
        assert_eq!(ev("D1+1"), V::Num(2.0));
        assert_eq!(ev("B1+1"), V::Err("#VALUE!"));
        assert_eq!(ev("1/0"), V::Err("#DIV/0!"));
        assert_eq!(ev("\"a\"&1&TRUE"), V::Text("a1TRUE".into()));
        assert_eq!(ev("Z99"), V::Empty);
        assert_eq!(ev("Z99+1"), V::Num(1.0));
        assert_eq!(ev("Rate*100"), V::Num(20.0));
        assert_eq!(ev("Nope*2"), V::Err("#NAME?"));
        assert_eq!(ev("\"B\">\"a\""), V::Bool(true), "text compares without case");
        assert_eq!(ev("1<\"a\""), V::Bool(true), "numbers come before text");
    }

    #[test]
    fn aggregates() {
        assert_eq!(ev("SUM(A1:A5)"), V::Num(15.0));
        assert_eq!(ev("SUM(A1:A5,C1,D1)"), V::Num(15.0), "cell references ignore text and TRUE");
        assert_eq!(ev("SUM(A1:A5,\"3\",TRUE)"), V::Num(19.0), "literal arguments count text and TRUE");
        assert_eq!(ev("SUM(A1:D1)"), V::Num(1.0), "in ranges only numbers count");
        assert_eq!(ev("AVERAGE(A1:A4)"), V::Num(2.5));
        assert_eq!(ev("MAX(A:A)"), V::Num(5.0));
        assert_eq!(ev("COUNT(A1:D5)"), V::Num(5.0));
        assert_eq!(ev("COUNTA(A1:D5)"), V::Num(12.0));
        assert_eq!(ev("SUMIF(B1:B5,\"apple\",A1:A5)"), V::Num(5.0));
        assert_eq!(ev("COUNTIF(A1:A5,\">2\")"), V::Num(3.0));
        assert_eq!(ev("COUNTIF(B1:B5,\"*an*\")"), V::Num(1.0));
        assert_eq!(ev("SUMPRODUCT(A1:A3,A1:A3)"), V::Num(14.0));
        assert_eq!(ev("ROUND(2.675,2)"), V::Num(2.68));
        assert_eq!(ev("ROUND(-2.5,0)"), V::Num(-3.0));
        assert_eq!(ev("ROUNDDOWN(3.99,0)"), V::Num(3.0));
        assert_eq!(ev("MOD(-7,3)"), V::Num(2.0));
    }

    #[test]
    fn logic_text_and_lookup() {
        assert_eq!(ev("IF(A1>0,\"yes\",\"no\")"), V::Text("yes".into()));
        assert_eq!(ev("IF(FALSE,1)"), V::Bool(false));
        assert_eq!(ev("IFERROR(1/0,\"oops\")"), V::Text("oops".into()));
        assert_eq!(ev("AND(A1:A5)"), V::Bool(true));
        assert_eq!(ev("OR(A1>9,D1)"), V::Bool(true));
        assert_eq!(ev("CONCAT(B1:B2)"), V::Text("applebanana".into()));
        assert_eq!(ev("TEXTJOIN(\", \",TRUE,B1:B3)"), V::Text("apple, banana, cherry".into()));
        assert_eq!(ev("UPPER(LEFT(B2,3))&MID(B3,2,3)"), V::Text("BANher".into()));
        assert_eq!(ev("MID(B3,2,1E+30)"), V::Text("herry".into()), "a huge length is the rest of the text");
        assert_eq!(ev("REPT(\"ab\",3)"), V::Text("ababab".into()));
        assert_eq!(ev("REPT(\"x\",1E+18)"), V::Err("#VALUE!"), "more than a cell can hold");
        assert_eq!(ev("TRIM(\"  a   b \")"), V::Text("a b".into()));
        assert_eq!(ev("PROPER(\"hello wORLD\")"), V::Text("Hello World".into()));
        assert_eq!(ev("FIND(\"an\",B2)"), V::Num(2.0));
        assert_eq!(ev("SEARCH(\"N?N\",B2)"), V::Num(3.0));
        assert_eq!(ev("SUBSTITUTE(\"a-b-c\",\"-\",\"+\",2)"), V::Text("a-b+c".into()));
        assert_eq!(ev("TEXT(0.256,\"0.0%\")"), V::Text("25.6%".into()));
        assert_eq!(ev("VLOOKUP(\"cherry\",B1:B5,1,FALSE)"), V::Text("cherry".into()));
        assert_eq!(ev("VLOOKUP(3.5,A1:B5,2)"), V::Text("cherry".into()), "approximate match finds the last not greater");
        assert_eq!(ev("VLOOKUP(\"fig\",B1:B5,1,FALSE)"), V::Err("#N/A"));
        assert_eq!(ev("MATCH(\"date\",B1:B5,0)"), V::Num(5.0));
        assert_eq!(ev("INDEX(B1:B5,MATCH(4,A1:A5,0))"), V::Text("apple".into()));
        assert_eq!(ev("CHOOSE(2,\"a\",\"b\")"), V::Text("b".into()));
        assert_eq!(ev("NOSUCHFUNCTION(1)"), V::Err("#NAME?"));
    }

    #[test]
    fn dates() {
        assert_eq!(ev("DATE(2023,3,15)"), V::Num(45000.0));
        assert_eq!(ev("YEAR(45000)&\"-\"&MONTH(45000)&\"-\"&DAY(45000)"), V::Text("2023-3-15".into()));
        assert_eq!(ev("WEEKDAY(45000)"), V::Num(4.0), "a Wednesday");
        assert_eq!(ev("TIME(18,0,0)"), V::Num(0.75));
        assert_eq!(ev("TODAY()"), V::Err("#N/A"), "no clock given");
    }

    fn nested_ones(terms: usize) -> String {
        let mut formula = String::from("1");
        for _ in 1..terms {
            formula = format!("1+({formula})");
        }
        formula
    }

    #[test]
    fn long_flat_sums_and_concatenation() {
        // A1:A5 are 1..5. A6:A130 are empty, and an empty cell is 0 in arithmetic.
        let cells = (1..=130).map(|row| format!("A{row}")).collect::<Vec<_>>().join("+");
        assert_eq!(ev(&cells), V::Num(15.0));

        let ones = std::iter::repeat_n("1", 200).collect::<Vec<_>>().join("+");
        assert_eq!(ev(&ones), V::Num(200.0));
        let triangle = (1..=200).map(|n| n.to_string()).collect::<Vec<_>>().join("+");
        assert_eq!(ev(&triangle), V::Num((200 * 201 / 2) as f64));

        let cat = std::iter::repeat_n("\"ab\"", 130).collect::<Vec<_>>().join("&");
        assert_eq!(ev(&cat), V::Text("ab".repeat(130)));
    }

    #[test]
    fn spine_keeps_operator_order() {
        assert_eq!(ev("1-2-3"), V::Num(-4.0));
        assert_eq!(ev("2^3^2"), V::Num(64.0));
        assert_eq!(ev("1+2*3+4*5"), V::Num(27.0));
        assert_eq!(ev("\"a\"&1+2&\"b\""), V::Text("a3b".into()));
    }

    #[test]
    fn nested_additions_hit_the_depth_guard() {
        // Real nesting still counts. 128 ones fit. 140 do not.
        assert_eq!(ev(&nested_ones(128)), V::Num(128.0));
        assert_eq!(ev(&nested_ones(140)), V::Err("#REF!"));
    }

    #[test]
    fn deep_unary_hits_the_depth_guard() {
        assert_eq!(ev(&format!("{}1", "-".repeat(127))), V::Num(-1.0));
        assert_eq!(ev(&format!("{}1", "-".repeat(140))), V::Err("#REF!"));
    }

    #[test]
    fn chain_skips_operands_after_an_error() {
        struct Clock(std::cell::Cell<u32>);
        impl Book for Clock {
            fn cell(&mut self, _: Option<&str>, _: u32, _: u32) -> V {
                V::Num(1.0)
            }
            fn extent(&self, _: Option<&str>) -> Option<(u32, u32)> {
                None
            }
            fn name(&self, _: &str) -> Option<Expr> {
                None
            }
            fn date_system(&self) -> DateSystem {
                DateSystem::From1900
            }
            fn now(&self) -> Option<f64> {
                self.0.set(self.0.get() + 1);
                Some(10.0)
            }
        }

        let mut clock = Clock(std::cell::Cell::new(0));
        assert_eq!(eval(&parse("1/0+NOW()+NOW()").unwrap(), &mut clock), V::Err("#DIV/0!"));
        assert_eq!(clock.0.get(), 0, "nothing after the failing left operand runs");

        let mut chain = std::iter::repeat_n("1", 100).collect::<Vec<_>>().join("+");
        chain.push_str("+1/0+NOW()");
        assert_eq!(eval(&parse(&chain).unwrap(), &mut clock), V::Err("#DIV/0!"));
        assert_eq!(clock.0.get(), 0);

        assert_eq!(eval(&parse("NOW()+1/0+NOW()").unwrap(), &mut clock), V::Err("#DIV/0!"));
        assert_eq!(clock.0.get(), 1, "the operand before the error did run, and the one after it did not");
    }
}
