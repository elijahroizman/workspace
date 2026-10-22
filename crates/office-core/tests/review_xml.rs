use office_core::{
    model::*,
    opc::{content_types::types, rels::kind, Package},
    xml::{self, ns, Element},
};

fn word(xml: &str) -> Document {
    let mut pkg = Package::new();
    pkg.put("word/document.xml", xml.as_bytes().to_vec(), types::DOCX_MAIN);
    pkg.relate("", kind::OFFICE_DOCUMENT, "word/document.xml").unwrap();
    office_core::read(&pkg.to_bytes().unwrap(), Some("test.docx")).unwrap()
}

#[test]
fn namespace_prefix_collision_creates_duplicate_declarations() {
    let mut el = xml::parse_element(r#"<root xmlns:w="urn:custom"/>"#).unwrap();
    el.set_attr(ns::W, "val", "x");
    let serialized = el.to_xml_string();
    assert_eq!(serialized.matches("xmlns:w=").count(), 1, "duplicate xmlns:w makes the XML invalid");
}

#[test]
fn whitespace_text_with_xml_space_is_significant() {
    let a = xml::parse_element(r#"<t xml:space="preserve">&#10;</t>"#).unwrap();
    let b = xml::parse_element(r#"<t xml:space="preserve"/>"#).unwrap();
    assert!(!a.same_content(&b));
}

#[test]
fn changed_preserved_whitespace_is_saved() {
    let src = format!(
        r#"<w:document xmlns:w="{}"><w:body><w:p><w:r><w:instrText xml:space="preserve">&#10;</w:instrText></w:r></w:p></w:body></w:document>"#,
        ns::W
    );
    let mut doc = word(&src);
    let Body::Flow { blocks } = &mut doc.body else { unreachable!() };
    let Block::Paragraph(p) = &mut blocks[0] else { unreachable!() };
    let Inline::Raw { xml } = &mut p.content[0] else { unreachable!() };
    xml.child_mut(ns::W, "instrText").unwrap().children.clear();
    let pkg = Package::read(&office_core::write(&doc, Kind::Word).unwrap()).unwrap();
    let text = pkg.xml("word/document.xml").unwrap().root.descendant(ns::W, "instrText").unwrap().text();
    assert_eq!(text, "");
}

#[test]
fn saving_edits_to_strict_word_keeps_strict_namespaces() {
    let src = r#"<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body><w:p/></w:body></w:document>"#;
    let mut doc = word(src);
    let Body::Flow { blocks } = &mut doc.body else { unreachable!() };
    blocks.push(Block::Paragraph(Paragraph::text("new")));
    let pkg = Package::read(&office_core::write(&doc, Kind::Word).unwrap()).unwrap();
    let out = String::from_utf8(pkg.part("word/document.xml").unwrap().to_vec()).unwrap();
    assert!(!out.contains(ns::W));
}

#[test]
fn detached_raw_xml_keeps_prefixes_used_in_attribute_values() {
    let src = format!(
        r#"<w:document xmlns:w="{}" xmlns:mc="{}" xmlns:w14="urn:w14"><w:body><mc:AlternateContent><mc:Choice Requires="w14"><w:p/></mc:Choice><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent></w:body></w:document>"#,
        ns::W,
        ns::MC
    );
    let root = xml::parse_element(&src).unwrap();
    let raw = root.descendant(ns::MC, "AlternateContent").unwrap();
    let serialized = raw.to_xml_string();
    assert!(serialized.contains("xmlns:w14="));
}

#[test]
fn streaming_sheet_data_selection_uses_namespace() {
    let src = format!(
        r#"<worksheet xmlns="{}" xmlns:e="urn:extension" xmlns:mc="{}" mc:Ignorable="e"><e:sheetData/><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>"#,
        ns::X,
        ns::MC
    );
    let mut pkg = Package::read(&office_core::write(&Document::new(Kind::Sheets), Kind::Sheets).unwrap()).unwrap();
    pkg.put("xl/worksheets/sheet1.xml", src.as_bytes().to_vec(), types::XLSX_SHEET);
    let doc = office_core::read(&pkg.to_bytes().unwrap(), Some("test.xlsx")).unwrap();
    assert_eq!(doc.sheet_value(CellRef::new(0, 0)), Some(&Value::Number(42.0)));
}

#[test]
fn attribute_prefix_must_not_rebind_current_element_name() {
    let mut root = xml::parse_element(&format!(r#"<r:document xmlns:r="{}"/>"#, ns::W)).unwrap();
    root.push(Element::new(ns::W, "hyperlink").with_attr(ns::R, "id", "rId1"));
    let out = root.to_xml_string();
    let back = xml::parse_element(&out).unwrap();
    assert!(back.child(ns::W, "hyperlink").is_some());
}

#[test]
fn strict_docx_edit_keeps_strict_run_namespaces() {
    let strict = "http://purl.oclc.org/ooxml/wordprocessingml/main";
    let mut doc = word(&format!(r#"<w:document xmlns:w="{strict}"><w:body><w:p><w:r><w:t>old</w:t></w:r></w:p></w:body></w:document>"#));
    if let Body::Flow { blocks } = &mut doc.body {
        if let Block::Paragraph(p) = &mut blocks[0] {
            p.runs_mut().next().unwrap().text = "new".into();
        }
    }
    let pkg = Package::read(&office_core::write(&doc, Kind::Word).unwrap()).unwrap();
    let xml = pkg.xml("word/document.xml").unwrap();
    assert_eq!(xml.root.descendant(ns::W, "r").unwrap().ns.as_deref(), Some(strict));
}

#[test]
fn inherited_xml_space_preserves_newlines() {
    let a = xml::parse_element(r#"<p xml:space="preserve"><t>&#10;</t></p>"#).unwrap();
    let b = xml::parse_element(r#"<p xml:space="preserve"><t/></p>"#).unwrap();
    assert!(!a.same_content(&b));
}

#[test]
fn attributes_cannot_rebind_each_other() {
    let mut root = xml::parse_element(r#"<root xmlns:r="urn:first"><child/></root>"#).unwrap();
    let child = root.child_mut("", "child").unwrap();
    child.set_attr("urn:first", "one", "1");
    child.attrs[0].prefix = Some("r".into());
    child.set_attr(ns::R, "id", "rId1");
    let back = xml::parse_element(&root.to_xml_string()).unwrap();
    let child = back.child("", "child").unwrap();
    assert_eq!(child.attr_ns("urn:first", "one"), Some("1"));
    assert_eq!(child.attr_ns(ns::R, "id"), Some("rId1"));
}

#[test]
fn hollow_scope_comes_from_the_selected_namespace() {
    let source = format!(
        r#"<worksheet xmlns="{}" xmlns:e="urn:extension" xmlns:a="urn:outer"><e:sheetData xmlns:a="urn:wrong"/><sheetData xmlns:a="urn:inner"><row a:value="1"/></sheetData></worksheet>"#,
        ns::X
    );
    let h = xml::stream::parse_hollow(source.as_bytes(), Some("sheetData")).unwrap();
    let row = xml::stream::parse_in(h.inner.as_deref().unwrap(), &h.scope).unwrap();
    assert_eq!(row.attr_ns("urn:inner", "value"), Some("1"));
    assert_eq!(h.scope.iter().filter(|a| a.local == "a").count(), 1);
}

#[test]
fn strict_writer_uses_strict_relationship_attributes() {
    let strict_w = "http://purl.oclc.org/ooxml/wordprocessingml/main";
    let strict_r = "http://purl.oclc.org/ooxml/officeDocument/relationships";
    let mut root = xml::parse_element(&format!(r#"<w:document xmlns:w="{strict_w}"/>"#)).unwrap();
    root.push(Element::new(ns::W, "hyperlink").with_attr(ns::R, "id", "rId1"));
    let out = root.to_xml_string();
    assert!(!out.contains(ns::W));
    assert!(!out.contains(ns::R));
    let back = xml::parse_element(&out).unwrap();
    let h = back.child(ns::W, "hyperlink").unwrap();
    assert_eq!(h.ns.as_deref(), Some(strict_w));
    assert_eq!(h.attrs.iter().find(|a| a.local == "id").unwrap().ns.as_deref(), Some(strict_r));
}
