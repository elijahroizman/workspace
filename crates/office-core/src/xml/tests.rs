use super::*;

const WORD: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"><!-- a comment --><w:body><w:p><w:r><w:t xml:space="preserve"> Fish &amp; chips &lt;3 </w:t></w:r><w:hyperlink r:id="rId4"/></w:p><w:p/></w:body></w:document>"#;

#[test]
fn round_trips_a_part() {
    let doc = parse(WORD.as_bytes()).unwrap();
    let again = parse(&doc.to_bytes()).unwrap();
    assert_eq!(doc, again);
    // Prefixes, declarations and the comment are all still there.
    let out = String::from_utf8(doc.to_bytes()).unwrap();
    assert!(out.starts_with(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#));
    assert!(out.contains("<!-- a comment -->"));
    assert!(out.contains(r#"<w:t xml:space="preserve"> Fish &amp; chips &lt;3 </w:t>"#));
    assert!(out.contains(r#"mc:Ignorable="w14""#));
    assert!(out.contains("<w:p/>"));
}

#[test]
fn looks_up_by_namespace() {
    let doc = parse(WORD.as_bytes()).unwrap();
    let body = doc.root.child(ns::W, "body").unwrap();
    assert_eq!(body.children_named(ns::W, "p").count(), 2);
    let t = body.path(ns::W, &["p", "r", "t"]).unwrap();
    assert_eq!(t.text(), " Fish & chips <3 ");
    assert_eq!(t.attr_ns(ns::XML, "space"), Some("preserve"));
    let link = body.descendant(ns::W, "hyperlink").unwrap();
    assert_eq!(link.attr_ns(ns::R, "id"), Some("rId4"));
    assert_eq!(link.attr("id"), None);
}

#[test]
fn other_prefixes_and_strict_namespaces_match() {
    let xml = r#"<x:document xmlns:x="http://purl.oclc.org/ooxml/wordprocessingml/main"><x:body/></x:document>"#;
    let doc = parse(xml.as_bytes()).unwrap();
    assert!(doc.root.is(ns::W, "document"));
    assert!(doc.root.child(ns::W, "body").is_some());
}

#[test]
fn default_namespace_and_unprefixed_attributes() {
    let xml = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="A1" t="s"><v>0</v></c></worksheet>"#;
    let doc = parse(xml.as_bytes()).unwrap();
    let c = doc.root.child(ns::X, "c").unwrap();
    assert_eq!(c.attr("r"), Some("A1"));
    assert_eq!(c.attr_ns(ns::X, "r"), None, "unprefixed attributes have no namespace");
    assert_eq!(String::from_utf8(doc.to_bytes()).unwrap(), xml);
}

#[test]
fn new_elements_get_declared() {
    let p = Element::new(ns::W, "p").with_child(Element::new(ns::W, "r").with_child(Element::new(ns::W, "t").with_text("hi")));
    let link = Element::new(ns::W, "hyperlink").with_attr(ns::R, "id", "rId1");
    let mut p = p;
    p.push(link);
    let s = p.to_xml_string();
    assert_eq!(
        s,
        r#"<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>hi</w:t></w:r><w:hyperlink r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></w:p>"#
    );
    assert_eq!(parse_element(&s).unwrap().text(), "hi");
}

#[test]
fn moved_elements_use_the_prefix_in_scope() {
    // A Word paragraph built with w: lands in a part that calls the namespace ns0.
    let mut doc =
        parse(br#"<ns0:document xmlns:ns0="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><ns0:body/></ns0:document>"#)
            .unwrap();
    doc.root.child_mut(ns::W, "body").unwrap().push(Element::new(ns::W, "p"));
    let out = String::from_utf8(doc.to_bytes()).unwrap();
    assert!(out.contains("<ns0:body><ns0:p/></ns0:body>"), "{out}");
}

#[test]
fn unprefixed_child_inside_a_default_namespace() {
    let mut root = Element::new("urn:example", "root");
    root.push(Element::new("", "plain"));
    let s = root.to_xml_string();
    assert_eq!(s, r#"<root xmlns="urn:example"><plain xmlns=""/></root>"#);
    let back = parse_element(&s).unwrap();
    assert!(back.elements().next().unwrap().ns.is_none());
}

#[test]
fn escapes_survive() {
    let el = Element::new("", "a").with_attr("", "v", "tab\there \"q\" <&>\nline").with_text("a\r\nb ]]> c");
    let back = parse_element(&el.to_xml_string()).unwrap();
    assert_eq!(back.attr("v"), Some("tab\there \"q\" <&>\nline"));
    assert_eq!(back.text(), "a\r\nb ]]> c");
}

#[test]
fn attribute_whitespace_is_normalized() {
    let el = parse_element("<a v=\"one\ntwo&#10;three\"/>").unwrap();
    assert_eq!(el.attr("v"), Some("one two\nthree"));
}

#[test]
fn char_refs_and_cdata() {
    let el = parse_element("<a>&#x41;&#66;<![CDATA[<raw>]]>&unknown;</a>").unwrap();
    assert_eq!(el.text(), "AB<raw>&unknown;");
}

#[test]
fn utf16_and_bom() {
    let xml = "<?xml version=\"1.0\" encoding=\"UTF-16\"?><a>é</a>";
    let mut bytes = vec![0xFF, 0xFE];
    bytes.extend(xml.encode_utf16().flat_map(u16::to_le_bytes));
    let doc = parse(&bytes).unwrap();
    assert_eq!(doc.root.text(), "é");
    assert!(String::from_utf8(doc.to_bytes()).unwrap().contains("encoding=\"UTF-8\""));
    let mut bom = vec![0xEF, 0xBB, 0xBF];
    bom.extend_from_slice(b"<a/>");
    assert_eq!(parse(&bom).unwrap().root.local, "a");
}

#[test]
fn rejects_broken_parts() {
    assert!(parse(b"<a><b></a>").is_err());
    assert!(parse(b"<a>").is_err());
    assert!(parse(b"").is_err());
    assert!(parse(b"<a/><b/>").is_err());
}

#[test]
fn editing_helpers() {
    let mut el = Element::new(ns::A, "rPr");
    el.set_attr("", "b", "1");
    el.set_attr("", "sz", "1200");
    el.set_attr("", "b", "0");
    assert_eq!(el.attrs.len(), 2);
    assert_eq!(el.attr("b"), Some("0"));
    assert_eq!(el.remove_attr("", "sz").as_deref(), Some("1200"));
    el.child_or_insert(ns::A, "solidFill");
    el.child_or_insert(ns::A, "solidFill");
    assert_eq!(el.elements().count(), 1);
    assert_eq!(el.remove_children(ns::A, "solidFill"), 1);
}

#[test]
fn serde_as_xml_text() {
    let el = Element::new(ns::A, "t").with_text("x");
    let json = serde_json::to_string(&el).unwrap();
    assert!(json.contains("a:t"));
    let back: Element = serde_json::from_str(&json).unwrap();
    assert!(back.is(ns::A, "t"));
}

#[test]
fn places_children_in_schema_order() {
    const ORDER: &[&[&str]] = &[&["xfrm"], &["prstGeom", "custGeom"], &["noFill", "solidFill"], &["ln"]];
    let mut sp = parse_element(&format!(r#"<a:spPr xmlns:a="{}"><a:prstGeom prst="rect"/><a:extLst/><a:ln/></a:spPr>"#, ns::A)).unwrap();
    sp.place(Element::new(ns::A, "solidFill"), ORDER);
    sp.place(Element::new(ns::A, "xfrm"), ORDER);
    let names: Vec<_> = sp.elements().map(|e| e.local.as_str()).collect();
    assert_eq!(names, ["xfrm", "prstGeom", "extLst", "solidFill", "ln"]);
    // Replacing a slot swaps the alternative in place.
    sp.place(Element::new(ns::A, "noFill"), ORDER);
    let names: Vec<_> = sp.elements().map(|e| e.local.as_str()).collect();
    assert_eq!(names, ["xfrm", "prstGeom", "extLst", "noFill", "ln"]);
    sp.clear(ns::A, &["noFill", "solidFill"]);
    assert_eq!(sp.elements().count(), 4);
}

#[test]
fn same_content_ignores_layout() {
    let a = parse_element("<a>\n  <b x=\"1\">\n  </b>\n  <t> </t>\n</a>").unwrap();
    let b = parse_element("<a><b x=\"1\"/><t> </t></a>").unwrap();
    let c = parse_element("<a><b x=\"1\"/><t></t></a>").unwrap();
    assert!(a.same_content(&b));
    assert!(!b.same_content(&c), "a space in text is text");
}

#[test]
fn characters_xml_cant_hold_are_left_out() {
    let el = Element::new("", "a").with_attr("", "v", "x\u{1}y").with_text("form\u{c}feed\u{b}");
    let back = parse_element(&el.to_xml_string()).unwrap();
    assert_eq!(back.attr("v"), Some("xy"));
    assert_eq!(back.text(), "formfeed");
}

#[test]
fn deep_nesting_is_rejected() {
    let deep = |n: usize| format!("{}{}", "<a>".repeat(n), "</a>".repeat(n));
    assert!(super::parse(deep(super::parse::MAX_DEPTH).as_bytes()).is_ok());
    assert!(super::parse(deep(200_000).as_bytes()).unwrap_err().contains("nested"));
    let empty_leaf = format!("{}<a/>{}", "<a>".repeat(super::parse::MAX_DEPTH), "</a>".repeat(super::parse::MAX_DEPTH));
    assert!(super::parse(empty_leaf.as_bytes()).unwrap_err().contains("nested"));
}

#[test]
fn deepest_accepted_tree_can_be_cloned_and_written_on_a_small_stack() {
    std::thread::Builder::new()
        .stack_size(1024 * 1024)
        .spawn(|| {
            let depth = super::parse::MAX_DEPTH;
            let source = format!("{}{}", "<a>".repeat(depth), "</a>".repeat(depth));
            let doc = super::parse(source.as_bytes()).unwrap();
            let copy = doc.clone();
            assert_eq!(copy.root.text(), "");
            assert!(super::parse(&copy.to_bytes()).is_ok());
        })
        .unwrap()
        .join()
        .unwrap();
}
