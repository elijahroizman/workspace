use super::props::read_string;
use crate::formats::common::{read_theme, rel_attr, shell, PartRels};
use crate::model::{Body, CellRef, Document, Kind, Origin, Range, Sheet, SheetCell, SheetRow, Value};
use crate::opc::{rels::kind, Package, Properties};
use crate::xml::{ns, Element};
use crate::{Error, Result};

pub fn read(pkg: Package) -> Result<Document> {
    let main = pkg.main_part()?;
    let workbook = pkg.xml(&main)?;
    let rels = PartRels::new(&pkg, &main)?;
    let mut doc = Document::new(Kind::Sheets);
    doc.properties = Properties::read(&pkg)?;
    doc.theme = read_theme(&pkg, &main)?;

    let strings = match pkg.related(&main, kind::SHARED_STRINGS)?.into_iter().next() {
        Some((_, part)) if pkg.has(&part) => pkg.xml(&part)?.root.children_named(ns::X, "si").map(read_string).collect(),
        _ => Vec::new(),
    };

    let mut sheets = Vec::new();
    for s in workbook.root.path(ns::X, &["sheets"]).into_iter().flat_map(|l| l.children_named(ns::X, "sheet")) {
        let name = s.attr("name").unwrap_or("").to_string();
        // Chart sheets and dialog sheets have no cells; they stay in the package.
        let Some(part) =
            rel_attr(s, "id").and_then(|id| rels.rels.get(id)).filter(|r| r.is(kind::WORKSHEET)).and_then(|r| pkg.target(&main, r))
        else {
            continue;
        };
        if !pkg.has(&part) {
            continue;
        }
        let mut sheet = read_sheet(&pkg, &part, &strings)?;
        sheet.name = name;
        sheet.hidden = matches!(s.attr("state"), Some("hidden" | "veryHidden"));
        sheets.push(sheet);
    }
    doc.body = Body::Workbook { sheets };
    doc.origin = shell(&workbook.root, |_| false);
    doc.package = Some(pkg);
    Ok(doc)
}

fn read_sheet(pkg: &Package, part: &str, strings: &[Value]) -> Result<Sheet> {
    let xml = pkg.xml(part)?;
    let root = &xml.root;
    let mut rows = Vec::new();
    let mut next_row = 0u32;
    for row in root.child(ns::X, "sheetData").into_iter().flat_map(|d| d.children_named(ns::X, "row")) {
        // `r` is 1-based and may be left out, meaning the row after the last.
        let index = row.attr("r").and_then(|r| r.parse::<u32>().ok()).map(|r| r.saturating_sub(1)).unwrap_or(next_row);
        next_row = index + 1;
        let mut cells = Vec::new();
        let mut next_col = 0u32;
        for c in row.children_named(ns::X, "c") {
            let col = c.attr("r").and_then(CellRef::parse).map(|r| r.col).unwrap_or(next_col);
            next_col = col + 1;
            cells.push(read_cell(c, col, strings).map_err(|message| Error::Xml { part: part.to_string(), message })?);
        }
        rows.push(SheetRow { index, cells, origin: shell(row, |e| e.is(ns::X, "c")) });
    }
    // Files are meant to list rows and cells in order; not every writer does.
    rows.sort_by_key(|r| r.index);
    for r in &mut rows {
        r.cells.sort_by_key(|c| c.col);
    }
    let merges = root
        .child(ns::X, "mergeCells")
        .into_iter()
        .flat_map(|m| m.children_named(ns::X, "mergeCell"))
        .filter_map(|m| Range::parse(m.attr("ref")?))
        .collect();

    // The sheet without its cells and merges; columns, views, formatting rules and the rest stay.
    let mut origin = root.clone();
    origin.remove_children(ns::X, "mergeCells");
    if let Some(data) = origin.child_mut(ns::X, "sheetData") {
        data.children.clear();
    }
    Ok(Sheet { name: String::new(), rows, merges, hidden: false, part: Some(part.to_string()), origin: Origin::new(origin) })
}

fn read_cell(c: &Element, col: u32, strings: &[Value]) -> Result<SheetCell, String> {
    // An empty `v` (a formula nobody has calculated yet) is no value.
    let v = c.child(ns::X, "v").map(Element::text).filter(|v| !v.is_empty());
    let value = match (c.attr("t").unwrap_or("n"), v) {
        ("inlineStr", _) => c.child(ns::X, "is").map(read_string).unwrap_or_default(),
        (_, None) => Value::Empty,
        ("s", Some(v)) => {
            let i: usize = v.trim().parse().map_err(|_| format!("shared string index {v:?}"))?;
            strings.get(i).cloned().ok_or_else(|| format!("shared string {i} doesn't exist"))?
        }
        ("b", Some(v)) => Value::Bool(v.trim() == "1"),
        ("e", Some(v)) => Value::Error(v),
        ("str", Some(v)) => Value::Text(super::props::unescape(&v)),
        // Strict files can store dates as ISO text.
        ("d", Some(v)) => Value::Text(v),
        (_, Some(v)) => match v.trim().parse::<f64>() {
            Ok(n) => Value::Number(n),
            Err(_) => Value::Text(v),
        },
    };
    // A shared formula's other cells have an `f` with no text; the Excel layer works out theirs.
    let formula = c.child(ns::X, "f").map(Element::text).filter(|f| !f.is_empty());
    Ok(SheetCell {
        col,
        value,
        formula,
        style: c.attr("s").and_then(|s| s.parse().ok()),
        // The origin keeps `v`, so the writer can tell an uncalculated formula's empty value.
        origin: shell(c, |e| e.is(ns::X, "is")),
    })
}
