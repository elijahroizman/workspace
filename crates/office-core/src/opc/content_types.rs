//! `[Content_Types].xml`: the media type of every part, by extension or by name.

use crate::xml::{ns, Element, XmlDoc};

pub const PART: &str = "[Content_Types].xml";

/// Media types of the parts the compiler reads or writes.
pub mod types {
    pub const RELS: &str = "application/vnd.openxmlformats-package.relationships+xml";
    pub const XML: &str = "application/xml";
    pub const CORE_PROPERTIES: &str = "application/vnd.openxmlformats-package.core-properties+xml";
    pub const EXTENDED_PROPERTIES: &str = "application/vnd.openxmlformats-officedocument.extended-properties+xml";
    pub const THEME: &str = "application/vnd.openxmlformats-officedocument.theme+xml";

    pub const DOCX_MAIN: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
    pub const DOCX_STYLES: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";

    pub const PPTX_MAIN: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
    pub const PPTX_SLIDE: &str = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
    pub const PPTX_LAYOUT: &str = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
    pub const PPTX_MASTER: &str = "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";

    pub const XLSX_MAIN: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
    pub const XLSX_SHEET: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
    pub const XLSX_SHARED_STRINGS: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
    pub const XLSX_STYLES: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";

    /// The media type for a picture or other binary part, by extension.
    pub fn for_extension(ext: &str) -> Option<&'static str> {
        Some(match ext {
            "png" => "image/png",
            "jpg" | "jpeg" | "jpe" => "image/jpeg",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            "tif" | "tiff" => "image/tiff",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            "emf" => "image/x-emf",
            "wmf" => "image/x-wmf",
            "ico" => "image/x-icon",
            "mp4" => "video/mp4",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "rels" => RELS,
            "xml" => XML,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ContentTypes {
    /// (extension, lowercase; media type)
    pub defaults: Vec<(String, String)>,
    /// (part name without the leading slash; media type)
    pub overrides: Vec<(String, String)>,
}

impl ContentTypes {
    /// What a new package starts with.
    pub fn standard() -> ContentTypes {
        ContentTypes { defaults: vec![("rels".into(), types::RELS.into()), ("xml".into(), types::XML.into())], overrides: Vec::new() }
    }

    pub fn parse(doc: &XmlDoc) -> ContentTypes {
        let mut ct = ContentTypes::default();
        for el in doc.root.elements() {
            let Some(media) = el.attr("ContentType") else { continue };
            if el.is(ns::CT, "Default") {
                if let Some(ext) = el.attr("Extension") {
                    ct.defaults.push((ext.to_ascii_lowercase(), media.to_string()));
                }
            } else if el.is(ns::CT, "Override") {
                if let Some(name) = el.attr("PartName") {
                    ct.overrides.push((name.trim_start_matches('/').to_string(), media.to_string()));
                }
            }
        }
        ct
    }

    pub fn to_xml(&self) -> XmlDoc {
        let mut root = Element::new(ns::CT, "Types");
        root.declare(None, ns::CT);
        let el = |local: &str| Element::new(ns::CT, local);
        for (ext, media) in &self.defaults {
            root.push(el("Default").with_attr("", "Extension", ext).with_attr("", "ContentType", media));
        }
        for (name, media) in &self.overrides {
            root.push(el("Override").with_attr("", "PartName", format!("/{name}")).with_attr("", "ContentType", media));
        }
        XmlDoc::new(root)
    }

    /// The media type of `part`: its override, else its extension's default.
    pub fn get(&self, part: &str) -> Option<&str> {
        if let Some((_, m)) = self.overrides.iter().find(|(n, _)| n.eq_ignore_ascii_case(part)) {
            return Some(m);
        }
        let ext = super::names::extension(part);
        self.defaults.iter().find(|(e, _)| *e == ext).map(|(_, m)| m.as_str())
    }

    /// Records `part`'s media type, as an override unless its extension's default already says so.
    /// For a picture with no default yet, adds one for its extension, the way Office does.
    pub fn set(&mut self, part: &str, media: &str) {
        self.remove(part);
        let ext = super::names::extension(part);
        match self.defaults.iter().find(|(e, _)| *e == ext) {
            Some((_, m)) if m == media => {}
            None if !ext.is_empty() && types::for_extension(&ext) == Some(media) => {
                self.defaults.push((ext, media.to_string()));
            }
            _ => self.overrides.push((part.to_string(), media.to_string())),
        }
    }

    pub fn remove(&mut self, part: &str) {
        self.overrides.retain(|(n, _)| !n.eq_ignore_ascii_case(part));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml;

    #[test]
    fn lookups() {
        let src = r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="XML" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
        let mut ct = ContentTypes::parse(&xml::parse(src.as_bytes()).unwrap());
        assert_eq!(ct.get("word/document.xml"), Some(types::DOCX_MAIN));
        assert_eq!(ct.get("word/styles.xml"), Some(types::XML));
        assert_eq!(ct.get("word/media/a.png"), None);

        ct.set("word/media/a.png", "image/png");
        assert_eq!(ct.defaults.last().unwrap().0, "png");
        ct.set("word/media/b.png", "image/png");
        assert_eq!(ct.overrides.len(), 1, "covered by the new default");
        ct.set("custom/thing.bin", "application/octet-stream");
        assert_eq!(ct.get("custom/thing.bin"), Some("application/octet-stream"));

        let back = ContentTypes::parse(&xml::parse(&ct.to_xml().to_bytes()).unwrap());
        assert_eq!(back, ct);
    }
}
