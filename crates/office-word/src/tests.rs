use office_core::model::{Block, Body, Paragraph};
use office_core::opc::Package;
use office_core::units::{Emu, FontSize};
use office_core::{Compiler, Document, Kind};

use super::*;

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn compiler() -> Compiler {
    Compiler::new().with_layer(Words)
}

fn round_trip(doc: &Document) -> Document {
    compiler().read(&compiler().write(doc, Kind::Word).unwrap(), Some("x.docx")).unwrap()
}

fn texts(doc: &Document) -> Vec<String> {
    paragraphs(doc).iter().map(|p| p.plain_text()).collect()
}

fn word_doc(paragraphs: Vec<Paragraph>) -> Document {
    let mut doc = Document::new(Kind::Word);
    doc.body = Body::Flow { blocks: paragraphs.into_iter().map(Block::Paragraph).collect() };
    doc
}

/// A document written by the core, then given `body` (Word markup for the body's blocks) and
/// extra parts, as Word would have saved them.
fn with_markup(body: &str, parts: &[(&str, &str, &str, &str)]) -> Document {
    let bytes = office_core::write(&word_doc(vec![]), Kind::Word).unwrap();
    let mut pkg = Package::read(&bytes).unwrap();
    let text = String::from_utf8(pkg.part("word/document.xml").unwrap().to_vec()).unwrap();
    let text = text.replacen("<w:body>", &format!("<w:body>{body}"), 1);
    pkg.replace("word/document.xml", text.into_bytes()).unwrap();
    for (name, rel, media, xml) in parts {
        pkg.put(name, xml.as_bytes().to_vec(), media);
        let id = pkg.relate("word/document.xml", rel, name).unwrap();
        // A header goes in the section's properties too.
        if *rel == "header" {
            let text = String::from_utf8(pkg.part("word/document.xml").unwrap().to_vec()).unwrap();
            let text = text.replacen("<w:sectPr>", &format!(r#"<w:sectPr><w:headerReference w:type="default" r:id="{id}"/>"#), 1);
            pkg.replace("word/document.xml", text.into_bytes()).unwrap();
        }
    }
    compiler().read(&pkg.to_bytes().unwrap(), Some("x.docx")).unwrap()
}

#[test]
fn built_in_styles_are_added_and_resolve() {
    let mut heading = Paragraph::text("Title");
    heading.props.style = Some("Heading1".into());
    let doc = round_trip(&word_doc(vec![heading, Paragraph::text("Body")]));
    let w = word(&doc).unwrap();
    assert!(w.styles.get("Heading1").is_some(), "Heading1 was written because a paragraph uses it");
    let ps = paragraphs(&doc);
    let run = resolved_run(&doc, ps[0], ps[0].runs().next().unwrap());
    assert_eq!(run.size, Some(FontSize(1600)));
    assert_eq!(run.font.as_deref(), Some("Calibri Light"), "the theme's heading font");
    let body = resolved_run(&doc, ps[1], ps[1].runs().next().unwrap());
    assert_eq!((body.size, body.font.as_deref()), (Some(FontSize(1100)), Some("Calibri")));
    assert_eq!(resolved_para(&doc, ps[1]).space_after, Some(Emu::from_twips(160)));
}

#[test]
fn lists_get_their_labels() {
    let mut doc = word_doc((0..5).map(|i| Paragraph::text(format!("item {i}"))).collect());
    let numbers = add_list(&mut doc, ListKind::Numbers);
    let bullets = add_list(&mut doc, ListKind::Bullets);
    set_list(&mut doc, 0, Some((&numbers, 0)));
    set_list(&mut doc, 1, Some((&numbers, 1)));
    set_list(&mut doc, 2, Some((&numbers, 0)));
    set_list(&mut doc, 4, Some((&bullets, 0)));
    let expect = [Some("1."), Some("a."), Some("2."), None, Some("•")];
    let labels = list_labels(&doc);
    assert_eq!(labels.iter().map(|l| l.as_deref()).collect::<Vec<_>>(), expect);
    let back = round_trip(&doc);
    assert_eq!(list_labels(&back).iter().map(|l| l.as_deref()).collect::<Vec<_>>(), expect);
    assert!(word(&back).unwrap().styles.get("ListParagraph").is_some());
    // Out of the list again.
    let mut back = back;
    set_list(&mut back, 0, None);
    assert_eq!(list_labels(&round_trip(&back))[0], None);
}

#[test]
fn sections_page_setup() {
    let mut doc = round_trip(&word_doc(vec![Paragraph::text("x")]));
    let s = &sections(&doc)[0];
    assert_eq!((s.page_width, s.landscape), (Emu::from_twips(11_906), false), "A4 portrait");
    let landscape =
        Section { page_width: s.page_height, page_height: s.page_width, landscape: true, margin_left: Emu::from_cm(2.0), ..s.clone() };
    set_section(&mut doc, 0, &landscape);
    let back = round_trip(&doc);
    let s = &sections(&back)[0];
    assert!(s.landscape);
    assert_eq!(s.margin_left, Emu::from_twips(Emu::from_cm(2.0).twips()));
}

#[test]
fn headers_and_footnotes_are_blocks() {
    let header = format!(r#"<w:hdr xmlns:w="{W}"><w:p><w:r><w:t>Old header</w:t></w:r></w:p></w:hdr>"#);
    let notes = format!(
        r#"<w:footnotes xmlns:w="{W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>A note.</w:t></w:r></w:p></w:footnote></w:footnotes>"#
    );
    let body = r#"<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>"#;
    let header_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
    let notes_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml";
    let mut doc =
        with_markup(body, &[("word/header1.xml", "header", header_type, &header), ("word/footnotes.xml", "footnotes", notes_type, &notes)]);
    let w = word(&doc).unwrap();
    assert_eq!(w.headers.len(), 1);
    assert_eq!(office_core::model::blocks_text(&w.headers[0].blocks), "Old header");
    assert_eq!(
        w.notes.iter().map(|n| (n.id.as_str(), office_core::model::blocks_text(&n.blocks))).collect::<Vec<_>>(),
        [("1", "A note.".to_string())]
    );
    assert_eq!(sections(&doc)[0].headers.len(), 1);

    let w = word_mut(&mut doc);
    w.headers[0].blocks = vec![Block::Paragraph(Paragraph::text("New header"))];
    w.notes[0].blocks = vec![Block::Paragraph(Paragraph::text("A better note."))];
    let back = round_trip(&doc);
    let w = word(&back).unwrap();
    assert_eq!(office_core::model::blocks_text(&w.headers[0].blocks), "New header");
    assert_eq!(office_core::model::blocks_text(&w.notes[0].blocks), "A better note.");
    // The separator is still there.
    let pkg = back.package.as_ref().unwrap();
    assert!(String::from_utf8_lossy(pkg.part("word/footnotes.xml").unwrap()).contains("w:separator"));
}

#[test]
fn comments_come_and_go() {
    let mut doc = word_doc(vec![Paragraph::text("Look at this."), Paragraph::text("And this.")]);
    let id = add_comment(&mut doc, 0, "Ada", Some("AL"), Some("2026-10-21T09:00:00Z"), "Nice.").unwrap();
    let back = round_trip(&doc);
    let w = word(&back).unwrap();
    assert_eq!(w.comments.len(), 1);
    assert_eq!((w.comments[0].author.as_str(), w.comments[0].text()), ("Ada", "Nice.".to_string()));
    assert_eq!(commented_text(&back, &id).trim(), "Look at this.");
    let mut back = back;
    remove_comment(&mut back, &id);
    let again = round_trip(&back);
    assert!(word(&again).unwrap().comments.is_empty());
    assert_eq!(texts(&again), ["Look at this.", "And this."]);
}

fn tracked() -> Document {
    let body = r#"<w:p><w:r><w:t xml:space="preserve">Keep </w:t></w:r><w:ins w:id="1" w:author="Ada" w:date="2026-10-21T09:00:00Z"><w:r><w:t>added </w:t></w:r></w:ins><w:del w:id="2" w:author="Bob"><w:r><w:delText>gone </w:delText></w:r></w:del><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr><w:t>bold</w:t></w:r></w:p><w:p><w:pPr><w:rPr><w:del w:id="4" w:author="Bob"/></w:rPr></w:pPr><w:r><w:t>joined </w:t></w:r></w:p><w:p><w:r><w:t>next</w:t></w:r></w:p>"#;
    with_markup(body, &[])
}

#[test]
fn tracked_changes() {
    let doc = tracked();
    let revs = revisions(&doc);
    let kinds: Vec<RevisionKind> = revs.iter().map(|r| r.kind).collect();
    assert_eq!(kinds, [RevisionKind::Insertion, RevisionKind::Deletion, RevisionKind::Formatting, RevisionKind::Paragraph]);
    assert!(revs.iter().any(|r| r.kind == RevisionKind::Insertion && r.text == "added " && r.author == "Ada"));
    assert!(revs.iter().any(|r| r.kind == RevisionKind::Deletion && r.text == "gone "));

    let mut accepted = tracked();
    assert_eq!(accept_all(&mut accepted).unwrap(), 4);
    assert_eq!(texts(&accepted), ["Keep added bold", "joined next"]);
    assert!(revisions(&accepted).is_empty());
    let back = round_trip(&accepted);
    assert_eq!(texts(&back), ["Keep added bold", "joined next"]);
    assert!(revisions(&back).is_empty());
    let bold = paragraphs(&back)[0].runs().last().unwrap().props.bold;
    assert_eq!(bold, Some(true));

    let mut rejected = tracked();
    reject_all(&mut rejected).unwrap();
    assert_eq!(texts(&rejected), ["Keep gone bold", "joined ", "next"]);
    let back = round_trip(&rejected);
    assert_eq!(paragraphs(&back)[0].runs().last().unwrap().props.bold, None, "the bold was the change");
    assert!(revisions(&back).is_empty());
}

#[test]
fn an_unchanged_document_saves_unchanged() {
    let doc = tracked();
    let first = compiler().write(&doc, Kind::Word).unwrap();
    let again = compiler().write(&compiler().read(&first, Some("x.docx")).unwrap(), Kind::Word).unwrap();
    assert_eq!(first, again);
}
