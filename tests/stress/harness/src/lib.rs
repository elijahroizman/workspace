//! What every stress binary does with a file: open it the way the app does, lay it out, paint
//! every page, save it unchanged, edit and undo and save again, and compare the packages.

use std::collections::BTreeMap;
use std::time::Instant;

use office_core::model::{CellRef, Kind};
use office_core::opc::Package;
use office_engine::measure::FixedMeasurer;
use office_sheets::view::SheetsView;
use office_slides::view::SlidesView;
use office_word::view::WordView;

#[derive(Default, Debug)]
pub struct Report {
    pub kind: String,
    pub open_ms: u128,
    pub layout_ms: u128,
    pub paint_ms: u128,
    pub save_ms: u128,
    pub pages: usize,
    /// Problems found: lost parts, lost elements, saves that don't reopen.
    pub issues: Vec<String>,
}

/// The kind the app would open `name` as.
pub fn app_kind(bytes: &[u8], name: &str) -> Option<Kind> {
    office_core::detect(bytes, Some(name)).ok()
}

/// Runs a file through open, layout, paint, save; `edit` also edits, undoes and saves again.
/// Returns Err with the open error (an error is fine; a panic or hang is not).
pub fn run(bytes: &[u8], name: &str, edit: bool, compare: bool) -> Result<Report, String> {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mut r = Report::default();
    let mut host = FixedMeasurer::default();
    let t = Instant::now();
    let (saved, edited) = match ext.as_str() {
        "docx" | "docm" | "dotx" => {
            r.kind = "word".into();
            let mut v = WordView::open(bytes).map_err(|e| e.to_string())?;
            r.open_ms = t.elapsed().as_millis();
            let t = Instant::now();
            v.layout(&mut host);
            r.layout_ms = t.elapsed().as_millis();
            r.pages = v.page_count();
            let t = Instant::now();
            for p in 0..r.pages {
                v.paint(&mut host, p);
            }
            r.paint_ms = t.elapsed().as_millis();
            let t = Instant::now();
            let saved = v.save().map_err(|e| format!("save failed: {e}"));
            r.save_ms = t.elapsed().as_millis();
            let edited = if edit {
                v.move_caret(&mut host, office_word::view::Move::DocEnd, false);
                v.insert_text("Zq");
                v.enter();
                v.insert_text("added");
                v.layout(&mut host);
                v.select_all();
                v.toggle(office_word::view::Toggle::Bold);
                v.layout(&mut host);
                let changed = v.save().map_err(|e| format!("edited save failed: {e}"));
                if let Ok(b) = &changed {
                    check_reopens(b, name, &mut r.issues, "edited");
                }
                while v.undo() {}
                v.layout(&mut host);
                Some(v.save().map_err(|e| format!("undone save failed: {e}")))
            } else {
                None
            };
            (saved, edited)
        }
        "pptx" | "pptm" | "potx" => {
            r.kind = "slides".into();
            let mut v = SlidesView::open(bytes).map_err(|e| e.to_string())?;
            r.open_ms = t.elapsed().as_millis();
            let t = Instant::now();
            r.pages = v.slides().len();
            for p in 0..r.pages {
                v.paint(&mut host, p);
            }
            r.paint_ms = t.elapsed().as_millis();
            let t = Instant::now();
            let saved = v.save().map_err(|e| format!("save failed: {e}"));
            r.save_ms = t.elapsed().as_millis();
            let edited = if edit && r.pages > 0 {
                v.set_active(0);
                let ids: Vec<u32> = v.slides()[0].frames.iter().map(|f| f.id).collect();
                if let Some(&id) = ids.first() {
                    v.move_frames(&mut host, &[id], 10.0, 5.0);
                }
                v.set_notes(0, "stress note");
                v.add_slide(0, None);
                v.paint(&mut host, 0);
                let changed = v.save().map_err(|e| format!("edited save failed: {e}"));
                if let Ok(b) = &changed {
                    check_reopens(b, name, &mut r.issues, "edited");
                }
                while v.undo() {}
                Some(v.save().map_err(|e| format!("undone save failed: {e}")))
            } else {
                None
            };
            (saved, edited)
        }
        _ => {
            r.kind = "sheets".into();
            let mut v = SheetsView::open(bytes, name).map_err(|e| e.to_string())?;
            v.set_now(46000.5);
            r.open_ms = t.elapsed().as_millis();
            let t = Instant::now();
            r.pages = v.sheets().len();
            for s in 0..r.pages {
                let g = v.grid(s);
                let (rows, cols) = (g.rows.min(60), g.cols.min(30));
                v.paint(&mut host, s, 0, rows.saturating_sub(1), 0, cols.saturating_sub(1));
            }
            r.paint_ms = t.elapsed().as_millis();
            let t = Instant::now();
            let saved = v.save().map_err(|e| format!("save failed: {e}"));
            r.save_ms = t.elapsed().as_millis();
            let edited = if edit && r.pages > 0 {
                v.set_input(0, CellRef::new(0, 0), "=1+2");
                v.set_input(0, CellRef::new(3, 2), "hello");
                v.paint(&mut host, 0, 0, 20, 0, 10);
                let changed = v.save().map_err(|e| format!("edited save failed: {e}"));
                if let Ok(b) = &changed {
                    check_reopens(b, name, &mut r.issues, "edited");
                }
                while v.undo() {}
                Some(v.save().map_err(|e| format!("undone save failed: {e}")))
            } else {
                None
            };
            (saved, edited)
        }
    };
    let saved = match saved {
        Ok(b) => b,
        Err(e) => {
            r.issues.push(e);
            return Ok(r);
        }
    };
    check_reopens(&saved, name, &mut r.issues, "saved");
    if compare && bytes.starts_with(b"PK") {
        for d in compare_packages(bytes, &saved) {
            r.issues.push(format!("save: {d}"));
        }
    }
    if let Some(edited) = edited {
        match edited {
            Ok(b) => {
                if compare && bytes.starts_with(b"PK") {
                    for d in compare_packages(&saved, &b) {
                        r.issues.push(format!("undo-all: {d}"));
                    }
                } else if !bytes.starts_with(b"PK") && b != saved {
                    r.issues.push("undo-all: csv differs".into());
                }
            }
            Err(e) => r.issues.push(e),
        }
    }
    Ok(r)
}

fn check_reopens(bytes: &[u8], name: &str, issues: &mut Vec<String>, what: &str) {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let ok = match ext.as_str() {
        "docx" | "docm" | "dotx" => WordView::open(bytes).map(|_| ()),
        "pptx" | "pptm" | "potx" => SlidesView::open(bytes).map(|_| ()),
        _ => SheetsView::open(bytes, name).map(|_| ()),
    };
    if let Err(e) = ok {
        issues.push(format!("{what} file doesn't reopen: {e}"));
    }
}

/// Where `b` says less than `a`: parts gone, and XML parts with fewer elements of some name or
/// less text. Parts with the same bytes are skipped.
pub fn compare_packages(a: &[u8], b: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let (pa, pb) = match (Package::read(a), Package::read(b)) {
        (Ok(x), Ok(y)) => (x, y),
        (Err(e), _) | (_, Err(e)) => return vec![format!("unreadable package: {e}")],
    };
    for name in pa.part_names() {
        let (Ok(x), Ok(y)) = (pa.part(name), pb.part(name)) else {
            if pa.part(name).is_ok() {
                out.push(format!("part gone: {name}"));
            }
            continue;
        };
        if x == y {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".xml") || lower.ends_with(".rels") || lower.ends_with(".vml")) {
            out.push(format!("binary part changed: {name}"));
            continue;
        }
        let (Ok(dx), Ok(dy)) = (office_core::xml::parse(x), office_core::xml::parse(y)) else {
            out.push(format!("part no longer parses: {name}"));
            continue;
        };
        let (cx, tx) = census(&dx.root);
        let (cy, ty) = census(&dy.root);
        let mut lost = Vec::new();
        for (k, n) in &cx {
            let m = cy.get(k).copied().unwrap_or(0);
            if m < *n {
                lost.push(format!("{k} {n}->{m}"));
            }
        }
        if !lost.is_empty() {
            lost.truncate(12);
            out.push(format!("{name}: fewer elements: {}", lost.join(", ")));
        }
        if ty < tx {
            out.push(format!("{name}: less text: {tx} -> {ty} chars"));
        }
    }
    out
}

/// Elements by `{ns}local` and attribute (`@name`) counts, and the total text length.
fn census(e: &office_core::xml::Element) -> (BTreeMap<String, usize>, usize) {
    let mut counts = BTreeMap::new();
    let mut text = 0;
    walk(e, &mut counts, &mut text);
    (counts, text)
}

fn walk(e: &office_core::xml::Element, counts: &mut BTreeMap<String, usize>, text: &mut usize) {
    let ns = e.ns.as_deref().map(short_ns).unwrap_or_default();
    *counts.entry(format!("{ns}:{}", e.local)).or_default() += 1;
    for a in &e.attrs {
        if !a.is_ns_decl() {
            *counts.entry(format!("{ns}:{}@{}", e.local, a.local)).or_default() += 1;
        }
    }
    for c in &e.children {
        match c {
            office_core::xml::Node::Element(c) => walk(c, counts, text),
            office_core::xml::Node::Text(t) | office_core::xml::Node::CData(t) => *text += t.trim().chars().count(),
            _ => {}
        }
    }
}

fn short_ns(uri: &str) -> String {
    let uri = uri.trim_end_matches('/');
    uri.rsplit('/').next().unwrap_or(uri).to_string()
}
