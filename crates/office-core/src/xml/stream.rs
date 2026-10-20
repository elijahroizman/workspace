//! Parts too big to hold as one tree: a worksheet with a million cells, its shared strings.
//! [`parse_hollow`] parses a part with one element's content left out as text, and
//! [`for_each_element`] and [`parse_in`] then go through that content one element at a time.

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{Attr, Element, XmlDoc};

/// A part parsed with one element's content left as source text.
pub struct Hollow {
    /// The part, with that element there but empty.
    pub doc: XmlDoc,
    /// The element's content as written, or `None` if the part has no such element.
    pub inner: Option<String>,
    /// The namespace declarations in force inside the element.
    pub scope: Vec<Attr>,
}

/// Parses `bytes`, leaving out the content of the root's first child named `local` (or of the
/// root itself, for `None`).
pub fn parse_hollow(bytes: &[u8], local: Option<&str>) -> Result<Hollow, String> {
    let text = super::parse::decode(bytes)?;
    let target_depth = if local.is_some() { 1 } else { 0 };
    let mut reader = Reader::from_str(&text);
    reader.config_mut().trim_text(false);
    let mut depth = 0usize;
    // Where the element's content starts and ends.
    let mut span: Option<(usize, usize)> = None;
    let mut open_at: Option<usize> = None;
    loop {
        let before = reader.buffer_position() as usize;
        let event = reader.read_event().map_err(|e| format!("{e} at byte {}", reader.error_position()))?;
        let name_matches = |name: &[u8]| {
            let name = std::str::from_utf8(name).unwrap_or("");
            local.is_none_or(|l| name.rsplit(':').next() == Some(l))
        };
        match event {
            Event::Start(s) => {
                if depth == target_depth && open_at.is_none() && span.is_none() && name_matches(s.name().0.as_bytes()) {
                    open_at = Some(reader.buffer_position() as usize);
                }
                depth += 1;
            }
            Event::End(_) => {
                depth -= 1;
                if depth == target_depth {
                    if let Some(start) = open_at.take() {
                        span = Some((start, before));
                    }
                }
            }
            Event::Empty(s) if depth == target_depth && span.is_none() && name_matches(s.name().0.as_bytes()) => {
                let at = reader.buffer_position() as usize;
                span = Some((at, at));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let (shell, inner) = match span {
        Some((a, b)) => (format!("{}{}", &text[..a], &text[b..]), Some(text[a..b].to_string())),
        None => (text.clone(), None),
    };
    let doc = super::parse(shell.as_bytes())?;
    let mut scope: Vec<Attr> = doc.root.attrs.iter().filter(|a| a.is_ns_decl()).cloned().collect();
    if let Some(l) = local {
        if let Some(el) = doc.root.elements().find(|e| e.local == l) {
            scope.extend(el.attrs.iter().filter(|a| a.is_ns_decl()).cloned());
        }
    }
    Ok(Hollow { doc, inner, scope })
}

/// Calls `f` with the source text of each element at the top level of `content`, in order.
pub fn for_each_element(content: &str, mut f: impl FnMut(&str) -> Result<(), String>) -> Result<(), String> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(false);
    let mut depth = 0usize;
    let mut start = 0usize;
    loop {
        let before = reader.buffer_position() as usize;
        match reader.read_event().map_err(|e| format!("{e} at byte {}", reader.error_position()))? {
            Event::Start(_) => {
                if depth == 0 {
                    start = before;
                }
                depth += 1;
            }
            Event::End(_) => {
                depth = depth.checked_sub(1).ok_or("a closing tag without an opening one")?;
                if depth == 0 {
                    f(&content[start..reader.buffer_position() as usize])?;
                }
            }
            Event::Empty(_) if depth == 0 => f(&content[before..reader.buffer_position() as usize])?,
            Event::Eof => return Ok(()),
            _ => {}
        }
    }
}

/// Like [`for_each_element`], but hands `f` runs of whole elements about `size` bytes long, to
/// parse together: much faster than one at a time, and memory still stays at one run's tree.
pub fn for_each_batch(content: &str, size: usize, mut f: impl FnMut(&str) -> Result<(), String>) -> Result<(), String> {
    let base = content.as_ptr() as usize;
    let mut run: Option<(usize, usize)> = None;
    for_each_element(content, |el| {
        let start = el.as_ptr() as usize - base;
        let end = start + el.len();
        let (from, _) = *run.get_or_insert((start, end));
        run = Some((from, end));
        if end - from >= size {
            run = None;
            return f(&content[from..end]);
        }
        Ok(())
    })?;
    match run {
        Some((from, end)) => f(&content[from..end]),
        None => Ok(()),
    }
}

/// Parses a run of elements' source text, as [`parse_in`] does one.
pub fn parse_all_in(source: &str, scope: &[Attr]) -> Result<Vec<Element>, String> {
    let wrapped = wrap(source, scope);
    let doc = super::parse(wrapped.as_bytes())?;
    Ok(doc
        .root
        .children
        .into_iter()
        .filter_map(|n| match n {
            super::Node::Element(e) => Some(e),
            _ => None,
        })
        .collect())
}

fn wrap(source: &str, scope: &[Attr]) -> String {
    let mut wrapper = String::with_capacity(source.len() + 256);
    wrapper.push_str("<_");
    for a in scope {
        wrapper.push_str(&format!(" {}=\"{}\"", a.qname(), a.value.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;")));
    }
    wrapper.push('>');
    wrapper.push_str(source);
    wrapper.push_str("</_>");
    wrapper
}

/// Whether `el` or anything in it is the comment `text`.
pub fn contains_comment(el: &Element, text: &str) -> bool {
    el.children.iter().any(|n| match n {
        super::Node::Comment(c) => c == text,
        super::Node::Element(e) => contains_comment(e, text),
        _ => false,
    })
}

/// Parses one element's source text as if it sat where `scope`'s declarations are in force.
pub fn parse_in(source: &str, scope: &[Attr]) -> Result<Element, String> {
    parse_all_in(source, scope)?.into_iter().next().ok_or_else(|| "no element".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::ns;

    const SHEET: &str = r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14ac="urn:x14ac"><dimension ref="A1"/><sheetData><row r="1" x14ac:dy="1"><c r="A1"><v>1</v></c></row><row r="2"/></sheetData><pageMargins left="1"/></worksheet>"#;

    #[test]
    fn hollows_and_walks() {
        let h = parse_hollow(SHEET.as_bytes(), Some("sheetData")).unwrap();
        assert!(h.doc.root.child(ns::X, "sheetData").unwrap().children.is_empty());
        assert!(h.doc.root.child(ns::X, "pageMargins").is_some());
        let mut rows = Vec::new();
        for_each_element(h.inner.as_deref().unwrap(), |s| {
            rows.push(parse_in(s, &h.scope)?);
            Ok(())
        })
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows[0].is(ns::X, "row"));
        assert_eq!(rows[0].attr_ns("urn:x14ac", "dy"), Some("1"));
        assert_eq!(rows[0].path(ns::X, &["c", "v"]).unwrap().text(), "1");
        // Written back where those declarations are in force, nothing is declared again.
        assert_eq!(rows[0].to_xml_string_in(&h.scope), r#"<row r="1" x14ac:dy="1"><c r="A1"><v>1</v></c></row>"#);
    }

    #[test]
    fn the_root_itself_and_missing_elements() {
        let h = parse_hollow(
            br#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1"><si><t>a</t></si></sst>"#,
            None,
        )
        .unwrap();
        assert_eq!(h.inner.as_deref(), Some("<si><t>a</t></si>"));
        assert!(h.doc.root.children.is_empty());
        let h = parse_hollow(br#"<worksheet><sheetData/></worksheet>"#, Some("sheetData")).unwrap();
        assert_eq!(h.inner.as_deref(), Some(""));
        let h = parse_hollow(br#"<worksheet/>"#, Some("sheetData")).unwrap();
        assert!(h.inner.is_none());
    }

    #[test]
    fn batches_hold_whole_elements() {
        let content = "<a>1</a><b/><c><d/></c><e>5</e>";
        let mut seen = Vec::new();
        for_each_batch(content, 10, |run| {
            seen.push(run.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(seen, ["<a>1</a><b/>", "<c><d/></c>", "<e>5</e>"]);
        assert_eq!(parse_all_in(&seen[0], &[]).unwrap().len(), 2);
    }
}
