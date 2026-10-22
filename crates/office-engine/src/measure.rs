//! Measuring text. The host measures (in the app, a canvas with the same fonts the page draws
//! with), and the engine caches what it asks, since a document repeats most of its words.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

/// A font as the host's text engine names it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Font {
    /// A CSS font-family list: `"Calibri", "Carlito", sans-serif`.
    pub family: String,
    pub bold: bool,
    pub italic: bool,
    /// Size in hundredths of a pixel, so fonts hash and compare exactly.
    pub size: u32,
}

impl Font {
    pub fn px(&self) -> f64 {
        self.size as f64 / 100.0
    }

    /// The CSS `font` shorthand: what a canvas measures with and a page draws with.
    pub fn css(&self) -> String {
        let mut s = String::new();
        if self.italic {
            s.push_str("italic ");
        }
        if self.bold {
            s.push_str("bold ");
        }
        s.push_str(&format!("{}px {}", self.size as f64 / 100.0, self.family));
        s
    }
}

/// How far a font reaches above and below the baseline, in pixels.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Metrics {
    pub ascent: f64,
    pub descent: f64,
}

impl Metrics {
    pub fn height(&self) -> f64 {
        self.ascent + self.descent
    }
}

/// What measures text: the app's canvas, or a stand-in in tests.
pub trait Measurer {
    /// The advance width of `text` in `font`, in pixels.
    fn width(&mut self, font: &Font, text: &str) -> f64;
    fn metrics(&mut self, font: &Font) -> Metrics;
}

/// A font's number in a [`Measure`]'s table.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FontId(pub u32);

/// The engine's side of measuring: fonts by number, and a cache of widths in front of the host.
pub struct Measure {
    fonts: Vec<Font>,
    ids: HashMap<Font, FontId>,
    metrics: Vec<Option<Metrics>>,
    widths: HashMap<(FontId, u64), f64>,
}

impl Default for Measure {
    fn default() -> Measure {
        Measure::new()
    }
}

/// Past this many cached widths the cache starts over, which keeps a long session's memory flat.
const MAX_CACHED: usize = 200_000;

impl Measure {
    pub fn new() -> Measure {
        Measure { fonts: Vec::new(), ids: HashMap::new(), metrics: Vec::new(), widths: HashMap::new() }
    }

    pub fn font_id(&mut self, font: &Font) -> FontId {
        if let Some(id) = self.ids.get(font) {
            return *id;
        }
        let id = FontId(self.fonts.len() as u32);
        self.fonts.push(font.clone());
        self.metrics.push(None);
        self.ids.insert(font.clone(), id);
        id
    }

    pub fn font(&self, id: FontId) -> &Font {
        &self.fonts[id.0 as usize]
    }

    pub fn metrics(&mut self, host: &mut dyn Measurer, id: FontId) -> Metrics {
        if let Some(m) = self.metrics[id.0 as usize] {
            return m;
        }
        let m = host.metrics(&self.fonts[id.0 as usize]);
        self.metrics[id.0 as usize] = Some(m);
        m
    }

    pub fn width(&mut self, host: &mut dyn Measurer, id: FontId, text: &str) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        let key = (id, hash_str(text));
        if let Some(w) = self.widths.get(&key) {
            return *w;
        }
        if self.widths.len() >= MAX_CACHED {
            self.widths.clear();
        }
        let w = host.width(&self.fonts[id.0 as usize], text);
        self.widths.insert(key, w);
        w
    }
}

fn hash_str(s: &str) -> u64 {
    let mut h = Fnv(0xcbf2_9ce4_8422_2325);
    s.hash(&mut h);
    h.0
}

/// FNV-1a: quick on the short strings measured here, and the same on every platform.
pub(crate) struct Fnv(pub u64);

impl Hasher for Fnv {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 ^= *b as u64;
            self.0 = self.0.wrapping_mul(0x100_0000_01b3);
        }
    }
}

/// A stand-in measurer for tests and headless use: every character is `advance` ems wide (spaces
/// half that), with fixed ascent and descent.
#[derive(Clone, Debug)]
pub struct FixedMeasurer {
    pub advance: f64,
    pub ascent: f64,
    pub descent: f64,
}

impl Default for FixedMeasurer {
    fn default() -> FixedMeasurer {
        FixedMeasurer { advance: 0.5, ascent: 0.8, descent: 0.2 }
    }
}

impl Measurer for FixedMeasurer {
    fn width(&mut self, font: &Font, text: &str) -> f64 {
        let px = font.px();
        text.chars().map(|c| if c == ' ' { self.advance * px / 2.0 } else { self.advance * px }).sum()
    }

    fn metrics(&mut self, font: &Font) -> Metrics {
        Metrics { ascent: self.ascent * font.px(), descent: self.descent * font.px() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Counting(FixedMeasurer, usize);
    impl Measurer for Counting {
        fn width(&mut self, font: &Font, text: &str) -> f64 {
            self.1 += 1;
            self.0.width(font, text)
        }
        fn metrics(&mut self, font: &Font) -> Metrics {
            self.0.metrics(font)
        }
    }

    #[test]
    fn caches_widths_per_font() {
        let mut host = Counting(FixedMeasurer::default(), 0);
        let mut m = Measure::new();
        let a = m.font_id(&Font { family: "A".into(), bold: false, italic: false, size: 1000 });
        let b = m.font_id(&Font { family: "A".into(), bold: true, italic: false, size: 1000 });
        assert_eq!(m.width(&mut host, a, "word"), 20.0);
        assert_eq!(m.width(&mut host, a, "word"), 20.0);
        assert_eq!(host.1, 1);
        m.width(&mut host, b, "word");
        assert_eq!(host.1, 2);
        assert_eq!(m.font_id(&Font { family: "A".into(), bold: false, italic: false, size: 1000 }), a);
    }

    #[test]
    fn css_shorthand() {
        let f = Font { family: "\"Calibri\", sans-serif".into(), bold: true, italic: true, size: 1467 };
        assert_eq!(f.css(), "italic bold 14.67px \"Calibri\", sans-serif");
    }
}
