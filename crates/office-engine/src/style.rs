//! How text looks once a layer has resolved its formatting: the font the host measures and draws
//! with, colors ready to paint, and the decorations. Layers resolve [`RunProps`] (styles,
//! placeholders, themes) and hand the result to [`TextStyle::from_props`].

use office_core::drawing::{Rgb, Rgba};
use office_core::model::{Baseline, RunProps, Strike};
use serde::Serialize;

use crate::measure::Font;

/// Resolved text formatting.
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    /// The font text is measured in: for superscript and subscript, already the smaller size.
    pub font: Font,
    pub color: Rgba,
    pub highlight: Option<Rgba>,
    /// Word's underline name (`single`, `double`, `wave`…), if underlined.
    pub underline: Option<String>,
    pub strike: Option<Strike>,
    pub baseline: Option<Baseline>,
    pub caps: bool,
    pub small_caps: bool,
    /// Part of a hyperlink.
    pub link: bool,
    /// Size before superscript or subscript shrank it, in pixels: where the line's height and the
    /// raised or lowered baseline come from.
    pub full_px: f64,
}

/// The size superscript and subscript text is drawn at, relative to the text around it (Word's).
pub const SCRIPT_SCALE: f64 = 0.65;

impl TextStyle {
    /// A style from resolved run properties. `color` turns a model color into paint (theme colors
    /// need the layer's theme and color map); `default_px` is the size when none is set.
    pub fn from_props(props: &RunProps, default_px: f64, color: &dyn Fn(&office_core::drawing::Color) -> Rgba) -> TextStyle {
        let full_px = props.size.map(|s| s.points() * 96.0 / 72.0).unwrap_or(default_px);
        let px = if props.baseline.is_some() { full_px * SCRIPT_SCALE } else { full_px };
        let family = props.font.as_deref().unwrap_or("Calibri");
        TextStyle {
            font: Font {
                family: css_family(family),
                bold: props.bold.unwrap_or(false),
                italic: props.italic.unwrap_or(false),
                size: (px * 100.0).round().max(1.0) as u32,
            },
            color: props.color.as_ref().map(color).unwrap_or(Rgba { rgb: Rgb::BLACK, alpha: 1.0 }),
            highlight: props.highlight.as_ref().map(color),
            underline: props.underline.clone().filter(|u| u != "none"),
            strike: props.strike.filter(|s| *s != Strike::None),
            baseline: props.baseline,
            caps: props.caps.unwrap_or(false),
            small_caps: props.small_caps.unwrap_or(false),
            link: false,
            full_px,
        }
    }

    /// How far the baseline moves up (positive) for superscript, or down for subscript.
    pub fn baseline_shift(&self) -> f64 {
        match self.baseline {
            Some(Baseline::Superscript) => self.full_px * 0.33,
            Some(Baseline::Subscript) => -self.full_px * 0.14,
            None => 0.0,
        }
    }

    /// Text as it's drawn: all capitals for caps. Small capitals are drawn by the host
    /// (`font-variant`), and measured as capitals, which is close.
    pub fn transform<'a>(&self, text: &'a str) -> std::borrow::Cow<'a, str> {
        if self.caps || self.small_caps {
            std::borrow::Cow::Owned(text.to_uppercase())
        } else {
            std::borrow::Cow::Borrowed(text)
        }
    }

    /// What the host needs to draw text in this style.
    pub fn paint(&self) -> PaintStyle {
        let mut deco = Vec::new();
        if self.underline.is_some() {
            deco.push("underline");
        }
        if self.strike.is_some() {
            deco.push("line-through");
        }
        let decoration = (!deco.is_empty()).then(|| {
            let mut d = deco.join(" ");
            match self.underline.as_deref() {
                Some("double") => d.push_str(" double"),
                Some("dotted" | "dottedHeavy") => d.push_str(" dotted"),
                Some(u) if u.starts_with("dash") || u.starts_with("dot") => d.push_str(" dashed"),
                Some(u) if u.starts_with("wav") => d.push_str(" wavy"),
                _ if self.strike == Some(Strike::Double) => d.push_str(" double"),
                _ => {}
            }
            d
        });
        PaintStyle {
            font: self.font.css(),
            color: self.color.css(),
            decoration,
            background: self.highlight.map(|h| h.css()),
            small_caps: self.small_caps && !self.caps,
            shift: (self.baseline_shift() * 100.0).round() / 100.0,
        }
    }
}

/// Text style as the host paints it: CSS values.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintStyle {
    pub font: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decoration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub small_caps: bool,
    /// Baseline shift in pixels, up positive.
    #[serde(skip_serializing_if = "is_zero")]
    pub shift: f64,
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

/// Open-licensed fonts with the same metrics as common Office fonts, which the app ships, so a
/// document lays out the same where the original isn't installed.
const SUBSTITUTES: &[(&str, &str)] = &[
    ("calibri", "Carlito"),
    ("calibri light", "Carlito"),
    ("cambria", "Caladea"),
    ("cambria math", "Caladea"),
    ("arial", "Liberation Sans"),
    ("helvetica", "Liberation Sans"),
    ("helvetica neue", "Liberation Sans"),
    ("arial nova", "Liberation Sans"),
    ("liberation sans", "Liberation Sans"),
    ("times new roman", "Liberation Serif"),
    ("times", "Liberation Serif"),
    ("liberation serif", "Liberation Serif"),
    ("courier new", "Liberation Mono"),
    ("courier", "Liberation Mono"),
    ("liberation mono", "Liberation Mono"),
];

/// The CSS family list for a document font: the font itself if the system has it, then the
/// shipped font with its metrics (or the closest kind), then a generic family.
pub fn css_family(name: &str) -> String {
    let name = name.trim().trim_matches('"');
    let lower = name.to_ascii_lowercase();
    let generic = generic_family(&lower);
    let substitute = SUBSTITUTES.iter().find(|(n, _)| *n == lower).map(|(_, s)| *s).unwrap_or(match generic {
        "serif" => "Liberation Serif",
        "monospace" => "Liberation Mono",
        _ => "Carlito",
    });
    let quoted = |f: &str| format!("\"{}\"", f.replace('"', ""));
    if name.is_empty() || name.eq_ignore_ascii_case(substitute) {
        format!("{}, {generic}", quoted(substitute))
    } else {
        format!("{}, {}, {generic}", quoted(name), quoted(substitute))
    }
}

fn generic_family(lower: &str) -> &'static str {
    const MONO: &[&str] = &["mono", "courier", "consolas", "menlo", "code", "typewriter", "lucida console"];
    const SERIF: &[&str] = &["serif", "times", "georgia", "garamond", "cambria", "book", "palatino", "baskerville", "minion", "caladea"];
    if lower.contains("sans") {
        "sans-serif"
    } else if MONO.iter().any(|m| lower.contains(m)) {
        "monospace"
    } else if SERIF.iter().any(|m| lower.contains(m)) {
        "serif"
    } else {
        "sans-serif"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use office_core::units::FontSize;

    #[test]
    fn families_fall_back_to_metric_twins() {
        assert_eq!(css_family("Calibri"), "\"Calibri\", \"Carlito\", sans-serif");
        assert_eq!(css_family("Times New Roman"), "\"Times New Roman\", \"Liberation Serif\", serif");
        assert_eq!(css_family("Fira Code"), "\"Fira Code\", \"Liberation Mono\", monospace");
        assert_eq!(css_family("Carlito"), "\"Carlito\", sans-serif");
        assert_eq!(css_family("Georgia"), "\"Georgia\", \"Liberation Serif\", serif");
    }

    #[test]
    fn superscript_is_smaller_and_raised() {
        let props = RunProps { size: Some(FontSize::from_points(12.0)), baseline: Some(Baseline::Superscript), ..Default::default() };
        let s = TextStyle::from_props(&props, 14.67, &|_| Rgba { rgb: Rgb::BLACK, alpha: 1.0 });
        assert_eq!(s.full_px, 16.0);
        assert_eq!(s.font.size, 1040);
        assert!(s.baseline_shift() > 5.0);
    }

    #[test]
    fn decorations() {
        let props = RunProps { underline: Some("double".into()), strike: Some(Strike::Single), ..Default::default() };
        let p = TextStyle::from_props(&props, 14.67, &|_| Rgba { rgb: Rgb::BLACK, alpha: 1.0 }).paint();
        assert_eq!(p.decoration.as_deref(), Some("underline line-through double"));
        let none = RunProps { underline: Some("none".into()), ..Default::default() };
        assert_eq!(TextStyle::from_props(&none, 14.67, &|_| Rgba { rgb: Rgb::BLACK, alpha: 1.0 }).paint().decoration, None);
    }
}
