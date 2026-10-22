use office_core::drawing::{Color, Rgb};
use office_core::{
    model::*,
    opc::{content_types::types, rels::kind, Package},
    xml::{ns, Element},
};

fn word(xml: &str) -> Document {
    let mut pkg = Package::new();
    pkg.put("word/document.xml", xml.as_bytes().to_vec(), types::DOCX_MAIN);
    pkg.relate("", kind::OFFICE_DOCUMENT, "word/document.xml").unwrap();
    office_core::read(&pkg.to_bytes().unwrap(), Some("test.docx")).unwrap()
}

#[test]
fn empty_formatted_rows_convert_to_word_and_text() {
    let mut doc = Document::new(Kind::Sheets);
    let Body::Workbook { sheets } = &mut doc.body else { unreachable!() };
    sheets[0].set(CellRef::new(0, 0), Value::Text("A".into()));
    sheets[0].rows.push(SheetRow { index: 9, ..Default::default() });
    let bytes = office_core::write(&doc, Kind::Sheets).unwrap();
    let parsed = office_core::read(&bytes, Some("test.xlsx")).unwrap();
    office_core::write(&parsed, Kind::Word).unwrap();
    office_core::write(&parsed, Kind::Csv).unwrap();
    let Body::Workbook { sheets } = &parsed.body else { unreachable!() };
    assert_eq!(sheets[0].to_text_rows().unwrap(), vec![vec!["A"]]);
}

#[test]
fn alpha_must_clamp_after_each_transform() {
    let result = Color::rgb(Rgb::BLACK).with("alphaMod", 200_000).with("alphaMod", 50_000).resolve(&|_| None);
    assert_eq!(result.alpha, 0.5);
}

#[test]
fn merging_runs_must_keep_unmodeled_formatting() {
    let src = format!(
        r#"<w:document xmlns:w="{}"><w:body><w:p><w:r><w:rPr><w:spacing w:val="0"/></w:rPr><w:t>a</w:t></w:r><w:r><w:rPr><w:spacing w:val="40"/></w:rPr><w:t>b</w:t></w:r></w:p></w:body></w:document>"#,
        ns::W
    );
    let mut doc = word(&src);
    let Body::Flow { blocks } = &mut doc.body else { unreachable!() };
    let Block::Paragraph(p) = &mut blocks[0] else { unreachable!() };
    p.merge_runs();
    let pkg = Package::read(&office_core::write(&doc, Kind::Word).unwrap()).unwrap();
    let out = String::from_utf8(pkg.part("word/document.xml").unwrap().to_vec()).unwrap();
    assert!(out.contains(r#"w:val="40""#));
}

#[test]
fn malformed_long_cell_ref_returns_error() {
    assert!(CellRef::parse("ZZZZZZZZZZZZ1").is_none());
}

#[test]
fn font_size_saturates_in_hostile_docx() {
    let src = format!(
        r#"<w:document xmlns:w="{}"><w:body><w:p><w:r><w:rPr><w:sz w:val="4294967295"/></w:rPr><w:t>a</w:t></w:r></w:p></w:body></w:document>"#,
        ns::W
    );
    let _ = word(&src);
}

#[test]
fn unit_boundaries_do_not_overflow() {
    use office_core::units::{Emu, FontSize};
    assert_eq!(Emu::from_twips(i64::MAX), Emu(i64::MAX));
    assert_eq!(Emu::from_twips(i64::MIN), Emu(i64::MIN));
    assert_eq!(Emu(i64::MAX).twips(), ((i64::MAX as i128 + 317) / 635) as i64);
    assert_eq!(Emu(i64::MIN).twips(), -((-(i64::MIN as i128) + 317) / 635) as i64);
    assert_eq!(FontSize::from_half_points(u32::MAX), FontSize(u32::MAX));
    assert_eq!(FontSize(u32::MAX).half_points(), ((u32::MAX as u64 + 25) / 50) as u32);
    assert!(Emu::parse("999999999999999999999999pt", 1).is_none());
}

#[test]
fn equivalent_drawing_runs_merge_across_line_breaks() {
    let props = Element::new(ns::A, "rPr").with_attr("", "b", "1");
    let mut p = Paragraph::default();
    for (local, text) in [("r", "before"), ("br", "\n"), ("r", "after")] {
        let mut origin = Element::new(ns::A, local).with_child(props.clone());
        if local == "r" {
            origin.push(Element::new(ns::A, "t").with_text(text));
        }
        p.content.push(Inline::Text(Run {
            text: text.into(),
            props: RunProps { bold: Some(true), ..Default::default() },
            origin: Origin::new(origin),
            ..Default::default()
        }));
    }
    p.merge_runs();
    assert_eq!(p.runs().count(), 1);
    assert_eq!(p.plain_text(), "before\nafter");
}
