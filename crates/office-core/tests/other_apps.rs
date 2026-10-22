//! What the compiler writes opens in other software. Needs LibreOffice (`soffice`) and,
//! optionally, python-docx, python-pptx and openpyxl, so it's ignored by default:
//!
//!     cargo test --test other_apps -- --ignored
//!
//! With OFFICE_SAMPLES set, each sample is also edited, saved and opened.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use office_core::model::{Body, Inline};
use office_core::{Document, Kind};

fn scratch() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("office-core-apps-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// LibreOffice converts the file to PDF without complaint.
fn libreoffice_opens(path: &Path) {
    // One LibreOffice at a time: copies running at once fight over its profile.
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
    let out = path.parent().unwrap().join("pdf");
    let status = Command::new("soffice")
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&out)
        .arg(path)
        .output()
        .expect("soffice should be on the PATH");
    let pdf = out.join(path.with_extension("pdf").file_name().unwrap());
    assert!(
        status.status.success() && pdf.exists(),
        "LibreOffice couldn't open {}: {}",
        path.display(),
        String::from_utf8_lossy(&status.stderr)
    );
    let bytes = std::fs::read(&pdf).unwrap();
    assert!(bytes.starts_with(b"%PDF") && bytes.len() > 500, "{} made an empty PDF", path.display());
}

/// python-docx, python-pptx or openpyxl reads the file, if they're installed.
fn python_opens(path: &Path, kind: Kind) {
    let script = match kind {
        Kind::Word => "import docx,sys; d=docx.Document(sys.argv[1]); print(len(d.paragraphs))",
        Kind::Slides => "import pptx,sys; p=pptx.Presentation(sys.argv[1]); print(len(p.slides))",
        Kind::Sheets => "import openpyxl,sys; w=openpyxl.load_workbook(sys.argv[1]); print(len(w.sheetnames))",
        Kind::Csv => return,
    };
    let module = script.split([' ', ',', ';']).nth(1).unwrap();
    // -P keeps the working directory off the import path; the user's site-packages (where pip
    // --user installs) stay on it.
    let have = Command::new("python3").args(["-P", "-c", &format!("import {module}")]).status().is_ok_and(|s| s.success());
    if !have {
        return;
    }
    let out = Command::new("python3").args(["-P", "-c", script]).arg(path).output().unwrap();
    assert!(out.status.success(), "{module} couldn't open {}: {}", path.display(), String::from_utf8_lossy(&out.stderr));
}

fn check(doc: &Document, kind: Kind, name: &str, dir: &Path) {
    let path = dir.join(format!("{name}.{}", kind.extension()));
    std::fs::write(&path, office_core::write(doc, kind).unwrap()).unwrap();
    libreoffice_opens(&path);
    python_opens(&path, kind);
}

#[test]
#[ignore]
fn new_documents_open() {
    let dir = scratch();
    check(&common::word(), Kind::Word, "word", &dir);
    check(&common::slides(), Kind::Slides, "slides", &dir);
    check(&common::sheets(), Kind::Sheets, "sheets", &dir);
}

/// Every run's text in upper case: an edit that touches every paragraph.
fn shout(doc: &mut Document) {
    fn para(p: &mut office_core::model::Paragraph) {
        for i in &mut p.content {
            if let Inline::Text(r) = i {
                r.text = r.text.to_uppercase();
            }
        }
    }
    fn blocks(bs: &mut [office_core::model::Block]) {
        for b in bs {
            match b {
                office_core::model::Block::Paragraph(p) => para(p),
                office_core::model::Block::Table(t) => t.rows.iter_mut().flat_map(|r| &mut r.cells).for_each(|c| blocks(&mut c.blocks)),
                _ => {}
            }
        }
    }
    match &mut doc.body {
        Body::Flow { blocks: b } => blocks(b),
        Body::Slides { slides, .. } => {
            for f in slides.iter_mut().flat_map(|s| &mut s.frames) {
                if let office_core::model::FrameContent::Shape { text: Some(body), .. } = &mut f.content {
                    body.paragraphs.iter_mut().for_each(para);
                }
            }
        }
        Body::Workbook { sheets } => {
            for c in sheets.iter_mut().flat_map(|s| &mut s.rows).flat_map(|r| &mut r.cells) {
                if let office_core::model::Value::Text(t) = &mut c.value {
                    *t = t.to_uppercase();
                }
            }
        }
    }
}

#[test]
#[ignore]
fn edited_samples_open() {
    let Some(samples) = std::env::var_os("OFFICE_SAMPLES") else { return };
    let dir = scratch();
    let mut stack = vec![PathBuf::from(samples)];
    while let Some(d) = stack.pop() {
        for entry in std::fs::read_dir(&d).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(kind) = path.extension().and_then(|e| Kind::from_extension(e.to_str()?)) else { continue };
            if kind == Kind::Csv {
                continue;
            }
            let name = path.file_stem().unwrap().to_string_lossy().replace(' ', "_");
            let parent = path.parent().unwrap().file_name().unwrap().to_string_lossy().to_string();
            let mut doc = office_core::read(&std::fs::read(&path).unwrap(), path.to_str()).unwrap();
            shout(&mut doc);
            check(&doc, kind, &format!("{parent}-{name}-edited"), &dir);
            // And converted to CSV and back, for workbooks.
            if kind == Kind::Sheets {
                let csv = office_core::write(&doc, Kind::Csv).unwrap();
                let back = office_core::read(&csv, Some("x.csv")).unwrap();
                let mut as_book = Document::new(Kind::Sheets);
                as_book.body = back.body;
                check(&as_book, Kind::Sheets, &format!("{parent}-{name}-via-csv"), &dir);
            }
        }
    }
}

#[test]
#[ignore]
fn conversions_open() {
    let dir = scratch();
    // A page longer than a slide, and a table longer than a slide, become several slides.
    let mut long = Document::new(Kind::Word);
    let mut blocks: Vec<office_core::model::Block> =
        (0..30).map(|i| office_core::model::Block::Paragraph(office_core::model::Paragraph::text(format!("Paragraph {i}")))).collect();
    let rows: Vec<Vec<String>> = (0..40).map(|i| vec![format!("Row {i}"), (i * i).to_string()]).collect();
    blocks.push(office_core::model::Block::Table(office_core::model::Table::from_text(&rows, office_core::units::Emu::from_inches(6.0))));
    long.body = Body::Flow { blocks };
    check(&long, Kind::Slides, "long-as-pptx", &dir);
    for (name, doc) in [("word", common::word()), ("slides", common::slides()), ("sheets", common::sheets())] {
        for kind in [Kind::Word, Kind::Slides, Kind::Sheets] {
            if kind != doc.kind {
                check(&doc, kind, &format!("{name}-as-{}", kind.extension()), &dir);
            }
        }
    }
}
