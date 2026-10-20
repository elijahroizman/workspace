//! SpreadsheetML's text formatting and colors, and its escapes for characters XML can't hold.

use crate::drawing::{Color, Rgb};
use crate::model::{Baseline, Run, RunProps, Strike};
use crate::units::{parse_bool, FontSize, Percent};
use crate::xml::{ns, Element};

/// Excel's numbered theme colors. Excel numbers the first four light-dark, the other way round
/// from the theme's own order.
pub const THEME_INDEX: [&str; 12] =
    ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

/// Excel's legacy palette, for `indexed` colors (64 is the window text, 65 the window).
pub const INDEXED: [u32; 66] = [
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, 0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF,
    0xFFFF00, 0xFF00FF, 0x00FFFF, 0x800000, 0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xC0C0C0, 0x808080, 0x9999FF, 0x993366,
    0xFFFFCC, 0xCCFFFF, 0x660066, 0xFF8080, 0x0066CC, 0xCCCCFF, 0x000080, 0xFF00FF, 0xFFFF00, 0x00FFFF, 0x800080, 0x800000, 0x008080,
    0x0000FF, 0x00CCFF, 0xCCFFFF, 0xCCFFCC, 0xFFFF99, 0x99CCFF, 0xFF99CC, 0xCC99FF, 0xFFCC99, 0x3366FF, 0x33CCCC, 0x99CC00, 0xFFCC00,
    0xFF9900, 0xFF6600, 0x666699, 0x969696, 0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366, 0x333399, 0x333333, 0x000000,
    0xFFFFFF,
];

/// A SpreadsheetML color (`<color rgb="FF4472C4"/>`, `theme="4" tint="-0.25"`, `indexed="10"`).
/// Excel's tint lightens or darkens in HSL, which is DrawingML's `lumMod` and `lumOff`.
pub fn read_color(el: &Element) -> Option<Color> {
    let mut c = if let Some(rgb) = el.attr("rgb").and_then(Rgb::parse) {
        Color::rgb(rgb)
    } else if let Some(slot) = el.attr("theme").and_then(|t| t.parse::<usize>().ok()).and_then(|i| THEME_INDEX.get(i)) {
        Color::scheme(slot)
    } else if let Some(&v) = el.attr("indexed").and_then(|i| i.parse::<usize>().ok()).and_then(|i| INDEXED.get(i)) {
        Color::rgb(Rgb((v >> 16) as u8, (v >> 8) as u8, v as u8))
    } else {
        return None;
    };
    if let Some(tint) = el.attr("tint").and_then(|t| t.parse::<f64>().ok()).filter(|t| *t != 0.0) {
        let whole = Percent::WHOLE as f64;
        if tint < 0.0 {
            c = c.with("lumMod", ((1.0 + tint) * whole).round() as i32);
        } else {
            c = c.with("lumMod", ((1.0 - tint) * whole).round() as i32).with("lumOff", (tint * whole).round() as i32);
        }
    }
    Some(c)
}

/// A rich-text run's `rPr`, whose children have Excel's `val` attributes.
pub fn read_run_props(rpr: &Element) -> RunProps {
    let v = |local: &str| rpr.child(ns::X, local).map(|e| e.attr("val"));
    let on = |local: &str| v(local).map(|val| val.and_then(parse_bool).unwrap_or(true));
    RunProps {
        font: v("rFont").flatten().map(str::to_string),
        size: v("sz").flatten().and_then(|s| s.parse().ok()).map(FontSize::from_points),
        bold: on("b"),
        italic: on("i"),
        underline: v("u").map(|u| match u.unwrap_or("single") {
            "singleAccounting" => "single".to_string(),
            "doubleAccounting" => "double".to_string(),
            u => u.to_string(),
        }),
        strike: on("strike").map(|s| if s { Strike::Single } else { Strike::None }),
        color: rpr.child(ns::X, "color").and_then(read_color),
        baseline: v("vertAlign").flatten().and_then(|a| match a {
            "superscript" => Some(Baseline::Superscript),
            "subscript" => Some(Baseline::Subscript),
            _ => None,
        }),
        ..Default::default()
    }
}

/// A shared or inline string (`si`, `is`): plain text, or runs if it has any.
pub fn read_string(si: &Element) -> crate::model::Value {
    use crate::model::Value;
    let runs: Vec<&Element> = si.children_named(ns::X, "r").collect();
    if runs.is_empty() {
        return Value::Text(si.child(ns::X, "t").map(|t| unescape(&t.text())).unwrap_or_default());
    }
    Value::Rich(
        runs.into_iter()
            .map(|r| Run {
                text: r.child(ns::X, "t").map(|t| unescape(&t.text())).unwrap_or_default(),
                props: r.child(ns::X, "rPr").map(read_run_props).unwrap_or_default(),
                ..Default::default()
            })
            .collect(),
    )
}

/// Undoes Excel's `_xHHHH_` escapes for characters XML can't hold (`_x000D_` is a carriage
/// return, `_x005F_` a literal underscore before something that looks like an escape).
pub fn unescape(s: &str) -> String {
    if !s.contains("_x") {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("_x") {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let code = looks_escaped(tail).then(|| &tail[2..6]);
        match code.and_then(|h| u32::from_str_radix(h, 16).ok()).and_then(char::from_u32) {
            Some(c) => {
                out.push(c);
                rest = &tail[7..];
            }
            None => {
                out.push_str("_x");
                rest = &tail[2..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The other way: control characters (other than tab and line breaks) as `_xHHHH_`, and an
/// underscore that would read as an escape as `_x005F_`.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (i, c) in s.char_indices() {
        if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') || matches!(c, '\u{FFFE}' | '\u{FFFF}') {
            out.push_str(&format!("_x{:04X}_", c as u32));
        } else if c == '_' && looks_escaped(&s[i..]) {
            out.push_str("_x005F_");
        } else {
            out.push(c);
        }
    }
    out
}

/// Whether `s` starts with something of the form `_xHHHH_`.
fn looks_escaped(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 7 && b.starts_with(b"_x") && b[2..6].iter().all(u8::is_ascii_hexdigit) && b[6] == b'_'
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse_element;

    #[test]
    fn escapes() {
        assert_eq!(unescape("a_x000D_b"), "a\rb");
        assert_eq!(unescape("_x005F_x0041_"), "_x0041_");
        assert_eq!(unescape("my_xvar_"), "my_xvar_");
        for s in ["a\u{1}b", "_x0041_", "plain_text", "x_x", "\u{b}"] {
            assert_eq!(unescape(&escape(s)), s, "{s:?}");
        }
        assert_eq!(escape("\u{1}"), "_x0001_");
    }

    #[test]
    fn colors() {
        let el = |attrs: &str| parse_element(&format!(r#"<color xmlns="{}" {attrs}/>"#, ns::X)).unwrap();
        assert_eq!(read_color(&el(r#"rgb="FF4472C4""#)), Some(Color::rgb(Rgb(0x44, 0x72, 0xC4))));
        assert_eq!(read_color(&el(r#"theme="1""#)), Some(Color::scheme("dk1")));
        assert_eq!(read_color(&el(r#"indexed="10""#)), Some(Color::rgb(Rgb(255, 0, 0))));
        let darker = read_color(&el(r#"theme="4" tint="-0.249977111117893""#)).unwrap();
        assert_eq!(darker.resolve(&|n| (n == "accent1").then_some(Rgb(0x44, 0x72, 0xC4))).rgb, Rgb(0x2F, 0x55, 0x97));
    }
}
