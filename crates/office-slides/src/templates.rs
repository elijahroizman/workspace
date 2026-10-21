//! Slide masters and layouts: the placeholders a slide's frames fill, the text styles they
//! inherit, and the color map that says what `tx1` and `bg1` are.
//!
//! A slide sits on a layout, and a layout on a master. A placeholder frame on a slide takes
//! whatever it doesn't say itself (its position, its text's formatting at each outline level)
//! from the matching placeholder on its layout, then on the master, then from the master's
//! title or body text style.

use office_core::drawing::{Theme, Xfrm};
use office_core::formats::dml::{read_para_props, read_run_props};
use office_core::model::{ParaProps, RunProps};
use office_core::opc::{rels::kind, Package};
use office_core::xml::{ns, Element};
use office_core::Result;

/// Formatting for each of the nine outline levels (`a:lvl1pPr`…`a:lvl9pPr`).
pub type Levels = Vec<(ParaProps, RunProps)>;

/// Reads a list style (`a:lstStyle`, `p:titleStyle`, `p:defaultTextStyle`…).
pub fn levels(el: Option<&Element>) -> Levels {
    (1..=9)
        .map(|n| {
            let lvl = el.and_then(|e| e.child(ns::A, &format!("lvl{n}pPr")));
            (
                lvl.map(read_para_props).unwrap_or_default(),
                lvl.and_then(|l| l.child(ns::A, "defRPr")).map(read_run_props).unwrap_or_default(),
            )
        })
        .collect()
}

#[derive(Clone, Debug)]
pub struct Placeholder {
    /// `title`, `body`, `ctrTitle`, `subTitle`, `dt`, `ftr`, `sldNum`, `pic`, `obj`… (`body`
    /// when the file doesn't say).
    pub kind: String,
    pub index: Option<u32>,
    pub name: String,
    pub xfrm: Option<Xfrm>,
    pub levels: Levels,
}

/// A layout or a master.
#[derive(Clone, Debug)]
pub struct Template {
    pub part: String,
    pub name: String,
    /// A layout's type (`title`, `obj`, `twoObj`, `blank`…); `None` for a master.
    pub layout_type: Option<String>,
    /// For a layout, its master.
    pub master: Option<String>,
    pub placeholders: Vec<Placeholder>,
    /// A master's color map, or a layout's override of it: (`bg1`, `lt1`)…
    pub color_map: Vec<(String, String)>,
    /// A master's text styles: title, body, other.
    pub title: Levels,
    pub body: Levels,
    pub other: Levels,
    /// A master's theme.
    pub theme: Option<Theme>,
}

impl Template {
    pub fn read(pkg: &Package, part: &str) -> Result<Template> {
        let xml = pkg.xml(part)?;
        let root = &xml.root;
        let c_sld = root.child(ns::P, "cSld");
        let tree = c_sld.and_then(|c| c.child(ns::P, "spTree"));
        let placeholders = tree.into_iter().flat_map(|t| t.elements()).filter_map(read_placeholder).collect();
        let is_master = root.is(ns::P, "sldMaster");
        let map_el = if is_master {
            root.child(ns::P, "clrMap")
        } else {
            root.path(ns::P, &["clrMapOvr"]).and_then(|o| o.child(ns::A, "overrideClrMapping"))
        };
        let color_map = map_el
            .map(|m| m.attrs.iter().filter(|a| !a.is_ns_decl()).map(|a| (a.local.clone(), a.value.clone())).collect())
            .unwrap_or_default();
        let styles = root.child(ns::P, "txStyles");
        let style = |name: &str| levels(styles.and_then(|s| s.child(ns::P, name)));
        let theme = if is_master {
            match pkg.related(part, kind::THEME)?.into_iter().next() {
                Some((_, t)) if pkg.has(&t) => Theme::parse(&pkg.xml(&t)?),
                _ => None,
            }
        } else {
            None
        };
        Ok(Template {
            part: part.to_string(),
            name: c_sld.and_then(|c| c.attr("name")).unwrap_or("").to_string(),
            layout_type: (!is_master).then(|| root.attr("type").unwrap_or("cust").to_string()),
            master: if is_master { None } else { pkg.related(part, kind::SLIDE_MASTER)?.into_iter().next().map(|(_, m)| m) },
            placeholders,
            color_map,
            title: style("titleStyle"),
            body: style("bodyStyle"),
            other: style("otherStyle"),
            theme,
        })
    }

    /// The placeholder a slide's placeholder (`kind`, `index`) takes from here: the same
    /// index, else the same kind (titles match titles; anything else, the body).
    pub fn matching(&self, kind: &str, index: Option<u32>) -> Option<&Placeholder> {
        if let Some(i) = index {
            if let Some(p) = self.placeholders.iter().find(|p| p.index == Some(i)) {
                return Some(p);
            }
        }
        let fam = family(kind);
        self.placeholders
            .iter()
            .find(|p| p.kind == kind)
            .or_else(|| self.placeholders.iter().find(|p| family(&p.kind) == fam && fam != "other"))
    }
}

/// Which of the master's text styles a placeholder kind uses.
pub fn family(kind: &str) -> &'static str {
    match kind {
        "title" | "ctrTitle" => "title",
        "dt" | "ftr" | "sldNum" | "hdr" => "other",
        _ => "body",
    }
}

fn read_placeholder(el: &Element) -> Option<Placeholder> {
    let nv = el.elements().find(|e| e.in_ns(ns::P) && e.local.starts_with("nv"))?;
    let ph = nv.path(ns::P, &["nvPr", "ph"])?;
    Some(Placeholder {
        kind: ph.attr("type").unwrap_or("body").to_string(),
        index: ph.attr("idx").and_then(|i| i.parse().ok()),
        name: nv.child(ns::P, "cNvPr").and_then(|c| c.attr("name")).unwrap_or("").to_string(),
        xfrm: el.child(ns::P, "spPr").and_then(|s| s.child(ns::A, "xfrm")).map(Xfrm::parse),
        levels: levels(el.path(ns::P, &["txBody"]).and_then(|b| b.child(ns::A, "lstStyle"))),
    })
}
