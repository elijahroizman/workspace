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
