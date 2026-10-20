//! Round trips real files. Set OFFICE_SAMPLES to a folder of .docx, .pptx, .xlsx and .csv files
//! (`crates/samples.py` makes one with python-docx, python-pptx, openpyxl and LibreOffice);
//! without it these tests pass without checking anything.

use std::path::PathBuf;

use office_core::drawing::Theme;
use office_core::opc::Package;
use office_core::xml;

fn samples(exts: &[&str]) -> Vec<(PathBuf, Vec<u8>)> {
    let Some(dir) = std::env::var_os("OFFICE_SAMPLES") else { return Vec::new() };
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::from(dir)];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| exts.contains(&e.to_ascii_lowercase().as_str())) {
                let bytes = std::fs::read(&path).unwrap();
                out.push((path, bytes));
            }
        }
    }
    out.sort();
    out
}

#[test]
fn packages_and_parts_round_trip() {
    for (path, bytes) in samples(&["docx", "pptx", "xlsx"]) {
        let pkg = Package::read(&bytes).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        pkg.main_part().unwrap();
        for name in pkg.part_names() {
            if !(name.ends_with(".xml") || name.ends_with(".rels")) {
                continue;
            }
            let doc = pkg.xml(name).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let again = xml::parse(&doc.to_bytes()).unwrap();
            assert_eq!(doc, again, "{} {name}", path.display());
        }
        let saved = pkg.to_bytes().unwrap();
        assert_eq!(Package::read(&saved).unwrap().to_bytes().unwrap(), saved, "{}", path.display());
    }
}

#[test]
fn themes_parse() {
    for (path, bytes) in samples(&["docx", "pptx", "xlsx"]) {
        let pkg = Package::read(&bytes).unwrap();
        for name in pkg.part_names().filter(|n| n.contains("theme/theme")) {
            let theme = Theme::parse(&pkg.xml(name).unwrap()).unwrap_or_else(|| panic!("{} {name}", path.display()));
            assert_eq!(theme.colors.len(), 12, "{} {name}", path.display());
            assert!(theme.scheme_color("accent1").is_some());
            assert!(!theme.fonts.minor.latin.is_empty());
        }
    }
}

#[test]
fn csv_round_trips() {
    for (path, bytes) in samples(&["csv", "tsv"]) {
        let name = path.file_name().unwrap().to_str().unwrap();
        let doc = office_core::read(&bytes, Some(name)).unwrap();
        assert_eq!(office_core::write(&doc, office_core::Kind::Csv).unwrap(), bytes, "{}", path.display());
    }
}

/// The text a document's model holds, for checking what the front ends read.
fn text_of(doc: &office_core::Document) -> String {
    use office_core::model::{blocks_text, Body};
    match &doc.body {
        Body::Flow { blocks } => blocks_text(blocks),
        Body::Slides { slides, .. } => {
            slides.iter().flat_map(|s| &s.frames).flat_map(|f| f.paragraphs()).map(|p| p.plain_text()).collect::<Vec<_>>().join("\n")
        }
        Body::Workbook { sheets } => sheets.iter().flat_map(|s| s.to_text_rows()).map(|r| r.join(",")).collect::<Vec<_>>().join("\n"),
    }
}

#[test]
fn front_ends_read_the_samples() {
    for (path, bytes) in samples(&["docx", "pptx", "xlsx"]) {
        let name = path.file_name().unwrap().to_str().unwrap();
        let doc = office_core::read(&bytes, Some(name)).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let text = text_of(&doc);
        if std::env::var_os("OFFICE_SAMPLES_DUMP").is_some() {
            println!("== {}\n{text}\n{}", path.display(), serde_json::to_string(&doc.body).unwrap().chars().take(3000).collect::<String>());
        }
        // What crates/samples.py puts in each file.
        let expect: &[&str] = match name {
            "pydocx.docx" => &["Hello & welcome", "Plain bold red and italic", "r0c0\tr0c1\tr0c2", "r1c2", "Bullet"],
            "pypptx.pptx" => &["Title slide", "First point", "Second point", "A text box", "Table", "a", "d"],
            "openpyxl.xlsx" => &["Name,Qty,Price,Ok", "Apple,3,1.25,TRUE", "merged", "hello"],
            "sample.xlsx" => &["name,qty,note", "said \"hi\""],
            _ => &[],
        };
        for e in expect {
            assert!(text.contains(e), "{}: no {e:?} in\n{text}", path.display());
        }
    }
}

#[test]
fn saving_unchanged_samples_changes_no_part() {
    for (path, bytes) in samples(&["docx", "pptx", "xlsx"]) {
        let name = path.file_name().unwrap().to_str().unwrap();
        let doc = office_core::read(&bytes, Some(name)).unwrap();
        let saved = office_core::write(&doc, doc.kind).unwrap();
        let (a, b) = (Package::read(&bytes).unwrap(), Package::read(&saved).unwrap());
        assert_eq!(a.part_names().collect::<Vec<_>>(), b.part_names().collect::<Vec<_>>(), "{}", path.display());
        for part in a.part_names() {
            assert!(a.part(part).unwrap() == b.part(part).unwrap(), "{}: {part} was rewritten", path.display());
        }
    }
}
