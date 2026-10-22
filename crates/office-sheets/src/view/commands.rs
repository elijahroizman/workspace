//! Editing workbooks: typing into cells, formatting them, columns and rows, merged cells,
//! sheets, the clipboard, find and replace, and undo. Formulas are worked out again after each
//! change.

use office_core::drawing::{Color, Rgb};
use office_core::model::{CellRef, Range, Sheet, SheetCell, SheetRow, Value};
use serde::Deserialize;

use super::{CStep, SheetSel, SheetsView};
use crate::{format_of, set_format};

/// A change to cells' formatting, from the inspector.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatPatch {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strike: Option<bool>,
    pub font: Option<String>,
    /// Points.
    pub size: Option<f64>,
    /// `RRGGBB`, or empty for automatic.
    pub color: Option<String>,
    /// `RRGGBB`, or empty for none.
    pub fill: Option<String>,
    /// `left`, `center`, `right`, or empty for general.
    pub align: Option<String>,
    /// `top`, `center`, `bottom`.
    pub valign: Option<String>,
    pub wrap: Option<bool>,
    pub number_format: Option<String>,
    /// `all`, `outside`, `bottom`, `none`.
    pub borders: Option<String>,
}

impl SheetsView {
    // ---- selection ----

    pub fn select(&mut self, sheet: usize, anchor: (u32, u32), focus: (u32, u32)) {
        if sheet != self.sel.sheet {
            self.history.seal();
        }
        self.sel = SheetSel { sheet: sheet.min(self.sheets().len().saturating_sub(1)), anchor, focus };
    }

    // ---- recording changes ----

    fn record(&mut self, steps: Vec<CStep>, before: SheetSel) {
        let after = self.sel;
        self.history.record(steps, before, after, None);
        crate::recalculate(&mut self.doc, self.now);
    }

    /// Changes cells through `f`, recording each cell's before and after.
    fn change_cells(&mut self, sheet: usize, cells: &[CellRef], f: impl Fn(&mut SheetsView, CellRef)) {
        let before = self.sel;
        let mut steps = Vec::with_capacity(cells.len());
        for &at in cells {
            let old = self.sheets().get(sheet).and_then(|s| s.cell(at)).cloned();
            f(self, at);
            let new = self.sheets().get(sheet).and_then(|s| s.cell(at)).cloned();
            if old != new || old.as_ref().map(|c| c.style) != new.as_ref().map(|c| c.style) {
                steps.push((at, old, new));
            }
        }
        if steps.is_empty() {
            return;
        }
        self.changed(Some(sheet));
        self.record(vec![CStep::Cells { sheet, cells: steps }], before);
    }

    /// Changes a whole sheet through `f` (rows and columns, widths, merges), as one step.
    fn change_sheet(&mut self, sheet: usize, f: impl FnOnce(&mut SheetsView)) {
        let Some(before) = self.sheets().get(sheet).cloned() else { return };
        let sel = self.sel;
        f(self);
        let Some(after) = self.sheets().get(sheet).cloned() else { return };
        self.changed(Some(sheet));
        self.record(vec![CStep::Sheet { sheet, before: Box::new(before), after: Box::new(after) }], sel);
    }

    fn change_book(&mut self, f: impl FnOnce(&mut SheetsView)) {
        let before = self.sheets().to_vec();
        let sel = self.sel;
        f(self);
        let after = self.sheets().to_vec();
        self.changed(None);
        self.sel.sheet = self.sel.sheet.min(after.len().saturating_sub(1));
        self.record(vec![CStep::Book { before, after }], sel);
    }

    pub fn undo(&mut self) -> bool {
        let Some(e) = self.history.undo() else { return false };
        for s in e.steps.iter().rev() {
            self.apply(s, true);
        }
        self.sel = e.before;
        crate::recalculate(&mut self.doc, self.now);
        self.changed(None);
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(e) = self.history.redo() else { return false };
        for s in &e.steps {
            self.apply(s, false);
        }
        self.sel = e.after;
        crate::recalculate(&mut self.doc, self.now);
        self.changed(None);
        true
    }

    fn apply(&mut self, step: &CStep, undo: bool) {
        match step {
            CStep::Cells { sheet, cells } => {
                for (at, old, new) in cells {
                    let target = if undo { old } else { new };
                    if let Some(s) = self.sheets_mut().get_mut(*sheet) {
                        put_cell(s, *at, target.clone());
                    }
                }
            }
            CStep::Sheet { sheet, before, after } => {
                if let Some(s) = self.sheets_mut().get_mut(*sheet) {
                    *s = if undo { (**before).clone() } else { (**after).clone() };
                }
            }
            CStep::Book { before, after } => *self.sheets_mut() = if undo { before.clone() } else { after.clone() },
        }
    }

    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    // ---- typing into cells ----

    /// Puts what was typed into a cell: a formula (`=…`), a number (with `%`, a currency sign,
    /// thousands separators), a date, TRUE or FALSE, or text. Empty clears the value.
    pub fn set_input(&mut self, sheet: usize, at: CellRef, input: &str) {
        let input = input.to_string();
        self.change_cells(sheet, &[at], |v, at| v.put_input(sheet, at, &input));
    }

    fn put_input(&mut self, sheet: usize, at: CellRef, input: &str) {
        let trimmed = input.trim();
        let system = crate::excel(&self.doc).map(|x| x.date_system).unwrap_or_default();
        let mut format: Option<&str> = None;
        let (value, formula) = if let Some(f) = trimmed.strip_prefix('=').filter(|f| !f.is_empty()) {
            (Value::Empty, Some(f.to_string()))
        } else if trimmed.is_empty() {
            (Value::Empty, None)
        } else if trimmed.eq_ignore_ascii_case("true") || trimmed.eq_ignore_ascii_case("false") {
            (Value::Bool(trimmed.eq_ignore_ascii_case("true")), None)
        } else if let Some(n) = parse_number(trimmed) {
            if trimmed.ends_with('%') {
                format = Some("0%");
            } else if trimmed.starts_with(['$', '€', '£']) || trimmed.starts_with("-$") {
                format = Some("\"$\"#,##0.00");
            }
            (Value::Number(n), None)
        } else if let Some((date, fmt)) = parse_date(trimmed) {
            format = Some(fmt);
            (Value::Number(crate::dates::to_serial(date, system)), None)
        } else {
            (Value::Text(input.to_string()), None)
        };
        let Some(s) = self.sheets_mut().get_mut(sheet) else { return };
        let cell = s.cell_mut(at);
        cell.value = value;
        cell.formula = formula;
        // The cell's markup said what its value was; that no longer holds.
        cell.origin = Default::default();
        if let Some(code) = format {
            let mut f = format_of(&self.doc, sheet, at);
            if f.number_format == "General" {
                f.number_format = code.to_string();
                set_format(&mut self.doc, sheet, at, &f);
            }
        }
    }

    /// Clears the values (and formulas) in a range, keeping formatting.
    pub fn clear(&mut self, sheet: usize, range: Range) {
        let cells = existing_cells(self.sheets().get(sheet), range);
        self.change_cells(sheet, &cells, |v, at| {
            if let Some(s) = v.sheets_mut().get_mut(sheet) {
                let c = s.cell_mut(at);
                c.value = Value::Empty;
                c.formula = None;
                c.origin = Default::default();
            }
        });
    }

    // ---- formatting ----

    /// Formats every cell in a range (empty ones too, as Excel does).
    pub fn format(&mut self, sheet: usize, range: Range, patch: &FormatPatch) {
        let cells = all_cells(range, 20_000);
        let p = patch.clone();
        let (r0, r1, c0, c1) = (range.start.row, range.end.row, range.start.col, range.end.col);
        self.change_cells(sheet, &cells, |v, at| {
            let mut f = format_of(&v.doc, sheet, at);
            if let Some(b) = p.bold {
                f.font.bold = b;
            }
            if let Some(i) = p.italic {
                f.font.italic = i;
            }
            if let Some(u) = p.underline {
                f.font.underline = u.then(|| "single".into());
            }
            if let Some(s) = p.strike {
                f.font.strike = s;
            }
            if let Some(n) = &p.font {
                f.font.name = Some(n.clone());
            }
            if let Some(s) = p.size {
                f.font.size = Some(s.clamp(1.0, 409.0));
            }
            if let Some(c) = &p.color {
                f.font.color = Rgb::parse(c).map(Color::rgb);
            }
            if let Some(c) = &p.fill {
                match Rgb::parse(c) {
                    Some(rgb) => {
                        f.fill.pattern = "solid".into();
                        f.fill.fg = Some(Color::rgb(rgb));
                    }
                    None => {
                        f.fill.pattern = "none".into();
                        f.fill.fg = None;
                    }
                }
            }
            if let Some(a) = &p.align {
                f.alignment.horizontal = (!a.is_empty()).then(|| a.clone());
            }
            if let Some(a) = &p.valign {
                f.alignment.vertical = (!a.is_empty() && a != "bottom").then(|| a.clone());
            }
            if let Some(w) = p.wrap {
                f.alignment.wrap = w;
            }
            if let Some(code) = &p.number_format {
                f.number_format = code.clone();
            }
            if let Some(b) = &p.borders {
                let thin = || crate::BorderSide { style: Some("thin".into()), color: None };
                let none = crate::BorderSide::default;
                match b.as_str() {
                    "all" => {
                        f.border.top = thin();
                        f.border.bottom = thin();
                        f.border.left = thin();
                        f.border.right = thin();
                    }
                    "outside" => {
                        if at.row == r0 {
                            f.border.top = thin();
                        }
                        if at.row == r1 {
                            f.border.bottom = thin();
                        }
                        if at.col == c0 {
                            f.border.left = thin();
                        }
                        if at.col == c1 {
                            f.border.right = thin();
                        }
                    }
                    "bottom" => {
                        if at.row == r1 {
                            f.border.bottom = thin();
                        }
                    }
                    _ => {
                        f.border.top = none();
                        f.border.bottom = none();
                        f.border.left = none();
                        f.border.right = none();
                    }
                }
            }
            set_format(&mut v.doc, sheet, at, &f);
        });
    }

    // ---- columns and rows ----

    /// Sets a column's width in pixels (`None`: back to the default).
    pub fn set_column_width(&mut self, sheet: usize, col: u32, px: Option<f64>) {
        self.change_sheet(sheet, |v| crate::set_column_width(&mut v.doc, sheet, col, px.map(|p| ((p - 5.0) / 7.0).max(0.0))));
    }

    /// Sets a row's height in pixels (`None`: back to the default).
    pub fn set_row_height(&mut self, sheet: usize, row: u32, px: Option<f64>) {
        self.change_sheet(sheet, |v| crate::set_row_height(&mut v.doc, sheet, row, px.map(|p| p * 72.0 / 96.0)));
    }

    /// Inserts `n` rows above row `at` (or deletes `n` rows from it, for a negative `n`).
    pub fn shift_rows(&mut self, sheet: usize, at: u32, n: i64) {
        self.change_sheet(sheet, |v| {
            let Some(s) = v.sheets_mut().get_mut(sheet) else { return };
            if n < 0 {
                let end = at as i64 - n;
                s.rows.retain(|r| (r.index as i64) < at as i64 || r.index as i64 >= end);
            }
            for r in &mut s.rows {
                if r.index >= at && (n > 0 || r.index as i64 >= at as i64 - n) {
                    r.index = (r.index as i64 + n).max(0) as u32;
                    r.origin = clear_attr(&r.origin, "r");
                    for c in &mut r.cells {
                        c.origin = Default::default();
                    }
                }
            }
            s.merges.retain(|m| n > 0 || !(m.start.row as i64 >= at as i64 && (m.end.row as i64) < at as i64 - n));
            for m in &mut s.merges {
                for p in [&mut m.start, &mut m.end] {
                    if p.row >= at {
                        p.row = (p.row as i64 + n).max(at as i64) as u32;
                    }
                }
            }
        });
    }

    /// Inserts `n` columns left of column `at` (or deletes `n` from it, for a negative `n`).
    pub fn shift_cols(&mut self, sheet: usize, at: u32, n: i64) {
        self.change_sheet(sheet, |v| {
            let Some(s) = v.sheets_mut().get_mut(sheet) else { return };
            for r in &mut s.rows {
                if n < 0 {
                    let end = at as i64 - n;
                    r.cells.retain(|c| (c.col as i64) < at as i64 || c.col as i64 >= end);
                }
                for c in &mut r.cells {
                    if c.col >= at {
                        c.col = (c.col as i64 + n).max(0) as u32;
                        c.origin = Default::default();
                    }
                }
                r.origin = clear_attr(&r.origin, "spans");
            }
            s.merges.retain(|m| n > 0 || !(m.start.col as i64 >= at as i64 && (m.end.col as i64) < at as i64 - n));
            for m in &mut s.merges {
                for p in [&mut m.start, &mut m.end] {
                    if p.col >= at {
                        p.col = (p.col as i64 + n).max(at as i64) as u32;
                    }
                }
            }
        });
    }

    /// Merges a range (keeping the top-left value), or unmerges any merge it touches.
    pub fn toggle_merge(&mut self, sheet: usize, range: Range) {
        self.change_sheet(sheet, |v| {
            let Some(s) = v.sheets_mut().get_mut(sheet) else { return };
            let touching: Vec<usize> = s.merges.iter().enumerate().filter(|(_, m)| overlaps(m, &range)).map(|(i, _)| i).collect();
            if !touching.is_empty() {
                for i in touching.into_iter().rev() {
                    s.merges.remove(i);
                }
                return;
            }
            if range.start == range.end {
                return;
            }
            for r in &mut s.rows {
                if r.index < range.start.row || r.index > range.end.row {
                    continue;
                }
                for c in &mut r.cells {
                    let at = CellRef::new(r.index, c.col);
                    if range.contains(at) && at != range.start {
                        c.value = Value::Empty;
                        c.formula = None;
                    }
                }
            }
            s.merges.push(range);
        });
    }

    // ---- sheets ----

    pub fn add_sheet(&mut self) {
        let n = self.sheets().len();
        let name =
            (n + 1..).map(|k| format!("Sheet{k}")).find(|name| !self.sheets().iter().any(|s| s.name.eq_ignore_ascii_case(name))).unwrap();
        self.change_book(|v| v.sheets_mut().push(Sheet::new(name)));
        self.sel = SheetSel { sheet: n, ..Default::default() };
    }

    pub fn rename_sheet(&mut self, sheet: usize, name: &str) {
        let name: String = name.chars().filter(|c| !matches!(c, ':' | '\\' | '/' | '?' | '*' | '[' | ']')).take(31).collect();
        let name = name.trim().trim_matches('\'').to_string();
        if name.is_empty() || self.sheets().iter().enumerate().any(|(i, s)| i != sheet && s.name.eq_ignore_ascii_case(&name)) {
            return;
        }
        self.change_book(|v| {
            if let Some(s) = v.sheets_mut().get_mut(sheet) {
                s.name = name;
            }
        });
    }

    /// Deletes a sheet; a workbook keeps at least one.
    pub fn delete_sheet(&mut self, sheet: usize) {
        if self.sheets().len() <= 1 {
            return;
        }
        self.change_book(|v| {
            v.sheets_mut().remove(sheet);
        });
        self.sel = SheetSel { sheet: sheet.saturating_sub(1), ..Default::default() };
    }

    pub fn move_sheet(&mut self, from: usize, to: usize) {
        let n = self.sheets().len();
        if from >= n || to >= n || from == to {
            return;
        }
        self.change_book(|v| {
            let s = v.sheets_mut().remove(from);
            v.sheets_mut().insert(to, s);
        });
        self.sel.sheet = to;
    }

    // ---- clipboard ----

    /// A range as tab-separated text, as Excel copies it.
    pub fn copy(&self, sheet: usize, range: Range) -> String {
        let mut out = String::new();
        for r in range.start.row..=range.end.row.min(range.start.row + 100_000) {
            let cells: Vec<String> =
                (range.start.col..=range.end.col).map(|c| crate::display(&self.doc, sheet, CellRef::new(r, c))).collect();
            out.push_str(&cells.join("\t"));
            out.push('\n');
        }
        out
    }

    /// Pastes tab-separated text with its top left at `at`; a single value fills a picked range.
    pub fn paste(&mut self, sheet: usize, at: Range, text: &str) {
        let rows: Vec<Vec<String>> = text
            .trim_end_matches(['\n', '\r'])
            .split('\n')
            .map(|l| l.trim_end_matches('\r').split('\t').map(str::to_string).collect())
            .collect();
        let single = rows.len() == 1 && rows[0].len() == 1;
        let mut cells = Vec::new();
        let mut inputs = Vec::new();
        if single {
            for c in all_cells(at, 20_000) {
                cells.push(c);
                inputs.push(rows[0][0].clone());
            }
        } else {
            for (i, row) in rows.iter().enumerate() {
                for (j, v) in row.iter().enumerate() {
                    cells.push(CellRef::new(at.start.row + i as u32, at.start.col + j as u32));
                    inputs.push(v.clone());
                }
            }
        }
        let map: std::collections::HashMap<CellRef, String> = cells.iter().copied().zip(inputs).collect();
        self.change_cells(sheet, &cells, |v, c| v.put_input(sheet, c, &map[&c]));
    }

    /// Copies the top row of a range down through it (⌘D), formulas shifted as Excel does.
    pub fn fill_down(&mut self, sheet: usize, range: Range) {
        if range.end.row <= range.start.row {
            return;
        }
        let cells = all_cells(Range { start: CellRef::new(range.start.row + 1, range.start.col), end: range.end }, 20_000);
        let src_row = range.start.row;
        self.change_cells(sheet, &cells, |v, at| {
            let src = CellRef::new(src_row, at.col);
            let input = match crate::formula(&v.doc, sheet, src) {
                Some(f) => crate::formula::shift(&f, at.row as i64 - src_row as i64, 0).map(|f| format!("={f}")).unwrap_or_default(),
                None => v.cell_info(sheet, src).input,
            };
            v.put_input(sheet, at, &input);
            let f = format_of(&v.doc, sheet, src);
            set_format(&mut v.doc, sheet, at, &f);
        });
    }

    // ---- find and replace ----

    /// Cells showing `query` (any case), in reading order, on every sheet: (sheet, cell).
    pub fn find(&self, query: &str) -> Vec<(usize, CellRef)> {
        let q = query.to_lowercase();
        let mut out = Vec::new();
        if q.is_empty() {
            return out;
        }
        for (si, s) in self.sheets().iter().enumerate() {
            for r in &s.rows {
                for c in &r.cells {
                    let at = CellRef::new(r.index, c.col);
                    if crate::display(&self.doc, si, at).to_lowercase().contains(&q) {
                        out.push((si, at));
                    }
                }
            }
        }
        out
    }

    /// Replaces `query` (any case) with `by` in the given cells' values (not formulas).
    pub fn replace(&mut self, matches: &[(usize, CellRef)], query: &str, by: &str) {
        let mut by_sheet: std::collections::BTreeMap<usize, Vec<CellRef>> = Default::default();
        for (s, c) in matches {
            by_sheet.entry(*s).or_default().push(*c);
        }
        self.history.begin_group(self.sel);
        for (sheet, cells) in by_sheet {
            let (q, b) = (query.to_string(), by.to_string());
            self.change_cells(sheet, &cells, |v, at| {
                if crate::formula(&v.doc, sheet, at).is_some() {
                    return;
                }
                let text = v.cell_info(sheet, at).input;
                let next = replace_ci(&text, &q, &b);
                if next != text {
                    v.put_input(sheet, at, &next);
                }
            });
        }
        self.history.end_group();
    }
}

/// Puts a cell back as it was (or removes it).
fn put_cell(s: &mut Sheet, at: CellRef, cell: Option<SheetCell>) {
    match cell {
        Some(c) => *s.cell_mut(at) = c,
        None => {
            if let Ok(i) = s.rows.binary_search_by_key(&at.row, |r| r.index) {
                s.rows[i].cells.retain(|c| c.col != at.col);
            }
        }
    }
}

fn existing_cells(s: Option<&Sheet>, range: Range) -> Vec<CellRef> {
    let Some(s) = s else { return Vec::new() };
    s.rows
        .iter()
        .filter(|r| r.index >= range.start.row && r.index <= range.end.row)
        .flat_map(|r: &SheetRow| {
            r.cells.iter().filter(|c| c.col >= range.start.col && c.col <= range.end.col).map(move |c| CellRef::new(r.index, c.col))
        })
        .collect()
}

/// Every cell in a range, up to `max` of them.
fn all_cells(range: Range, max: usize) -> Vec<CellRef> {
    let mut out = Vec::new();
    for r in range.start.row..=range.end.row {
        for c in range.start.col..=range.end.col {
            out.push(CellRef::new(r, c));
            if out.len() >= max {
                return out;
            }
        }
    }
    out
}

fn overlaps(a: &Range, b: &Range) -> bool {
    a.start.row <= b.end.row && b.start.row <= a.end.row && a.start.col <= b.end.col && b.start.col <= a.end.col
}

fn clear_attr(o: &office_core::model::Origin, k: &str) -> office_core::model::Origin {
    match o.get() {
        Some(el) => {
            let mut el = el.clone();
            el.remove_attr("", k);
            office_core::model::Origin::new(el)
        }
        None => Default::default(),
    }
}

/// A number as typed: `1,234.5`, `-3`, `12%`, `$9.99`, `(4)`.
fn parse_number(s: &str) -> Option<f64> {
    let mut t = s.trim().to_string();
    let mut sign = 1.0;
    if t.starts_with('(') && t.ends_with(')') {
        sign = -1.0;
        t = t[1..t.len() - 1].to_string();
    }
    if let Some(rest) = t.strip_prefix('-') {
        sign = -sign;
        t = rest.to_string();
    }
    let t = t.trim_start_matches(['$', '€', '£']).to_string();
    let (t, pct) = match t.strip_suffix('%') {
        Some(x) => (x.to_string(), true),
        None => (t, false),
    };
    if t.is_empty()
        || !t.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | 'e' | 'E' | '+' | '-'))
        || !t.chars().next()?.is_ascii_digit() && !t.starts_with('.')
    {
        return None;
    }
    // Thousands separators only between groups of three.
    if t.contains(',') {
        let int = t.split('.').next()?;
        let groups: Vec<&str> = int.split(',').collect();
        if groups.iter().skip(1).any(|g| g.len() != 3) || groups[0].is_empty() || groups[0].len() > 3 {
            return None;
        }
    }
    let n: f64 = t.replace(',', "").parse().ok()?;
    Some(sign * if pct { n / 100.0 } else { n })
}

/// A date as typed: `2026-01-31` or `1/31/2026`, with the format to show it in.
fn parse_date(s: &str) -> Option<(crate::DateTime, &'static str)> {
    let parts: Vec<&str> = s.split(['-', '/']).collect();
    if parts.len() != 3 || !parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    let n: Vec<i32> = parts.iter().map(|p| p.parse().ok()).collect::<Option<_>>()?;
    let (y, m, d, fmt) = if s.contains('-') && parts[0].len() == 4 {
        (n[0], n[1], n[2], "yyyy-mm-dd")
    } else if s.contains('/') && parts[2].len() == 4 {
        (n[2], n[0], n[1], "m/d/yyyy")
    } else {
        return None;
    };
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || !(1900..=9999).contains(&y) {
        return None;
    }
    Some((crate::DateTime::date(y, m as u32, d as u32), fmt))
}

fn replace_ci(text: &str, query: &str, by: &str) -> String {
    if query.is_empty() {
        return text.to_string();
    }
    let lower = text.to_lowercase();
    let q = query.to_lowercase();
    if lower.len() != text.len() {
        return text.replace(query, by);
    }
    let mut out = String::new();
    let mut from = 0;
    while let Some(at) = lower[from..].find(&q) {
        out.push_str(&text[from..from + at]);
        out.push_str(by);
        from += at + q.len();
    }
    out.push_str(&text[from..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_and_dates_as_typed() {
        assert_eq!(parse_number("1,234.5"), Some(1234.5));
        assert_eq!(parse_number("12%"), Some(0.12));
        assert_eq!(parse_number("$9.99"), Some(9.99));
        assert_eq!(parse_number("(4)"), Some(-4.0));
        assert_eq!(parse_number("12,34"), None);
        assert_eq!(parse_number("abc"), None);
        assert!(parse_date("2026-01-31").is_some());
        assert!(parse_date("1/31/2026").is_some());
        assert!(parse_date("31/31/2026").is_none());
    }
}
