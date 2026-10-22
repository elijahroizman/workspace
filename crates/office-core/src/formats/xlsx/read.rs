use super::props::read_string;
use crate::formats::common::{read_theme, rel_attr, shell, PartRels};
use crate::model::{Body, CellRef, Document, Fingerprint, Kind, Origin, Range, Sheet, SheetCell, SheetRow, Value};
use crate::opc::{rels::kind, Package, Properties};
use crate::xml::{ns, stream, Element};
use crate::{Error, Result};

pub fn read(pkg: Package) -> Result<Document> {
    let main = pkg.main_part()?;
    let workbook = pkg.xml(&main)?;
    let rels = PartRels::new(&pkg, &main)?;
    let mut doc = Document::new(Kind::Sheets);
    doc.properties = Properties::read(&pkg)?;
    doc.theme = read_theme(&pkg, &main)?;

    let strings: Vec<Value> = match pkg.related(&main, kind::SHARED_STRINGS)?.into_iter().next() {
        Some((_, part)) if pkg.has(&part) => shared_strings(&pkg, &part)?.iter().map(read_string).collect(),
        _ => Vec::new(),
    };

    // Only duplicate modeled values need a cell origin to retain their original SST index.
    let mut plain = std::collections::HashSet::new();
    let mut rich = std::collections::HashSet::new();
    let duplicate: Vec<bool> = strings
        .iter()
        .map(|v| match v {
            Value::Text(text) => !plain.insert(text.as_str()),
            value => !rich.insert(super::write::string_key(value)),
        })
        .collect();
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
        let mut sheet = read_sheet(&pkg, &part, &strings, &duplicate)?;
        sheet.name = name;
        sheet.hidden = matches!(s.attr("state"), Some("hidden" | "veryHidden"));
        sheets.push(sheet);
    }
    doc.body = Body::Workbook { sheets };
    doc.origin = shell(&workbook.root, |_| false);
    doc.package = Some(pkg);
    Ok(doc)
}

/// A shared string table's `si` elements, read one at a time: the table can be huge.
pub(super) fn shared_strings(pkg: &Package, part: &str) -> Result<Vec<Element>> {
    let bad = |message: String| Error::Xml { part: part.to_string(), message };
    let hollow = stream::parse_hollow(pkg.part(part)?, None).map_err(bad)?;
    let mut items = Vec::new();
    stream::for_each_batch(hollow.inner.as_deref().unwrap_or(""), 256 * 1024, |source| {
        items.extend(stream::parse_all_in(source, &hollow.scope)?.into_iter().filter(|el| el.is(ns::X, "si")));
        Ok(())
    })
    .map_err(bad)?;
    Ok(items)
}

/// Reads a worksheet a row at a time, so a sheet with millions of cells never becomes one big
/// tree. Rows and cells keep an origin only when they have markup the writer couldn't make
/// again from the model (Excel's row attributes, a shared formula, an inline string).
fn read_sheet(pkg: &Package, part: &str, strings: &[Value], duplicate: &[bool]) -> Result<Sheet> {
    let bad = |message: String| Error::Xml { part: part.to_string(), message };
    let hollow = stream::parse_hollow(pkg.part(part)?, Some("sheetData")).map_err(bad)?;
    let root = &hollow.doc.root;
    let mut rows = Vec::new();
    let mut next_row = 0u32;
    // A few hundred kilobytes of rows at a time.
    stream::for_each_batch(hollow.inner.as_deref().unwrap_or(""), 256 * 1024, |source| {
        for row in stream::parse_all_in(source, &hollow.scope)? {
            if !row.is(ns::X, "row") {
                continue;
            }
            // `r` is 1-based and may be left out, meaning the row after the last.
            let index = row.attr("r").and_then(|r| r.parse::<u32>().ok()).map(|r| r.saturating_sub(1)).unwrap_or(next_row);
            next_row = index + 1;
            let mut cells = Vec::new();
            let mut next_col = 0u32;
            for c in row.children_named(ns::X, "c") {
                let col = c.attr("r").and_then(CellRef::parse).map(|r| r.col).unwrap_or(next_col);
                next_col = col + 1;
                cells.push(read_cell(c, col, strings, duplicate)?);
            }
            let origin = if row_needs_origin(&row) { shell(&row, |e| e.is(ns::X, "c")) } else { Origin::default() };
            rows.push(SheetRow { index, cells, origin });
        }
        Ok(())
    })
    .map_err(bad)?;
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
    let mut sheet = Sheet {
        name: String::new(),
        rows,
        merges,
        hidden: false,
        part: Some(part.to_string()),
        origin: Origin::new(origin),
        read_as: Default::default(),
    };
    sheet.read_as = Fingerprint(Some(sheet.fingerprint()));
    Ok(sheet)
}

/// Whether a row has more than its number and column span hint: a height, a style, Excel's
/// extension attributes, something besides cells.
fn row_needs_origin(row: &Element) -> bool {
    row.attrs.iter().any(|a| !(a.ns.is_none() && matches!(a.local.as_str(), "r" | "spans"))) || row.elements().any(|e| !e.is(ns::X, "c"))
}

/// Whether a cell has markup the writer can't make again from its value, formula and style.
fn cell_needs_origin(c: &Element) -> bool {
    let plain_attrs = c.attrs.iter().all(|a| a.ns.is_none() && matches!(a.local.as_str(), "r" | "s" | "t"));
    let plain_type = matches!(c.attr("t"), None | Some("n" | "s" | "b" | "e" | "str"));
    let plain_children = c.elements().all(|e| match e.local.as_str() {
        // An empty `v`: a formula nobody has calculated, which the writer keeps.
        "v" => !e.text().is_empty() && e.attrs.is_empty(),
        "f" => e.attrs.is_empty(),
        _ => false,
    });
    !(plain_attrs && plain_type && plain_children)
}

fn read_cell(c: &Element, col: u32, strings: &[Value], duplicate: &[bool]) -> Result<SheetCell, String> {
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
        origin: if cell_needs_origin(c)
            || (c.attr("t") == Some("s")
                && c.child(ns::X, "v").and_then(|v| v.text().trim().parse::<usize>().ok()).and_then(|i| duplicate.get(i)) == Some(&true))
        {
            Origin::new(c.clone())
        } else {
            Origin::default()
        },
    })
}
