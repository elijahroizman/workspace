//! PowerPoint table styles (`ppt/tableStyles.xml`, or PowerPoint's built-in ones a deck names
//! without defining): each part of a table (the whole, banded rows, header row…) with its fill,
//! borders and text, laid under the cells' own formatting.

use std::collections::HashMap;

use office_core::drawing::{Color, Fill};
use office_core::model::{Document, Table};
use office_core::units::parse_bool;
use office_core::xml::{ns, parse_element, Element};
use office_engine::flow::{BorderLine, CellLook, TableLook};

use super::text::{emu_px, Paint};

/// Table styles by id.
#[derive(Default)]
pub struct TableStyles {
    styles: HashMap<String, Element>,
    default: Option<String>,
}

impl TableStyles {
    pub fn read(doc: &Document) -> TableStyles {
        let mut out = TableStyles::default();
        let Some(pkg) = &doc.package else { return out };
        let Some(part) = pkg.part_names().find(|p| p.ends_with("tableStyles.xml")).map(str::to_string) else { return out };
        let Ok(xml) = pkg.xml(&part) else { return out };
        out.default = xml.root.attr("def").map(str::to_string);
        for s in xml.root.children_named(ns::A, "tblStyle") {
            if let Some(id) = s.attr("styleId") {
                out.styles.insert(id.to_string(), s.clone());
            }
        }
        out
    }
}

/// A table's style, resolved: its parts by name (`wholeTbl`, `firstRow`, `band1H`…).
#[derive(Clone, Debug, Default)]
pub struct TableStyle {
    parts: HashMap<String, Element>,
}

/// PowerPoint's default table style (Medium Style 2 – Accent 1), for decks that use it without
/// defining it.
const MEDIUM_2_ACCENT_1: &str = r#"<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}">
<a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>
<a:left><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:left>
<a:right><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:right>
<a:top><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top>
<a:bottom><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom>
<a:insideH><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideH>
<a:insideV><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideV>
</a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>
<a:band1H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H>
<a:band1V><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1V>
<a:lastCol><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:lastCol>
<a:firstCol><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstCol>
<a:lastRow><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:top><a:ln w="38100"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:lastRow>
<a:firstRow><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:bottom><a:ln w="38100"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>
</a:tblStyle>"#;

/// The style a table uses: its own, the deck's default, or PowerPoint's default.
pub fn style_for(styles: &TableStyles, t: &Table) -> TableStyle {
    let id = t.style.as_deref().or(styles.default.as_deref());
    let el = id.and_then(|id| styles.styles.get(id).cloned()).or_else(|| {
        // "No Style" styles draw nothing; PowerPoint's others look like its default.
        match id {
            Some("{2D5ABB26-0587-4C30-8999-92F81FD0307C}") | Some("{5940675A-B579-460E-94D1-54222C63F5DA}") => None,
            _ => parse_element(MEDIUM_2_ACCENT_1).ok(),
        }
    });
    let mut out = TableStyle::default();
    if let Some(el) = el {
        for part in el.elements() {
            out.parts.insert(part.local.clone(), part.clone());
        }
    }
    // "Table Grid": thin black lines everywhere.
    if id == Some("{5940675A-B579-460E-94D1-54222C63F5DA}") {
        if let Ok(grid) = parse_element(
            r#"<a:wholeTbl xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:tcStyle><a:tcBdr><a:left><a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:left><a:right><a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:right><a:top><a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:top><a:bottom><a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:bottom><a:insideH><a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:insideH><a:insideV><a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:insideV></a:tcBdr></a:tcStyle></a:wholeTbl>"#,
        ) {
            out.parts.insert("wholeTbl".into(), grid);
        }
    }
    out
}

/// Which parts apply to a cell, least to most important, as the table's flags turn them on.
fn parts_for(t: &Table, row: usize, col: usize) -> Vec<&'static str> {
    let pr = t.origin.get().and_then(|o| o.child(ns::A, "tblPr"));
    let flag = |k: &str| pr.and_then(|p| p.attr(k)).and_then(parse_bool).unwrap_or(false);
    let rows = t.rows.len();
    let cols = t.columns.len().max(1);
    let first_row = flag("firstRow");
    let first_col = flag("firstCol");
    let mut out = vec!["wholeTbl"];
    if flag("bandRow") {
        let r = row.saturating_sub(first_row as usize);
        if !(first_row && row == 0) {
            out.push(if r.is_multiple_of(2) { "band1H" } else { "band2H" });
        }
    }
    if flag("bandCol") {
        let c = col.saturating_sub(first_col as usize);
        out.push(if c.is_multiple_of(2) { "band1V" } else { "band2V" });
    }
    if flag("lastCol") && col + 1 == cols {
        out.push("lastCol");
    }
    if first_col && col == 0 {
        out.push("firstCol");
    }
    if flag("lastRow") && row + 1 == rows {
        out.push("lastRow");
    }
    if first_row && row == 0 {
        out.push("firstRow");
    }
    out
}

/// A table style's text formatting for a cell.
#[derive(Clone, Debug, Default)]
pub struct PartText {
    pub bold: Option<bool>,
    pub color: Option<Color>,
}

pub fn text_for(t: &Table, style: &TableStyle, row: usize, col: usize) -> PartText {
    let mut out = PartText::default();
    for name in parts_for(t, row, col) {
        let Some(tx) = style.parts.get(name).and_then(|p| p.child(ns::A, "tcTxStyle")) else { continue };
        if let Some(b) = tx.attr("b") {
            out.bold = Some(b == "on");
        }
        if let Some(c) = tx.elements().find(|e| !e.is(ns::A, "fontRef") && !e.is(ns::A, "font")).and_then(Color::from_drawingml) {
            out.color = Some(c);
        }
    }
    out
}

fn line(paint: &Paint, ln: &Element) -> Option<BorderLine> {
    let fill = Fill::in_children(ln);
    let color = match fill {
        Some(Fill::None) => return None,
        Some(f) => super::draw::fill_css(paint, &f)?,
        None => return None,
    };
    let w = ln.attr("w").and_then(|w| w.parse::<f64>().ok()).map(|w| w / 9525.0).unwrap_or(1.0);
    Some(BorderLine { width: w.max(0.5), color, style: "solid" })
}

/// How a table looks: columns, each cell's fill, borders, margins and anchoring.
pub fn look(paint: &Paint, t: &Table, style: &TableStyle, width: f64) -> TableLook {
    let ncols = t.columns.len().max(t.rows.iter().map(|r| r.cells.len()).max().unwrap_or(0)).max(1);
    let mut columns: Vec<f64> = (0..ncols).map(|c| t.columns.get(c).map(|e| emu_px(*e)).unwrap_or(0.0)).collect();
    if columns.iter().sum::<f64>() <= 1.0 {
        columns = vec![width / ncols as f64; ncols];
    }
    let rows = t.rows.len();
    let cells = t
        .rows
        .iter()
        .enumerate()
        .map(|(r, row)| {
            row.cells
                .iter()
                .enumerate()
                .map(|(c, cell)| {
                    let mut look = CellLook { fill: None, borders: [None, None, None, None], margins: [4.8, 9.6, 4.8, 9.6], valign: 0 };
                    let last_row = r + cell.row_span.max(1) as usize >= rows;
                    let last_col = c + cell.col_span.max(1) as usize >= ncols;
                    for name in parts_for(t, r, c) {
                        let Some(tc) = style.parts.get(name).and_then(|p| p.child(ns::A, "tcStyle")) else { continue };
                        if let Some(f) = tc.child(ns::A, "fill").and_then(Fill::in_children) {
                            look.fill = super::draw::fill_css(paint, &f);
                        }
                        if let Some(bdr) = tc.child(ns::A, "tcBdr") {
                            let side = |outer: &str, inner: &str, edge: bool| {
                                bdr.child(ns::A, if edge { outer } else { inner }).and_then(|s| s.child(ns::A, "ln"))
                            };
                            let sides = [
                                side("top", "insideH", r == 0),
                                side("right", "insideV", last_col),
                                side("bottom", "insideH", last_row),
                                side("left", "insideV", c == 0),
                            ];
                            for (i, s) in sides.into_iter().enumerate() {
                                if let Some(ln) = s {
                                    look.borders[i] = line(paint, ln);
                                }
                            }
                        }
                    }
                    // The cell's own formatting.
                    if let Some(f) = &cell.fill {
                        look.fill = Some(paint.color(f).css());
                    }
                    if let Some(pr) = cell.origin.get().and_then(|o| o.child(ns::A, "tcPr")) {
                        if pr.child(ns::A, "noFill").is_some() {
                            look.fill = None;
                        }
                        for (i, k) in ["lnT", "lnR", "lnB", "lnL"].iter().enumerate() {
                            if let Some(ln) = pr.child(ns::A, k) {
                                look.borders[i] = line(paint, ln);
                            }
                        }
                        let m = |k: &str| pr.attr(k).and_then(|v| v.parse::<f64>().ok()).map(|v| v / 9525.0);
                        for (i, k) in ["marT", "marR", "marB", "marL"].iter().enumerate() {
                            if let Some(v) = m(k) {
                                look.margins[i] = v;
                            }
                        }
                        look.valign = match pr.attr("anchor") {
                            Some("ctr") => 1,
                            Some("b") => 2,
                            _ => 0,
                        };
                    }
                    look
                })
                .collect()
        })
        .collect();
    let heights = t.rows.iter().map(|row| row.height.map(|h| (emu_px(h), false))).collect();
    TableLook { columns, indent: 0.0, cells, heights }
}
