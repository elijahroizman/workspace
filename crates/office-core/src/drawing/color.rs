//! Colors, as DrawingML describes them: a base color (an RGB value, a theme slot, a system or
//! preset color) and a list of transforms (`lumMod`, `tint`, `alpha`…) applied in order.
//! Word's `w:color` with `w:themeColor` and Excel's `theme`/`tint` attributes map onto the same
//! model, so a theme color is one thing in all three formats.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::units::Percent;
use crate::xml::{ns, Element};

/// A plain sRGB color, written `RRGGBB`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    pub const BLACK: Rgb = Rgb(0, 0, 0);
    pub const WHITE: Rgb = Rgb(255, 255, 255);

    /// `RRGGBB`, or Excel's `AARRGGBB` (the alpha is dropped; Excel ignores it too).
    pub fn parse(hex: &str) -> Option<Rgb> {
        let hex = hex.trim().trim_start_matches('#');
        let hex = if hex.len() == 8 { &hex[2..] } else { hex };
        if hex.len() != 6 || !hex.is_ascii() {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
        Some(Rgb(byte(0)?, byte(2)?, byte(4)?))
    }

    pub fn hex(self) -> String {
        format!("{:02X}{:02X}{:02X}", self.0, self.1, self.2)
    }
}

impl fmt::Display for Rgb {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.hex())
    }
}

impl Serialize for Rgb {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.hex())
    }
}

impl<'de> Deserialize<'de> for Rgb {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Rgb, D::Error> {
        let s = String::deserialize(d)?;
        Rgb::parse(&s).ok_or_else(|| serde::de::Error::custom(format!("not a color: {s}")))
    }
}

/// A resolved color, ready to paint.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Rgba {
    pub rgb: Rgb,
    /// 0 (transparent) to 1 (opaque).
    pub alpha: f64,
}

impl Rgba {
    pub fn css(&self) -> String {
        if self.alpha >= 1.0 {
            format!("#{}", self.rgb.hex().to_ascii_lowercase())
        } else {
            format!("rgba({}, {}, {}, {})", self.rgb.0, self.rgb.1, self.rgb.2, (self.alpha * 1000.0).round() / 1000.0)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Color {
    pub base: ColorBase,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transforms: Vec<Transform>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ColorBase {
    Rgb {
        value: Rgb,
    },
    /// A theme slot: `accent1`, `dk1`, `tx1`, `bg2`, `hlink`… or `phClr`, the placeholder a
    /// theme's styles use for "the color this style is applied with".
    Scheme {
        name: String,
    },
    /// An operating system color (`windowText`), with the value it had when the file was saved.
    System {
        name: String,
        last: Option<Rgb>,
    },
    /// A named color: `black`, `dkBlue`, `ltGray`…
    Preset {
        name: String,
    },
    /// Hue in 60 000ths of a degree; saturation and luminance in thousandths of a percent.
    Hsl {
        hue: i32,
        sat: i32,
        lum: i32,
    },
    /// Linear RGB, each channel in thousandths of a percent.
    ScRgb {
        r: i32,
        g: i32,
        b: i32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    /// The DrawingML element name: `lumMod`, `tint`, `alpha`, `comp`…
    pub kind: String,
    /// Thousandths of a percent (or 60 000ths of a degree for `hue`/`hueOff`); 0 for the
    /// transforms without a value (`comp`, `inv`, `gray`, `gamma`, `invGamma`).
    pub value: i32,
}

impl Color {
    pub fn rgb(rgb: Rgb) -> Color {
        Color { base: ColorBase::Rgb { value: rgb }, transforms: Vec::new() }
    }

    pub fn scheme(name: &str) -> Color {
        Color { base: ColorBase::Scheme { name: name.to_string() }, transforms: Vec::new() }
    }

    pub fn with(mut self, kind: &str, value: i32) -> Color {
        self.transforms.push(Transform { kind: kind.to_string(), value });
        self
    }

    /// Reads a DrawingML color element (`a:srgbClr`, `a:schemeClr`…), or `None` if `el` isn't one.
    pub fn from_drawingml(el: &Element) -> Option<Color> {
        if !el.in_ns(ns::A) {
            return None;
        }
        let val = || el.attr("val").unwrap_or("").to_string();
        let pct = |name: &str| el.attr(name).and_then(Percent::parse).map(|p| p.0).unwrap_or(0);
        let base = match el.local.as_str() {
            "srgbClr" => ColorBase::Rgb { value: Rgb::parse(&val())? },
            "schemeClr" => ColorBase::Scheme { name: val() },
            "sysClr" => ColorBase::System { name: val(), last: el.attr("lastClr").and_then(Rgb::parse) },
            "prstClr" => ColorBase::Preset { name: val() },
            "hslClr" => ColorBase::Hsl { hue: el.attr("hue").and_then(|h| h.parse().ok()).unwrap_or(0), sat: pct("sat"), lum: pct("lum") },
            "scrgbClr" => ColorBase::ScRgb { r: pct("r"), g: pct("g"), b: pct("b") },
            _ => return None,
        };
        let transforms = el
            .elements()
            .map(|t| Transform {
                kind: t.local.clone(),
                value: t
                    .attr("val")
                    .and_then(
                        |v| if matches!(t.local.as_str(), "hue" | "hueOff") { v.parse().ok() } else { Percent::parse(v).map(|p| p.0) },
                    )
                    .unwrap_or(0),
            })
            .collect();
        Some(Color { base, transforms })
    }

    /// The first DrawingML color among `parent`'s children (as in `a:solidFill`).
    pub fn in_drawingml(parent: &Element) -> Option<Color> {
        parent.elements().find_map(Color::from_drawingml)
    }

    /// The DrawingML element for this color.
    pub fn to_drawingml(&self) -> Element {
        let mut el = match &self.base {
            ColorBase::Rgb { value } => Element::new(ns::A, "srgbClr").with_attr("", "val", value.hex()),
            ColorBase::Scheme { name } => Element::new(ns::A, "schemeClr").with_attr("", "val", name),
            ColorBase::System { name, last } => {
                let el = Element::new(ns::A, "sysClr").with_attr("", "val", name);
                match last {
                    Some(l) => el.with_attr("", "lastClr", l.hex()),
                    None => el,
                }
            }
            ColorBase::Preset { name } => Element::new(ns::A, "prstClr").with_attr("", "val", name),
            ColorBase::Hsl { hue, sat, lum } => Element::new(ns::A, "hslClr")
                .with_attr("", "hue", hue.to_string())
                .with_attr("", "sat", sat.to_string())
                .with_attr("", "lum", lum.to_string()),
            ColorBase::ScRgb { r, g, b } => Element::new(ns::A, "scrgbClr")
                .with_attr("", "r", r.to_string())
                .with_attr("", "g", g.to_string())
                .with_attr("", "b", b.to_string()),
        };
        for t in &self.transforms {
            let mut child = Element::new(ns::A, &t.kind);
            if !matches!(t.kind.as_str(), "comp" | "inv" | "gray" | "gamma" | "invGamma") {
                child.set_attr("", "val", t.value.to_string());
            }
            el.push(child);
        }
        el
    }

    /// The color to paint. `scheme` looks up theme slots by name (see
    /// [`super::Theme::scheme_color`]); `None` there, or for `phClr`, falls back to black.
    pub fn resolve(&self, scheme: &dyn Fn(&str) -> Option<Rgb>) -> Rgba {
        let base = match &self.base {
            ColorBase::Rgb { value } => *value,
            ColorBase::Scheme { name } => scheme(name).unwrap_or(Rgb::BLACK),
            ColorBase::System { name, last } => last.or_else(|| system_color(name)).unwrap_or(Rgb::BLACK),
            ColorBase::Preset { name } => preset_color(name).unwrap_or(Rgb::BLACK),
            ColorBase::Hsl { hue, sat, lum } => Hsl { h: *hue as f64 / 60_000.0, s: frac(*sat), l: frac(*lum) }.to_rgb(),
            ColorBase::ScRgb { r, g, b } => Linear([frac(*r), frac(*g), frac(*b)]).to_rgb(),
        };
        let mut c = Working::new(base);
        for t in &self.transforms {
            c.apply(&t.kind, t.value);
        }
        Rgba { rgb: c.rgb(), alpha: c.alpha.clamp(0.0, 1.0) }
    }
}

fn frac(v: i32) -> f64 {
    v as f64 / Percent::WHOLE as f64
}

/// A color part way through its transforms. Office applies some in HSL and some in linear RGB;
/// the working color keeps whichever it was last changed in, so a run of HSL transforms doesn't
/// round-trip through 8-bit RGB between each one.
struct Working {
    space: Space,
    alpha: f64,
}

enum Space {
    Hsl(Hsl),
    Linear(Linear),
}

impl Working {
    fn new(rgb: Rgb) -> Working {
        Working { space: Space::Linear(Linear::from_rgb(rgb)), alpha: 1.0 }
    }

    fn hsl(&mut self) -> &mut Hsl {
        if let Space::Linear(l) = &self.space {
            self.space = Space::Hsl(Hsl::from_rgb(l.to_rgb()));
        }
        match &mut self.space {
            Space::Hsl(h) => h,
            Space::Linear(_) => unreachable!(),
        }
    }

    fn linear(&mut self) -> &mut Linear {
        if let Space::Hsl(h) = &self.space {
            self.space = Space::Linear(Linear::from_rgb(h.to_rgb()));
        }
        match &mut self.space {
            Space::Linear(l) => l,
            Space::Hsl(_) => unreachable!(),
        }
    }

    fn rgb(&self) -> Rgb {
        match &self.space {
            Space::Hsl(h) => h.to_rgb(),
            Space::Linear(l) => l.to_rgb(),
        }
    }

    fn apply(&mut self, kind: &str, value: i32) {
        let v = frac(value);
        let unit = |x: f64| x.clamp(0.0, 1.0);
        match kind {
            "alpha" => self.alpha = v,
            "alphaMod" => self.alpha *= v,
            "alphaOff" => self.alpha += v,
            "lum" => self.hsl().l = unit(v),
            "lumMod" => self.hsl().l = unit(self.hsl().l * v),
            "lumOff" => self.hsl().l = unit(self.hsl().l + v),
            "sat" => self.hsl().s = unit(v),
            "satMod" => self.hsl().s = unit(self.hsl().s * v),
            "satOff" => self.hsl().s = unit(self.hsl().s + v),
            "hue" => self.hsl().h = (value as f64 / 60_000.0).rem_euclid(360.0),
            "hueMod" => self.hsl().h = (self.hsl().h * v).rem_euclid(360.0),
            "hueOff" => self.hsl().h = (self.hsl().h + value as f64 / 60_000.0).rem_euclid(360.0),
            "comp" => self.hsl().h = (self.hsl().h + 180.0).rem_euclid(360.0),
            // Tint moves toward white and shade toward black, both in linear RGB, as Office does.
            "tint" => self.linear().map(|c| 1.0 - (1.0 - c) * v),
            "shade" => self.linear().map(|c| c * v),
            "inv" => self.linear().map(|c| 1.0 - c),
            "gray" => {
                let [r, g, b] = self.linear().0;
                let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                self.linear().0 = [y; 3];
            }
            "gamma" => self.linear().map(srgb_encode),
            "invGamma" => self.linear().map(srgb_decode),
            "red" | "green" | "blue" | "redMod" | "greenMod" | "blueMod" | "redOff" | "greenOff" | "blueOff" => {
                let i = match &kind[..kind.len().min(3)] {
                    "red" => 0,
                    "gre" => 1,
                    _ => 2,
                };
                let c = &mut self.linear().0[i];
                *c = unit(if kind.ends_with("Mod") {
                    *c * v
                } else if kind.ends_with("Off") {
                    *c + v
                } else {
                    v
                });
            }
            _ => {}
        }
    }
}

#[derive(Copy, Clone, Debug)]
struct Linear([f64; 3]);

impl Linear {
    fn from_rgb(c: Rgb) -> Linear {
        Linear([c.0, c.1, c.2].map(|v| srgb_decode(v as f64 / 255.0)))
    }
    fn to_rgb(self) -> Rgb {
        let [r, g, b] = self.0.map(|v| (srgb_encode(v.clamp(0.0, 1.0)) * 255.0).round() as u8);
        Rgb(r, g, b)
    }
    fn map(&mut self, f: impl Fn(f64) -> f64) {
        self.0 = self.0.map(|c| f(c).clamp(0.0, 1.0));
    }
}

fn srgb_decode(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn srgb_encode(c: f64) -> f64 {
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// Hue in degrees, saturation and luminance 0–1.
#[derive(Copy, Clone, Debug)]
struct Hsl {
    h: f64,
    s: f64,
    l: f64,
}

impl Hsl {
    fn from_rgb(c: Rgb) -> Hsl {
        let [r, g, b] = [c.0, c.1, c.2].map(|v| v as f64 / 255.0);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        let d = max - min;
        if d == 0.0 {
            return Hsl { h: 0.0, s: 0.0, l };
        }
        let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
        let h = if max == r {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        Hsl { h: h * 60.0, s, l }
    }

    fn to_rgb(self) -> Rgb {
        let Hsl { h, s, l } = self;
        let channel = |t: f64| {
            let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
            let p = 2.0 * l - q;
            let t = t.rem_euclid(1.0);
            let v = if t < 1.0 / 6.0 {
                p + (q - p) * 6.0 * t
            } else if t < 0.5 {
                q
            } else if t < 2.0 / 3.0 {
                p + (q - p) * (2.0 / 3.0 - t) * 6.0
            } else {
                p
            };
            (v.clamp(0.0, 1.0) * 255.0).round() as u8
        };
        let h = h / 360.0;
        Rgb(channel(h + 1.0 / 3.0), channel(h), channel(h - 1.0 / 3.0))
    }
}

/// The usual values of the system colors Office files name, for files that don't say.
fn system_color(name: &str) -> Option<Rgb> {
    Some(match name {
        "windowText" | "menuText" | "captionText" | "btnText" | "infoText" => Rgb::BLACK,
        "window" | "menu" | "btnHighlight" | "highlightText" => Rgb::WHITE,
        "btnFace" | "3dLight" | "menuBar" => Rgb(0xF0, 0xF0, 0xF0),
        "highlight" | "hotLight" => Rgb(0x00, 0x78, 0xD7),
        "grayText" | "btnShadow" => Rgb(0x6D, 0x6D, 0x6D),
        _ => return None,
    })
}

/// DrawingML's preset colors are the CSS named colors, with `dk`, `lt` and `med` short for
/// dark, light and medium (`dkSlateGray`, `ltGoldenrodYellow`, `medSeaGreen`).
fn preset_color(name: &str) -> Option<Rgb> {
    let lower = name.to_ascii_lowercase();
    let full = if let Some(rest) = lower.strip_prefix("dk") {
        format!("dark{rest}")
    } else if let Some(rest) = lower.strip_prefix("lt") {
        format!("light{rest}")
    } else if let Some(rest) = lower.strip_prefix("med") {
        if rest.starts_with("ium") {
            lower.clone()
        } else {
            format!("medium{rest}")
        }
    } else {
        lower
    };
    let mut words = CSS_COLORS.split_ascii_whitespace();
    while let (Some(n), Some(hex)) = (words.next(), words.next()) {
        if n == full {
            return Rgb::parse(hex);
        }
    }
    None
}

const CSS_COLORS: &str = "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc \
bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 \
cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c \
cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgrey a9a9a9 darkgreen 006400 \
darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 \
darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f \
darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 \
dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc \
ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 grey 808080 green 008000 greenyellow adff2f \
honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa \
lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff \
lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgrey d3d3d3 lightgreen 90ee90 lightpink ffb6c1 lightsalmon ffa07a \
lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de \
lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa \
mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee \
mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa \
mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 \
orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee \
palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 \
purple 800080 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 \
seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 \
slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 \
tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 \
yellowgreen 9acd32";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse_element;

    fn resolve(c: &Color) -> Rgb {
        c.resolve(&|name| (name == "accent1").then_some(Rgb(0x44, 0x72, 0xC4))).rgb
    }

    #[test]
    fn parses_hex() {
        assert_eq!(Rgb::parse("4472C4"), Some(Rgb(0x44, 0x72, 0xC4)));
        assert_eq!(Rgb::parse("FF4472C4"), Some(Rgb(0x44, 0x72, 0xC4)));
        assert_eq!(Rgb::parse("auto"), None);
        assert_eq!(Rgb(1, 2, 255).hex(), "0102FF");
    }

    #[test]
    fn reads_and_writes_drawingml() {
        let el = parse_element(&format!(
            r#"<a:schemeClr xmlns:a="{}" val="accent1"><a:lumMod val="75000"/><a:alpha val="50%"/></a:schemeClr>"#,
            ns::A
        ))
        .unwrap();
        let c = Color::from_drawingml(&el).unwrap();
        assert_eq!(c, Color::scheme("accent1").with("lumMod", 75_000).with("alpha", 50_000));
        let back = Color::from_drawingml(&c.to_drawingml()).unwrap();
        assert_eq!(back, c);
        let sys = parse_element(&format!(r#"<a:sysClr xmlns:a="{}" val="windowText" lastClr="111111"/>"#, ns::A)).unwrap();
        assert_eq!(resolve(&Color::from_drawingml(&sys).unwrap()), Rgb(0x11, 0x11, 0x11));
    }

    #[test]
    fn resolves_like_office() {
        // PowerPoint's "Blue, Accent 1, Darker 25%" and "Lighter 40%".
        assert_eq!(resolve(&Color::scheme("accent1").with("lumMod", 75_000)), Rgb(0x2F, 0x55, 0x97));
        assert_eq!(resolve(&Color::scheme("accent1").with("lumMod", 60_000).with("lumOff", 40_000)), Rgb(0x8F, 0xAA, 0xDC));
        assert_eq!(resolve(&Color::rgb(Rgb::WHITE).with("shade", 50_000)), Rgb(0xBC, 0xBC, 0xBC));
        assert_eq!(resolve(&Color::rgb(Rgb::BLACK).with("tint", 50_000)), Rgb(0xBC, 0xBC, 0xBC));
        assert_eq!(resolve(&Color::rgb(Rgb(255, 0, 0)).with("comp", 0)), Rgb(0, 255, 255));
        assert_eq!(resolve(&Color::rgb(Rgb::BLACK).with("inv", 0)), Rgb::WHITE);
        let half = Color::rgb(Rgb::BLACK).with("alpha", 50_000).resolve(&|_| None);
        assert_eq!(half.alpha, 0.5);
        assert_eq!(half.css(), "rgba(0, 0, 0, 0.5)");
        assert_eq!(Color::rgb(Rgb(0xAB, 0xCD, 0xEF)).resolve(&|_| None).css(), "#abcdef");
    }

    #[test]
    fn hsl_round_trips() {
        for c in [Rgb(0x44, 0x72, 0xC4), Rgb(0xED, 0x7D, 0x31), Rgb(1, 2, 3), Rgb::WHITE, Rgb::BLACK, Rgb(0x80, 0x80, 0x80)] {
            assert_eq!(Hsl::from_rgb(c).to_rgb(), c);
            assert_eq!(Linear::from_rgb(c).to_rgb(), c);
        }
    }

    #[test]
    fn presets() {
        assert_eq!(preset_color("dkSlateGray"), Some(Rgb(0x2F, 0x4F, 0x4F)));
        assert_eq!(preset_color("ltGoldenrodYellow"), Some(Rgb(0xFA, 0xFA, 0xD2)));
        assert_eq!(preset_color("medSeaGreen"), Some(Rgb(0x3C, 0xB3, 0x71)));
        assert_eq!(preset_color("black"), Some(Rgb::BLACK));
        assert_eq!(preset_color("nope"), None);
    }
}
