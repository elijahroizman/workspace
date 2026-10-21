//! Sections (`w:sectPr`): page size and orientation, margins, columns, and which headers and
//! footers a stretch of the document uses. A document's last section's properties end its body;
//! each earlier section's end a paragraph.

use office_core::formats::docx::val;
use office_core::units::Emu;
use office_core::xml::{ns, Element};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub page_width: Emu,
    pub page_height: Emu,
    pub landscape: bool,
    pub margin_top: Emu,
    pub margin_right: Emu,
    pub margin_bottom: Emu,
    pub margin_left: Emu,
    /// From the page's edge to the header and the footer.
    pub header: Emu,
    pub footer: Emu,
    pub columns: u32,
    /// A different header and footer on the section's first page.
    pub title_page: bool,
    /// How the section starts: `nextPage`, `continuous`, `evenPage`, `oddPage`, `nextColumn`.
    pub start: String,
    /// The section's headers and footers: (`default`, `first` or `even`; the relationship id).
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub footers: Vec<(String, String)>,
}

impl Default for Section {
    /// A4 with Word's one-inch margins.
    fn default() -> Section {
        let inch = Emu::from_inches(1.0);
        Section {
            page_width: Emu::from_twips(11_906),
            page_height: Emu::from_twips(16_838),
            landscape: false,
            margin_top: inch,
            margin_right: inch,
            margin_bottom: inch,
            margin_left: inch,
            header: Emu::from_twips(708),
            footer: Emu::from_twips(708),
            columns: 1,
            title_page: false,
            start: "nextPage".into(),
            headers: Vec::new(),
            footers: Vec::new(),
        }
    }
}

impl Section {
    pub fn parse(sect: &Element) -> Section {
        let d = Section::default();
        let twips = |el: Option<&Element>, k: &str, or: Emu| {
            el.and_then(|e| e.attr_ns(ns::W, k)).and_then(|v| Emu::parse(v, Emu::PER_TWIP)).unwrap_or(or)
        };
        let size = sect.child(ns::W, "pgSz");
        let mar = sect.child(ns::W, "pgMar");
        let refs = |local: &str| {
            sect.children_named(ns::W, local)
                .filter_map(|r| Some((r.attr_ns(ns::W, "type").unwrap_or("default").to_string(), r.attr_ns(ns::R, "id")?.to_string())))
                .collect()
        };
        Section {
            page_width: twips(size, "w", d.page_width),
            page_height: twips(size, "h", d.page_height),
            landscape: size.and_then(|s| s.attr_ns(ns::W, "orient")) == Some("landscape"),
            margin_top: twips(mar, "top", d.margin_top),
            margin_right: twips(mar, "right", d.margin_right),
            margin_bottom: twips(mar, "bottom", d.margin_bottom),
            margin_left: twips(mar, "left", d.margin_left),
            header: twips(mar, "header", d.header),
            footer: twips(mar, "footer", d.footer),
            columns: sect.child(ns::W, "cols").and_then(|c| c.attr_ns(ns::W, "num")).and_then(|n| n.parse().ok()).unwrap_or(1),
            title_page: office_core::formats::docx::toggle(sect, "titlePg").unwrap_or(false),
            start: sect.child(ns::W, "type").and_then(val).unwrap_or("nextPage").to_string(),
            headers: refs("headerReference"),
            footers: refs("footerReference"),
        }
    }

    /// Writes the page setup into `sect`, changing only what differs from what it says. Header
    /// and footer references are left as they are.
    pub fn patch(&self, sect: &mut Element) {
        const ORDER: &[&[&str]] = &[
            &["headerReference", "footerReference"],
            &["footnotePr"],
            &["endnotePr"],
            &["type"],
            &["pgSz"],
            &["pgMar"],
            &["paperSrc"],
            &["pgBorders"],
            &["lnNumType"],
            &["pgNumType"],
            &["cols"],
            &["formProt"],
            &["vAlign"],
            &["noEndnote"],
            &["titlePg"],
            &["textDirection"],
            &["bidi"],
            &["rtlGutter"],
            &["docGrid"],
            &["printerSettings"],
            &["sectPrChange"],
        ];
        let old = Section::parse(sect);
        if self == &old {
            return;
        }
        let set = |el: &mut Element, k: &str, v: Emu| el.set_attr(ns::W, k, v.twips().to_string());
        if (self.page_width, self.page_height, self.landscape) != (old.page_width, old.page_height, old.landscape) {
            let mut size = sect.child(ns::W, "pgSz").cloned().unwrap_or_else(|| Element::new(ns::W, "pgSz"));
            set(&mut size, "w", self.page_width);
            set(&mut size, "h", self.page_height);
            if self.landscape {
                size.set_attr(ns::W, "orient", "landscape");
            } else {
                size.remove_attr(ns::W, "orient");
            }
            sect.place(size, ORDER);
        }
        let margins = [self.margin_top, self.margin_right, self.margin_bottom, self.margin_left, self.header, self.footer];
        let before = [old.margin_top, old.margin_right, old.margin_bottom, old.margin_left, old.header, old.footer];
        if margins != before {
            let mut mar =
                sect.child(ns::W, "pgMar").cloned().unwrap_or_else(|| Element::new(ns::W, "pgMar").with_attr(ns::W, "gutter", "0"));
            for (k, v) in ["top", "right", "bottom", "left", "header", "footer"].iter().zip(margins) {
                set(&mut mar, k, v);
            }
            sect.place(mar, ORDER);
        }
        if self.columns != old.columns {
            let mut cols =
                sect.child(ns::W, "cols").cloned().unwrap_or_else(|| Element::new(ns::W, "cols").with_attr(ns::W, "space", "708"));
            if self.columns > 1 {
                cols.set_attr(ns::W, "num", self.columns.to_string());
            } else {
                cols.remove_attr(ns::W, "num");
            }
            sect.place(cols, ORDER);
        }
        if self.title_page != old.title_page {
            sect.clear(ns::W, &["titlePg"]);
            if self.title_page {
                sect.place(Element::new(ns::W, "titlePg"), ORDER);
            }
        }
        if self.start != old.start {
            sect.clear(ns::W, &["type"]);
            if self.start != "nextPage" {
                sect.place(Element::new(ns::W, "type").with_attr(ns::W, "val", &self.start), ORDER);
            }
        }
    }

    /// The width text has between the margins.
    pub fn text_width(&self) -> Emu {
        Emu(self.page_width.0 - self.margin_left.0 - self.margin_right.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use office_core::xml::parse_element;

    #[test]
    fn reads_and_patches_page_setup() {
        let mut sect = parse_element(&format!(
            r#"<w:sectPr xmlns:w="{}" xmlns:r="{}"><w:headerReference w:type="default" r:id="rId8"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>"#,
            ns::W,
            ns::R
        ))
        .unwrap();
        let s = Section::parse(&sect);
        assert_eq!(s.page_width, Emu::from_inches(8.5), "US Letter");
        assert_eq!(s.headers, vec![("default".to_string(), "rId8".to_string())]);
        assert_eq!(s.text_width(), Emu::from_inches(6.5));
        let untouched = sect.clone();
        s.patch(&mut sect);
        assert_eq!(sect, untouched);

        let landscape =
            Section { page_width: s.page_height, page_height: s.page_width, landscape: true, columns: 2, title_page: true, ..s.clone() };
        landscape.patch(&mut sect);
        assert_eq!(Section::parse(&sect), landscape);
        let names: Vec<&str> = sect.elements().map(|e| e.local.as_str()).collect();
        assert_eq!(names, ["headerReference", "pgSz", "pgMar", "cols", "titlePg", "docGrid"]);
    }
}
