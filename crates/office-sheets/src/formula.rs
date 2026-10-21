//! Formulas: reading Excel's formula text into a tree, and moving a formula's relative
//! references the way copying it to another cell does (which is how shared formulas work).

use office_core::model::CellRef;

/// One end of a reference. A whole column (`A:A`) has no row; a whole row (`1:1`) no column.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct RefPart {
    pub row: Option<u32>,
    pub col: Option<u32>,
    pub row_abs: bool,
    pub col_abs: bool,
}

/// A cell or a range, perhaps on another sheet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reference {
    pub sheet: Option<String>,
    pub start: RefPart,
    pub end: Option<RefPart>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Concat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Number(f64),
    Text(String),
    Bool(bool),
    Error(String),
    Ref(Reference),
    /// A defined name.
    Name(String),
    Neg(Box<Expr>),
    Percent(Box<Expr>),
    Binary(Op, Box<Expr>, Box<Expr>),
    /// A function, by its name in capitals (`_xlfn.` prefixes dropped).
    Call(String, Vec<Expr>),
    /// `{1,2;3,4}`: rows of constants.
    Array(Vec<Vec<Expr>>),
    /// An argument left out: the second in `IF(A1,,0)`.
    Missing,
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Number(f64),
    Text(String),
    Error(String),
    Ref(Reference),
    Ident(String),
    Op(String),
    Open,
    Close,
    Comma,
    Semi,
    OpenBrace,
    CloseBrace,
}

const ERRORS: [&str; 8] = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA"];

/// Splits formula text into tokens with where each one is (so references can be rewritten in
/// place). Whitespace is left out.
fn lex(src: &str) -> Result<Vec<(Tok, std::ops::Range<usize>)>, String> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let start = i;
        let c = b[i] as char;
        let tok = match c {
            ' ' | '\t' | '\n' | '\r' => {
                i += 1;
                continue;
            }
            '"' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match src[i..].find('"') {
                        Some(j) => {
                            s.push_str(&src[i..i + j]);
                            i += j + 1;
                            if b.get(i) == Some(&b'"') {
                                s.push('"');
                                i += 1;
                            } else {
                                break;
                            }
                        }
                        None => return Err("a string isn't closed".into()),
                    }
                }
                Tok::Text(s)
            }
            '#' => {
                let e = ERRORS.iter().find(|e| src[i..].to_ascii_uppercase().starts_with(*e)).ok_or("unknown error value")?;
                i += e.len();
                Tok::Error(e.to_string())
            }
            '(' => {
                i += 1;
                Tok::Open
            }
            ')' => {
                i += 1;
                Tok::Close
            }
            ',' => {
                i += 1;
                Tok::Comma
            }
            ';' => {
                i += 1;
                Tok::Semi
            }
            '{' => {
                i += 1;
                Tok::OpenBrace
            }
            '}' => {
                i += 1;
                Tok::CloseBrace
            }
            '<' | '>' => {
                let two = &src[i..(i + 2).min(src.len())];
                let op = if two == "<=" || two == ">=" || two == "<>" { two } else { &src[i..i + 1] };
                i += op.len();
                Tok::Op(op.to_string())
            }
            '+' | '-' | '*' | '/' | '^' | '&' | '=' | '%' => {
                i += 1;
                Tok::Op(c.to_string())
            }
            '0'..='9' | '.' => {
                // A number, unless it's a whole-row range (1:3) or a cell further on.
                if let Some((r, len)) = reference(src, i, None) {
                    i += len;
                    Tok::Ref(r)
                } else {
                    let mut j = i;
                    while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'.') {
                        j += 1;
                    }
                    if j < b.len() && (b[j] == b'e' || b[j] == b'E') {
                        let mut k = j + 1;
                        if k < b.len() && (b[k] == b'+' || b[k] == b'-') {
                            k += 1;
                        }
                        if k < b.len() && b[k].is_ascii_digit() {
                            while k < b.len() && b[k].is_ascii_digit() {
                                k += 1;
                            }
                            j = k;
                        }
                    }
                    let n = src[i..j].parse().map_err(|_| format!("not a number: {}", &src[i..j]))?;
                    i = j;
                    Tok::Number(n)
                }
            }
            '\'' => {
                // 'A sheet name'!A1
                let mut j = i + 1;
                let mut name = String::new();
                loop {
                    match b.get(j) {
                        Some(b'\'') if b.get(j + 1) == Some(&b'\'') => {
                            name.push('\'');
                            j += 2;
                        }
                        Some(b'\'') => break,
                        Some(_) => {
                            let ch = src[j..].chars().next().unwrap();
                            name.push(ch);
                            j += ch.len_utf8();
                        }
                        None => return Err("a sheet name isn't closed".into()),
                    }
                }
                if b.get(j + 1) != Some(&b'!') {
                    return Err("a quoted name that isn't a sheet".into());
                }
                let (r, len) = reference(src, j + 2, Some(name)).ok_or("no reference after the sheet name")?;
                i = j + 2 + len;
                Tok::Ref(r)
            }
            c if c == '$' || c == '_' || c == '\\' || c.is_alphabetic() || !c.is_ascii() => {
                if let Some((r, len)) = reference(src, i, None) {
                    i += len;
                    Tok::Ref(r)
                } else {
                    let mut j = i;
                    while j < src.len() {
                        let ch = src[j..].chars().next().unwrap();
                        if ch.is_alphanumeric() || ch == '_' || ch == '.' || ch == '\\' || ch == '$' {
                            j += ch.len_utf8();
                        } else {
                            break;
                        }
                    }
                    let word = &src[i..j];
                    // Sheet1!A1
                    if b.get(j) == Some(&b'!') {
                        let (r, len) = reference(src, j + 1, Some(word.to_string())).ok_or("no reference after the sheet name")?;
                        i = j + 1 + len;
                        Tok::Ref(r)
                    } else {
                        i = j;
                        Tok::Ident(word.to_string())
                    }
                }
            }
            c => return Err(format!("unexpected {c:?}")),
        };
        out.push((tok, start..i));
    }
    Ok(out)
}

/// A reference at `at`: `A1`, `$A$1`, `A1:B2`, `A:C`, `1:3`. Not when it's a function's name
/// (`LOG10(`), or runs on into a longer name.
fn reference(src: &str, at: usize, sheet: Option<String>) -> Option<(Reference, usize)> {
    fn part(s: &[u8], mut i: usize) -> Option<(RefPart, usize)> {
        let start = i;
        let col_abs = s.get(i) == Some(&b'$');
        if col_abs {
            i += 1;
        }
        let cs = i;
        while i < s.len() && s[i].is_ascii_alphabetic() {
            i += 1;
        }
        let col = if i > cs && i - cs <= 3 {
            Some(s[cs..i].iter().fold(0u32, |n, c| n * 26 + (c.to_ascii_uppercase() - b'A' + 1) as u32) - 1)
        } else if i == cs {
            None
        } else {
            return None;
        };
        let row_abs = s.get(i) == Some(&b'$');
        let ri = if row_abs { i + 1 } else { i };
        let mut j = ri;
        while j < s.len() && s[j].is_ascii_digit() {
            j += 1;
        }
        let row = if j > ri { std::str::from_utf8(&s[ri..j]).ok()?.parse::<u32>().ok().filter(|r| *r >= 1).map(|r| r - 1) } else { None };
        if j > ri {
            i = j;
        } else if row_abs {
            return None;
        }
        if col.is_none() && row.is_none() || col.is_some_and(|c| c > 16_383) || row.is_some_and(|r| r > 1_048_575) {
            return None;
        }
        Some((RefPart { row, col, row_abs: row_abs && row.is_some(), col_abs: col_abs && col.is_some() }, i - start))
    }
    let s = src.as_bytes();
    let (first, n1) = part(s, at)?;
    let mut len = n1;
    let mut end = None;
    if s.get(at + len) == Some(&b':') {
        if let Some((second, n2)) = part(s, at + len + 1) {
            // Both ends must be the same kind: cells, whole columns or whole rows.
            let kind = |p: &RefPart| (p.row.is_some(), p.col.is_some());
            if kind(&first) == kind(&second) {
                end = Some(second);
                len += 1 + n2;
            }
        }
    }
    // Alone, a whole column or row isn't a reference (A is a name, 1 is a number).
    if end.is_none() && (first.row.is_none() || first.col.is_none()) {
        return None;
    }
    // Not a function (LOG10() or a longer name (A1B).
    let next = src[at + len..].chars().next();
    if next.is_some_and(|c| c == '(' || c.is_alphanumeric() || c == '_' || c == '.') {
        return None;
    }
    Some((Reference { sheet, start: first, end }, len))
}

/// Parses formula text (without its `=`).
pub fn parse(src: &str) -> Result<Expr, String> {
    let toks = lex(src)?;
    let mut p = Parser { toks: toks.into_iter().map(|(t, _)| t).collect(), at: 0 };
    let e = p.compare()?;
    if p.at != p.toks.len() {
        return Err(format!("unexpected {:?}", p.toks[p.at]));
    }
    Ok(e)
}

struct Parser {
    toks: Vec<Tok>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.at)
    }

    fn op(&self, ops: &[&str]) -> Option<String> {
        match self.peek() {
            Some(Tok::Op(o)) if ops.contains(&o.as_str()) => Some(o.clone()),
            _ => None,
        }
    }

    fn binary(&mut self, ops: &[&str], next: fn(&mut Parser) -> Result<Expr, String>) -> Result<Expr, String> {
        let mut left = next(self)?;
        while let Some(o) = self.op(ops) {
            self.at += 1;
            let right = next(self)?;
            let op = match o.as_str() {
                "=" => Op::Eq,
                "<>" => Op::Ne,
                "<" => Op::Lt,
                "<=" => Op::Le,
                ">" => Op::Gt,
                ">=" => Op::Ge,
                "&" => Op::Concat,
                "+" => Op::Add,
                "-" => Op::Sub,
                "*" => Op::Mul,
                "/" => Op::Div,
                _ => Op::Pow,
            };
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn compare(&mut self) -> Result<Expr, String> {
        self.binary(&["=", "<>", "<", "<=", ">", ">="], Parser::concat)
    }
    fn concat(&mut self) -> Result<Expr, String> {
        self.binary(&["&"], Parser::additive)
    }
    fn additive(&mut self) -> Result<Expr, String> {
        self.binary(&["+", "-"], Parser::multiplicative)
    }
    fn multiplicative(&mut self) -> Result<Expr, String> {
        self.binary(&["*", "/"], Parser::power)
    }
    fn power(&mut self) -> Result<Expr, String> {
        self.binary(&["^"], Parser::percent)
    }

    fn percent(&mut self) -> Result<Expr, String> {
        let mut e = self.unary()?;
        while self.op(&["%"]).is_some() {
            self.at += 1;
            e = Expr::Percent(Box::new(e));
        }
        Ok(e)
    }

    /// Excel's minus binds tighter than ^: -2^2 is 4.
    fn unary(&mut self) -> Result<Expr, String> {
        match self.op(&["-", "+"]) {
            Some(o) => {
                self.at += 1;
                let e = self.unary()?;
                Ok(if o == "-" { Expr::Neg(Box::new(e)) } else { e })
            }
            None => self.primary(),
        }
    }

    fn primary(&mut self) -> Result<Expr, String> {
        let tok = self.peek().cloned().ok_or("the formula ends too soon")?;
        self.at += 1;
        Ok(match tok {
            Tok::Number(n) => Expr::Number(n),
            Tok::Text(s) => Expr::Text(s),
            Tok::Error(e) => Expr::Error(e),
            Tok::Ref(r) => Expr::Ref(r),
            Tok::Open => {
                let e = self.compare()?;
                self.expect(Tok::Close)?;
                e
            }
            Tok::OpenBrace => {
                let mut rows = vec![Vec::new()];
                loop {
                    rows.last_mut().unwrap().push(self.unary()?);
                    match self.peek() {
                        Some(Tok::Comma) => self.at += 1,
                        Some(Tok::Semi) => {
                            self.at += 1;
                            rows.push(Vec::new());
                        }
                        _ => break,
                    }
                }
                self.expect(Tok::CloseBrace)?;
                Expr::Array(rows)
            }
            Tok::Ident(name) => {
                if self.peek() == Some(&Tok::Open) {
                    self.at += 1;
                    let mut args = Vec::new();
                    if self.peek() != Some(&Tok::Close) {
                        loop {
                            if matches!(self.peek(), Some(Tok::Comma | Tok::Close)) {
                                args.push(Expr::Missing);
                            } else {
                                args.push(self.compare()?);
                            }
                            if self.peek() == Some(&Tok::Comma) {
                                self.at += 1;
                            } else {
                                break;
                            }
                        }
                    }
                    self.expect(Tok::Close)?;
                    let upper = name.to_ascii_uppercase();
                    // Newer functions are saved with a prefix older Excel ignores.
                    let upper = ["_XLFN.", "_XLWS."].iter().fold(upper.as_str(), |n, p| n.strip_prefix(p).unwrap_or(n)).to_string();
                    Expr::Call(upper, args)
                } else if name.eq_ignore_ascii_case("TRUE") {
                    Expr::Bool(true)
                } else if name.eq_ignore_ascii_case("FALSE") {
                    Expr::Bool(false)
                } else {
                    Expr::Name(name)
                }
            }
            t => return Err(format!("unexpected {t:?}")),
        })
    }

    fn expect(&mut self, t: Tok) -> Result<(), String> {
        if self.peek() == Some(&t) {
            self.at += 1;
            Ok(())
        } else {
            Err(format!("expected {t:?}"))
        }
    }
}

fn write_part(p: &RefPart) -> String {
    let mut s = String::new();
    if let Some(c) = p.col {
        if p.col_abs {
            s.push('$');
        }
        s.push_str(&CellRef::column_name(c));
    }
    if let Some(r) = p.row {
        if p.row_abs {
            s.push('$');
        }
        s.push_str(&(r + 1).to_string());
    }
    s
}

fn write_sheet(name: &str) -> String {
    let plain =
        name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.') && !name.chars().next().is_some_and(|c| c.is_ascii_digit());
    if plain {
        format!("{name}!")
    } else {
        format!("'{}'!", name.replace('\'', "''"))
    }
}

/// The formula as it reads copied `rows` down and `cols` across: relative references move,
/// absolute ones (`$A$1`) stay. A reference moved off the sheet becomes `#REF!`.
pub fn shift(src: &str, rows: i64, cols: i64) -> Result<String, String> {
    let toks = lex(src)?;
    let mut out = String::with_capacity(src.len());
    let mut last = 0;
    for (tok, span) in toks {
        let Tok::Ref(r) = tok else { continue };
        out.push_str(&src[last..span.start]);
        last = span.end;
        let mv = |p: &RefPart| -> Option<RefPart> {
            let row = match p.row {
                Some(r) if !p.row_abs => Some(u32::try_from(r as i64 + rows).ok().filter(|r| *r <= 1_048_575)?),
                r => r,
            };
            let col = match p.col {
                Some(c) if !p.col_abs => Some(u32::try_from(c as i64 + cols).ok().filter(|c| *c <= 16_383)?),
                c => c,
            };
            Some(RefPart { row, col, ..*p })
        };
        let moved = (mv(&r.start), r.end.as_ref().map(mv));
        let text = match moved {
            (Some(a), None) => write_part(&a),
            (Some(a), Some(Some(b))) => format!("{}:{}", write_part(&a), write_part(&b)),
            _ => "#REF!".to_string(),
        };
        if let Some(sheet) = &r.sheet {
            out.push_str(&write_sheet(sheet));
        }
        out.push_str(&text);
    }
    out.push_str(&src[last..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(row: u32, col: u32) -> RefPart {
        RefPart { row: Some(row), col: Some(col), row_abs: false, col_abs: false }
    }

    #[test]
    fn parses_precedence() {
        assert_eq!(
            parse("1+2*3").unwrap(),
            Expr::Binary(
                Op::Add,
                Box::new(Expr::Number(1.0)),
                Box::new(Expr::Binary(Op::Mul, Box::new(Expr::Number(2.0)), Box::new(Expr::Number(3.0))))
            )
        );
        assert_eq!(
            parse("-2^2").unwrap(),
            Expr::Binary(Op::Pow, Box::new(Expr::Neg(Box::new(Expr::Number(2.0)))), Box::new(Expr::Number(2.0)))
        );
        assert_eq!(parse("50%").unwrap(), Expr::Percent(Box::new(Expr::Number(50.0))));
        assert!(matches!(parse("A1&\"x\"=B2").unwrap(), Expr::Binary(Op::Eq, _, _)));
    }

    #[test]
    fn parses_references_and_calls() {
        assert_eq!(parse("A1").unwrap(), Expr::Ref(Reference { sheet: None, start: cell(0, 0), end: None }));
        let Expr::Ref(r) = parse("'My Sheet'!$B$2:C10").unwrap() else { panic!() };
        assert_eq!(r.sheet.as_deref(), Some("My Sheet"));
        assert!(r.start.row_abs && r.start.col_abs);
        assert_eq!(r.end, Some(cell(9, 2)));
        let Expr::Ref(r) = parse("Data!A:A").unwrap() else { panic!() };
        assert_eq!((r.start.row, r.start.col), (None, Some(0)));
        let Expr::Ref(r) = parse("2:3").unwrap() else { panic!() };
        assert_eq!((r.start.row, r.end.unwrap().row), (Some(1), Some(2)));
        assert_eq!(
            parse("SUM(A1:A3,5)").unwrap(),
            Expr::Call(
                "SUM".into(),
                vec![Expr::Ref(Reference { sheet: None, start: cell(0, 0), end: Some(cell(2, 0)) }), Expr::Number(5.0)]
            )
        );
        assert_eq!(
            parse("_xlfn.CONCAT(\"a\",\"b\"\"c\")").unwrap(),
            Expr::Call("CONCAT".into(), vec![Expr::Text("a".into()), Expr::Text("b\"c".into())])
        );
        assert_eq!(
            parse("IF(A1,,0)").unwrap(),
            Expr::Call(
                "IF".into(),
                vec![Expr::Ref(Reference { sheet: None, start: cell(0, 0), end: None }), Expr::Missing, Expr::Number(0.0)]
            )
        );
        assert_eq!(parse("LOG10(100)").unwrap(), Expr::Call("LOG10".into(), vec![Expr::Number(100.0)]));
        assert_eq!(parse("Rate*TRUE").unwrap(), Expr::Binary(Op::Mul, Box::new(Expr::Name("Rate".into())), Box::new(Expr::Bool(true))));
        assert_eq!(
            parse("{1,2;3,4}").unwrap(),
            Expr::Array(vec![vec![Expr::Number(1.0), Expr::Number(2.0)], vec![Expr::Number(3.0), Expr::Number(4.0)]])
        );
        assert_eq!(parse("#N/A").unwrap(), Expr::Error("#N/A".into()));
        assert_eq!(parse("1.5E+3").unwrap(), Expr::Number(1500.0));
        assert!(parse("SUM(1").is_err());
        assert!(parse("1+").is_err());
    }

    #[test]
    fn shifts_like_copying() {
        assert_eq!(shift("A1+$B$1+B$2+$C3", 2, 1).unwrap(), "B3+$B$1+C$2+$C5");
        assert_eq!(shift("SUM(A1:A10)*Sheet2!B2", 1, 0).unwrap(), "SUM(A2:A11)*Sheet2!B3");
        assert_eq!(shift("'My Sheet'!A1", 0, 1).unwrap(), "'My Sheet'!B1");
        assert_eq!(shift("A:A", 5, 1).unwrap(), "B:B");
        assert_eq!(shift("A1-1", -1, 0).unwrap(), "#REF!-1");
        assert_eq!(shift("\"A1\"&A1", 1, 0).unwrap(), "\"A1\"&A2", "text that looks like a reference isn't one");
    }
}
