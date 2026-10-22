//! Laying out a paragraph: breaking its text into lines across a width, aligning them, placing
//! tabs, pictures and list labels, and working out each line's height. The same code lays out
//! a Word paragraph, the text in a PowerPoint shape and a wrapped spreadsheet cell.
//!
//! A layer describes the paragraph as a [`ParaSpec`]: its text with one character standing for
//! each object (a picture, a break, a field), and items saying what each stretch of that text
//! is. Offsets are byte offsets into that text, and they're also how positions and selections
//! address the paragraph.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use unicode_linebreak::{linebreaks, BreakOpportunity};

use crate::measure::{FontId, Fnv, Measure, Measurer, Metrics};
use crate::style::TextStyle;

/// A style's number in a [`Styles`] table.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct StyleId(pub u32);

/// The text styles a view has used, numbered so layouts and display lists can refer to them.
#[derive(Default)]
pub struct Styles {
    list: Vec<(TextStyle, FontId)>,
    index: HashMap<u64, Vec<u32>>,
}

impl Styles {
    pub fn new() -> Styles {
        Styles::default()
    }

    pub fn add(&mut self, measure: &mut Measure, style: TextStyle) -> StyleId {
        let key = style_hash(&style);
        if let Some(ids) = self.index.get(&key) {
            if let Some(id) = ids.iter().find(|&&i| self.list[i as usize].0 == style) {
                return StyleId(*id);
            }
        }
        let id = self.list.len() as u32;
        let font = measure.font_id(&style.font);
        self.list.push((style, font));
        self.index.entry(key).or_default().push(id);
        StyleId(id)
    }

    pub fn get(&self, id: StyleId) -> &TextStyle {
        &self.list[id.0 as usize].0
    }

    pub fn font(&self, id: StyleId) -> FontId {
        self.list[id.0 as usize].1
    }

    pub fn len(&self) -> usize {
        self.list.len()
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &TextStyle> {
        self.list.iter().map(|(s, _)| s)
    }
}

fn style_hash(s: &TextStyle) -> u64 {
    let mut h = Fnv(0xcbf2_9ce4_8422_2325);
    s.font.hash(&mut h);
    (s.color.rgb, s.color.alpha.to_bits(), s.highlight.map(|c| (c.rgb, c.alpha.to_bits()))).hash(&mut h);
    (&s.underline, s.strike.map(|x| x as u8), s.baseline.map(|x| x as u8), s.caps, s.small_caps, s.link).hash(&mut h);
    h.finish()
}

/// What a stretch of a paragraph's text is.
#[derive(Clone, Debug, PartialEq)]
pub enum ItemKind {
    Text(StyleId),
    /// A tab character.
    Tab(StyleId),
    /// A line break (`\n`).
    Break(StyleId),
    /// A page break: ends the line, and the layer starts a new page after it.
    PageBreak,
    ColumnBreak,
    /// A picture or other box sitting on the baseline. `inline` is its index in the model
    /// paragraph's content, for drawing it.
    Object { width: f64, height: f64, inline: u32 },
    /// Something drawn as text but edited as one character: a field's result.
    Atomic { text: String, style: StyleId, inline: u32 },
    /// Kept in the text but not drawn (markup with nothing to show: a bookmark).
    Hidden,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub start: u32,
    pub end: u32,
    pub kind: ItemKind,
}

#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Spacing {
    /// A multiple of the line's natural height.
    Multiple(f64),
    Exactly(f64),
    AtLeast(f64),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum TabKind {
    Left,
    Center,
    Right,
    Decimal,
}

#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Tab {
    pub pos: f64,
    pub kind: TabKind,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
    Justify,
}

/// A list label (a number or a bullet) drawn in front of the first line.
#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    pub text: String,
    pub style: StyleId,
}

/// A paragraph to lay out. Lengths in pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct ParaSpec {
    pub text: String,
    pub items: Vec<Item>,
    pub align: Align,
    pub indent_start: f64,
    pub indent_end: f64,
    /// Extra indent of the first line; negative hangs it.
    pub first_line: f64,
    pub space_before: f64,
    pub space_after: f64,
    pub spacing: Spacing,
    pub tabs: Vec<Tab>,
    pub default_tab: f64,
    pub label: Option<Label>,
    /// The paragraph mark's style: how tall an empty paragraph is.
    pub mark: StyleId,
    /// Single spacing includes the font's line gap (Word's does; PowerPoint's doesn't).
    pub line_gap: bool,
}

impl ParaSpec {
    /// A paragraph of plain text in one style, left aligned and single spaced.
    pub fn plain(text: &str, style: StyleId) -> ParaSpec {
        let mut items = Vec::new();
        let mut start = 0;
        for (i, c) in text.char_indices() {
            let kind = match c {
                '\t' => ItemKind::Tab(style),
                '\n' => ItemKind::Break(style),
                _ => continue,
            };
            if i > start {
                items.push(Item { start: start as u32, end: i as u32, kind: ItemKind::Text(style) });
            }
            items.push(Item { start: i as u32, end: i as u32 + 1, kind });
            start = i + 1;
        }
        if text.len() > start {
            items.push(Item { start: start as u32, end: text.len() as u32, kind: ItemKind::Text(style) });
        }
        ParaSpec {
            text: text.to_string(),
            items,
            align: Align::Left,
            indent_start: 0.0,
            indent_end: 0.0,
            first_line: 0.0,
            space_before: 0.0,
            space_after: 0.0,
            spacing: Spacing::Multiple(1.0),
            tabs: Vec::new(),
            default_tab: 48.0,
            label: None,
            mark: style,
            line_gap: true,
        }
    }

    /// A hash of everything that decides the layout, for caching layouts across edits.
    pub fn key(&self, width: f64) -> u64 {
        let mut h = Fnv(0xcbf2_9ce4_8422_2325);
        self.text.hash(&mut h);
        for it in &self.items {
            (it.start, it.end).hash(&mut h);
            match &it.kind {
                ItemKind::Text(s) => (0u8, s).hash(&mut h),
                ItemKind::Tab(s) => (1u8, s).hash(&mut h),
                ItemKind::Break(s) => (2u8, s).hash(&mut h),
                ItemKind::PageBreak => 3u8.hash(&mut h),
                ItemKind::ColumnBreak => 4u8.hash(&mut h),
                ItemKind::Object { width, height, inline } => (5u8, width.to_bits(), height.to_bits(), inline).hash(&mut h),
                ItemKind::Atomic { text, style, inline } => (6u8, text, style, inline).hash(&mut h),
                ItemKind::Hidden => 7u8.hash(&mut h),
            }
        }
        (self.align as u8, self.indent_start.to_bits(), self.indent_end.to_bits(), self.first_line.to_bits()).hash(&mut h);
        (self.space_before.to_bits(), self.space_after.to_bits(), self.default_tab.to_bits(), width.to_bits()).hash(&mut h);
        match self.spacing {
            Spacing::Multiple(v) => (0u8, v.to_bits()).hash(&mut h),
            Spacing::Exactly(v) => (1u8, v.to_bits()).hash(&mut h),
            Spacing::AtLeast(v) => (2u8, v.to_bits()).hash(&mut h),
        }
        for t in &self.tabs {
            (t.pos.to_bits(), t.kind as u8).hash(&mut h);
        }
        self.label.as_ref().map(|l| (&l.text, l.style)).hash(&mut h);
        (self.mark, self.line_gap).hash(&mut h);
        h.finish()
    }

    fn item_at(&self, offset: u32) -> Option<&Item> {
        let i = self.items.partition_point(|it| it.end <= offset);
        self.items.get(i).filter(|it| it.start <= offset)
    }
}

/// How a line ends.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum LineEnd {
    /// The text ran on past the width.
    Wrap,
    /// A line break.
    Break,
    PageBreak,
    ColumnBreak,
    /// The end of the paragraph.
    Para,
}

#[derive(Clone, Debug, PartialEq)]
pub enum FragKind {
    Text(StyleId),
    Tab(StyleId),
    Object { inline: u32, height: f64 },
    Atomic { text: String, style: StyleId, inline: u32 },
    Label { text: String, style: StyleId },
}

/// A piece of a line: a stretch of text in one style, a tab, a picture, a label.
#[derive(Clone, Debug, PartialEq)]
pub struct Frag {
    pub x: f64,
    pub width: f64,
    pub start: u32,
    pub end: u32,
    pub kind: FragKind,
    /// Extra space after each space character, from justifying the line.
    pub space: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// From the top of the paragraph's first line (space before isn't counted).
    pub top: f64,
    pub height: f64,
    /// From the line's top.
    pub baseline: f64,
    pub start: u32,
    pub end: u32,
    pub frags: Vec<Frag>,
    pub ends: LineEnd,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParaLayout {
    pub width: f64,
    pub lines: Vec<Line>,
    pub space_before: f64,
    pub space_after: f64,
    /// The lines' height, without the space before and after.
    pub height: f64,
}

/// What laying out needs: the host's measurer, the engine's cache in front of it, and the styles.
pub struct Ctx<'a> {
    pub host: &'a mut dyn Measurer,
    pub measure: &'a mut Measure,
    pub styles: &'a mut Styles,
}

impl Ctx<'_> {
    fn width(&mut self, style: StyleId, text: &str) -> f64 {
        let s = self.styles.get(style);
        let font = self.styles.font(style);
        if s.caps || s.small_caps {
            let upper = s.transform(text).into_owned();
            self.measure.width(self.host, font, &upper)
        } else {
            self.measure.width(self.host, font, text)
        }
    }

    fn metrics(&mut self, style: StyleId) -> (Metrics, f64) {
        let s = self.styles.get(style);
        let shift = s.baseline_shift();
        let font = self.styles.font(style);
        let m = self.measure.metrics(self.host, font);
        if s.baseline.is_some() {
            // Raised or lowered text sits inside the line its full size would make.
            let scale = 1.0 / crate::style::SCRIPT_SCALE;
            let full = Metrics { ascent: m.ascent * scale, descent: m.descent * scale, gap: m.gap * scale };
            let lifted = Metrics { ascent: m.ascent + shift, descent: m.descent - shift, gap: m.gap };
            (Metrics { ascent: full.ascent.max(lifted.ascent), descent: full.descent.max(lifted.descent), gap: m.gap * scale }, shift)
        } else {
            (m, 0.0)
        }
    }

    /// Width of `text` from `start` within an item of this kind; for tabs and objects their laid
    /// out width counts as a whole.
    pub fn text_width(&mut self, style: StyleId, text: &str) -> f64 {
        self.width(style, text)
    }
}

/// A piece of text that can't be broken inside, with what follows it.
#[derive(Clone, Debug)]
struct Piece {
    start: u32,
    end: u32,
    /// Without trailing spaces.
    width: f64,
    /// Of trailing spaces, which may hang past the line's end.
    trailing: f64,
    kind: PieceKind,
    /// A line may break after this piece.
    break_after: bool,
}

#[derive(Clone, Debug)]
enum PieceKind {
    Text(StyleId),
    Tab(StyleId),
    Object { inline: u32, height: f64 },
    Atomic { text: String, style: StyleId, inline: u32 },
    End(LineEnd, Option<StyleId>),
    Hidden,
}

/// Lays `spec` out across `width` pixels.
pub fn layout(ctx: &mut Ctx, spec: &ParaSpec, width: f64) -> ParaLayout {
    let pieces = pieces(ctx, spec);
    let mut b = Builder { ctx, spec, width, lines: Vec::new(), frags: Vec::new(), x: 0.0, line_start: 0, top: 0.0, pending_tabs: Vec::new() };
    b.start_line(true);
    let mut i = 0;
    while i < pieces.len() {
        // The run of pieces up to the next break opportunity is a word: it moves to the next
        // line whole unless it doesn't fit on one by itself.
        let mut j = i;
        while !pieces[j].break_after && j + 1 < pieces.len() && !matches!(pieces[j + 1].kind, PieceKind::End(..) | PieceKind::Tab(_)) {
            j += 1;
        }
        if let PieceKind::End(end, style) = pieces[i].kind {
            b.finish_line(pieces[i].start, pieces[i].end, end, style);
            if end != LineEnd::Para {
                b.start_line(false);
            }
            i += 1;
            continue;
        }
        if let PieceKind::Tab(style) = pieces[i].kind {
            b.place_tab(&pieces[i], style);
            i += 1;
            continue;
        }
        let word = &pieces[i..=j];
        let word_width: f64 = word.iter().take(word.len() - 1).map(|p| p.width + p.trailing).sum::<f64>() + word[word.len() - 1].width;
        let limit = b.right();
        if b.x + word_width > limit + 0.01 && b.has_content() {
            let at = word[0].start;
            b.finish_line(at, at, LineEnd::Wrap, None);
            b.start_line(false);
        }
        if b.x + word_width > b.right() + 0.01 && !b.has_content() {
            // Longer than a whole line: break it between characters.
            for p in word {
                b.place_split(p);
            }
        } else {
            for p in word {
                b.place(p);
            }
        }
        i = j + 1;
    }
    let height = b.lines.last().map(|l| l.top + l.height).unwrap_or(0.0);
    ParaLayout { width, lines: b.lines, space_before: spec.space_before, space_after: spec.space_after, height }
}

fn pieces(ctx: &mut Ctx, spec: &ParaSpec) -> Vec<Piece> {
    let text = spec.text.as_str();
    let breaks: Vec<u32> =
        linebreaks(text).filter(|(_, o)| *o == BreakOpportunity::Allowed || *o == BreakOpportunity::Mandatory).map(|(i, _)| i as u32).collect();
    let can_break = |at: u32| breaks.binary_search(&at).is_ok();
    let mut out = Vec::with_capacity(spec.items.len() * 4);
    for item in &spec.items {
        match &item.kind {
            ItemKind::Text(style) => {
                let lo = breaks.partition_point(|&b| b <= item.start);
                let mut start = item.start;
                let mut cuts: Vec<u32> = breaks[lo..].iter().copied().take_while(|&b| b < item.end).collect();
                cuts.push(item.end);
                for cut in cuts {
                    if cut <= start {
                        continue;
                    }
                    let seg = &text[start as usize..cut as usize];
                    let body = seg.trim_end_matches(' ');
                    let spaces = seg.len() - body.len();
                    let width = ctx.width(*style, body);
                    let trailing = if spaces > 0 { ctx.width(*style, " ") * spaces as f64 } else { 0.0 };
                    out.push(Piece { start, end: cut, width, trailing, kind: PieceKind::Text(*style), break_after: can_break(cut) });
                    start = cut;
                }
            }
            ItemKind::Tab(style) => out.push(Piece { start: item.start, end: item.end, width: 0.0, trailing: 0.0, kind: PieceKind::Tab(*style), break_after: true }),
            ItemKind::Break(style) => out.push(Piece {
                start: item.start,
                end: item.end,
                width: 0.0,
                trailing: 0.0,
                kind: PieceKind::End(LineEnd::Break, Some(*style)),
                break_after: true,
            }),
            ItemKind::PageBreak | ItemKind::ColumnBreak => {
                let end = if item.kind == ItemKind::PageBreak { LineEnd::PageBreak } else { LineEnd::ColumnBreak };
                out.push(Piece { start: item.start, end: item.end, width: 0.0, trailing: 0.0, kind: PieceKind::End(end, None), break_after: true })
            }
            ItemKind::Object { width, height, inline } => out.push(Piece {
                start: item.start,
                end: item.end,
                width: *width,
                trailing: 0.0,
                kind: PieceKind::Object { inline: *inline, height: *height },
                break_after: true,
            }),
            ItemKind::Atomic { text: shown, style, inline } => {
                let width = ctx.width(*style, shown);
                out.push(Piece {
                    start: item.start,
                    end: item.end,
                    width,
                    trailing: 0.0,
                    kind: PieceKind::Atomic { text: shown.clone(), style: *style, inline: *inline },
                    break_after: can_break(item.end),
                })
            }
            ItemKind::Hidden => out.push(Piece { start: item.start, end: item.end, width: 0.0, trailing: 0.0, kind: PieceKind::Hidden, break_after: can_break(item.end) }),
        }
    }
    let end = text.len() as u32;
    out.push(Piece { start: end, end, width: 0.0, trailing: 0.0, kind: PieceKind::End(LineEnd::Para, None), break_after: true });
    out
}

struct Builder<'a, 'b, 'c> {
    ctx: &'a mut Ctx<'b>,
    spec: &'c ParaSpec,
    width: f64,
    lines: Vec<Line>,
    frags: Vec<Frag>,
    x: f64,
    line_start: u32,
    top: f64,
    /// Center, right and decimal tabs on this line: (frag index, stop, kind).
    pending_tabs: Vec<(usize, f64, TabKind)>,
}

impl Builder<'_, '_, '_> {
    fn left(&self, first: bool) -> f64 {
        self.spec.indent_start + if first { self.spec.first_line } else { 0.0 }
    }

    fn right(&self) -> f64 {
        (self.width - self.spec.indent_end).max(self.x.min(self.width))
    }

    fn has_content(&self) -> bool {
        self.frags.iter().any(|f| !matches!(f.kind, FragKind::Label { .. }))
    }

    fn start_line(&mut self, first: bool) {
        self.frags.clear();
        self.pending_tabs.clear();
        self.x = self.left(first);
        if first {
            if let Some(label) = &self.spec.label {
                // The label hangs at the first line's indent; the text starts at the paragraph's
                // indent, or the next tab stop if the label runs past it (Word's tab after the
                // number).
                let w = self.ctx.width(label.style, &label.text);
                let at = self.x;
                self.frags.push(Frag {
                    x: at,
                    width: w,
                    start: 0,
                    end: 0,
                    kind: FragKind::Label { text: label.text.clone(), style: label.style },
                    space: 0.0,
                });
                let after = at + w;
                self.x = if after < self.spec.indent_start - 0.5 { self.spec.indent_start } else { self.next_stop(after).0 };
            }
        }
    }

    /// The next tab stop after `x`: a set stop, or the next default one.
    fn next_stop(&self, x: f64) -> (f64, TabKind) {
        if let Some(t) = self.spec.tabs.iter().find(|t| t.pos > x + 0.5) {
            return (t.pos, t.kind);
        }
        let step = if self.spec.default_tab > 1.0 { self.spec.default_tab } else { 48.0 };
        (((x + 0.5) / step).floor() * step + step, TabKind::Left)
    }

    fn place(&mut self, p: &Piece) {
        let (kind, width) = match &p.kind {
            PieceKind::Text(s) => (FragKind::Text(*s), p.width + p.trailing),
            PieceKind::Object { inline, height } => (FragKind::Object { inline: *inline, height: *height }, p.width),
            PieceKind::Atomic { text, style, inline } => (FragKind::Atomic { text: text.clone(), style: *style, inline: *inline }, p.width),
            PieceKind::Hidden => return,
            PieceKind::Tab(_) | PieceKind::End(..) => unreachable!(),
        };
        // Text in the same style as the last fragment joins it.
        if let (FragKind::Text(s), Some(last)) = (&kind, self.frags.last_mut()) {
            if last.kind == FragKind::Text(*s) && last.end == p.start {
                last.end = p.end;
                last.width += width;
                self.x += width;
                return;
            }
        }
        self.frags.push(Frag { x: self.x, width, start: p.start, end: p.end, kind, space: 0.0 });
        self.x += width;
    }

    /// Places a piece too long for a line, character by character, breaking lines as it fills.
    fn place_split(&mut self, p: &Piece) {
        let PieceKind::Text(style) = p.kind else {
            if self.x + p.width > self.right() && self.has_content() {
                self.finish_line(p.start, p.start, LineEnd::Wrap, None);
                self.start_line(false);
            }
            return self.place(p);
        };
        let text = &self.spec.text[p.start as usize..p.end as usize];
        let mut seg_start = p.start;
        let mut iter = text.char_indices().peekable();
        while let Some((i, _)) = iter.next() {
            let next = iter.peek().map(|(n, _)| *n).unwrap_or(text.len());
            let upto = &self.spec.text[seg_start as usize..p.start as usize + next];
            let w = self.ctx.width(style, upto);
            if self.x + w > self.right() + 0.01 && (p.start as usize + i) as u32 > seg_start {
                let at = p.start + i as u32;
                let done = &self.spec.text[seg_start as usize..at as usize];
                let dw = self.ctx.width(style, done);
                self.place(&Piece { start: seg_start, end: at, width: dw, trailing: 0.0, kind: PieceKind::Text(style), break_after: false });
                self.finish_line(at, at, LineEnd::Wrap, None);
                self.start_line(false);
                seg_start = at;
            }
        }
        let rest = &self.spec.text[seg_start as usize..p.end as usize];
        let body = rest.trim_end_matches(' ');
        let w = self.ctx.width(style, body);
        let trailing = if rest.len() > body.len() { self.ctx.width(style, " ") * (rest.len() - body.len()) as f64 } else { 0.0 };
        self.place(&Piece { start: seg_start, end: p.end, width: w, trailing, kind: PieceKind::Text(style), break_after: p.break_after });
    }

    fn place_tab(&mut self, p: &Piece, style: StyleId) {
        let (stop, kind) = self.next_stop(self.x);
        if stop > self.right() + 0.5 && self.has_content() {
            // No stop left on the line: the tab moves to the next line, like a word.
            self.finish_line(p.start, p.start, LineEnd::Wrap, None);
            self.start_line(false);
            return self.place_tab(p, style);
        }
        self.resolve_tabs();
        let width = if kind == TabKind::Left { (stop - self.x).max(0.0) } else { 0.0 };
        if kind != TabKind::Left {
            self.pending_tabs.push((self.frags.len(), stop, kind));
        }
        self.frags.push(Frag { x: self.x, width, start: p.start, end: p.end, kind: FragKind::Tab(style), space: 0.0 });
        self.x += width;
    }

    /// Sizes the center, right and decimal tabs waiting on the text after them.
    fn resolve_tabs(&mut self) {
        for (index, stop, kind) in std::mem::take(&mut self.pending_tabs) {
            let after: f64 = self.frags[index + 1..].iter().map(|f| f.width).sum();
            let tab_x = self.frags[index].x;
            let want = match kind {
                TabKind::Center => stop - after / 2.0,
                _ => stop - after,
            };
            let width = (want - tab_x).max(0.0);
            self.frags[index].width = width;
            let mut x = tab_x + width;
            for f in &mut self.frags[index + 1..] {
                f.x = x;
                x += f.width;
            }
            self.x = x;
        }
    }

    fn finish_line(&mut self, end_start: u32, end_end: u32, ends: LineEnd, break_style: Option<StyleId>) {
        self.resolve_tabs();
        let first = self.lines.is_empty();
        let mut frags = std::mem::take(&mut self.frags);
        // Trailing spaces hang past the end: they don't count for alignment.
        let mut content_end = self.x;
        if let Some(last) = frags.iter().rev().find(|f| !matches!(f.kind, FragKind::Label { .. })) {
            if let FragKind::Text(s) = last.kind {
                let text = &self.spec.text[last.start as usize..last.end as usize];
                let spaces = text.len() - text.trim_end_matches(' ').len();
                if spaces > 0 {
                    content_end = last.x + last.width - self.ctx.width(s, " ") * spaces as f64;
                }
            }
        }
        let left = self.left(first);
        let free = (self.width - self.spec.indent_end - content_end).max(0.0);
        let shift = match self.spec.align {
            Align::Center => free / 2.0,
            Align::Right => free,
            _ => 0.0,
        };
        if self.spec.align == Align::Justify && ends == LineEnd::Wrap && free > 0.0 {
            let stretch_from = frags.iter().rposition(|f| matches!(f.kind, FragKind::Tab(_))).map(|i| i + 1).unwrap_or(0);
            let count = |f: &Frag| -> usize {
                let text = &self.spec.text[f.start as usize..f.end as usize];
                match f.kind {
                    FragKind::Text(_) => text.matches(' ').count(),
                    _ => 0,
                }
            };
            let last_index = frags.len().saturating_sub(1);
            let mut spaces: usize = frags[stretch_from..].iter().map(count).sum();
            if let Some(last) = frags.get(last_index) {
                let text = &self.spec.text[last.start as usize..last.end as usize];
                spaces -= text.len() - text.trim_end_matches(' ').len();
            }
            if spaces > 0 {
                let each = free / spaces as f64;
                let mut add = 0.0;
                for (i, f) in frags.iter_mut().enumerate().skip(stretch_from) {
                    f.x += add;
                    if let FragKind::Text(_) = f.kind {
                        let text = &self.spec.text[f.start as usize..f.end as usize];
                        let mut n = text.matches(' ').count();
                        if i == last_index {
                            n -= text.len() - text.trim_end_matches(' ').len();
                        }
                        f.space = each;
                        f.width += each * n as f64;
                        add += each * n as f64;
                    }
                }
            }
        } else if shift > 0.0 {
            for f in &mut frags {
                f.x += shift;
            }
        }
        let _ = left;

        // Height: the tallest text and objects on the line, then line spacing.
        let mut ascent: f64 = 0.0;
        let mut descent: f64 = 0.0;
        let mut gap: f64 = 0.0;
        let mut any = false;
        for f in &frags {
            match &f.kind {
                FragKind::Text(s) | FragKind::Tab(s) | FragKind::Atomic { style: s, .. } | FragKind::Label { style: s, .. } => {
                    let (m, _) = self.ctx.metrics(*s);
                    ascent = ascent.max(m.ascent);
                    descent = descent.max(m.descent);
                    gap = gap.max(m.gap);
                    any = true;
                }
                FragKind::Object { height, .. } => {
                    ascent = ascent.max(*height);
                    any = true;
                }
            }
        }
        if !any || frags.iter().all(|f| matches!(f.kind, FragKind::Object { .. })) {
            let (m, _) = self.ctx.metrics(break_style.unwrap_or(self.spec.mark));
            if !any {
                ascent = m.ascent;
            }
            descent = descent.max(m.descent);
            gap = gap.max(m.gap);
        }
        // The line gap goes above the text, as Word puts it.
        let natural = ascent + descent + if self.spec.line_gap { gap } else { 0.0 };
        let (height, baseline) = match self.spec.spacing {
            Spacing::Multiple(m) => {
                let h = natural * m;
                (h, h - descent)
            }
            Spacing::Exactly(h) => (h, if natural > 0.0 { h * ascent / natural } else { h * 0.8 }),
            Spacing::AtLeast(h) => {
                let h = h.max(natural);
                (h, h - descent)
            }
        };
        let start = self.line_start;
        let end = if ends == LineEnd::Wrap { end_start } else { end_end };
        let _ = end_start;
        self.lines.push(Line { top: self.top, height, baseline, start, end, frags, ends });
        self.top += height;
        self.line_start = end;
    }
}

// ---- positions in a laid-out paragraph ----

impl ParaLayout {
    /// The line an offset is on. An offset where a line wraps belongs to the next line, unless
    /// `before` asks for the end of the earlier one (the caret after the last character typed).
    pub fn line_of(&self, offset: u32, before: bool) -> usize {
        for (i, l) in self.lines.iter().enumerate() {
            let last = i + 1 == self.lines.len();
            if offset < l.end || last || (offset == l.end && (before || l.ends != LineEnd::Wrap)) {
                if offset == l.end && l.ends != LineEnd::Wrap && l.ends != LineEnd::Para && !before && !last {
                    // Right after a line break: the next line.
                    return i + 1;
                }
                return i;
            }
        }
        0
    }

    /// Where the caret for `offset` stands: x from the paragraph's left, and the line.
    pub fn caret(&self, ctx: &mut Ctx, spec: &ParaSpec, offset: u32, before: bool) -> (f64, usize) {
        let li = self.line_of(offset, before);
        let line = &self.lines[li];
        (x_in_line(ctx, spec, line, offset), li)
    }

    /// The offset nearest `x` on line `li`.
    pub fn offset_at(&self, ctx: &mut Ctx, spec: &ParaSpec, li: usize, x: f64) -> u32 {
        let line = &self.lines[li.min(self.lines.len() - 1)];
        let frags: Vec<&Frag> = line.frags.iter().filter(|f| !matches!(f.kind, FragKind::Label { .. })).collect();
        // The end of a wrapped line is the start of the next; a click past it goes before its
        // trailing space instead.
        let line_end = if line.ends == LineEnd::Wrap {
            let text = &spec.text[line.start as usize..line.end as usize];
            let trimmed = text.trim_end_matches(' ').len();
            if trimmed < text.len() {
                line.start + trimmed as u32
            } else {
                prev_boundary(&spec.text, line.end).max(line.start)
            }
        } else {
            line.end
        };
        let Some(first) = frags.first() else { return line.start };
        if x <= first.x {
            return first.start;
        }
        for f in &frags {
            if x >= f.x + f.width {
                continue;
            }
            return match f.kind {
                FragKind::Text(_) => {
                    let mut best = f.start;
                    let mut prev_x = f.x;
                    let text = &spec.text[f.start as usize..f.end as usize];
                    for (i, c) in text.char_indices() {
                        let next = f.start + (i + c.len_utf8()) as u32;
                        let nx = x_in_line(ctx, spec, line, next);
                        if x < (prev_x + nx) / 2.0 {
                            return best;
                        }
                        best = next;
                        prev_x = nx;
                    }
                    best.min(line_end)
                }
                _ => {
                    if x < f.x + f.width / 2.0 {
                        f.start
                    } else {
                        f.end.min(line_end)
                    }
                }
            };
        }
        line_end
    }
}

/// The x of `offset` on `line`.
pub fn x_in_line(ctx: &mut Ctx, spec: &ParaSpec, line: &Line, offset: u32) -> f64 {
    let mut last_x = None;
    for f in &line.frags {
        if matches!(f.kind, FragKind::Label { .. }) {
            continue;
        }
        if offset < f.start {
            return last_x.unwrap_or(f.x);
        }
        if offset <= f.end {
            if offset == f.start {
                return f.x;
            }
            return match f.kind {
                FragKind::Text(style) => {
                    let part = &spec.text[f.start as usize..offset as usize];
                    let spaces = part.matches(' ').count() as f64;
                    f.x + ctx.width(style, part) + spaces * f.space
                }
                _ => f.x + f.width,
            };
        }
        last_x = Some(f.x + f.width);
    }
    last_x.unwrap_or_else(|| {
        // An empty line: where its text would start.
        let first = line.start == 0;
        let base = spec.indent_start + if first { spec.first_line } else { 0.0 };
        match spec.align {
            Align::Center => (base + spec.indent_end.max(0.0)).max(base),
            _ => base,
        }
    })
}

/// The character boundary before `offset`.
pub fn prev_boundary(text: &str, offset: u32) -> u32 {
    let mut i = (offset as usize).min(text.len());
    if i == 0 {
        return 0;
    }
    i -= 1;
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i as u32
}

/// The character boundary after `offset`.
pub fn next_boundary(text: &str, offset: u32) -> u32 {
    let mut i = offset as usize + 1;
    if i >= text.len() {
        return text.len() as u32;
    }
    while i < text.len() && !text.is_char_boundary(i) {
        i += 1;
    }
    i as u32
}

/// The word around `offset`: letters and digits, or a run of anything else that isn't space.
pub fn word_at(text: &str, offset: u32) -> (u32, u32) {
    let kind = |c: char| if c.is_alphanumeric() || c == '_' || c == '\'' || c == '’' { 1 } else if c.is_whitespace() { 0 } else { 2 };
    let at = (offset as usize).min(text.len());
    let after = text[at..].chars().next();
    let before = text[..at].chars().next_back();
    let k = match (before.map(kind), after.map(kind)) {
        (_, Some(1)) | (Some(1), _) => 1,
        (_, Some(k)) if k != 0 => k,
        (Some(k), _) => k,
        _ => return (offset, offset),
    };
    let start = text[..at].char_indices().rev().take_while(|(_, c)| kind(*c) == k).last().map(|(i, _)| i).unwrap_or(at);
    let end = at + text[at..].chars().take_while(|c| kind(*c) == k).map(char::len_utf8).sum::<usize>();
    (start as u32, end as u32)
}

/// Where a word movement from `offset` lands: the start of the previous word, or the end of
/// the next, as Option-arrow (Ctrl-arrow) does.
pub fn word_move(text: &str, offset: u32, forward: bool) -> u32 {
    let at = (offset as usize).min(text.len());
    if forward {
        let rest = &text[at..];
        let skip_space: usize = rest.chars().take_while(|c| !c.is_alphanumeric()).map(char::len_utf8).sum();
        let word: usize = rest[skip_space..].chars().take_while(|c| c.is_alphanumeric() || *c == '\'' || *c == '’').map(char::len_utf8).sum();
        (at + skip_space + word) as u32
    } else {
        let head = &text[..at];
        let skip_space: usize = head.chars().rev().take_while(|c| !c.is_alphanumeric()).map(char::len_utf8).sum();
        let word: usize =
            head[..at - skip_space].chars().rev().take_while(|c| c.is_alphanumeric() || *c == '\'' || *c == '’').map(char::len_utf8).sum();
        (at - skip_space - word) as u32
    }
}

impl Item {
    pub fn style(&self) -> Option<StyleId> {
        match &self.kind {
            ItemKind::Text(s) | ItemKind::Tab(s) | ItemKind::Break(s) => Some(*s),
            ItemKind::Atomic { style, .. } => Some(*style),
            _ => None,
        }
    }
}

impl ParaSpec {
    /// The style text typed at `offset` would show in, before any formatting is applied: the
    /// text before it, or the mark's in an empty paragraph.
    pub fn style_at(&self, offset: u32) -> StyleId {
        let before = if offset > 0 { self.item_at(offset - 1).and_then(Item::style) } else { None };
        before.or_else(|| self.item_at(offset).and_then(Item::style)).unwrap_or(self.mark)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::measure::FixedMeasurer;
    use office_core::drawing::{Rgb, Rgba};
    use office_core::model::RunProps;
    use office_core::units::FontSize;

    fn setup() -> (FixedMeasurer, Measure, Styles, StyleId) {
        let mut measure = Measure::new();
        let mut styles = Styles::new();
        // 10 px text: 5 px per character, 2.5 per space; ascent 8, descent 2.
        let props = RunProps { size: Some(FontSize::from_points(7.5)), ..Default::default() };
        let s = styles.add(&mut measure, TextStyle::from_props(&props, 10.0, &|_| Rgba { rgb: Rgb::BLACK, alpha: 1.0 }));
        (FixedMeasurer::default(), measure, styles, s)
    }

    fn lines_text(spec: &ParaSpec, l: &ParaLayout) -> Vec<String> {
        l.lines.iter().map(|line| spec.text[line.start as usize..line.end as usize].to_string()).collect()
    }

    #[test]
    fn wraps_at_spaces() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let spec = ParaSpec::plain("aaaa bbbb cccc dddd", s);
        // 4 letters = 20 px, a space 2.5: two words fit in 45 px.
        let l = layout(&mut ctx, &spec, 45.0);
        assert_eq!(lines_text(&spec, &l), vec!["aaaa bbbb ", "cccc dddd"]);
        assert_eq!(l.lines[0].height, 10.0);
        assert_eq!(l.lines[1].top, 10.0);
        assert_eq!(l.height, 20.0);
        assert_eq!(l.lines[0].ends, LineEnd::Wrap);
        assert_eq!(l.lines[1].ends, LineEnd::Para);
    }

    #[test]
    fn breaks_long_words_between_characters() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let spec = ParaSpec::plain("abcdefghij", s);
        let l = layout(&mut ctx, &spec, 22.0);
        assert_eq!(lines_text(&spec, &l), vec!["abcd", "efgh", "ij"]);
    }

    #[test]
    fn line_breaks_and_empty_paragraphs() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let spec = ParaSpec::plain("one\ntwo", s);
        let l = layout(&mut ctx, &spec, 500.0);
        assert_eq!(lines_text(&spec, &l), vec!["one\n", "two"]);
        assert_eq!(l.lines[0].ends, LineEnd::Break);
        let empty = layout(&mut ctx, &ParaSpec::plain("", s), 500.0);
        assert_eq!(empty.lines.len(), 1);
        assert_eq!(empty.height, 10.0);
    }

    #[test]
    fn alignment_and_justification() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let mut spec = ParaSpec::plain("ab cd", s);
        spec.align = Align::Right;
        let l = layout(&mut ctx, &spec, 100.0);
        // "ab cd" is 22.5 px wide.
        assert_eq!(l.lines[0].frags[0].x, 77.5);
        spec.align = Align::Center;
        let l = layout(&mut ctx, &spec, 100.0);
        assert_eq!(l.lines[0].frags[0].x, 38.75);

        let mut spec = ParaSpec::plain("aa bb cc dd ee", s);
        spec.align = Align::Justify;
        let l = layout(&mut ctx, &spec, 40.0);
        // First line "aa bb cc " (trailing space hangs): 35 px of content, 5 px spread over 2 spaces.
        let f = &l.lines[0].frags[0];
        assert_eq!(f.space, 2.5);
        // The last line isn't stretched.
        assert_eq!(l.lines.last().unwrap().frags[0].space, 0.0);
    }

    #[test]
    fn tabs_and_labels() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let mut spec = ParaSpec::plain("a\tb", s);
        spec.default_tab = 48.0;
        let l = layout(&mut ctx, &spec, 500.0);
        assert_eq!(l.lines[0].frags[1].width, 43.0);
        assert_eq!(l.lines[0].frags[2].x, 48.0);

        spec.tabs = vec![Tab { pos: 200.0, kind: TabKind::Right }];
        let l = layout(&mut ctx, &spec, 500.0);
        let b = &l.lines[0].frags[2];
        assert_eq!(b.x + b.width, 200.0);

        let mut spec = ParaSpec::plain("item", s);
        spec.indent_start = 24.0;
        spec.first_line = -24.0;
        spec.label = Some(Label { text: "1.".into(), style: s });
        let l = layout(&mut ctx, &spec, 500.0);
        assert_eq!(l.lines[0].frags[0].x, 0.0);
        assert_eq!(l.lines[0].frags[1].x, 24.0);
    }

    #[test]
    fn spacing() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let mut spec = ParaSpec::plain("x", s);
        spec.spacing = Spacing::Multiple(2.0);
        let l = layout(&mut ctx, &spec, 100.0);
        assert_eq!((l.lines[0].height, l.lines[0].baseline), (20.0, 18.0));
        spec.spacing = Spacing::Exactly(30.0);
        assert_eq!(layout(&mut ctx, &spec, 100.0).lines[0].height, 30.0);
        spec.spacing = Spacing::AtLeast(4.0);
        assert_eq!(layout(&mut ctx, &spec, 100.0).lines[0].height, 10.0);
    }

    #[test]
    fn objects_sit_on_the_baseline() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let mut spec = ParaSpec::plain("a\u{FFFC}b", s);
        spec.items = vec![
            Item { start: 0, end: 1, kind: ItemKind::Text(s) },
            Item { start: 1, end: 4, kind: ItemKind::Object { width: 50.0, height: 40.0, inline: 1 } },
            Item { start: 4, end: 5, kind: ItemKind::Text(s) },
        ];
        let l = layout(&mut ctx, &spec, 500.0);
        assert_eq!(l.lines[0].height, 42.0);
        assert_eq!(l.lines[0].baseline, 40.0);
        assert_eq!(l.lines[0].frags[2].x, 55.0);
    }

    #[test]
    fn carets_and_hits() {
        let (mut host, mut measure, mut styles, s) = setup();
        let mut ctx = Ctx { host: &mut host, measure: &mut measure, styles: &mut styles };
        let spec = ParaSpec::plain("aaaa bbbb cccc", s);
        let l = layout(&mut ctx, &spec, 45.0);
        // Offset 10 is where line two starts.
        assert_eq!(l.caret(&mut ctx, &spec, 10, false), (0.0, 1));
        assert_eq!(l.caret(&mut ctx, &spec, 10, true).1, 0);
        assert_eq!(l.caret(&mut ctx, &spec, 2, false), (10.0, 0));
        assert_eq!(l.offset_at(&mut ctx, &spec, 0, 11.0), 2);
        assert_eq!(l.offset_at(&mut ctx, &spec, 0, 12.6), 3);
        // Past the end of a wrapped line: before its trailing space.
        assert_eq!(l.offset_at(&mut ctx, &spec, 0, 44.0), 9);
        assert_eq!(l.offset_at(&mut ctx, &spec, 1, 400.0), 14);
    }

    #[test]
    fn words() {
        assert_eq!(word_at("hello, world", 2), (0, 5));
        assert_eq!(word_at("hello, world", 5), (0, 5));
        assert_eq!(word_at("hello, world", 7), (7, 12));
        assert_eq!(word_move("hello, world", 0, true), 5);
        assert_eq!(word_move("hello, world", 5, true), 12);
        assert_eq!(word_move("hello, world", 12, false), 7);
        assert_eq!(word_move("hello, world", 7, false), 0);
    }

    #[test]
    fn layout_keys_follow_content() {
        let (_, _, _, s) = setup();
        let a = ParaSpec::plain("abc", s);
        let mut b = a.clone();
        assert_eq!(a.key(100.0), b.key(100.0));
        assert_ne!(a.key(100.0), a.key(101.0));
        b.align = Align::Center;
        assert_ne!(a.key(100.0), b.key(100.0));
    }
}
