//! LibreOffice reads what the Word layer writes: lists with their labels, headings, comments,
//! a landscape page. Needs `soffice`, so it's ignored by default:
//! `cargo test -p office-word -- --ignored`.

use std::process::Command;

use office_core::model::{Block, Body, Paragraph};
use office_core::{Compiler, Document, Kind};
use office_word::*;

#[test]
#[ignore]
fn libreoffice_reads_our_lists_and_comments() {
    let mut doc = Document::new(Kind::Word);
    let mut title = Paragraph::text("Shopping");
    title.props.style = Some("Heading1".into());
    let mut blocks = vec![Block::Paragraph(title)];
    blocks.extend(["Apples", "Green ones", "Pears", "Plums"].iter().map(|t| Block::Paragraph(Paragraph::text(*t))));
    doc.body = Body::Flow { blocks };
    let numbers = add_list(&mut doc, ListKind::Numbers);
    let bullets = add_list(&mut doc, ListKind::Bullets);
    set_list(&mut doc, 1, Some((&numbers, 0)));
    set_list(&mut doc, 2, Some((&numbers, 1)));
    set_list(&mut doc, 3, Some((&numbers, 0)));
    set_list(&mut doc, 4, Some((&bullets, 0)));
    add_comment(&mut doc, 3, "Ada", None, None, "Ripe ones").unwrap();
    let mut s = sections(&doc)[0].clone();
    (s.page_width, s.page_height, s.landscape) = (s.page_height, s.page_width, true);
    set_section(&mut doc, 0, &s);

    let dir = std::env::temp_dir().join(format!("office-word-apps-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("lists.docx");
    std::fs::write(&path, Compiler::new().with_layer(Words).write(&doc, Kind::Word).unwrap()).unwrap();
    let out = Command::new("soffice")
        .args(["--headless", "--convert-to", "txt:Text (encoded):UTF8", "--outdir"])
        .arg(&dir)
        .arg(&path)
        .output()
        .expect("soffice should be on the PATH");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let text = std::fs::read_to_string(dir.join("lists.txt")).unwrap();
    let lines: Vec<&str> = text.lines().map(|l| l.trim_start_matches('\u{feff}').trim()).filter(|l| !l.is_empty()).collect();
    assert_eq!(&lines[..5], ["Shopping", "1. Apples", "a. Green ones", "2. Pears", "• Plums"], "{text}");
    // Text has no comments; as ODF, the comment is an annotation on its paragraph.
    let out = Command::new("soffice").args(["--headless", "--convert-to", "fodt", "--outdir"]).arg(&dir).arg(&path).output().unwrap();
    assert!(out.status.success());
    let odf = std::fs::read_to_string(dir.join("lists.fodt")).unwrap();
    let note = odf.find("<office:annotation").expect("the comment should be an annotation");
    assert!(odf[note..].contains("Ripe ones") && odf[note..].contains("Ada"));
    assert!(odf.contains("landscape"), "the page is landscape");
}
