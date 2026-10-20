//! Word's run and paragraph properties (`w:rPr`, `w:pPr`) and colors.

use crate::drawing::{Color, Rgb};
use crate::model::{Align, Baseline, LineSpacing, ParaProps, RunProps, Strike};
use crate::units::{parse_bool, Emu, FontSize, Percent};
use crate::xml::{ns, Element};

/// Word's `w:val`.
pub fn val(el: &Element) -> Option<&str> {
    el.attr_ns(ns::W, "val")
}

/// An on/off property: `<w:b/>` is on, `<w:b w:val="0"/>` off.
pub fn toggle(parent: &Element, local: &str) -> Option<bool> {
    parent.child(ns::W, local).map(|e| val(e).map(|v| parse_bool(v).unwrap_or(true)).unwrap_or(true))
}

/// Word's theme font names, and DrawingML's references for the same fonts (the model's).
pub const THEME_FONTS: &[(&str, &str)] = &[
    ("minorHAnsi", "+mn-lt"),
    ("minorAscii", "+mn-lt"),
    ("majorHAnsi", "+mj-lt"),
    ("majorAscii", "+mj-lt"),
    ("minorEastAsia", "+mn-ea"),
    ("majorEastAsia", "+mj-ea"),
    ("minorBidi", "+mn-cs"),
    ("majorBidi", "+mj-cs"),
];

fn theme_font(word: &str) -> Option<&'static str> {
    THEME_FONTS.iter().find(|(w, _)| *w == word).map(|(_, d)| *d)
}

/// Word's theme color names, and the scheme slots they are.
pub const THEME_COLORS: &[(&str, &str)] = &[
    ("dark1", "dk1"),
    ("light1", "lt1"),
    ("dark2", "dk2"),
    ("light2", "lt2"),
    ("accent1", "accent1"),
    ("accent2", "accent2"),
    ("accent3", "accent3"),
    ("accent4", "accent4"),
    ("accent5", "accent5"),
    ("accent6", "accent6"),
    ("hyperlink", "hlink"),
    ("followedHyperlink", "folHlink"),
    ("text1", "tx1"),
    ("background1", "bg1"),
    ("text2", "tx2"),
    ("background2", "bg2"),
];

/// `w:color`: a theme color with Word's tint or shade (bytes, 255 is none) becomes the
/// DrawingML transforms Word itself uses for them; `auto` is no color.
pub fn read_color(el: &Element) -> Option<Color> {
    if let Some(slot) = el.attr_ns(ns::W, "themeColor").and_then(|t| THEME_COLORS.iter().find(|(w, _)| *w == t)).map(|(_, s)| *s) {
        let byte =
            |k: &str| el.attr_ns(ns::W, k).and_then(|v| u8::from_str_radix(v, 16).ok()).map(|b| b as i64 * Percent::WHOLE as i64 / 255);
        let mut c = Color::scheme(slot);
        if let Some(t) = byte("themeTint") {
            c = c.with("lumMod", t as i32).with("lumOff", (Percent::WHOLE as i64 - t) as i32);
        } else if let Some(s) = byte("themeShade") {
            c = c.with("lumMod", s as i32);
        }
        return Some(c);
    }
    val(el).and_then(Rgb::parse).map(Color::rgb)
}

/// Word's highlight colors, which are names, not values.
pub const HIGHLIGHTS: &[(&str, Rgb)] = &[
    ("black", Rgb(0, 0, 0)),
    ("blue", Rgb(0, 0, 255)),
    ("cyan", Rgb(0, 255, 255)),
    ("green", Rgb(0, 255, 0)),
    ("magenta", Rgb(255, 0, 255)),
    ("red", Rgb(255, 0, 0)),
    ("yellow", Rgb(255, 255, 0)),
    ("white", Rgb(255, 255, 255)),
    ("darkBlue", Rgb(0, 0, 128)),
    ("darkCyan", Rgb(0, 128, 128)),
    ("darkGreen", Rgb(0, 128, 0)),
    ("darkMagenta", Rgb(128, 0, 128)),
    ("darkRed", Rgb(128, 0, 0)),
    ("darkYellow", Rgb(128, 128, 0)),
    ("darkGray", Rgb(128, 128, 128)),
    ("lightGray", Rgb(192, 192, 192)),
];

pub fn read_run_props(rpr: &Element) -> RunProps {
    let fonts = rpr.child(ns::W, "rFonts");
    let font = |direct: &str, theme: &str| {
        let f = fonts?;
        f.attr_ns(ns::W, theme).and_then(theme_font).map(str::to_string).or_else(|| f.attr_ns(ns::W, direct).map(str::to_string))
    };
    let strike = match (toggle(rpr, "dstrike"), toggle(rpr, "strike")) {
        (Some(true), _) => Some(Strike::Double),
        (_, Some(true)) => Some(Strike::Single),
        (Some(false), _) | (_, Some(false)) => Some(Strike::None),
        _ => None,
    };
    RunProps {
        font: font("ascii", "asciiTheme"),
        font_east_asian: font("eastAsia", "eastAsiaTheme"),
        font_complex: font("cs", "cstheme"),
        size: rpr.child(ns::W, "sz").and_then(val).and_then(|v| v.parse().ok()).map(FontSize::from_half_points),
        bold: toggle(rpr, "b"),
        italic: toggle(rpr, "i"),
        underline: rpr.child(ns::W, "u").map(|u| val(u).unwrap_or("single").to_string()),
        strike,
        caps: toggle(rpr, "caps"),
        small_caps: toggle(rpr, "smallCaps"),
        color: rpr.child(ns::W, "color").and_then(read_color),
        highlight: rpr
            .child(ns::W, "highlight")
            .and_then(val)
            .and_then(|h| HIGHLIGHTS.iter().find(|(n, _)| *n == h))
            .map(|(_, rgb)| Color::rgb(*rgb)),
        baseline: rpr.child(ns::W, "vertAlign").and_then(val).and_then(|v| match v {
            "superscript" => Some(Baseline::Superscript),
            "subscript" => Some(Baseline::Subscript),
            _ => None,
        }),
        style: rpr.child(ns::W, "rStyle").and_then(val).map(str::to_string),
        lang: rpr.child(ns::W, "lang").and_then(val).map(str::to_string),
    }
}

pub fn read_para_props(ppr: &Element) -> ParaProps {
    let twips = |el: Option<&Element>, k: &str| el.and_then(|e| e.attr_ns(ns::W, k)).and_then(|v| Emu::parse(v, Emu::PER_TWIP));
    let ind = ppr.child(ns::W, "ind");
    let spacing = ppr.child(ns::W, "spacing");
    let auto = |k: &str| spacing.and_then(|s| s.attr_ns(ns::W, k)).and_then(parse_bool).unwrap_or(false);
    let first_line = twips(ind, "firstLine").or_else(|| twips(ind, "hanging").map(|h| Emu(-h.0)));
    ParaProps {
        style: ppr.child(ns::W, "pStyle").and_then(val).map(str::to_string),
        align: ppr.child(ns::W, "jc").and_then(val).and_then(|j| {
            Some(match j {
                "left" | "start" => Align::Left,
                "center" => Align::Center,
                "right" | "end" => Align::Right,
                "both" | "lowKashida" | "mediumKashida" | "highKashida" => Align::Justify,
                "distribute" | "thaiDistribute" => Align::Distribute,
                _ => return None,
            })
        }),
        level: ppr.path(ns::W, &["numPr", "ilvl"]).and_then(val).and_then(|v| v.parse().ok()),
        indent_start: twips(ind, "start").or_else(|| twips(ind, "left")),
        indent_end: twips(ind, "end").or_else(|| twips(ind, "right")),
        indent_first_line: first_line,
        space_before: if auto("beforeAutospacing") { None } else { twips(spacing, "before") },
        space_after: if auto("afterAutospacing") { None } else { twips(spacing, "after") },
        line_spacing: spacing.and_then(|s| {
            let line: i64 = s.attr_ns(ns::W, "line")?.parse().ok()?;
            Some(match s.attr_ns(ns::W, "lineRule").unwrap_or("auto") {
                "exact" => LineSpacing::Exactly(Emu::from_twips(line)),
                "atLeast" => LineSpacing::AtLeast(Emu::from_twips(line)),
                // 240ths of a line.
                _ => LineSpacing::Multiple(Percent((line * Percent::WHOLE as i64 / 240) as i32)),
            })
        }),
        rtl: toggle(ppr, "bidi"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse_element;

    fn el(inner: &str, local: &str) -> Element {
        parse_element(&format!(r#"<w:{local} xmlns:w="{}">{inner}</w:{local}>"#, ns::W)).unwrap()
    }

    #[test]
    fn run_properties() {
        let rpr = el(
            r#"<w:rStyle w:val="Strong"/><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsia="MS Mincho"/><w:b/><w:i w:val="0"/><w:dstrike/><w:color w:val="2F5597" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:highlight w:val="yellow"/><w:u w:val="double"/><w:vertAlign w:val="subscript"/><w:lang w:val="en-GB"/>"#,
            "rPr",
        );
        let p = read_run_props(&rpr);
        assert_eq!(p.style.as_deref(), Some("Strong"));
        assert_eq!(p.font.as_deref(), Some("+mn-lt"));
        assert_eq!(p.font_east_asian.as_deref(), Some("MS Mincho"));
        assert_eq!((p.bold, p.italic, p.strike), (Some(true), Some(false), Some(Strike::Double)));
        assert_eq!(p.size, Some(FontSize(1150)));
        assert_eq!(p.underline.as_deref(), Some("double"));
        assert_eq!(p.baseline, Some(Baseline::Subscript));
        assert_eq!(p.highlight, Some(Color::rgb(Rgb(255, 255, 0))));
        // Shade BF (191/255, a hair under 75%) is Word's "Darker 25%": Word itself writes 2F5496 for it.
        let c = p.color.unwrap();
        assert_eq!(c.resolve(&|n| (n == "accent1").then_some(Rgb(0x44, 0x72, 0xC4))).rgb, Rgb(0x2F, 0x54, 0x96));
    }

    #[test]
    fn paragraph_properties() {
        let ppr = el(
            r#"<w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="2"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/><w:jc w:val="both"/>"#,
            "pPr",
        );
        let p = read_para_props(&ppr);
        assert_eq!(p.style.as_deref(), Some("Heading1"));
        assert_eq!(p.level, Some(2));
        assert_eq!(p.space_before, Some(Emu::from_twips(240)));
        assert_eq!(p.line_spacing, Some(LineSpacing::Multiple(Percent(150_000))));
        assert_eq!(p.indent_start, Some(Emu::from_twips(720)));
        assert_eq!(p.indent_first_line, Some(Emu::from_twips(-360)));
        assert_eq!(p.align, Some(Align::Justify));
    }
}
