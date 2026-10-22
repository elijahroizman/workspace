use office_core::drawing::Xfrm;
use office_core::model::{Body, Frame, FrameContent, Origin, Paragraph, Slide};
use office_core::opc::Package;
use office_core::xml::{self, ns};
use office_core::{Compiler, Document, Kind};
fn deck() -> Document {
    let mut d = Document::new(Kind::Slides);
    if let Body::Slides { slides, .. } = &mut d.body {
        *slides = vec![Slide::default()];
    }
    d
}

fn slide_with_text() -> Slide {
    let mut f = Frame::text_box(2, Xfrm::default(), vec![Paragraph::text("Hello")]);
    f.shape.xfrm = None;
    f.placeholder = Some(office_core::model::Placeholder { kind: Some("obj".into()), index: None });
    Slide { frames: vec![f], layout: Some("layout".into()), ..Default::default() }
}

fn template() -> office_slides::Template {
    office_slides::Template {
        part: "layout".into(),
        name: String::new(),
        layout_type: Some("obj".into()),
        master: None,
        placeholders: vec![],
        color_map: vec![],
        title: vec![],
        body: vec![],
        other: vec![],
        theme: None,
    }
}

#[test]
fn slides_default_idx_is_zero() {
    let mut t = template();
    t.placeholders = vec![
        office_slides::templates::Placeholder { kind: "obj".into(), index: Some(1), name: "wrong".into(), xfrm: None, levels: vec![] },
        office_slides::templates::Placeholder { kind: "obj".into(), index: None, name: "right".into(), xfrm: None, levels: vec![] },
    ];
    assert_eq!(t.matching("obj", None).unwrap().name, "right");
}

#[test]
fn slides_paragraph_default_run() {
    let d = deck();
    let mut s = slide_with_text();
    if let FrameContent::Shape { text: Some(b), .. } = &mut s.frames[0].content {
        b.paragraphs[0].origin = Origin::new(
            xml::parse_element(&format!(
                r#"<a:p xmlns:a="{}"><a:pPr><a:defRPr sz="3200" b="1"/></a:pPr><a:r><a:t>Hello</a:t></a:r></a:p>"#,
                ns::A
            ))
            .unwrap(),
        );
    }
    let resolved = office_slides::resolve(&d, &s, &s.frames[0]);
    assert_eq!(resolved.paragraphs[0].1[0].bold, Some(true));
}

#[test]
fn slides_transition_exact_duration() {
    let mut s = Slide::default();
    let t = office_slides::Transition { kind: "fade".into(), direction: None, duration_ms: Some(1600), on_click: true, after_ms: None };
    office_slides::set_transition(&mut s, Some(&t));
    assert_eq!(office_slides::transition(&s).unwrap().duration_ms, Some(1600));
}

#[test]
fn slides_master_color_override_bypasses_layout() {
    let mut d = deck();
    let mut m = template();
    m.part = "master".into();
    m.layout_type = None;
    m.theme = Some(office_core::drawing::Theme::office());
    m.color_map = vec![("tx1".into(), "dk1".into())];
    let mut l = template();
    l.master = Some("master".into());
    l.color_map = vec![("tx1".into(), "lt1".into())];
    let mut ppt = office_slides::Ppt::default();
    ppt.templates = vec![m, l];
    d.extensions.insert(ppt);
    let mut s = Slide { layout: Some("layout".into()), ..Default::default() };
    s.origin = Origin::new(
        xml::parse_element(&format!(
            r#"<p:sld xmlns:p="{}" xmlns:a="{}"><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#,
            ns::P,
            ns::A
        ))
        .unwrap(),
    );
    assert_eq!(office_slides::color(&d, &s, &office_core::drawing::Color::scheme("tx1")).rgb, office_core::drawing::Rgb::BLACK);
}

#[test]
fn slides_master_paragraph_style() {
    let mut pkg = Package::read(&office_core::write(&deck(), Kind::Slides).unwrap()).unwrap();
    let p = "ppt/slideLayouts/slideLayout1.xml";
    pkg.replace(p,format!(r#"<p:sldLayout xmlns:p="{}" xmlns:a="{}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1"/></a:pPr></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>"#,ns::P,ns::A).into_bytes()).unwrap();
    let d = Compiler::new().with_layer(office_slides::Decks).read(&pkg.to_bytes().unwrap(), Some("x.pptx")).unwrap();
    let mut s = slide_with_text();
    s.layout = Some(p.into());
    s.frames[0].placeholder.as_mut().unwrap().index = Some(1);
    assert_eq!(office_slides::resolve(&d, &s, &s.frames[0]).paragraphs[0].1[0].bold, Some(true));
}

#[test]
fn slides_new_transition_keeps_effect_namespace() {
    let mut s = Slide::default();
    const P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";
    s.origin=Origin::new(xml::parse_element(&format!(r#"<p:sld xmlns:p="{}" xmlns:p14="{P14}" xmlns:mc="{}"><mc:AlternateContent><mc:Choice Requires="p14"><p:transition p14:dur="1600"><p14:vortex dir="r"/></p:transition></mc:Choice><mc:Fallback><p:transition><p:fade/></p:transition></mc:Fallback></mc:AlternateContent></p:sld>"#,ns::P,ns::MC)).unwrap());
    let t = office_slides::transition(&s).unwrap();
    office_slides::set_transition(&mut s, Some(&t));
    let root = s.origin.get().unwrap();
    let alternate = root.child(ns::MC, "AlternateContent").unwrap();
    let choice = alternate.child(ns::MC, "Choice").unwrap();
    assert_eq!(choice.attr("Requires"), Some("p14"));
    let transition = choice.child(ns::P, "transition").unwrap();
    assert_eq!(transition.attr_ns(P14, "dur"), Some("1600"));
    assert_eq!(transition.child(P14, "vortex").unwrap().attr("dir"), Some("r"));
    assert!(alternate.child(ns::MC, "Fallback").unwrap().child(ns::P, "transition").unwrap().child(ns::P, "fade").is_some());
    let encoded = xml::XmlDoc::new(root.clone()).to_bytes();
    let parsed = xml::parse(&encoded).unwrap();
    assert!(parsed.root.descendant(P14, "vortex").is_some());
    assert_eq!(office_slides::transition(&s), Some(t));
}

#[test]
fn slides_layout_to_master_matches_type_before_index() {
    let mut t = template();
    t.layout_type = None;
    t.placeholders = vec![
        office_slides::templates::Placeholder { kind: "title".into(), index: None, name: "title".into(), xfrm: None, levels: vec![] },
        office_slides::templates::Placeholder { kind: "body".into(), index: Some(3), name: "body".into(), xfrm: None, levels: vec![] },
    ];
    assert_eq!(t.matching("obj", None).unwrap().name, "body");
    assert_eq!(t.matching("ctrTitle", Some(3)).unwrap().name, "title");
}
