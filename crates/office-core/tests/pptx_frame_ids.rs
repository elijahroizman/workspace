use std::collections::HashSet;

use office_core::drawing::Xfrm;
use office_core::model::{Body, Frame, FrameContent, Paragraph};
use office_core::opc::{content_types::types, rels::kind, Package};
use office_core::xml::{ns, Element};
use office_core::{Document, Kind};

fn fixture(root_id: u32) -> Document {
    let mut pkg = Package::new();
    pkg.put(
        "ppt/presentation.xml",
        format!(
            r#"<p:presentation xmlns:p="{}" xmlns:r="{}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>"#,
            ns::P,
            ns::R
        )
        .into_bytes(),
        types::PPTX_MAIN,
    );
    pkg.relate("", kind::OFFICE_DOCUMENT, "ppt/presentation.xml").unwrap();
    pkg.relate("ppt/presentation.xml", kind::SLIDE, "ppt/slides/slide1.xml").unwrap();
    pkg.put(
        "ppt/slides/slide1.xml",
        format!(
            r#"<p:sld xmlns:p="{}"><p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="{root_id}" name="root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
              <p:sp><p:nvSpPr><p:cNvPr id="{}" name="max"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>
              <p:sp><p:nvSpPr><p:cNvPr id="{}" name="near max"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>
            </p:grpSp>
            <p:sp><p:nvSpPr><p:cNvPr id="2" name="existing"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>
            </p:spTree></p:cSld></p:sld>"#,
            ns::P,
            u32::MAX,
            u32::MAX - 1
        )
        .into_bytes(),
        types::PPTX_SLIDE,
    );
    office_core::read(&pkg.to_bytes().unwrap(), Some("ids.pptx")).unwrap()
}

fn frame(id: u32, name: &str) -> Frame {
    let mut frame = Frame::text_box(id, Xfrm::default(), vec![Paragraph::text(name)]);
    frame.name = name.into();
    frame
}

fn ids(el: &Element, out: &mut Vec<(String, u32)>) {
    if el.is(ns::P, "cNvPr") {
        out.push((el.attr("name").unwrap().into(), el.attr("id").unwrap().parse().unwrap()));
    }
    for child in el.elements() {
        ids(child, out);
    }
}

fn saved_ids(bytes: &[u8]) -> Vec<(String, u32)> {
    let pkg = Package::read(bytes).unwrap();
    let slide = pkg.xml("ppt/slides/slide1.xml").unwrap();
    let mut out = Vec::new();
    ids(&slide.root, &mut out);
    let unique: HashSet<_> = out.iter().map(|(_, id)| *id).collect();
    assert_eq!(unique.len(), out.len(), "duplicate slide shape IDs: {out:?}");
    assert!(!unique.contains(&0), "zero is an unassigned model ID");
    out
}

#[test]
fn unchanged_max_frame_id_saves_and_reopens() {
    let doc = fixture(1);
    let saved = office_core::write(&doc, Kind::Slides).unwrap();
    let before = saved_ids(&saved);
    assert_eq!(
        before,
        vec![("root".into(), 1), ("group".into(), 4), ("max".into(), u32::MAX), ("near max".into(), u32::MAX - 1), ("existing".into(), 2)]
    );
    let reopened = office_core::read(&saved, Some("ids.pptx")).unwrap();
    let again = office_core::write(&reopened, Kind::Slides).unwrap();
    assert_eq!(saved_ids(&again), before);
    assert_eq!(
        Package::read(&saved).unwrap().part("ppt/slides/slide1.xml").unwrap(),
        Package::read(&again).unwrap().part("ppt/slides/slide1.xml").unwrap()
    );
}

#[test]
fn zero_frame_ids_use_free_ids_across_groups_and_the_slide_root() {
    for root_id in [1, 7] {
        let mut doc = fixture(root_id);
        let Body::Slides { slides, .. } = &mut doc.body else { unreachable!() };
        let frames = &mut slides[0].frames;
        let FrameContent::Group { frames: children } = &mut frames[0].content else { unreachable!() };
        children.push(frame(0, "new nested"));
        frames.insert(0, frame(0, "new first"));
        let mut group = frame(0, "new group");
        group.content = FrameContent::Group { frames: vec![frame(0, "new child")] };
        frames.insert(1, group);

        let saved = office_core::write(&doc, Kind::Slides).unwrap();
        let allocated = saved_ids(&saved);
        for (name, id) in [
            ("root", root_id),
            ("new first", 3),
            ("new group", 5),
            ("new child", 6),
            ("new nested", if root_id == 7 { 8 } else { 7 }),
            ("max", u32::MAX),
        ] {
            assert!(allocated.contains(&(name.into(), id)), "{name}: {allocated:?}");
        }
        let reopened = office_core::read(&saved, Some("ids.pptx")).unwrap();
        assert_eq!(saved_ids(&office_core::write(&reopened, Kind::Slides).unwrap()), allocated);
    }
}
