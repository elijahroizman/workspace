//! The back ends: documents built in code survive a write and a read, edits land where they
//! should, and nothing else in the package moves.

mod common;

use common::*;
use office_core::drawing::Xfrm;
use office_core::model::*;
use office_core::opc::Package;
use office_core::units::Emu;
use office_core::{Document, Kind};

fn body_blocks(doc: &Document) -> &[Block] {
    match &doc.body {
        Body::Flow { blocks } => blocks,
        _ => panic!("not a flow document"),
    }
}

/// Asserts two parts of the model are equal, naming the first place they aren't.
fn same<T: serde::Serialize + PartialEq>(a: &T, b: &T) {
    fn first(a: &serde_json::Value, b: &serde_json::Value, path: String) -> Option<String> {
        use serde_json::Value::*;
        match (a, b) {
            (Object(x), Object(y)) => {
                x.keys().chain(y.keys()).find_map(|k| first(x.get(k).unwrap_or(&Null), y.get(k).unwrap_or(&Null), format!("{path}.{k}")))
            }
            (Array(x), Array(y)) if x.len() == y.len() => {
                x.iter().zip(y).enumerate().find_map(|(i, (x, y))| first(x, y, format!("{path}[{i}]")))
            }
            (x, y) if x == y => None,
            (x, y) => Some(format!("{path}: {x} vs {y}")),
        }
    }
    if a != b {
        let (x, y) = (serde_json::to_value(a).unwrap(), serde_json::to_value(b).unwrap());
        panic!("differ at {}", first(&x, &y, String::new()).unwrap_or_else(|| "(only in what JSON leaves out)".into()));
    }
}

/// The model in a form that doesn't depend on how a format happens to split things: runs
/// joined, covered cells' (invisible) content dropped, where things were read from forgotten.
fn canon(mut doc: Document) -> Body {
    fn blocks(blocks: &mut [Block]) {
        for b in blocks {
            match b {
                Block::Paragraph(p) => {
                    p.merge_runs();
                    for i in &mut p.content {
                        if let Inline::Image(img) = i {
                            img.media.clear();
                        }
                    }
                }
                Block::Table(t) => table(t),
                Block::Raw { .. } => {}
            }
        }
    }
    fn table(t: &mut Table) {
        for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
            if cell.covered {
                cell.blocks.clear();
            }
            blocks(&mut cell.blocks);
        }
    }
    fn frames(list: &mut [Frame]) {
        for f in list {
            match &mut f.content {
                FrameContent::Shape { text: Some(body), .. } => body.paragraphs.iter_mut().for_each(Paragraph::merge_runs),
                FrameContent::Table { table: t } => table(t),
                FrameContent::Group { frames: inner } => frames(inner),
                // Media ids name where the bytes are, which changes on saving.
                FrameContent::Picture { image } => image.media.clear(),
                _ => {}
            }
        }
    }
    match &mut doc.body {
        Body::Flow { blocks: b } => blocks(b),
        Body::Slides { slides, .. } => slides.iter_mut().for_each(|s| {
            s.part = None;
            s.layout = None;
            frames(&mut s.frames)
        }),
        Body::Workbook { sheets } => sheets.iter_mut().for_each(|s| s.part = None),
    }
    doc.body
}

fn round_trip(doc: &Document, kind: Kind) -> Document {
    let bytes = office_core::write(doc, kind).unwrap();
    office_core::read(&bytes, Some(&format!("x.{}", kind.extension()))).unwrap()
}

#[test]
fn word_from_scratch() {
    let doc = word();
    let back = round_trip(&doc, Kind::Word);
    same(&canon(back.clone()), &canon(doc.clone()));
    assert_eq!(back.properties.title.as_deref(), Some("From scratch"));
    let Block::Paragraph(p) = &body_blocks(&back)[3] else { panic!() };
    let Inline::Image(img) = &p.content[0] else { panic!() };
    assert_eq!(&*back.media_bytes(&img.media).unwrap(), PNG);
    assert!(back.theme.is_some(), "a new document gets the Office theme");
}

#[test]
fn slides_from_scratch() {
    let doc = slides();
    let back = round_trip(&doc, Kind::Slides);
    same(&canon(back), &canon(doc));
}

#[test]
fn sheets_from_scratch() {
    let doc = sheets();
    let back = round_trip(&doc, Kind::Sheets);
    same(&canon(back), &canon(doc));
}

#[test]
fn edits_touch_only_what_changed() {
    let mut doc = Document::new(Kind::Word);
    let png = doc.add_media("image/png", PNG.to_vec());
    let pic = Paragraph {
        content: vec![Inline::Image(Image {
            media: png,
            width: Emu(1000),
            height: Emu(1000),
            name: "Dot".into(),
            description: None,
            origin: Default::default(),
        })],
        ..Default::default()
    };
    doc.body = Body::Flow {
        blocks: vec![Block::Paragraph(rich_paragraph()), Block::Paragraph(Paragraph::text("untouched")), Block::Paragraph(pic)],
    };
    let first = office_core::write(&doc, Kind::Word).unwrap();

    // Saving what was read, unchanged, changes nothing.
    let mut read = office_core::read(&first, Some("x.docx")).unwrap();
    let again = office_core::write(&read, Kind::Word).unwrap();
    let (a, b) = (Package::read(&first).unwrap(), Package::read(&again).unwrap());
    for name in a.part_names() {
        assert_eq!(a.part(name).unwrap(), b.part(name).unwrap(), "{name} changed");
    }

    // Make one run italic and change the other paragraph's text.
    let Body::Flow { blocks } = &mut read.body else { panic!() };
    let Block::Paragraph(p) = &mut blocks[0] else { panic!() };
    p.runs_mut().next().unwrap().props.italic = Some(true);
    let Block::Paragraph(p) = &mut blocks[1] else { panic!() };
    p.runs_mut().next().unwrap().text = "edited".into();
    let edited = office_core::write(&read, Kind::Word).unwrap();
    let c = Package::read(&edited).unwrap();
    for name in a.part_names() {
        let same = a.part(name).unwrap() == c.part(name).unwrap();
        assert_eq!(same, name != "word/document.xml", "{name}");
    }
    let back = office_core::read(&edited, Some("x.docx")).unwrap();
    let blocks = body_blocks(&back);
    let Block::Paragraph(p0) = &blocks[0] else { panic!() };
    assert_eq!(p0.runs().next().unwrap().props.italic, Some(true));
    assert_eq!(p0.runs().nth(1).unwrap().props.bold, Some(true), "the other runs keep their formatting");
    let Block::Paragraph(p1) = &blocks[1] else { panic!() };
    assert_eq!(p1.plain_text(), "edited");
}

#[test]
fn removing_slides_and_sheets() {
    let mut doc = Document::new(Kind::Slides);
    let slide = |t: &str| Slide {
        frames: vec![Frame::text_box(2, Xfrm { width: Emu(100), height: Emu(100), ..Default::default() }, vec![Paragraph::text(t)])],
        ..Default::default()
    };
    doc.body = Body::Slides { size: SlideSize::default(), slides: vec![slide("one"), slide("two"), slide("three")] };
    let mut read = round_trip(&doc, Kind::Slides);
    let Body::Slides { slides, .. } = &mut read.body else { panic!() };
    slides.remove(1);
    slides.swap(0, 1);
    let back = round_trip(&read, Kind::Slides);
    let Body::Slides { slides, .. } = &back.body else { panic!() };
    let texts: Vec<String> = slides.iter().map(|s| s.frames[0].paragraphs()[0].plain_text()).collect();
    assert_eq!(texts, ["three", "one"]);
    let pkg = back.package.as_ref().unwrap();
    assert_eq!(pkg.part_names().filter(|n| n.starts_with("ppt/slides/slide")).count(), 2, "the removed slide's part is gone");

    let mut doc = Document::new(Kind::Sheets);
    let Body::Workbook { sheets } = &mut doc.body else { panic!() };
    sheets.push(Sheet::new("Two"));
    let mut read = round_trip(&doc, Kind::Sheets);
    let Body::Workbook { sheets } = &mut read.body else { panic!() };
    sheets.remove(0);
    let back = round_trip(&read, Kind::Sheets);
    let Body::Workbook { sheets } = &back.body else { panic!() };
    assert_eq!(sheets.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Two"]);
}
