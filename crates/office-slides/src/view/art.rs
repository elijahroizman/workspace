//! What a slide shows from its layout and master: their own shapes and backgrounds, drawn
//! behind the slide, and the raw markup their placeholders and text styles carry (bullets, text
//! insets, anchoring, autofit) that the model doesn't read. Read once when the view opens.

use std::collections::HashMap;

use office_core::model::{Document, Frame, Kind};
use office_core::opc::Package;
use office_core::units::parse_bool;
use office_core::xml::{ns, Element};

/// A placeholder on a layout or master: what slides' frames that fill it inherit.
#[derive(Clone, Debug, Default)]
pub struct PhArt {
    pub kind: String,
    pub index: Option<u32>,
    pub sp_pr: Option<Element>,
    pub style: Option<Element>,
    pub body_pr: Option<Element>,
    pub lst_style: Option<Element>,
}

/// A layout or master, as drawn.
#[derive(Clone, Debug, Default)]
pub struct Art {
    /// Its shapes that aren't placeholders (logos, lines, backgrounds made of shapes).
    pub frames: Vec<Frame>,
    /// `p:bg`.
    pub background: Option<Element>,
    /// Whether slides on it show the master's shapes (`showMasterSp`).
    pub show_master: bool,
    pub placeholders: Vec<PhArt>,
    /// A master's `p:txStyles`.
    pub tx_styles: Option<Element>,
    /// The master's part, for a layout.
    pub master: Option<String>,
    pub is_layout: bool,
}

/// Every layout's and master's art, by part name. Their pictures' media are part names, read
/// from the package when drawn.
pub struct ArtSet {
    pub parts: HashMap<String, Art>,
}

impl ArtSet {
    pub fn read(doc: &Document) -> ArtSet {
        let mut media = Document::new(Kind::Slides);
        let mut parts = HashMap::new();
        if let (Some(pkg), Some(ppt)) = (&doc.package, crate::ppt(doc)) {
            for t in &ppt.templates {
                if let Some(art) = read_art(pkg, &t.part, &mut media) {
                    parts.insert(t.part.clone(), Art { master: t.master.clone(), is_layout: t.layout_type.is_some(), ..art });
                }
            }
        }
        ArtSet { parts }
    }

    pub fn get(&self, part: Option<&str>) -> Option<&Art> {
        self.parts.get(part?)
    }

    /// A slide's layout and master art.
    pub fn chain(&self, layout: Option<&str>) -> (Option<&Art>, Option<&Art>) {
        let l = self.get(layout);
        let m = l.and_then(|l| self.get(l.master.as_deref())).or_else(|| self.parts.values().find(|a| !a.is_layout));
        (l, m)
    }
}

fn read_art(pkg: &Package, part: &str, media: &mut Document) -> Option<Art> {
    let xml = pkg.xml(part).ok()?;
    let root = &xml.root;
    let c_sld = root.child(ns::P, "cSld");
    let frames = office_core::formats::pptx::read_part_frames(pkg, part, media).unwrap_or_default();
    let tree = c_sld.and_then(|c| c.child(ns::P, "spTree"));
    let mut placeholders = Vec::new();
    for el in tree.into_iter().flat_map(|t| t.elements()) {
        let nv = el.elements().find(|e| e.in_ns(ns::P) && e.local.starts_with("nv"));
        let Some(ph) = nv.and_then(|n| n.path(ns::P, &["nvPr", "ph"])) else { continue };
        let body = el.child(ns::P, "txBody");
        placeholders.push(PhArt {
            kind: ph.attr("type").unwrap_or("obj").to_string(),
            index: ph.attr("idx").and_then(|i| i.parse().ok()),
            sp_pr: el.child(ns::P, "spPr").cloned(),
            style: el.child(ns::P, "style").cloned(),
            body_pr: body.and_then(|b| b.child(ns::A, "bodyPr")).cloned(),
            lst_style: body.map(|b| {
                // The placeholder's list style, with each level's paragraph properties from its own
                // paragraphs folded in (PowerPoint keeps a placeholder's prompt formatting there).
                let mut lst = b.child(ns::A, "lstStyle").cloned().unwrap_or_else(|| Element::new(ns::A, "lstStyle"));
                for p in b.children_named(ns::A, "p") {
                    if let Some(ppr) = p.child(ns::A, "pPr") {
                        let lvl = ppr.attr("lvl").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0).min(8);
                        let name = format!("lvl{}pPr", lvl + 1);
                        if lst.child(ns::A, &name).is_none() {
                            let mut copy = ppr.clone();
                            copy.local = name;
                            lst.push(copy);
                        }
                    }
                }
                lst
            }),
        });
    }
    // Placeholders are drawn by the slides that fill them, not by the layout.
    let frames = frames.into_iter().filter(|f| f.placeholder.is_none()).collect();
    Some(Art {
        frames,
        background: c_sld.and_then(|c| c.child(ns::P, "bg")).cloned(),
        show_master: root.attr("showMasterSp").and_then(parse_bool).unwrap_or(true),
        placeholders,
        tx_styles: root.child(ns::P, "txStyles").cloned(),
        master: None,
        is_layout: false,
    })
}

impl Art {
    /// The placeholder a slide frame (or a layout placeholder) fills: on a layout by index (an
    /// omitted index is 0), on a master by kind, then by family (title, body, other).
    pub fn matching(&self, kind: &str, index: Option<u32>) -> Option<&PhArt> {
        if self.is_layout {
            return self
                .placeholders
                .iter()
                .find(|p| {
                    p.index.unwrap_or(0) == index.unwrap_or(0) && (index.is_some() || p.kind == kind || family(&p.kind) == family(kind))
                })
                .or_else(|| self.placeholders.iter().find(|p| p.index.unwrap_or(0) == index.unwrap_or(0)));
        }
        self.placeholders
            .iter()
            .find(|p| p.kind == kind)
            .or_else(|| self.placeholders.iter().find(|p| family(&p.kind) == family(kind) && family(kind) != "other"))
    }
}

/// Which master text style a placeholder kind uses.
pub fn family(kind: &str) -> &'static str {
    crate::templates::family(kind)
}
