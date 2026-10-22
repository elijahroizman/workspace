//! Themes (`a:theme`): the color and font schemes every Office format shares. Word and Excel
//! have one theme; in PowerPoint each slide master has its own, and the PowerPoint layer picks
//! the master's. The format scheme (fill, line and effect styles) is kept as raw XML for it too.

use serde::{Deserialize, Serialize};

use super::color::{Color, Rgb};
use crate::xml::{ns, Element, XmlDoc};

/// The twelve color slots, in schema order.
pub const SLOTS: [&str; 12] =
    ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub name: String,
    pub color_scheme_name: String,
    /// (slot, color) for each of [`SLOTS`] the theme defines.
    pub colors: Vec<(String, Color)>,
    pub fonts: FontScheme,
    /// `a:fmtScheme`, untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_scheme: Option<Element>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontScheme {
    pub name: String,
    /// Headings.
    pub major: FontSet,
    /// Body text.
    pub minor: FontSet,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontSet {
    pub latin: String,
    pub east_asian: String,
    pub complex: String,
    /// Fonts for particular scripts: (`Jpan`, `Yu Gothic`)…
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<(String, String)>,
}

impl Theme {
    pub fn parse(doc: &XmlDoc) -> Option<Theme> {
        let root = &doc.root;
        if !root.is(ns::A, "theme") {
            return None;
        }
        let elements = root.child(ns::A, "themeElements")?;
        let scheme = elements.child(ns::A, "clrScheme");
        let colors = scheme
            .map(|s| {
                s.elements()
                    .filter(|e| SLOTS.contains(&e.local.as_str()))
                    .filter_map(|e| Some((e.local.clone(), Color::in_drawingml(e)?)))
                    .collect()
            })
            .unwrap_or_default();
        let fonts = elements.child(ns::A, "fontScheme");
        let set = |name: &str| {
            let Some(el) = fonts.and_then(|f| f.child(ns::A, name)) else { return FontSet::default() };
            let face = |local: &str| el.child(ns::A, local).and_then(|e| e.attr("typeface")).unwrap_or("").to_string();
            FontSet {
                latin: face("latin"),
                east_asian: face("ea"),
                complex: face("cs"),
                scripts: el
                    .children_named(ns::A, "font")
                    .filter_map(|f| Some((f.attr("script")?.to_string(), f.attr("typeface")?.to_string())))
                    .collect(),
            }
        };
        Some(Theme {
            name: root.attr("name").unwrap_or("").to_string(),
            color_scheme_name: scheme.and_then(|s| s.attr("name")).unwrap_or("").to_string(),
            colors,
            fonts: FontScheme {
                name: fonts.and_then(|f| f.attr("name")).unwrap_or("").to_string(),
                major: set("majorFont"),
                minor: set("minorFont"),
            },
            format_scheme: elements.child(ns::A, "fmtScheme").cloned(),
        })
    }

    /// The theme Office 2013–2022 gives new documents ("Office Theme": Calibri, blue accents).
    pub fn office() -> Theme {
        let rgb = |hex: &str| Color::rgb(Rgb::parse(hex).unwrap());
        let sys = |name: &str, last: Rgb| Color {
            base: super::color::ColorBase::System { name: name.into(), last: Some(last) },
            transforms: Vec::new(),
        };
        let colors = vec![
            ("dk1", sys("windowText", Rgb::BLACK)),
            ("lt1", sys("window", Rgb::WHITE)),
            ("dk2", rgb("44546A")),
            ("lt2", rgb("E7E6E6")),
            ("accent1", rgb("4472C4")),
            ("accent2", rgb("ED7D31")),
            ("accent3", rgb("A5A5A5")),
            ("accent4", rgb("FFC000")),
            ("accent5", rgb("5B9BD5")),
            ("accent6", rgb("70AD47")),
            ("hlink", rgb("0563C1")),
            ("folHlink", rgb("954F72")),
        ];
        let set = |latin: &str| FontSet { latin: latin.into(), ..Default::default() };
        Theme {
            name: "Office Theme".into(),
            color_scheme_name: "Office".into(),
            colors: colors.into_iter().map(|(n, c)| (n.to_string(), c)).collect(),
            fonts: FontScheme { name: "Office".into(), major: set("Calibri Light"), minor: set("Calibri") },
            format_scheme: None,
        }
    }

    /// The theme part. Without a format scheme of its own, writes the smallest one Office accepts.
    pub fn to_xml(&self) -> XmlDoc {
        let mut root = Element::new(ns::A, "theme").with_attr("", "name", &self.name);
        root.declare(Some("a"), ns::A);
        let mut scheme = Element::new(ns::A, "clrScheme").with_attr("", "name", &self.color_scheme_name);
        for slot in SLOTS {
            let color = self.colors.iter().find(|(n, _)| n == slot).map(|(_, c)| c.clone()).unwrap_or_else(|| Color::rgb(Rgb::BLACK));
            scheme.push(Element::new(ns::A, slot).with_child(color.to_drawingml()));
        }
        let set = |name: &str, f: &FontSet| {
            let mut el = Element::new(ns::A, name)
                .with_child(Element::new(ns::A, "latin").with_attr("", "typeface", &f.latin))
                .with_child(Element::new(ns::A, "ea").with_attr("", "typeface", &f.east_asian))
                .with_child(Element::new(ns::A, "cs").with_attr("", "typeface", &f.complex));
            for (script, face) in &f.scripts {
                el.push(Element::new(ns::A, "font").with_attr("", "script", script).with_attr("", "typeface", face));
            }
            el
        };
        let fonts = Element::new(ns::A, "fontScheme")
            .with_attr("", "name", &self.fonts.name)
            .with_child(set("majorFont", &self.fonts.major))
            .with_child(set("minorFont", &self.fonts.minor));
        let format = self.format_scheme.clone().unwrap_or_else(minimal_format_scheme);
        root.push(Element::new(ns::A, "themeElements").with_child(scheme).with_child(fonts).with_child(format));
        XmlDoc::new(root)
    }

    /// A slot's color as RGB, following the aliases Word and Excel use (`tx1` is `dk1`, `bg1`
    /// is `lt1`, `tx2` is `dk2`, `bg2` is `lt2`). PowerPoint maps those through the master's
    /// color map instead, which the PowerPoint layer applies before asking.
    pub fn scheme_color(&self, name: &str) -> Option<Rgb> {
        let slot = match name {
            "tx1" | "dark1" | "text1" => "dk1",
            "bg1" | "light1" | "background1" => "lt1",
            "tx2" | "dark2" | "text2" => "dk2",
            "bg2" | "light2" | "background2" => "lt2",
            "hyperlink" => "hlink",
            "followedHyperlink" => "folHlink",
            other => other,
        };
        let (_, color) = self.colors.iter().find(|(n, _)| n == slot)?;
        // Theme slots hold plain colors; resolving one can't refer back to the scheme.
        Some(color.resolve(&|_| None).rgb)
    }

    /// The font a theme reference names: DrawingML's `+mj-lt`/`+mn-ea`, or Word's `majorHAnsi`,
    /// `minorEastAsia`, `minorBidi`… Anything else isn't a reference and comes back `None`.
    pub fn font(&self, reference: &str) -> Option<&str> {
        let (major, script) = match reference {
            "+mj-lt" | "majorHAnsi" | "majorAscii" => (true, 0),
            "+mj-ea" | "majorEastAsia" => (true, 1),
            "+mj-cs" | "majorBidi" => (true, 2),
            "+mn-lt" | "minorHAnsi" | "minorAscii" => (false, 0),
            "+mn-ea" | "minorEastAsia" => (false, 1),
            "+mn-cs" | "minorBidi" => (false, 2),
            _ => return None,
        };
        let set = if major { &self.fonts.major } else { &self.fonts.minor };
        Some(match script {
            0 => &set.latin,
            1 => &set.east_asian,
            _ => &set.complex,
        })
    }
}

/// Three of each style list, the least the schema allows.
fn minimal_format_scheme() -> Element {
    let solid = || Element::new(ns::A, "solidFill").with_child(Element::new(ns::A, "schemeClr").with_attr("", "val", "phClr"));
    let list = |name: &str, item: &dyn Fn() -> Element| (0..3).fold(Element::new(ns::A, name), |el, _| el.with_child(item()));
    let line = || Element::new(ns::A, "ln").with_attr("", "w", "6350").with_child(solid());
    let effect = || Element::new(ns::A, "effectStyle").with_child(Element::new(ns::A, "effectLst"));
    Element::new(ns::A, "fmtScheme")
        .with_attr("", "name", "Office")
        .with_child(list("fillStyleLst", &solid))
        .with_child(list("lnStyleLst", &line))
        .with_child(list("effectStyleLst", &effect))
        .with_child(list("bgFillStyleLst", &solid))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml;

    #[test]
    fn office_theme_round_trips() {
        let theme = Theme::office();
        let doc = xml::parse(&theme.to_xml().to_bytes()).unwrap();
        let back = Theme::parse(&doc).unwrap();
        assert_eq!(back.colors, theme.colors);
        assert_eq!(back.fonts, theme.fonts);
        assert!(back.format_scheme.is_some());
        assert_eq!(back.scheme_color("accent1"), Some(Rgb(0x44, 0x72, 0xC4)));
        assert_eq!(back.scheme_color("tx1"), Some(Rgb::BLACK));
        assert_eq!(back.scheme_color("bg1"), Some(Rgb::WHITE));
        assert_eq!(back.scheme_color("phClr"), None);
        assert_eq!(back.font("+mn-lt"), Some("Calibri"));
        assert_eq!(back.font("majorHAnsi"), Some("Calibri Light"));
        assert_eq!(back.font("Arial"), None);
    }
}
