//! Shape properties (`a:spPr`, `pic:spPr`, `xdr:spPr`…): where a drawing object sits, its
//! outline geometry, fill and line. The same element appears in all three formats.

use serde::{Deserialize, Serialize};

use super::color::Color;
use crate::units::{parse_bool, Angle, Emu};
use crate::xml::{ns, Element};

/// The children of `a:spPr`, in schema order.
const SP_PR: &[&[&str]] = &[
    &["xfrm"],
    &["custGeom", "prstGeom"],
    &["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"],
    &["ln"],
    &["effectLst", "effectDag"],
    &["scene3d"],
    &["sp3d"],
    &["extLst"],
];

const LN: &[&[&str]] = &[
    &["noFill", "solidFill", "gradFill", "pattFill"],
    &["prstDash", "custDash"],
    &["round", "bevel", "miter"],
    &["headEnd"],
    &["tailEnd"],
    &["extLst"],
];

/// `a:xfrm`: position and size in EMUs, rotation, flips; for groups, the child coordinate space.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Xfrm {
    pub x: Emu,
    pub y: Emu,
    pub width: Emu,
    pub height: Emu,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rotation: Angle,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub flip_h: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub flip_v: bool,
    /// A group's `a:chOff` and `a:chExt`: the rectangle its children's coordinates are in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child: Option<(Emu, Emu, Emu, Emu)>,
}

fn is_zero(a: &Angle) -> bool {
    a.0 == 0
}

impl Xfrm {
    /// Reads `a:xfrm` or `p:xfrm` (graphic frames use PresentationML's own element).
    pub fn parse(el: &Element) -> Xfrm {
        let pair = |name: &str, a: &str, b: &str| {
            el.elements().find(|e| e.local == name).map(|e| {
                let n = |k: &str| e.attr(k).and_then(|v| Emu::parse(v, 1)).unwrap_or_default();
                (n(a), n(b))
            })
        };
        let (x, y) = pair("off", "x", "y").unwrap_or_default();
        let (width, height) = pair("ext", "cx", "cy").unwrap_or_default();
        let child = match (pair("chOff", "x", "y"), pair("chExt", "cx", "cy")) {
            (Some((cx, cy)), Some((cw, ch))) => Some((cx, cy, cw, ch)),
            _ => None,
        };
        let flag = |k: &str| el.attr(k).and_then(parse_bool).unwrap_or(false);
        Xfrm {
            x,
            y,
            width,
            height,
            rotation: Angle(el.attr("rot").and_then(|r| r.parse().ok()).unwrap_or(0)),
            flip_h: flag("flipH"),
            flip_v: flag("flipV"),
            child,
        }
    }

    /// Writes the element in `ns` (DrawingML's for shapes, PresentationML's for graphic frames).
    pub fn to_xml(&self, ns: &str) -> Element {
        let mut el = Element::new(ns, "xfrm");
        if self.rotation.0 != 0 {
            el.set_attr("", "rot", self.rotation.0.to_string());
        }
        if self.flip_h {
            el.set_attr("", "flipH", "1");
        }
        if self.flip_v {
            el.set_attr("", "flipV", "1");
        }
        let pair = |name: &str, a: &str, va: Emu, b: &str, vb: Emu| {
            Element::new(ns::A, name).with_attr("", a, va.0.to_string()).with_attr("", b, vb.0.to_string())
        };
        el.push(pair("off", "x", self.x, "y", self.y));
        el.push(pair("ext", "cx", self.width, "cy", self.height));
        if let Some((cx, cy, cw, ch)) = self.child {
            el.push(pair("chOff", "x", cx, "y", cy));
            el.push(pair("chExt", "cx", cw, "cy", ch));
        }
        el
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Fill {
    None,
    Solid {
        color: Color,
    },
    /// Gradients, patterns, pictures and group fills, as XML for now.
    Other {
        xml: Element,
    },
}

impl Fill {
    /// Reads a fill element, or `None` if `el` isn't one.
    pub fn parse(el: &Element) -> Option<Fill> {
        if !el.in_ns(ns::A) {
            return None;
        }
        Some(match el.local.as_str() {
            "noFill" => Fill::None,
            "solidFill" => match Color::in_drawingml(el) {
                Some(color) => Fill::Solid { color },
                None => Fill::Other { xml: el.clone() },
            },
            "gradFill" | "blipFill" | "pattFill" | "grpFill" => Fill::Other { xml: el.clone() },
            _ => return None,
        })
    }

    /// The first fill among `parent`'s children.
    pub fn in_children(parent: &Element) -> Option<Fill> {
        parent.elements().find_map(Fill::parse)
    }

    pub fn to_xml(&self) -> Element {
        match self {
            Fill::None => Element::new(ns::A, "noFill"),
            Fill::Solid { color } => Element::new(ns::A, "solidFill").with_child(color.to_drawingml()),
            Fill::Other { xml } => xml.clone(),
        }
    }
}

/// `a:ln`: an outline.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<Emu>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    /// A preset dash: `solid`, `dash`, `sysDot`…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash: Option<String>,
}

impl Line {
    pub fn parse(el: &Element) -> Line {
        Line {
            width: el.attr("w").and_then(|w| Emu::parse(w, 1)),
            fill: Fill::in_children(el),
            dash: el.child(ns::A, "prstDash").and_then(|d| d.attr("val")).map(str::to_string),
        }
    }

    /// Updates `el` (an existing `a:ln`, or a new one) to say what `self` says, changing only
    /// what differs from `before`.
    pub fn patch(&self, before: &Line, el: &mut Element) {
        if self.width != before.width {
            match self.width {
                Some(w) => el.set_attr("", "w", w.0.to_string()),
                None => {
                    el.remove_attr("", "w");
                }
            }
        }
        if self.fill != before.fill {
            match &self.fill {
                Some(f) => el.place(f.to_xml(), LN),
                None => el.clear(ns::A, LN[0]),
            }
        }
        if self.dash != before.dash {
            match &self.dash {
                Some(d) => el.place(Element::new(ns::A, "prstDash").with_attr("", "val", d), LN),
                None => el.clear(ns::A, LN[1]),
            }
        }
    }
}

/// What the model reads from `spPr`. Effects, 3D and anything else stay in the element.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeProps {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xfrm: Option<Xfrm>,
    /// A preset outline (`rect`, `roundRect`, `ellipse`…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Line>,
}

impl ShapeProps {
    pub fn parse(sp_pr: &Element) -> ShapeProps {
        ShapeProps {
            xfrm: sp_pr.child(ns::A, "xfrm").map(Xfrm::parse),
            preset: sp_pr.child(ns::A, "prstGeom").and_then(|g| g.attr("prst")).map(str::to_string),
            fill: Fill::in_children(sp_pr),
            line: sp_pr.child(ns::A, "ln").map(Line::parse),
        }
    }

    /// Writes `self` into `sp_pr` (the element it was read from, or a new one), touching only
    /// the properties that differ from what `sp_pr` says now. A custom geometry is kept unless
    /// `preset` changes.
    pub fn patch(&self, sp_pr: &mut Element) {
        let before = ShapeProps::parse(sp_pr);
        if self.xfrm != before.xfrm {
            match &self.xfrm {
                Some(x) => sp_pr.place(x.to_xml(ns::A), SP_PR),
                None => sp_pr.clear(ns::A, SP_PR[0]),
            }
        }
        if self.preset != before.preset {
            match &self.preset {
                Some(p) => {
                    let geom = Element::new(ns::A, "prstGeom").with_attr("", "prst", p).with_child(Element::new(ns::A, "avLst"));
                    sp_pr.place(geom, SP_PR);
                }
                None => sp_pr.clear(ns::A, &["prstGeom"]),
            }
        }
        if self.fill != before.fill {
            match &self.fill {
                Some(f) => sp_pr.place(f.to_xml(), SP_PR),
                None => sp_pr.clear(ns::A, SP_PR[2]),
            }
        }
        if self.line != before.line {
            match &self.line {
                Some(line) => {
                    let mut ln = sp_pr.child(ns::A, "ln").cloned().unwrap_or_else(|| Element::new(ns::A, "ln"));
                    line.patch(&before.line.clone().unwrap_or_default(), &mut ln);
                    sp_pr.place(ln, SP_PR);
                }
                None => sp_pr.clear(ns::A, SP_PR[3]),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawing::color::Rgb;
    use crate::xml::parse_element;

    fn sp_pr(inner: &str) -> Element {
        parse_element(&format!(r#"<p:spPr xmlns:p="{}" xmlns:a="{}">{inner}</p:spPr>"#, ns::P, ns::A)).unwrap()
    }

    #[test]
    fn reads_shape_properties() {
        let el = sp_pr(
            r#"<a:xfrm rot="5400000" flipH="1"><a:off x="914400" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:ln w="12700"><a:noFill/></a:ln><a:effectLst/>"#,
        );
        let props = ShapeProps::parse(&el);
        let x = props.xfrm.as_ref().unwrap();
        assert_eq!((x.x, x.width, x.rotation, x.flip_h), (Emu(914400), Emu(1828800), Angle::from_degrees(90.0), true));
        assert_eq!(props.preset.as_deref(), Some("roundRect"));
        assert_eq!(props.fill, Some(Fill::Solid { color: Color::scheme("accent2") }));
        assert_eq!(props.line, Some(Line { width: Some(Emu(12700)), fill: Some(Fill::None), dash: None }));
    }

    #[test]
    fn patching_changes_only_what_changed() {
        let mut el = sp_pr(r#"<a:custGeom><a:pathLst/></a:custGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst/>"#);
        let untouched = el.clone();
        let mut props = ShapeProps::parse(&el);
        props.patch(&mut el);
        assert_eq!(el, untouched, "nothing changed, nothing written");

        props.fill = Some(Fill::Solid { color: Color::rgb(Rgb(0, 0x80, 0)) });
        props.xfrm = Some(Xfrm { width: Emu(100), height: Emu(200), ..Default::default() });
        props.line = Some(Line { dash: Some("dash".into()), ..Default::default() });
        props.patch(&mut el);
        let names: Vec<_> = el.elements().map(|e| e.local.as_str()).collect();
        assert_eq!(names, ["xfrm", "custGeom", "solidFill", "ln", "effectLst"]);
        assert_eq!(ShapeProps::parse(&el), props);
    }

    #[test]
    fn group_transforms() {
        let el = parse_element(&format!(
            r#"<a:xfrm xmlns:a="{}"><a:off x="1" y="2"/><a:ext cx="3" cy="4"/><a:chOff x="5" y="6"/><a:chExt cx="7" cy="8"/></a:xfrm>"#,
            ns::A
        ))
        .unwrap();
        let x = Xfrm::parse(&el);
        assert_eq!(x.child, Some((Emu(5), Emu(6), Emu(7), Emu(8))));
        assert_eq!(Xfrm::parse(&x.to_xml(ns::A)), x);
    }
}
