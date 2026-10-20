//! DrawingML text (`a:p`, `a:r`, `a:rPr`, `a:pPr`): the text in PowerPoint's shapes and table
//! cells, and in Word's and Excel's drawings.

use super::common::{rel_attr, shell, PartRels};
use crate::drawing::Color;
use crate::model::{
    underline_from_drawingml, Align, Baseline, Inline, LineSpacing, Link, ParaProps, Paragraph, Run, RunProps, Strike, TextBody,
};
use crate::units::{parse_bool, Emu, FontSize, Percent};
use crate::xml::{ns, Element};

/// Reads `p:txBody`/`a:txBody`. The body's `a:bodyPr` and `a:lstStyle` stay in its origin.
pub fn read_text_body(el: &Element, rels: Option<&PartRels>) -> TextBody {
    TextBody {
        paragraphs: el.children_named(ns::A, "p").map(|p| read_paragraph(p, rels)).collect(),
        origin: shell(el, |c| c.is(ns::A, "p")),
    }
}

pub fn read_paragraph(p: &Element, rels: Option<&PartRels>) -> Paragraph {
    let mut content = Vec::new();
    for child in p.elements() {
        if !child.in_ns(ns::A) {
            content.push(Inline::Raw { xml: child.clone() });
            continue;
        }
        match child.local.as_str() {
            "pPr" | "endParaRPr" => {}
            "r" | "br" => {
                let rpr = child.child(ns::A, "rPr");
                let text =
                    if child.local == "br" { "\n".to_string() } else { child.child(ns::A, "t").map(Element::text).unwrap_or_default() };
                content.push(Inline::Text(Run {
                    text,
                    props: rpr.map(read_run_props).unwrap_or_default(),
                    link: rpr.and_then(|r| read_link(r, rels)),
                    origin: shell(child, |c| c.is(ns::A, "t")),
                }));
            }
            // Fields (slide numbers, dates) and anything else, whole.
            _ => content.push(Inline::Raw { xml: child.clone() }),
        }
    }
    Paragraph {
        props: p.child(ns::A, "pPr").map(read_para_props).unwrap_or_default(),
        content,
        mark: p.child(ns::A, "endParaRPr").map(read_run_props),
        origin: shell(p, |c| !(c.is(ns::A, "pPr") || c.is(ns::A, "endParaRPr"))),
    }
}

/// `a:rPr`, `a:endParaRPr` or `a:defRPr`.
pub fn read_run_props(el: &Element) -> RunProps {
    let face = |local: &str| el.child(ns::A, local).and_then(|f| f.attr("typeface")).filter(|f| !f.is_empty()).map(str::to_string);
    let (mut caps, mut small_caps) = (None, None);
    match el.attr("cap") {
        Some("all") => caps = Some(true),
        Some("small") => small_caps = Some(true),
        Some("none") => {
            caps = Some(false);
            small_caps = Some(false);
        }
        _ => {}
    }
    RunProps {
        font: face("latin"),
        font_east_asian: face("ea"),
        font_complex: face("cs"),
        size: el.attr("sz").and_then(|s| s.parse().ok()).map(FontSize),
        bold: el.attr("b").and_then(parse_bool),
        italic: el.attr("i").and_then(parse_bool),
        underline: el.attr("u").map(|u| underline_from_drawingml(u).to_string()),
        strike: el.attr("strike").map(|s| match s {
            "sngStrike" => Strike::Single,
            "dblStrike" => Strike::Double,
            _ => Strike::None,
        }),
        caps,
        small_caps,
        color: el.child(ns::A, "solidFill").and_then(Color::in_drawingml),
        highlight: el.child(ns::A, "highlight").and_then(Color::in_drawingml),
        baseline: el.attr("baseline").and_then(Percent::parse).and_then(|b| match b.0.signum() {
            1 => Some(Baseline::Superscript),
            -1 => Some(Baseline::Subscript),
            _ => None,
        }),
        style: None,
        lang: el.attr("lang").map(str::to_string),
    }
}

/// A run's `a:hlinkClick` to a URL. Clicks that jump to a slide or run an action stay in the
/// run's origin for the PowerPoint layer.
fn read_link(rpr: &Element, rels: Option<&PartRels>) -> Option<Link> {
    let click = rpr.child(ns::A, "hlinkClick")?;
    if click.attr("action").is_some_and(|a| !a.is_empty() && !a.starts_with("ppaction://hlinkfile")) {
        return None;
    }
    let url = rels.and_then(|r| r.url(rel_attr(click, "id")?))?;
    Some(Link { url: Some(url), anchor: None, tooltip: click.attr("tooltip").map(str::to_string) })
}

pub fn read_para_props(el: &Element) -> ParaProps {
    let emu = |k: &str| el.attr(k).and_then(|v| Emu::parse(v, 1));
    let spacing = |local: &str| {
        el.child(ns::A, local).and_then(|s| s.child(ns::A, "spcPts")).and_then(|p| p.attr("val")).and_then(|v| v.parse::<f64>().ok())
    };
    ParaProps {
        style: None,
        align: el.attr("algn").and_then(|a| {
            Some(match a {
                "l" => Align::Left,
                "ctr" => Align::Center,
                "r" => Align::Right,
                "just" | "justLow" => Align::Justify,
                "dist" | "thaiDist" => Align::Distribute,
                _ => return None,
            })
        }),
        level: el.attr("lvl").and_then(|l| l.parse().ok()),
        indent_start: emu("marL"),
        indent_end: emu("marR"),
        indent_first_line: emu("indent"),
        space_before: spacing("spcBef").map(|p| Emu::from_points(p / 100.0)),
        space_after: spacing("spcAft").map(|p| Emu::from_points(p / 100.0)),
        line_spacing: el.child(ns::A, "lnSpc").and_then(|l| {
            if let Some(pct) = l.child(ns::A, "spcPct").and_then(|p| p.attr("val")).and_then(Percent::parse) {
                Some(LineSpacing::Multiple(pct))
            } else {
                let pts = l.child(ns::A, "spcPts")?.attr("val")?.parse::<f64>().ok()?;
                Some(LineSpacing::Exactly(Emu::from_points(pts / 100.0)))
            }
        }),
        rtl: el.attr("rtl").and_then(parse_bool),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawing::Rgb;
    use crate::xml::parse_element;

    fn p(inner: &str) -> Paragraph {
        read_paragraph(&parse_element(&format!(r#"<a:p xmlns:a="{}">{inner}</a:p>"#, ns::A)).unwrap(), None)
    }

    #[test]
    fn reads_runs_and_breaks() {
        let para = p(
            r#"<a:pPr algn="ctr" lvl="1" marL="457200" indent="-228600"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-GB" sz="2400" b="1" u="sng" strike="dblStrike" cap="small" baseline="30000"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr><a:t>Big</a:t></a:r><a:br><a:rPr sz="2400"/></a:br><a:r><a:t>next</a:t></a:r><a:fld id="{X}" type="slidenum"><a:t>3</a:t></a:fld><a:endParaRPr lang="en-GB" sz="1800"/>"#,
        );
        assert_eq!(para.props.align, Some(Align::Center));
        assert_eq!(para.props.level, Some(1));
        assert_eq!(para.props.indent_first_line, Some(Emu(-228_600)));
        assert_eq!(para.props.line_spacing, Some(LineSpacing::Multiple(Percent(150_000))));
        assert_eq!(para.props.space_before, Some(Emu::from_points(6.0)));
        let runs: Vec<&Run> = para.runs().collect();
        assert_eq!(runs.iter().map(|r| r.text.as_str()).collect::<Vec<_>>(), ["Big", "\n", "next"]);
        let big = &runs[0].props;
        assert_eq!(big.size, Some(FontSize(2400)));
        assert_eq!(big.bold, Some(true));
        assert_eq!(big.underline.as_deref(), Some("single"));
        assert_eq!(big.strike, Some(Strike::Double));
        assert_eq!(big.small_caps, Some(true));
        assert_eq!(big.baseline, Some(Baseline::Superscript));
        assert_eq!(big.font.as_deref(), Some("Georgia"));
        assert_eq!(big.color, Some(Color::rgb(Rgb(255, 0, 0))));
        assert_eq!(big.lang.as_deref(), Some("en-GB"));
        assert!(matches!(para.content[3], Inline::Raw { .. }), "the field is kept whole");
        assert_eq!(para.mark.as_ref().unwrap().size, Some(FontSize(1800)));
        assert_eq!(para.plain_text(), "Big\nnext");
        // The bullet isn't modeled; it stays in the origin's pPr.
        assert!(para.origin.get().unwrap().descendant(ns::A, "buChar").is_some());
        assert!(para.origin.get().unwrap().child(ns::A, "r").is_none());
    }
}
