//! Units. Each format measures in its own: Word in twips (1/20 pt) and half-points, DrawingML
//! (PowerPoint, and pictures everywhere) in EMUs, Excel in points and characters. The model uses
//! [`Emu`] for lengths and [`FontSize`] for type sizes, both integers, so converting a file's
//! numbers in and back out gives the same numbers.

use serde::{Deserialize, Serialize};

/// English Metric Units: 914 400 to the inch, 12 700 to the point, 635 to the twip.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Emu(pub i64);

impl Emu {
    pub const PER_INCH: i64 = 914_400;
    pub const PER_CM: i64 = 360_000;
    pub const PER_MM: i64 = 36_000;
    pub const PER_POINT: i64 = 12_700;
    pub const PER_TWIP: i64 = 635;
    /// A CSS pixel, at 96 to the inch.
    pub const PER_PIXEL: i64 = 9_525;

    pub fn from_twips(t: i64) -> Emu {
        Emu(t * Self::PER_TWIP)
    }
    pub fn from_points(pt: f64) -> Emu {
        Emu((pt * Self::PER_POINT as f64).round() as i64)
    }
    pub fn from_inches(i: f64) -> Emu {
        Emu((i * Self::PER_INCH as f64).round() as i64)
    }
    pub fn from_cm(cm: f64) -> Emu {
        Emu((cm * Self::PER_CM as f64).round() as i64)
    }
    pub fn from_pixels(px: f64) -> Emu {
        Emu((px * Self::PER_PIXEL as f64).round() as i64)
    }

    /// Rounded to the nearest twip.
    pub fn twips(self) -> i64 {
        div_round(self.0, Self::PER_TWIP)
    }
    pub fn points(self) -> f64 {
        self.0 as f64 / Self::PER_POINT as f64
    }
    pub fn inches(self) -> f64 {
        self.0 as f64 / Self::PER_INCH as f64
    }
    pub fn pixels(self) -> f64 {
        self.0 as f64 / Self::PER_PIXEL as f64
    }

    /// Parses a length: a bare number in `unit` EMUs (635 for twips, 1 for EMUs), or a number
    /// with a unit (`2.5cm`, `12pt`, `1in`, `10mm`, `6pc`, `3pi`), which strict files and some
    /// Word attributes use.
    pub fn parse(s: &str, unit: i64) -> Option<Emu> {
        let s = s.trim();
        let split = s.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(s.len());
        let (num, suffix) = s.split_at(split);
        let per = match suffix {
            "" => unit as f64,
            "mm" => Self::PER_MM as f64,
            "cm" => Self::PER_CM as f64,
            "in" => Self::PER_INCH as f64,
            "pt" => Self::PER_POINT as f64,
            "pc" | "pi" => 12.0 * Self::PER_POINT as f64,
            _ => return None,
        };
        if suffix.is_empty() {
            // Integers are the common case; keep them exact.
            if let Ok(n) = num.parse::<i64>() {
                return Some(Emu(n * unit));
            }
        }
        num.parse::<f64>().ok().filter(|n| n.is_finite()).map(|n| Emu((n * per).round() as i64))
    }
}

impl std::ops::Add for Emu {
    type Output = Emu;
    fn add(self, o: Emu) -> Emu {
        Emu(self.0 + o.0)
    }
}

impl std::ops::Sub for Emu {
    type Output = Emu;
    fn sub(self, o: Emu) -> Emu {
        Emu(self.0 - o.0)
    }
}

/// A type size in hundredths of a point: PowerPoint's own unit (`sz="1200"` is 12 pt). Word's
/// half-points and Excel's points convert exactly for every size those formats can write.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FontSize(pub u32);

impl FontSize {
    pub fn from_points(pt: f64) -> FontSize {
        FontSize((pt * 100.0).round().max(0.0) as u32)
    }
    pub fn from_half_points(hp: u32) -> FontSize {
        FontSize(hp * 50)
    }
    pub fn points(self) -> f64 {
        self.0 as f64 / 100.0
    }
    /// Rounded to the nearest half-point, as Word stores sizes.
    pub fn half_points(self) -> u32 {
        (self.0 + 25) / 50
    }
}

/// DrawingML's percentages, in thousandths of a percent: 100 000 is 100%. Strict files may
/// write `"50%"` instead; [`Percent::parse`] reads both.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Percent(pub i32);

impl Percent {
    pub const WHOLE: i32 = 100_000;

    pub fn parse(s: &str) -> Option<Percent> {
        match s.trim().strip_suffix('%') {
            Some(n) => n.trim().parse::<f64>().ok().map(|n| Percent((n * 1000.0).round() as i32)),
            None => s.trim().parse().ok().map(Percent),
        }
    }
    pub fn fraction(self) -> f64 {
        self.0 as f64 / Self::WHOLE as f64
    }
}

/// DrawingML angles, in 60 000ths of a degree.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Angle(pub i32);

impl Angle {
    pub const PER_DEGREE: i32 = 60_000;

    pub fn from_degrees(d: f64) -> Angle {
        Angle((d * Self::PER_DEGREE as f64).round() as i32)
    }
    pub fn degrees(self) -> f64 {
        self.0 as f64 / Self::PER_DEGREE as f64
    }
}

fn div_round(n: i64, d: i64) -> i64 {
    if (n < 0) == (d < 0) {
        (n + d / 2) / d
    } else {
        (n - d / 2) / d
    }
}

/// OOXML's booleans: `1`, `true` and `on` are true; Word's `<w:b/>` with no value is true too,
/// which callers handle by defaulting when the attribute is missing.
pub fn parse_bool(s: &str) -> Option<bool> {
    match s.trim() {
        "1" | "true" | "on" | "True" | "TRUE" => Some(true),
        "0" | "false" | "off" | "False" | "FALSE" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lengths() {
        assert_eq!(Emu::from_twips(1440), Emu(Emu::PER_INCH));
        assert_eq!(Emu(Emu::PER_INCH).twips(), 1440);
        assert_eq!(Emu(-1000).twips(), -2);
        assert_eq!(Emu::from_points(12.0).points(), 12.0);
        assert_eq!(Emu::from_cm(2.54), Emu(Emu::PER_INCH));
        assert_eq!(Emu::parse("720", Emu::PER_TWIP), Some(Emu::from_twips(720)));
        assert_eq!(Emu::parse("2.54cm", 1), Some(Emu(Emu::PER_INCH)));
        assert_eq!(Emu::parse("1in", 1), Some(Emu(Emu::PER_INCH)));
        assert_eq!(Emu::parse("12pt", 1), Some(Emu::from_points(12.0)));
        assert_eq!(Emu::parse("1pc", 1), Some(Emu::from_points(12.0)));
        assert_eq!(Emu::parse("-457200", 1), Some(Emu(-457200)));
        assert_eq!(Emu::parse("12furlongs", 1), None);
        assert_eq!(Emu::parse("", 1), None);
    }

    #[test]
    fn font_sizes() {
        assert_eq!(FontSize::from_half_points(23), FontSize(1150));
        assert_eq!(FontSize(1150).half_points(), 23);
        assert_eq!(FontSize::from_points(10.5), FontSize(1050));
        for hp in 1..400 {
            assert_eq!(FontSize::from_half_points(hp).half_points(), hp);
        }
    }

    #[test]
    fn percents_and_angles() {
        assert_eq!(Percent::parse("75000"), Some(Percent(75_000)));
        assert_eq!(Percent::parse("75%"), Some(Percent(75_000)));
        assert_eq!(Percent(50_000).fraction(), 0.5);
        assert_eq!(Angle::from_degrees(90.0), Angle(5_400_000));
        assert_eq!(parse_bool("on"), Some(true));
        assert_eq!(parse_bool("0"), Some(false));
        assert_eq!(parse_bool("maybe"), None);
    }
}
