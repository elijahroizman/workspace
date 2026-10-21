//! The office compiler's Excel layer: what only spreadsheets have, on top of `office-core`'s
//! sheets of values.
//!
//! - **Formats**: each cell's [`CellFormat`] (number format, font, fill, border, alignment),
//!   reading and adding them through the style sheet ([`styles`]), and showing a value the
//!   way Excel does ([`display`], [`numfmt`], [`dates`]).
//! - **Formulas**: parsing ([`formula`]), the formulas of cells that share one, and working
//!   them out again ([`recalculate`], [`eval`]).
//! - **The workbook**: defined names, the date system, column widths and row heights.
//!
//! Add [`Sheets`] to a compiler to have it read and write all this:
//!
//! ```
//! use office_core::model::{Body, CellRef, Value};
//! let compiler = office_core::Compiler::new().with_layer(office_sheets::Sheets);
//! let mut doc = office_core::Document::new(office_core::Kind::Sheets);
//! let Body::Workbook { sheets } = &mut doc.body else { unreachable!() };
//! sheets[0].set(CellRef::new(0, 0), Value::Number(0.256));
//! let mut format = office_sheets::format_of(&doc, 0, CellRef::new(0, 0));
//! format.number_format = "0.0%".into();
//! office_sheets::set_format(&mut doc, 0, CellRef::new(0, 0), &format);
//! assert_eq!(office_sheets::display(&doc, 0, CellRef::new(0, 0)), "25.6%");
//! let saved = compiler.write(&doc, office_core::Kind::Sheets).unwrap();
//! let back = compiler.read(&saved, Some("book.xlsx")).unwrap();
//! assert_eq!(office_sheets::display(&back, 0, CellRef::new(0, 0)), "25.6%");
//! ```

pub mod dates;
pub mod eval;
pub mod formula;
pub mod numfmt;
pub mod styles;

use std::collections::{HashMap, HashSet};

use office_core::model::{Body, CellRef, Document, Kind, Origin, Sheet, Value};
use office_core::opc::Package;
use office_core::units::parse_bool;
use office_core::xml::{ns, Element, Node};
use office_core::{Layer, Result};

pub use dates::{DateSystem, DateTime};
pub use styles::{Alignment, Border, BorderSide, CellFormat, Fill, Font, StyleSheet};

use eval::{Book, V};
use formula::Expr;

/// The layer: add it to a [`office_core::Compiler`].
pub struct Sheets;

/// What the layer keeps on a workbook (in its extensions).
#[derive(Clone, Debug)]
pub struct Excel {
    pub styles: StyleSheet,
    pub date_system: DateSystem,
    pub names: Vec<DefinedName>,
}

/// A defined name: `TaxRate` for `Settings!$B$2`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DefinedName {
    pub name: String,
    /// The sheet it belongs to (by position), or `None` for the whole workbook.
    pub sheet: Option<usize>,
    /// What it refers to, as formula text.
    pub formula: String,
    pub hidden: bool,
}

impl Default for Excel {
    fn default() -> Excel {
        Excel { styles: StyleSheet::new_default(), date_system: DateSystem::default(), names: Vec::new() }
    }
}

impl Layer for Sheets {
    fn name(&self) -> &'static str {
        "Excel"
    }

    fn kinds(&self) -> &[Kind] {
        &[Kind::Sheets]
    }

    fn after_read(&self, doc: &mut Document) -> Result<()> {
        let styles = match &doc.package {
            Some(pkg) => StyleSheet::read(pkg)?,
            None => None,
        };
        let workbook = doc.origin.get();
        let date_system = match workbook.and_then(|w| w.child(ns::X, "workbookPr")).and_then(|p| p.attr("date1904")).and_then(parse_bool) {
            Some(true) => DateSystem::From1904,
            _ => DateSystem::From1900,
        };
        let names = workbook
            .and_then(|w| w.child(ns::X, "definedNames"))
            .into_iter()
            .flat_map(|d| d.children_named(ns::X, "definedName"))
            .filter_map(|d| {
                Some(DefinedName {
                    name: d.attr("name")?.to_string(),
                    sheet: d.attr("localSheetId").and_then(|i| i.parse().ok()),
                    formula: d.text(),
                    hidden: d.attr("hidden").and_then(parse_bool).unwrap_or(false),
                })
            })
            .collect();
        doc.extensions.insert(Excel { styles: styles.unwrap_or_else(StyleSheet::new_default), date_system, names });
        Ok(())
    }

    fn write_parts(&self, doc: &Document, package: &mut Package, _to: Kind) -> Result<()> {
        if let Some(excel) = doc.extensions.get::<Excel>() {
            excel.styles.write(package)?;
        }
        Ok(())
    }
}

/// The layer's data on a workbook, if it has been read with the layer or given formats.
pub fn excel(doc: &Document) -> Option<&Excel> {
    doc.extensions.get::<Excel>()
}

/// The layer's data on a workbook, made (with a new workbook's style sheet) if it has none.
pub fn excel_mut(doc: &mut Document) -> &mut Excel {
    if doc.extensions.get::<Excel>().is_none() {
        doc.extensions.insert(Excel::default());
    }
    doc.extensions.get_mut::<Excel>().unwrap()
}

fn sheet(doc: &Document, index: usize) -> Option<&Sheet> {
    match &doc.body {
        Body::Workbook { sheets } => sheets.get(index),
        _ => None,
    }
}

fn sheet_mut(doc: &mut Document, index: usize) -> Option<&mut Sheet> {
    match &mut doc.body {
        Body::Workbook { sheets } => sheets.get_mut(index),
        _ => None,
    }
}

// ---- formats ----

/// A cell's format (the default for a cell without one).
pub fn format_of(doc: &Document, sheet_index: usize, at: CellRef) -> CellFormat {
    let style = sheet(doc, sheet_index).and_then(|s| s.cell(at)).and_then(|c| c.style).unwrap_or(0);
    match excel(doc) {
        Some(x) => x.styles.format(style),
        None => CellFormat::default(),
    }
}

/// Gives a cell a format, adding it to the style sheet if it isn't there. The cell is made if
/// it's empty, as formatting an empty cell in Excel does.
pub fn set_format(doc: &mut Document, sheet_index: usize, at: CellRef, format: &CellFormat) {
    let index = excel_mut(doc).styles.add(format);
    if let Some(s) = sheet_mut(doc, sheet_index) {
        s.cell_mut(at).style = (index != 0).then_some(index);
    }
}

/// A cell's value as Excel shows it, through its number format.
pub fn display(doc: &Document, sheet_index: usize, at: CellRef) -> String {
    let Some(s) = sheet(doc, sheet_index) else { return String::new() };
    let value = s.value(at);
    let code = format_of(doc, sheet_index, at).number_format;
    numfmt::format(value, &code, excel(doc).map(|x| x.date_system).unwrap_or_default()).text
}

/// The date and time a cell shows, if its format shows it as one.
pub fn date_of(doc: &Document, sheet_index: usize, at: CellRef) -> Option<DateTime> {
    let Value::Number(n) = sheet(doc, sheet_index)?.value(at) else { return None };
    if !numfmt::is_date_format(&format_of(doc, sheet_index, at).number_format) {
        return None;
    }
    dates::from_serial(*n, excel(doc).map(|x| x.date_system).unwrap_or_default())
}

// ---- formulas ----

/// A shared formula's `f`: its group, and the range it covers if this is the group's first cell.
fn shared(origin: &Origin) -> Option<(&str, Option<&str>)> {
    let f = origin.get()?.child(ns::X, "f")?;
    (f.attr("t") == Some("shared")).then(|| (f.attr("si").unwrap_or(""), f.attr("ref")))
}

/// A cell's formula (without its `=`), including a formula it shares with the cells around it:
/// Excel stores a copied formula once, and the others say only that they share it.
pub fn formula(doc: &Document, sheet_index: usize, at: CellRef) -> Option<String> {
    let s = sheet(doc, sheet_index)?;
    let cell = s.cell(at)?;
    if let Some(f) = &cell.formula {
        return Some(f.clone());
    }
    let (group, _) = shared(&cell.origin)?;
    // The group's first cell has the text; this one is that text copied here.
    for row in &s.rows {
        for c in &row.cells {
            if let (Some(text), Some((g, Some(_)))) = (&c.formula, shared(&c.origin)) {
                if g == group {
                    return formula::shift(text, at.row as i64 - row.index as i64, at.col as i64 - c.col as i64).ok();
                }
            }
        }
    }
    None
}

/// Works out every formula in the workbook again and puts the results in the cells, as Excel
/// does when it recalculates. `now` (a serial number) is what NOW() and TODAY() give; without
/// one they're #N/A. A formula that depends on itself comes to 0, as in Excel. Returns how many
/// formulas there were.
pub fn recalculate(doc: &mut Document, now: Option<f64>) -> usize {
    let Body::Workbook { sheets } = &doc.body else { return 0 };
    let mut formulas = HashMap::new();
    for (si, s) in sheets.iter().enumerate() {
        // Each shared formula's first cell and text, so its other cells can copy it.
        let mut groups: HashMap<&str, (u32, u32, &str)> = HashMap::new();
        for row in &s.rows {
            for c in &row.cells {
                if let (Some(text), Some((g, Some(_)))) = (&c.formula, shared(&c.origin)) {
                    groups.insert(g, (row.index, c.col, text));
                }
            }
        }
        for row in &s.rows {
            for c in &row.cells {
                let text = match (&c.formula, shared(&c.origin)) {
                    (Some(f), _) => Some(f.clone()),
                    (None, Some((g, _))) => groups
                        .get(g)
                        .and_then(|(r, col, text)| formula::shift(text, row.index as i64 - *r as i64, c.col as i64 - *col as i64).ok()),
                    _ => None,
                };
                if let Some(text) = text {
                    let expr = formula::parse(&text).unwrap_or(Expr::Error("#NAME?".into()));
                    formulas.insert((si, row.index, c.col), expr);
                }
            }
        }
    }
    let x = excel(doc);
    let mut book = Workbook {
        sheets,
        names: x.map(|x| x.names.clone()).unwrap_or_default(),
        date_system: x.map(|x| x.date_system).unwrap_or_default(),
        now,
        formulas,
        done: HashMap::new(),
        working: HashSet::new(),
        current: vec![0],
    };
    let keys: Vec<(usize, u32, u32)> = book.formulas.keys().copied().collect();
    for &(s, r, c) in &keys {
        book.current = vec![s];
        book.value(s, r, c);
    }
    let results: Vec<((usize, u32, u32), Value)> =
        keys.iter().map(|k| (*k, book.done.get(k).map(V::to_value).unwrap_or(Value::Number(0.0)))).collect();
    let Body::Workbook { sheets } = &mut doc.body else { unreachable!() };
    for ((s, r, c), value) in results {
        let cell = sheets[s].cell_mut(CellRef::new(r, c));
        if cell.value != value {
            cell.value = value;
        }
    }
    keys.len()
}

/// The workbook as formulas see it while they're worked out.
struct Workbook<'a> {
    sheets: &'a [Sheet],
    names: Vec<DefinedName>,
    date_system: DateSystem,
    now: Option<f64>,
    formulas: HashMap<(usize, u32, u32), Expr>,
    done: HashMap<(usize, u32, u32), V>,
    working: HashSet<(usize, u32, u32)>,
    /// The sheet of the formula being worked out, innermost last.
    current: Vec<usize>,
}

impl Workbook<'_> {
    fn sheet_index(&self, name: Option<&str>) -> Option<usize> {
        match name {
            None => self.current.last().copied(),
            Some(n) => self.sheets.iter().position(|s| s.name.eq_ignore_ascii_case(n)),
        }
    }

    fn value(&mut self, s: usize, r: u32, c: u32) -> V {
        let key = (s, r, c);
        if let Some(v) = self.done.get(&key) {
            return v.clone();
        }
        let Some(expr) = self.formulas.get(&key).cloned() else {
            return V::from_value(self.sheets[s].value(CellRef::new(r, c)));
        };
        if !self.working.insert(key) {
            // A circular reference.
            return V::Num(0.0);
        }
        self.current.push(s);
        let v = eval::eval(&expr, self);
        self.current.pop();
        self.working.remove(&key);
        // A formula's result is a single value; an array formula shows its first.
        let v = match v {
            V::Range(rows) => rows.into_iter().next().and_then(|r| r.into_iter().next()).unwrap_or(V::Empty),
            v => v,
        };
        self.done.insert(key, v.clone());
        v
    }
}

impl Book for Workbook<'_> {
    fn cell(&mut self, sheet: Option<&str>, row: u32, col: u32) -> V {
        match self.sheet_index(sheet) {
            Some(s) => self.value(s, row, col),
            None => V::Err("#REF!"),
        }
    }

    fn extent(&self, sheet: Option<&str>) -> Option<(u32, u32)> {
        let used = self.sheets.get(self.sheet_index(sheet)?)?.used_range()?;
        Some((used.end.row, used.end.col))
    }

    fn name(&self, name: &str) -> Option<Expr> {
        let here = self.current.last().copied();
        // A sheet's own name wins over the workbook's.
        let found = self
            .names
            .iter()
            .find(|n| n.name.eq_ignore_ascii_case(name) && n.sheet.is_some() && n.sheet == here)
            .or_else(|| self.names.iter().find(|n| n.name.eq_ignore_ascii_case(name) && n.sheet.is_none()))?;
        formula::parse(&found.formula).ok()
    }

    fn date_system(&self) -> DateSystem {
        self.date_system
    }

    fn now(&self) -> Option<f64> {
        self.now
    }
}

// ---- the workbook ----

/// The workbook's defined names.
pub fn names(doc: &Document) -> &[DefinedName] {
    excel(doc).map(|x| x.names.as_slice()).unwrap_or(&[])
}

/// A column's width in characters of the default font, if the sheet sets one.
pub fn column_width(doc: &Document, sheet_index: usize, col: u32) -> Option<f64> {
    let cols = sheet(doc, sheet_index)?.origin.get()?.child(ns::X, "cols")?;
    cols.children_named(ns::X, "col")
        .find(|c| {
            let n = |k: &str| c.attr(k).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
            (n("min")..=n("max")).contains(&(col + 1))
        })
        .and_then(|c| c.attr("width"))
        .and_then(|w| w.parse().ok())
}

/// The children of `worksheet` before `cols`, for putting a new `cols` in its place.
const BEFORE_COLS: &[&[&str]] = &[&["sheetPr"], &["dimension"], &["sheetViews"], &["sheetFormatPr"], &["cols"], &["sheetData"]];

/// Sets a column's width (in characters), or clears it for `None`.
pub fn set_column_width(doc: &mut Document, sheet_index: usize, col: u32, width: Option<f64>) {
    let Some(s) = sheet_mut(doc, sheet_index) else { return };
    let mut root = s.origin.get().cloned().unwrap_or_else(|| {
        let mut ws = Element::new(ns::X, "worksheet");
        ws.declare(None, ns::X);
        ws.push(Element::new(ns::X, "sheetData"));
        ws
    });
    let n = col + 1;
    let mut cols: Vec<Element> = root.child(ns::X, "cols").map(|c| c.children_named(ns::X, "col").cloned().collect()).unwrap_or_default();
    // Split whatever range covers the column, so it can have its own entry.
    let mut kept = Vec::new();
    for c in cols.drain(..) {
        let get = |k: &str| c.attr(k).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        let (min, max) = (get("min"), get("max"));
        if !(min..=max).contains(&n) {
            kept.push(c);
            continue;
        }
        if min < n {
            kept.push(c.clone().with_attr("", "max", (n - 1).to_string()));
        }
        if max > n {
            kept.push(c.clone().with_attr("", "min", (n + 1).to_string()));
        }
    }
    if let Some(w) = width {
        kept.push(
            Element::new(ns::X, "col")
                .with_attr("", "min", n.to_string())
                .with_attr("", "max", n.to_string())
                .with_attr("", "width", office_core::model::format_number(w))
                .with_attr("", "customWidth", "1"),
        );
    }
    kept.sort_by_key(|c| c.attr("min").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0));
    root.remove_children(ns::X, "cols");
    if !kept.is_empty() {
        let mut el = Element::new(ns::X, "cols");
        el.children = kept.into_iter().map(Node::Element).collect();
        root.place(el, BEFORE_COLS);
    }
    s.origin = Origin::new(root);
}

/// A row's height in points, if it has one of its own.
pub fn row_height(doc: &Document, sheet_index: usize, row: u32) -> Option<f64> {
    let s = sheet(doc, sheet_index)?;
    let r = s.rows.iter().find(|r| r.index == row)?;
    r.origin.get()?.attr("ht")?.parse().ok()
}

/// Sets a row's height in points, or clears it for `None`. The row is made if it's empty.
pub fn set_row_height(doc: &mut Document, sheet_index: usize, row: u32, height: Option<f64>) {
    let Some(s) = sheet_mut(doc, sheet_index) else { return };
    let i = match s.rows.binary_search_by_key(&row, |r| r.index) {
        Ok(i) => i,
        Err(i) => {
            s.rows.insert(i, office_core::model::SheetRow { index: row, ..Default::default() });
            i
        }
    };
    let r = &mut s.rows[i];
    let mut el = r.origin.get().cloned().unwrap_or_else(|| Element::new(ns::X, "row"));
    match height {
        Some(h) => {
            el.set_attr("", "ht", office_core::model::format_number(h));
            el.set_attr("", "customHeight", "1");
        }
        None => {
            el.remove_attr("", "ht");
            el.remove_attr("", "customHeight");
        }
    }
    r.origin = Origin::new(el);
}

#[cfg(test)]
mod tests;
