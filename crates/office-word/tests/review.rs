use office_core::model::{Body, Origin, ParaProps, Paragraph, RunProps};
use office_core::opc::Package;
use office_core::xml::{self, ns};
use office_core::{Compiler, Document, Kind};
use office_word::{numbering::Numbering, styles::Styles};
const ABS: &str = r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>"#;
fn word_styles(s: &str) -> Styles {
    Styles::parse(&xml::parse(format!("<w:styles xmlns:w=\"{}\">{s}</w:styles>", ns::W).as_bytes()).unwrap())
}

fn numbering(s: &str) -> Numbering {
    Numbering::parse(&xml::parse(format!("<w:numbering xmlns:w=\"{}\">{s}</w:numbering>", ns::W).as_bytes()).unwrap())
}

#[test]
fn word_chain_toggles() {
    let s = word_styles(
        r#"<w:style w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style><w:style w:styleId="Derived"><w:basedOn w:val="Base"/><w:rPr><w:b/></w:rPr></w:style>"#,
    );
    assert_eq!(
        s.resolve_run(&ParaProps { style: Some("Derived".into()), ..Default::default() }, &RunProps::default(), None).bold,
        Some(false)
    );
}

#[test]
fn word_full_level_override() {
    let n = numbering(&format!(
        r#"{ABS}<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1)"/></w:lvl></w:lvlOverride></w:num>"#
    ));
    assert_eq!(n.labels([Some(("1".into(), 0))]), vec![Some("I)".into())]);
}

#[test]
fn word_remove_style_numbering() {
    let c = Compiler::new().with_layer(office_word::Words);
    let mut d = c.read(&office_core::write(&Document::new(Kind::Word), Kind::Word).unwrap(), Some("x.docx")).unwrap();
    let id = office_word::add_list(&mut d, office_word::ListKind::Numbers);
    let s = word_styles(&format!(r#"<w:style w:styleId="ListStyle"><w:pPr><w:numPr><w:numId w:val="{id}"/></w:numPr></w:pPr></w:style>"#));
    office_word::word_mut(&mut d).styles = s;
    if let Body::Flow { blocks } = &mut d.body {
        let mut p = Paragraph::text("x");
        p.props.style = Some("ListStyle".into());
        *blocks = vec![office_core::model::Block::Paragraph(p)];
    }
    office_word::set_list(&mut d, 0, None);
    assert_eq!(office_word::list_labels(&d), vec![None]);
}

#[test]
fn word_restart_at_specific_level() {
    let n = numbering(
        r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%2"/></w:lvl><w:lvl w:ilvl="2"><w:numFmt w:val="decimal"/><w:lvlText w:val="%3"/><w:lvlRestart w:val="1"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#,
    );
    let got = n.labels([2, 1, 2].map(|l| Some(("1".into(), l))));
    assert_eq!(got, vec![Some("1".into()), Some("1".into()), Some("2".into())]);
}

#[test]
fn word_style_numbering_level() {
    let mut d = Document::new(Kind::Word);
    let s = word_styles(r#"<w:style w:styleId="Nested"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>"#);
    let w = office_word::word_mut(&mut d);
    w.styles = s;
    w.numbering = numbering(
        r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="2"><w:pStyle w:val="Nested"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#,
    );
    let mut p = Paragraph::text("x");
    p.props.style = Some("Nested".into());
    assert_eq!(office_word::list_of(&d, &p), Some(("1".into(), 2)));
}

#[test]
fn word_reject_table_property_revision() {
    let mut pkg = Package::read(&office_core::write(&Document::new(Kind::Word), Kind::Word).unwrap()).unwrap();
    let p = "word/document.xml";
    pkg.replace(p,format!(r#"<w:document xmlns:w="{}"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblPrChange w:id="1" w:author="A"><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr></w:tblPrChange></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>"#,ns::W).into_bytes()).unwrap();
    let c = Compiler::new().with_layer(office_word::Words);
    let mut d = c.read(&pkg.to_bytes().unwrap(), Some("x.docx")).unwrap();
    office_word::reject_all(&mut d).unwrap();
    assert!(office_word::revisions(&d).is_empty());
    let out = Package::read(&c.write(&d, Kind::Word).unwrap()).unwrap();
    let xml = out.xml(p).unwrap();
    assert!(xml.root.descendant(ns::W, "tblPrChange").is_none());
    assert_eq!(xml.root.descendant(ns::W, "tblW").unwrap().attr_ns(ns::W, "w"), Some("4000"));
}

#[test]
fn word_deleted_merged_row_shrinks_span() {
    let c = Compiler::new().with_layer(office_word::Words);
    let mut d = c.read(&office_core::write(&Document::new(Kind::Word), Kind::Word).unwrap(), Some("x.docx")).unwrap();
    let cell = |s| office_core::model::Cell::text(s);
    let mut owner = cell("owner");
    owner.row_span = 3;
    let mut covered1 = cell("");
    covered1.covered = true;
    let mut covered2 = cell("");
    covered2.covered = true;
    let row = |cells| office_core::model::Row { cells, ..Default::default() };
    let mut deleted = row(vec![covered1]);
    deleted.origin = Origin::new(
        xml::parse_element(&format!(r#"<w:tr xmlns:w="{}"><w:trPr><w:del w:id="1" w:author="A"/></w:trPr></w:tr>"#, ns::W)).unwrap(),
    );
    let t = office_core::model::Table {
        columns: vec![office_core::units::Emu(1000)],
        rows: vec![row(vec![owner]), deleted, row(vec![covered2]), row(vec![cell("independent")])],
        ..Default::default()
    };
    if let Body::Flow { blocks } = &mut d.body {
        *blocks = vec![office_core::model::Block::Table(t)]
    }
    office_word::accept_all(&mut d).unwrap();
    let Body::Flow { blocks } = &d.body else { unreachable!() };
    let office_core::model::Block::Table(t) = &blocks[0] else { unreachable!() };
    assert_eq!(t.rows[0].cells[0].row_span, 2);
}

#[test]
fn word_all_style_toggles_and_direct_formatting() {
    use office_core::model::Strike;
    for property in ["b", "i", "caps", "smallCaps", "strike", "dstrike"] {
        let styles = word_styles(&format!(
            r#"<w:style w:styleId="Base"><w:rPr><w:{property}/></w:rPr></w:style><w:style w:styleId="Derived"><w:basedOn w:val="Base"/><w:rPr><w:{property}/></w:rPr></w:style><w:style w:styleId="NoToggle"><w:basedOn w:val="Base"/><w:rPr><w:{property} w:val="0"/></w:rPr></w:style>"#
        ));
        let resolved =
            |name: &str| styles.resolve_run(&ParaProps { style: Some(name.into()), ..Default::default() }, &RunProps::default(), None);
        let on = resolved("Base");
        let off = resolved("Derived");
        assert_eq!(resolved("NoToggle"), on);
        match property {
            "b" => assert_eq!((on.bold, off.bold), (Some(true), Some(false))),
            "i" => assert_eq!((on.italic, off.italic), (Some(true), Some(false))),
            "caps" => assert_eq!((on.caps, off.caps), (Some(true), Some(false))),
            "smallCaps" => assert_eq!((on.small_caps, off.small_caps), (Some(true), Some(false))),
            "strike" => assert_eq!((on.strike, off.strike), (Some(Strike::Single), Some(Strike::None))),
            _ => assert_eq!((on.strike, off.strike), (Some(Strike::Double), Some(Strike::None))),
        }
        let direct = RunProps {
            bold: Some(true),
            italic: Some(true),
            caps: Some(true),
            small_caps: Some(true),
            strike: Some(Strike::Double),
            ..Default::default()
        };
        let r = styles.resolve_run(&ParaProps { style: Some("Derived".into()), ..Default::default() }, &direct, None);
        assert_eq!(
            (r.bold, r.italic, r.caps, r.small_caps, r.strike),
            (Some(true), Some(true), Some(true), Some(true), Some(Strike::Double))
        );
    }
}

#[test]
fn word_extended_toggles_stay_in_word_layer() {
    let props = "<w:outline/><w:shadow/><w:emboss/><w:imprint/><w:vanish/>";
    let styles = word_styles(&format!(
        r#"<w:style w:styleId="Base"><w:rPr>{props}</w:rPr></w:style><w:style w:styleId="Derived"><w:basedOn w:val="Base"/><w:rPr>{props}</w:rPr></w:style>"#
    ));
    let para = |name: &str| ParaProps { style: Some(name.into()), ..Default::default() };
    let run = RunProps::default();
    let get = |p: &ParaProps, direct| styles.resolve_run_with_toggles(p, &run, direct, None).toggles;
    let on = get(&para("Base"), None);
    let off = get(&para("Derived"), None);
    assert_eq!((on.outline, on.shadow, on.emboss, on.imprint, on.vanish), (Some(true), Some(true), Some(true), Some(true), Some(true)));
    assert_eq!(
        (off.outline, off.shadow, off.emboss, off.imprint, off.vanish),
        (Some(false), Some(false), Some(false), Some(false), Some(false))
    );
    let direct = xml::parse_element(&format!(r#"<w:rPr xmlns:w="{}">{props}</w:rPr>"#, ns::W)).unwrap();
    assert_eq!(get(&para("Derived"), Some(&direct)), on);
}

#[test]
fn word_accept_and_reject_all_table_property_kinds() {
    let source = format!(
        r#"<w:document xmlns:w="{}"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblPrChange w:id="1"><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr></w:tblPrChange></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="800"/><w:trPrChange w:id="2"><w:trPr><w:trHeight w:val="400"/><w:tblHeader/></w:trPr></w:trPrChange></w:trPr><w:tc><w:tcPr><w:shd w:fill="FF0000"/><w:tcPrChange w:id="3"><w:tcPr><w:shd w:fill="0000FF"/></w:tcPr></w:tcPrChange></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>"#,
        ns::W
    );
    for accept in [false, true] {
        let mut pkg = Package::read(&office_core::write(&Document::new(Kind::Word), Kind::Word).unwrap()).unwrap();
        pkg.replace("word/document.xml", source.as_bytes().to_vec()).unwrap();
        let c = Compiler::new().with_layer(office_word::Words);
        let mut d = c.read(&pkg.to_bytes().unwrap(), Some("x.docx")).unwrap();
        assert_eq!(office_word::revisions(&d).len(), 3);
        if accept {
            office_word::accept_all(&mut d).unwrap();
        } else {
            office_word::reject_all(&mut d).unwrap();
        }
        assert!(office_word::revisions(&d).is_empty());
        let out = Package::read(&c.write(&d, Kind::Word).unwrap()).unwrap();
        let x = out.xml("word/document.xml").unwrap();
        for tag in ["tblPrChange", "trPrChange", "tcPrChange"] {
            assert!(x.root.descendant(ns::W, tag).is_none());
        }
        assert_eq!(x.root.descendant(ns::W, "tblW").unwrap().attr_ns(ns::W, "w"), Some(if accept { "9000" } else { "4000" }));
        assert_eq!(x.root.descendant(ns::W, "trHeight").unwrap().attr_ns(ns::W, "val"), Some(if accept { "800" } else { "400" }));
        assert_eq!(x.root.descendant(ns::W, "shd").unwrap().attr_ns(ns::W, "fill"), Some(if accept { "FF0000" } else { "0000FF" }));
        assert_eq!(x.root.descendant(ns::W, "tblHeader").is_some(), !accept);
    }
}
