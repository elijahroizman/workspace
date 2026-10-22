//! Editing a model paragraph by offsets into its flat text: what layout and positions use.
//!
//! The flat text is the paragraph's runs' text, with one character for each object: U+FFFC for
//! a picture or raw markup (a field, a bookmark), U+000C for a page break, U+000B for a column
//! break. So every object can be selected and deleted like a character.

use office_core::model::{BreakKind, Inline, Paragraph, Run, RunProps};

pub const OBJECT: char = '\u{FFFC}';
pub const PAGE_BREAK: char = '\u{C}';
pub const COLUMN_BREAK: char = '\u{B}';

/// The paragraph's flat text, and where each inline sits in it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Flat {
    pub text: String,
    pub spans: Vec<(u32, u32)>,
}

pub fn flat(p: &Paragraph) -> Flat {
    let mut text = String::new();
    let mut spans = Vec::with_capacity(p.content.len());
    for inline in &p.content {
        let start = text.len() as u32;
        match inline {
            Inline::Text(r) => text.push_str(&r.text),
            Inline::Break { kind: BreakKind::Page } => text.push(PAGE_BREAK),
            Inline::Break { kind: BreakKind::Column } => text.push(COLUMN_BREAK),
            Inline::Image(_) | Inline::Raw { .. } => text.push(OBJECT),
        }
        spans.push((start, text.len() as u32));
    }
    Flat { text, spans }
}

/// Length of an inline in flat text.
pub fn inline_len(inline: &Inline) -> u32 {
    match inline {
        Inline::Text(r) => r.text.len() as u32,
        Inline::Break { .. } => 1,
        Inline::Image(_) | Inline::Raw { .. } => OBJECT.len_utf8() as u32,
    }
}

pub fn len(p: &Paragraph) -> u32 {
    p.content.iter().map(inline_len).sum()
}

/// Splits the run that `offset` falls inside, so an inline starts there, and returns its index
/// (the content's length if `offset` is the end). An offset inside an object counts as before it.
pub fn boundary(p: &mut Paragraph, offset: u32) -> usize {
    let mut at = 0;
    for i in 0..p.content.len() {
        let n = inline_len(&p.content[i]);
        if offset <= at {
            return i;
        }
        if offset < at + n {
            if let Inline::Text(run) = &mut p.content[i] {
                let mut cut = (offset - at) as usize;
                while !run.text.is_char_boundary(cut) {
                    cut -= 1;
                }
                let tail = run.text.split_off(cut);
                let second = Run { text: tail, props: run.props.clone(), link: run.link.clone(), origin: run.origin.clone() };
                p.content.insert(i + 1, Inline::Text(second));
                return i + 1;
            }
            return i;
        }
        at += n;
    }
    p.content.len()
}

/// The run formatting at `offset`: of the text before it, or after it at the paragraph's start,
/// or the paragraph mark's in an empty paragraph. What typing there starts with.
pub fn props_at(p: &Paragraph, offset: u32) -> RunProps {
    let mut at = 0;
    let mut before: Option<&Run> = None;
    let mut after: Option<&Run> = None;
    for inline in &p.content {
        let n = inline_len(inline);
        if let Inline::Text(r) = inline {
            if at < offset && (offset <= at + n) {
                before = Some(r);
            }
            if after.is_none() && at >= offset {
                after = Some(r);
            }
        }
        at += n;
    }
    before.or(after).map(|r| r.props.clone()).or_else(|| p.mark.clone()).unwrap_or_default()
}

/// The link on the text before `offset`, if text typed there should join it: only inside a
/// link, not at its end (typing after a link isn't part of it).
fn link_inside(p: &Paragraph, offset: u32) -> Option<office_core::model::Link> {
    let mut at = 0;
    for inline in &p.content {
        let n = inline_len(inline);
        if let Inline::Text(r) = inline {
            if at < offset && offset < at + n {
                return r.link.clone();
            }
        }
        at += n;
    }
    None
}

/// The formatting text typed at `offset` takes: the text before it's, except right after a link,
/// where it's the text's before the link (typing after a link isn't part of it and shouldn't
/// look like it either).
pub fn typing_props(p: &Paragraph, offset: u32) -> RunProps {
    let mut at = 0;
    let mut last_plain: Option<&Run> = None;
    let mut before: Option<&Run> = None;
    for inline in &p.content {
        let n = inline_len(inline);
        if at >= offset {
            break;
        }
        if let Inline::Text(r) = inline {
            if at + n >= offset {
                before = Some(r);
            }
            if r.link.is_none() && at + n <= offset {
                last_plain = Some(r);
            }
        }
        at += n;
    }
    match before {
        Some(r) if r.link.is_some() && at == offset => match last_plain {
            Some(plain) => plain.props.clone(),
            None => {
                let mut props = r.props.clone();
                props.color = None;
                props.underline = None;
                if props.style.as_deref() == Some("Hyperlink") {
                    props.style = None;
                }
                props
            }
        },
        _ => props_at(p, offset),
    }
}

/// Inserts `text` at `offset`. With `props`, the new text has that formatting; without, the
/// formatting typing there gets (see [`typing_props`]).
pub fn insert_text(p: &mut Paragraph, offset: u32, text: &str, props: Option<&RunProps>) {
    if text.is_empty() {
        return;
    }
    let props = props.cloned().unwrap_or_else(|| typing_props(p, offset));
    let link = link_inside(p, offset);
    // Extend the run the text lands in or at the end of, when it looks the same.
    let mut at = 0;
    for i in 0..p.content.len() {
        let n = inline_len(&p.content[i]);
        if let Inline::Text(run) = &mut p.content[i] {
            if at <= offset && offset <= at + n && run.props == props && run.link == link && (offset < at + n || link.is_none()) {
                let mut cut = (offset - at) as usize;
                while !run.text.is_char_boundary(cut) {
                    cut -= 1;
                }
                run.text.insert_str(cut, text);
                return;
            }
        }
        at += n;
        if at > offset {
            break;
        }
    }
    let i = boundary(p, offset);
    p.content.insert(i, Inline::Text(Run { text: text.to_string(), props, link, ..Default::default() }));
}

/// Inserts an object (a picture, a break) at `offset`.
pub fn insert_inline(p: &mut Paragraph, offset: u32, inline: Inline) {
    let i = boundary(p, offset);
    p.content.insert(i, inline);
}

/// Removes the text and objects between two offsets.
pub fn delete(p: &mut Paragraph, from: u32, to: u32) {
    if to <= from {
        return;
    }
    let a = boundary(p, from);
    let b = boundary(p, to);
    p.content.drain(a..b);
    tidy(p, a);
}

/// Joins the runs either side of inline `at` if they look the same and came from the same
/// markup, and drops empty runs there.
fn tidy(p: &mut Paragraph, at: usize) {
    let lo = at.saturating_sub(1);
    let mut i = lo;
    while i + 1 < p.content.len() && i <= at {
        let join = match (&p.content[i], &p.content[i + 1]) {
            (Inline::Text(a), Inline::Text(b)) => a.props == b.props && a.link == b.link && a.origin.id() == b.origin.id(),
            _ => false,
        };
        if join {
            let Inline::Text(b) = p.content.remove(i + 1) else { unreachable!() };
            if let Inline::Text(a) = &mut p.content[i] {
                a.text.push_str(&b.text);
            }
        } else {
            i += 1;
        }
    }
    p.content.retain(|x| !matches!(x, Inline::Text(r) if r.text.is_empty()));
}

/// The content between two offsets, as inlines.
pub fn slice(p: &Paragraph, from: u32, to: u32) -> Vec<Inline> {
    let mut copy = Paragraph { content: p.content.clone(), ..Default::default() };
    let b = boundary(&mut copy, to);
    copy.content.truncate(b);
    let a = boundary(&mut copy, from);
    copy.content.drain(..a);
    copy.content
}

/// Splits a paragraph at `offset`. The second half keeps the paragraph's properties and a new
/// origin, so it's written as a paragraph of its own; its mark takes the formatting at the cut.
pub fn split(p: &Paragraph, offset: u32) -> (Paragraph, Paragraph) {
    let mut first = p.clone();
    let i = boundary(&mut first, offset);
    let tail: Vec<Inline> = first.content.drain(i..).collect();
    let at_cut = props_at(p, offset);
    let second = Paragraph {
        props: p.props.clone(),
        content: tail,
        mark: (!at_cut.is_empty()).then_some(at_cut).or(p.mark.clone()),
        ..Default::default()
    };
    (first, second)
}

/// Appends `b`'s content to `a`, as deleting the break between two paragraphs does.
pub fn join(a: &mut Paragraph, b: Paragraph) {
    let at = a.content.len();
    if a.content.is_empty() && b.content.is_empty() {
        return;
    }
    a.content.extend(b.content);
    tidy(a, at);
}

/// Changes the formatting of the runs between two offsets. Objects are left alone. With an
/// empty range, the paragraph's mark changes, which is what an empty paragraph shows.
pub fn format(p: &mut Paragraph, from: u32, to: u32, f: &dyn Fn(&mut RunProps)) {
    if from >= to {
        if p.content.is_empty() || from == len(p) {
            let mut mark = p.mark.clone().unwrap_or_default();
            f(&mut mark);
            p.mark = Some(mark);
        }
        return;
    }
    let a = boundary(p, from);
    let b = boundary(p, to);
    for inline in &mut p.content[a..b] {
        if let Inline::Text(r) = inline {
            f(&mut r.props);
        }
    }
    if b == p.content.len() {
        let mut mark = p.mark.clone().unwrap_or_default();
        f(&mut mark);
        p.mark = Some(mark);
    }
    tidy(p, b);
    tidy(p, a);
}

/// Sets or removes the link on the text between two offsets.
pub fn set_link(p: &mut Paragraph, from: u32, to: u32, link: Option<office_core::model::Link>) {
    let a = boundary(p, from);
    let b = boundary(p, to);
    for inline in &mut p.content[a..b] {
        if let Inline::Text(r) = inline {
            r.link = link.clone();
        }
    }
    tidy(p, b);
    tidy(p, a);
}

/// The inline at `offset` and the offset it starts at.
pub fn inline_at(p: &Paragraph, offset: u32) -> Option<(usize, u32)> {
    let mut at = 0;
    for (i, inline) in p.content.iter().enumerate() {
        let n = inline_len(inline);
        if offset < at + n {
            return Some((i, at));
        }
        at += n;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use office_core::model::Image;
    use office_core::units::Emu;

    fn bold() -> RunProps {
        RunProps { bold: Some(true), ..Default::default() }
    }

    fn para(parts: &[(&str, bool)]) -> Paragraph {
        Paragraph {
            content: parts
                .iter()
                .map(|(t, b)| Inline::Text(Run::new(*t).with_props(if *b { bold() } else { RunProps::default() })))
                .collect(),
            ..Default::default()
        }
    }

    fn runs(p: &Paragraph) -> Vec<(String, bool)> {
        p.runs().map(|r| (r.text.clone(), r.props.bold == Some(true))).collect()
    }

    #[test]
    fn typing_extends_the_run_before() {
        let mut p = para(&[("Hello", false), (" world", true)]);
        insert_text(&mut p, 5, "!", None);
        assert_eq!(runs(&p), vec![("Hello!".into(), false), (" world".into(), true)]);
        insert_text(&mut p, 0, ">", None);
        assert_eq!(p.plain_text(), ">Hello! world");
        insert_text(&mut p, 3, "X", Some(&bold()));
        assert_eq!(runs(&p), vec![(">He".into(), false), ("X".into(), true), ("llo!".into(), false), (" world".into(), true)]);
    }

    #[test]
    fn delete_joins_matching_runs() {
        let mut p = para(&[("ab", false), ("cd", true), ("ef", false)]);
        delete(&mut p, 1, 5);
        assert_eq!(runs(&p), vec![("af".into(), false)]);
    }

    #[test]
    fn objects_are_one_character() {
        let mut p = para(&[("ab", false)]);
        let img = Inline::Image(Image {
            media: "m".into(),
            width: Emu(1),
            height: Emu(1),
            name: String::new(),
            description: None,
            origin: Default::default(),
        });
        insert_inline(&mut p, 1, img);
        let f = flat(&p);
        assert_eq!(f.text, "a\u{FFFC}b");
        assert_eq!(f.spans, vec![(0, 1), (1, 4), (4, 5)]);
        delete(&mut p, 1, 4);
        assert_eq!(runs(&p), vec![("ab".into(), false)]);
    }

    #[test]
    fn split_and_join() {
        let p = para(&[("one", false), ("two", true)]);
        let (a, b) = split(&p, 4);
        assert_eq!(a.plain_text(), "onet");
        assert_eq!(b.plain_text(), "wo");
        assert_eq!(b.mark.as_ref().and_then(|m| m.bold), Some(true));
        let mut a = a;
        join(&mut a, b);
        assert_eq!(runs(&a), vec![("one".into(), false), ("two".into(), true)]);
    }

    #[test]
    fn formatting_a_range() {
        let mut p = para(&[("abcdef", false)]);
        format(&mut p, 2, 4, &|r| r.bold = Some(true));
        assert_eq!(runs(&p), vec![("ab".into(), false), ("cd".into(), true), ("ef".into(), false)]);
        format(&mut p, 0, 6, &|r| r.bold = Some(true));
        assert_eq!(runs(&p), vec![("abcdef".into(), true)]);
        let mut empty = Paragraph::default();
        format(&mut empty, 0, 0, &|r| r.italic = Some(true));
        assert_eq!(empty.mark.unwrap().italic, Some(true));
    }

    #[test]
    fn typing_after_a_link_leaves_it() {
        let mut p = para(&[("see ", false)]);
        p.content.push(Inline::Text(Run {
            text: "here".into(),
            link: Some(office_core::model::Link { url: Some("https://x".into()), ..Default::default() }),
            ..Default::default()
        }));
        if let Some(Inline::Text(r)) = p.content.last_mut() {
            r.props.color = Some(office_core::drawing::Color::rgb(office_core::drawing::Rgb(5, 99, 193)));
        }
        insert_text(&mut p, 8, "!", None);
        assert_eq!(p.runs().last().unwrap().text, "!");
        assert!(p.runs().last().unwrap().link.is_none());
        assert!(p.runs().last().unwrap().props.color.is_none(), "takes the look of the text before the link");
        insert_text(&mut p, 6, "e", None);
        assert_eq!(p.runs().nth(1).unwrap().text, "heere");
    }

    #[test]
    fn multibyte_offsets() {
        let mut p = para(&[("héllo", false)]);
        insert_text(&mut p, 3, "x", Some(&bold()));
        assert_eq!(p.plain_text(), "héxllo");
        assert_eq!(slice(&p, 1, 4).len(), 2);
    }
}
