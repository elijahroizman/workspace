//! Lists (`word/numbering.xml`): what list a paragraph is in, what its label says ("1.",
//! "a)", "•"), and making new bulleted and numbered lists.
//!
//! A paragraph's `w:numPr` (or its style's) names a `w:num`, which points at an abstract list
//! definition with nine levels: each level's number format, label text (`%1.%2.`), start value
//! and indent.

use std::collections::HashMap;

use office_core::formats::docx::val;
use office_core::xml::{ns, Element, XmlDoc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    /// `decimal`, `lowerLetter`, `upperLetter`, `lowerRoman`, `upperRoman`, `bullet`, `none`…
    pub format: String,
    /// The label, with `%1`…`%9` for each level's number: `%1.%2.`, or the bullet character.
    pub text: String,
    pub start: u32,
    /// Whether this level counts from its start again after a shallower level (Word's default).
    pub restart: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Numbering {
    /// Abstract list definitions by their `w:abstractNumId`.
    pub abstracts: HashMap<String, Vec<Level>>,
    /// `w:num`s: their abstract definition and any levels that start elsewhere.
    pub nums: HashMap<String, (String, HashMap<u8, u32>)>,
}

impl Numbering {
    pub fn parse(doc: &XmlDoc) -> Numbering {
        let mut n = Numbering::default();
        for a in doc.root.children_named(ns::W, "abstractNum") {
            let Some(id) = a.attr_ns(ns::W, "abstractNumId") else { continue };
            let mut levels = vec![Level { format: "decimal".into(), text: String::new(), start: 1, restart: true }; 9];
            for l in a.children_named(ns::W, "lvl") {
                let Some(i) = l.attr_ns(ns::W, "ilvl").and_then(|v| v.parse::<usize>().ok()).filter(|i| *i < 9) else { continue };
                let child = |local: &str| l.child(ns::W, local).and_then(val).map(str::to_string);
                levels[i] = Level {
                    format: child("numFmt").unwrap_or_else(|| "decimal".into()),
                    text: child("lvlText").unwrap_or_default(),
                    start: child("start").and_then(|s| s.parse().ok()).unwrap_or(1),
                    restart: child("lvlRestart").is_none_or(|r| r != "0"),
                };
            }
            n.abstracts.insert(id.to_string(), levels);
        }
        for num in doc.root.children_named(ns::W, "num") {
            let (Some(id), Some(abs)) = (num.attr_ns(ns::W, "numId"), num.child(ns::W, "abstractNumId").and_then(val)) else { continue };
            let overrides = num
                .children_named(ns::W, "lvlOverride")
                .filter_map(|o| {
                    Some((o.attr_ns(ns::W, "ilvl")?.parse().ok()?, o.child(ns::W, "startOverride").and_then(val)?.parse().ok()?))
                })
                .collect();
            n.nums.insert(id.to_string(), (abs.to_string(), overrides));
        }
        n
    }

    pub fn levels(&self, num_id: &str) -> Option<&[Level]> {
        let (abs, _) = self.nums.get(num_id)?;
        self.abstracts.get(abs).map(Vec::as_slice)
    }

    /// Labels for paragraphs in document order: `(num_id, level)` for each one that's in a
    /// list, `None` for each that isn't. Counting runs through the whole document, as Word's
    /// does; `numId` 0 means "not in a list".
    pub fn labels(&self, paragraphs: impl IntoIterator<Item = Option<(String, u8)>>) -> Vec<Option<String>> {
        // Counters by abstract definition, since lists sharing one count together.
        let mut counters: HashMap<String, [Option<u32>; 9]> = HashMap::new();
        let mut started: HashMap<String, bool> = HashMap::new();
        let mut out = Vec::new();
        for p in paragraphs {
            let Some((num, level)) = p.filter(|(n, _)| n != "0") else {
                out.push(None);
                continue;
            };
            let Some((abs, overrides)) = self.nums.get(&num) else {
                out.push(None);
                continue;
            };
            let Some(levels) = self.abstracts.get(abs) else {
                out.push(None);
                continue;
            };
            let level = (level as usize).min(8);
            let first_use = !started.insert(num.clone(), true).unwrap_or(false);
            let c = counters.entry(abs.clone()).or_insert([None; 9]);
            // A num with start overrides starts those levels again the first time it's used.
            if first_use {
                for (l, start) in overrides {
                    if (*l as usize) < 9 {
                        c[*l as usize] = Some(start.saturating_sub(1));
                    }
                }
            }
            let start = |l: usize| overrides.get(&(l as u8)).copied().unwrap_or(levels[l].start);
            c[level] = Some(c[level].map(|n| n + 1).unwrap_or(start(level)));
            for (l, counter) in c.iter_mut().enumerate().skip(level + 1) {
                if levels[l].restart {
                    *counter = None;
                }
            }
            let mut label = levels[level].text.clone();
            if levels[level].format == "bullet" {
                out.push(Some(bullet(&label)));
                continue;
            }
            for l in 0..=level {
                let n = c[l].unwrap_or(start(l));
                label = label.replace(&format!("%{}", l + 1), &format_number(n, &levels[l].format));
            }
            out.push(Some(if levels[level].format == "none" { String::new() } else { label }));
        }
        out
    }
}

/// A bullet as text: Word's bullets are often characters in the Symbol or Wingdings fonts,
/// which mean nothing outside them; those become the bullets they look like.
fn bullet(text: &str) -> String {
    match text.chars().next() {
        Some('\u{F0B7}') | Some('\u{F06C}') | None => "•".into(),
        Some('\u{F0A7}') | Some('\u{F06E}') => "▪".into(),
        Some('o') if text == "o" => "◦".into(),
        Some(c) if ('\u{F000}'..='\u{F0FF}').contains(&c) => "•".into(),
        _ => text.to_string(),
    }
}

/// A list number in one of Word's formats.
pub fn format_number(n: u32, format: &str) -> String {
    let letters = |n: u32, base: u8| {
        // a, b, … z, aa, bb, … as Word counts.
        let n = n.max(1) - 1;
        ((base + (n % 26) as u8) as char).to_string().repeat((n / 26 + 1) as usize)
    };
    match format {
        "lowerLetter" => letters(n, b'a'),
        "upperLetter" => letters(n, b'A'),
        "lowerRoman" => roman(n).to_lowercase(),
        "upperRoman" => roman(n),
        "decimalZero" => format!("{n:02}"),
        "ordinal" => format!("{n}{}", ordinal_suffix(n)),
        "none" => String::new(),
        _ => n.to_string(),
    }
}

fn ordinal_suffix(n: u32) -> &'static str {
    match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    }
}

fn roman(mut n: u32) -> String {
    if n == 0 {
        return "0".into();
    }
    let table = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut s = String::new();
    for (v, r) in table {
        while n >= v {
            s.push_str(r);
            n -= v;
        }
    }
    s
}

/// What kind of list [`add_list`] makes.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ListKind {
    /// •, ◦, ▪ by level.
    Bullets,
    /// 1., a., i. by level.
    Numbers,
}

/// Adds a list definition and a num for it to `numbering` (made if `None`), as Word's own
/// bullet and number buttons do; returns the new numId.
pub fn add_list(numbering: &mut XmlDoc, kind: ListKind) -> String {
    let root = &mut numbering.root;
    let next = |local: &str, attr: &str| {
        root.children_named(ns::W, local)
            .filter_map(|e| e.attr_ns(ns::W, attr)?.parse::<u32>().ok())
            .max()
            .map(|m| m + 1)
            .unwrap_or(if local == "num" { 1 } else { 0 })
    };
    let (abs_id, num_id) = (next("abstractNum", "abstractNumId"), next("num", "numId"));
    let w = |local: &str, attrs: &[(&str, &str)]| attrs.iter().fold(Element::new(ns::W, local), |el, (k, v)| el.with_attr(ns::W, k, *v));
    let mut abs =
        w("abstractNum", &[("abstractNumId", &abs_id.to_string())]).with_child(w("multiLevelType", &[("val", "hybridMultilevel")]));
    for l in 0..9u32 {
        let (format, text, font) = match kind {
            ListKind::Bullets => ("bullet", ["•", "◦", "▪"][l as usize % 3].to_string(), true),
            ListKind::Numbers => (["decimal", "lowerLetter", "lowerRoman"][l as usize % 3], format!("%{}.", l + 1), false),
        };
        let left = (720 * (l + 1)).to_string();
        let mut lvl = w("lvl", &[("ilvl", &l.to_string())])
            .with_child(w("start", &[("val", "1")]))
            .with_child(w("numFmt", &[("val", format)]))
            .with_child(w("lvlText", &[("val", &text)]))
            .with_child(w("lvlJc", &[("val", if format == "lowerRoman" { "right" } else { "left" })]))
            .with_child(Element::new(ns::W, "pPr").with_child(w("ind", &[("left", &left), ("hanging", "360")])));
        if font {
            lvl.push(Element::new(ns::W, "rPr").with_child(w("rFonts", &[("ascii", "Calibri"), ("hAnsi", "Calibri")])));
        }
        abs.push(lvl);
    }
    // Abstract definitions come before nums.
    let at = root
        .children
        .iter()
        .position(|n| matches!(n, office_core::xml::Node::Element(e) if e.is(ns::W, "num")))
        .unwrap_or(root.children.len());
    root.children.insert(at, office_core::xml::Node::Element(abs));
    root.push(w("num", &[("numId", &num_id.to_string())]).with_child(w("abstractNumId", &[("val", &abs_id.to_string())])));
    num_id.to_string()
}

/// An empty `numbering.xml`.
pub fn empty() -> XmlDoc {
    let mut root = Element::new(ns::W, "numbering");
    root.declare(Some("w"), ns::W);
    XmlDoc::new(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_like_word() {
        let mut doc = empty();
        let numbers = add_list(&mut doc, ListKind::Numbers);
        let bullets = add_list(&mut doc, ListKind::Bullets);
        let n = Numbering::parse(&office_core::xml::parse(&doc.to_bytes()).unwrap());
        let p = |id: &str, l: u8| Some((id.to_string(), l));
        let labels = n.labels([
            p(&numbers, 0),
            p(&numbers, 1),
            p(&numbers, 1),
            None,
            p(&bullets, 0),
            p(&numbers, 0),
            p(&numbers, 1),
            p(&numbers, 2),
            p(&numbers, 2),
        ]);
        let got: Vec<&str> = labels.iter().map(|l| l.as_deref().unwrap_or("-")).collect();
        // Level 1 starts again under each new level-0 item; other paragraphs don't break the count.
        assert_eq!(got, ["1.", "a.", "b.", "-", "•", "2.", "a.", "i.", "ii."]);
    }

    #[test]
    fn formats_and_start_overrides() {
        assert_eq!(format_number(4, "upperRoman"), "IV");
        assert_eq!(format_number(1994, "lowerRoman"), "mcmxciv");
        assert_eq!(format_number(28, "lowerLetter"), "bb");
        assert_eq!(format_number(3, "decimalZero"), "03");
        assert_eq!(format_number(22, "ordinal"), "22nd");
        let xml = r#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Step %1:"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="10"/></w:lvlOverride></w:num></w:numbering>"#;
        let n = Numbering::parse(&office_core::xml::parse(xml.as_bytes()).unwrap());
        let labels =
            n.labels([Some(("1".into(), 0)), Some(("1".into(), 1)), Some(("2".into(), 0)), Some(("2".into(), 0)), Some(("0".into(), 0))]);
        assert_eq!(labels, [Some("Step 1:".into()), Some("•".into()), Some("Step 10:".into()), Some("Step 11:".into()), None]);
    }
}
