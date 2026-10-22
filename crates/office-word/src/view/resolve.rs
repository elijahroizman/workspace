//! How a Word paragraph or table looks: styles, lists, fields and pictures turned into what the
//! engine lays out.

use std::collections::HashMap;

use office_core::drawing::{Color, Rgb, Rgba, Theme};
use office_core::formats::docx::val;
use office_core::model::{Align, Block, Document, Inline, LineSpacing, Paragraph, RunProps, Table};
use office_core::units::Emu;
use office_core::xml::{ns, Element};
use office_engine::flow::{BorderLine, CellLook, Keep, Resolver, TableLook};
use office_engine::para::{self, Ctx, Item, ItemKind, Label, ParaSpec, Spacing, StyleId, Tab};
use office_engine::pos::{blocks_at, Path};
use office_engine::style::TextStyle;
use office_engine::text;

use super::extras::{Border, Borders, Extras, TableLookStyle};
use crate::{list_of, word, StyleKind};

pub fn emu_px(e: Emu) -> f64 {
    e.0 as f64 / 9525.0
}

/// Word's colors on screen: theme colors through the document's theme.
pub fn paint_color(theme: Option<&Theme>, c: &Color) -> Rgba {
    let scheme = |name: &str| -> Option<Rgb> {
        let theme = theme?;
        // Word's text and background names are the theme's dark and light slots.
        let slot = match name {
            "tx1" | "text1" => "dk1",
            "bg1" | "background1" => "lt1",
            "tx2" | "text2" => "dk2",
            "bg2" | "background2" => "lt2",
            "hyperlink" => "hlink",
            "followedHyperlink" => "folHlink",
            other => other,
        };
        theme.scheme_color(slot)
    };
    c.resolve(&scheme)
}

/// What a field shows while the view lays out a page: its page number and the page count.
#[derive(Copy, Clone, Debug, Default)]
pub struct PageFields {
    pub page: u32,
    pub pages: u32,
}

pub struct WordResolver<'a> {
    pub doc: &'a Document,
    pub extras: &'a Extras,
    /// The story being laid out (body, a header, a note), for looking at neighbors.
    pub story: &'a [Block],
    /// List labels by paragraph path, for this story.
    pub labels: &'a HashMap<Path, String>,
    pub fields: Option<PageFields>,
}

/// The default Word font size when nothing says (10 pt: Word's own default).
const DEFAULT_PX: f64 = 10.0 * 96.0 / 72.0;

impl<'a> WordResolver<'a> {
    fn theme(&self) -> Option<&'a Theme> {
        self.doc.theme.as_ref()
    }

    fn style(&self, ctx: &mut Ctx, props: &RunProps, link: bool) -> StyleId {
        let theme = self.theme();
        let mut s = TextStyle::from_props(props, DEFAULT_PX, &|c| paint_color(theme, c));
        s.link = link;
        ctx.styles.add(ctx.measure, s)
    }

    /// The run formatting text has in this paragraph, styles and table style included.
    fn run_props(&self, p: &Paragraph, direct: &RunProps, path: &Path) -> RunProps {
        let mut r = match word(self.doc) {
            Some(w) => w.styles.resolve_run(&p.props, direct, self.theme()),
            None => direct.clone(),
        };
        if let Some(part) = self.cell_part(path) {
            if part.bold.is_some() && direct.bold.is_none() {
                r.bold = part.bold;
            }
            if part.color.is_some() && direct.color.is_none() {
                r.color = part.color.clone();
            }
        }
        r
    }

    /// The conditional table-style part (header row, banded row…) the cell holding `path` is in.
    fn cell_part(&self, path: &Path) -> Option<super::extras::PartLook> {
        let (table_path, row, col) = path.cell()?;
        let Block::Table(t) = blocks_at(self.story, table_path.container())?.get(table_path.block() as usize)? else { return None };
        let look = self.table_style(t);
        let parts = cell_parts(t, row as usize, col as usize);
        let mut out: Option<super::extras::PartLook> = None;
        for name in parts.iter().rev() {
            if let Some(p) = look.parts.get(*name) {
                let o = out.get_or_insert_with(Default::default);
                if o.bold.is_none() {
                    o.bold = p.bold;
                }
                if o.color.is_none() {
                    o.color = p.color.clone();
                }
            }
        }
        out
    }

    fn table_style(&self, t: &Table) -> TableLookStyle {
        let id = t.style.as_deref().or(self.extras.default_table.as_deref());
        let mut look = id.and_then(|id| self.extras.table_styles.get(id)).cloned().unwrap_or_default();
        let own = TableLookStyle::read(t.origin.get().and_then(|o| o.child(ns::W, "tblPr")), None);
        look.overlay(&own);
        look
    }

    /// The paragraph next to `path` among its siblings, if it's a paragraph.
    fn sibling(&self, path: &Path, delta: i64) -> Option<&'a Paragraph> {
        let i = path.block() as i64 + delta;
        if i < 0 {
            return None;
        }
        match blocks_at(self.story, path.container())?.get(i as usize)? {
            Block::Paragraph(p) => Some(p),
            _ => None,
        }
    }

    fn para_style_id(&self, p: &Paragraph) -> Option<String> {
        p.props.style.clone().or_else(|| word(self.doc)?.styles.default_of(StyleKind::Paragraph).map(|s| s.id.clone()))
    }
}

/// Which conditional parts of a table style apply to a cell, from most to least specific, as
/// the table's `w:tblLook` turns them on.
fn cell_parts(t: &Table, row: usize, col: usize) -> Vec<&'static str> {
    let look = t.origin.get().and_then(|o| o.path(ns::W, &["tblPr", "tblLook"]));
    let flag = |name: &str, bit: u32, default: bool| -> bool {
        let Some(l) = look else { return default };
        if let Some(v) = l.attr_ns(ns::W, name) {
            return office_core::units::parse_bool(v).unwrap_or(default);
        }
        l.attr_ns(ns::W, "val").and_then(|v| u32::from_str_radix(v, 16).ok()).map(|v| v & bit != 0).unwrap_or(default)
    };
    let first_row = flag("firstRow", 0x0020, true);
    let last_row = flag("lastRow", 0x0040, false);
    let first_col = flag("firstColumn", 0x0080, true);
    let last_col = flag("lastColumn", 0x0100, false);
    let h_band = !flag("noHBand", 0x0200, false);
    let v_band = !flag("noVBand", 0x0400, true);
    let rows = t.rows.len();
    let cols = t.columns.len().max(1);
    let header_rows = if first_row { 1 } else { 0 };
    let mut out = Vec::new();
    if first_row && row == 0 {
        out.push("firstRow");
    } else if last_row && row + 1 == rows {
        out.push("lastRow");
    }
    if first_col && col == 0 {
        out.push("firstCol");
    } else if last_col && col + 1 == cols {
        out.push("lastCol");
    }
    if h_band && row >= header_rows {
        out.push(if (row - header_rows) % 2 == 0 { "band1Horz" } else { "band2Horz" });
    }
    if v_band {
        let first = if first_col { 1 } else { 0 };
        if col >= first {
            out.push(if (col - first) % 2 == 0 { "band1Vert" } else { "band2Vert" });
        }
    }
    out
}

/// What a raw inline shows, if anything.
enum RawShow {
    Hidden,
    Text(String),
    FieldBegin,
    FieldInstr(String),
    FieldSeparate,
    FieldEnd,
    Simple(String, String),
    /// A footnote or endnote reference mark.
    NoteRef(String),
}

fn raw_show(el: &Element) -> RawShow {
    if el.is(ns::W, "r") {
        if let Some(f) = el.child(ns::W, "fldChar") {
            return match f.attr_ns(ns::W, "fldCharType") {
                Some("begin") => RawShow::FieldBegin,
                Some("separate") => RawShow::FieldSeparate,
                _ => RawShow::FieldEnd,
            };
        }
        if let Some(i) = el.child(ns::W, "instrText") {
            return RawShow::FieldInstr(i.text());
        }
        if let Some(n) = el.child(ns::W, "footnoteReference").or_else(|| el.child(ns::W, "endnoteReference")) {
            return RawShow::NoteRef(n.attr_ns(ns::W, "id").unwrap_or("").to_string());
        }
        if el.child(ns::W, "vanish").is_some() || el.path(ns::W, &["rPr", "vanish"]).is_some() {
            return RawShow::Hidden;
        }
        let mut s = String::new();
        for c in el.elements() {
            match c.local.as_str() {
                "t" => s.push_str(&c.text()),
                "tab" | "ptab" => s.push('\t'),
                "br" | "cr" => s.push('\n'),
                "noBreakHyphen" => s.push('\u{2011}'),
                "softHyphen" => {}
                "sym" => {
                    if let Some(ch) = c.attr_ns(ns::W, "char").and_then(|h| u32::from_str_radix(h, 16).ok()).and_then(char::from_u32) {
                        s.push(match ch {
                            '\u{F0B7}' | '\u{F06C}' => '•',
                            c if ('\u{F000}'..='\u{F0FF}').contains(&c) => char::from_u32(c as u32 - 0xF000).unwrap_or(c),
                            c => c,
                        });
                    }
                }
                _ => {}
            }
        }
        return if s.is_empty() { RawShow::Hidden } else { RawShow::Text(s) };
    }
    if el.is(ns::W, "fldSimple") {
        let instr = el.attr_ns(ns::W, "instr").unwrap_or("").to_string();
        return RawShow::Simple(instr, el.text());
    }
    // Content controls, smart tags, inserted text in revisions: their text shows.
    if el.is(ns::W, "sdt") || el.is(ns::W, "smartTag") || el.is(ns::W, "ins") || el.is(ns::W, "customXml") || el.is(ns::W, "hyperlink") {
        let mut s = String::new();
        collect_text(el, &mut s);
        return if s.is_empty() { RawShow::Hidden } else { RawShow::Text(s) };
    }
    RawShow::Hidden
}

fn collect_text(el: &Element, out: &mut String) {
    for c in el.elements() {
        if !c.in_ns(ns::W) {
            collect_text(c, out);
            continue;
        }
        match c.local.as_str() {
            "t" => out.push_str(&c.text()),
            "tab" => out.push('\t'),
            "br" => out.push('\n'),
            "delText" | "instrText" | "sdtPr" | "rPr" | "del" => {}
            _ => collect_text(c, out),
        }
    }
}

/// What a field instruction computes on a page, if it's one the view keeps current.
fn page_field(instr: &str, fields: Option<PageFields>) -> Option<String> {
    let f = fields?;
    let name = instr.split_whitespace().next()?.to_ascii_uppercase();
    match name.as_str() {
        "PAGE" => Some(f.page.to_string()),
        "NUMPAGES" | "SECTIONPAGES" => Some(f.pages.to_string()),
        _ => None,
    }
}

impl Resolver for WordResolver<'_> {
    fn para(&mut self, ctx: &mut Ctx, path: &Path, p: &Paragraph, width: f64) -> (ParaSpec, Keep) {
        let _ = width;
        let resolved = match word(self.doc) {
            Some(w) => w.styles.resolve_para(&p.props),
            None => p.props.clone(),
        };
        let own_ppr = p.origin.get().and_then(|o| o.child(ns::W, "pPr"));
        let style_id = self.para_style_id(p);
        let mut extras = self.extras.para(style_id.as_deref(), own_ppr);
        let list = list_of(self.doc, p).filter(|(n, _)| n != "0");
        let level = list.as_ref().and_then(|(num, lvl)| self.extras.levels.get(num).and_then(|l| l.get(*lvl as usize)));
        if let Some(l) = level {
            extras.overlay(&super::extras::ParaExtras { tabs: l.tabs.clone(), ..Default::default() });
        }

        let mark_props = {
            let mut m = p.mark.clone().unwrap_or_default();
            m.style = None;
            self.run_props(p, &m, path)
        };
        let mark = self.style(ctx, &mark_props, false);

        // Items: each inline's stretch of the flat text.
        let flat = text::flat(p);
        let mut items: Vec<Item> = Vec::with_capacity(p.content.len() + 4);
        let mut field: Option<(String, bool, bool)> = None; // (instruction, in result, result shown)
        for (i, inline) in p.content.iter().enumerate() {
            let (start, end) = flat.spans[i];
            match inline {
                Inline::Text(r) => {
                    if let Some((instr, in_result, shown)) = &mut field {
                        if *in_result {
                            if let Some(v) = page_field(instr, self.fields) {
                                let kind = if *shown { ItemKind::Hidden } else { ItemKind::Atomic { text: v, style: self.style(ctx, &self.run_props(p, &r.props, path), false), inline: i as u32 } };
                                *shown = true;
                                items.push(Item { start, end, kind });
                                continue;
                            }
                        } else {
                            items.push(Item { start, end, kind: ItemKind::Hidden });
                            continue;
                        }
                    }
                    let hidden = r.origin.get().and_then(|o| o.path(ns::W, &["rPr", "vanish"])).is_some();
                    if hidden {
                        items.push(Item { start, end, kind: ItemKind::Hidden });
                        continue;
                    }
                    let style = self.style(ctx, &self.run_props(p, &r.props, path), r.link.is_some());
                    split_text(&r.text, start, style, &mut items);
                }
                Inline::Break { kind } => items.push(Item {
                    start,
                    end,
                    kind: if *kind == office_core::model::BreakKind::Page { ItemKind::PageBreak } else { ItemKind::ColumnBreak },
                }),
                Inline::Image(img) => {
                    items.push(Item { start, end, kind: ItemKind::Object { width: emu_px(img.width), height: emu_px(img.height), inline: i as u32 } })
                }
                Inline::Raw { xml } => {
                    let kind = match raw_show(xml) {
                        RawShow::FieldBegin => {
                            field = Some((String::new(), false, false));
                            ItemKind::Hidden
                        }
                        RawShow::FieldInstr(s) => {
                            if let Some((instr, _, _)) = &mut field {
                                instr.push_str(&s);
                            }
                            ItemKind::Hidden
                        }
                        RawShow::FieldSeparate => {
                            if let Some((_, in_result, _)) = &mut field {
                                *in_result = true;
                            }
                            ItemKind::Hidden
                        }
                        RawShow::FieldEnd => {
                            let pending = field.take();
                            // A page field with no result yet still shows its number.
                            match pending.and_then(|(instr, _, shown)| (!shown).then(|| page_field(&instr, self.fields)).flatten()) {
                                Some(v) => ItemKind::Atomic { text: v, style: mark, inline: i as u32 },
                                None => ItemKind::Hidden,
                            }
                        }
                        RawShow::Simple(instr, shown) => {
                            let text = page_field(&instr, self.fields).unwrap_or(shown);
                            if text.is_empty() {
                                ItemKind::Hidden
                            } else {
                                let rpr = xml.descendant(ns::W, "rPr").map(office_core::formats::docx::read_run_props).unwrap_or_default();
                                ItemKind::Atomic { text, style: self.style(ctx, &self.run_props(p, &rpr, path), false), inline: i as u32 }
                            }
                        }
                        RawShow::NoteRef(id) => {
                            let rpr = xml.child(ns::W, "rPr").map(office_core::formats::docx::read_run_props).unwrap_or_default();
                            let mut props = self.run_props(p, &rpr, path);
                            props.baseline = Some(office_core::model::Baseline::Superscript);
                            ItemKind::Atomic { text: id, style: self.style(ctx, &props, false), inline: i as u32 }
                        }
                        RawShow::Text(s) => {
                            if matches!(&field, Some((_, false, _))) {
                                ItemKind::Hidden
                            } else {
                                let rpr = xml.child(ns::W, "rPr").or_else(|| xml.descendant(ns::W, "rPr")).map(office_core::formats::docx::read_run_props).unwrap_or_default();
                                ItemKind::Atomic { text: s, style: self.style(ctx, &self.run_props(p, &rpr, path), false), inline: i as u32 }
                            }
                        }
                        RawShow::Hidden => ItemKind::Hidden,
                    };
                    items.push(Item { start, end, kind });
                }
            }
        }

        let px = |e: Option<Emu>| e.map(emu_px).unwrap_or(0.0);
        // Indents: the style's, then the list level's, then the paragraph's own.
        let indent_start = p.props.indent_start.or(level.and_then(|l| l.indent_start)).or(resolved.indent_start);
        let first_line = p.props.indent_first_line.or(level.and_then(|l| l.first_line)).or(resolved.indent_first_line);
        let mut space_before = px(resolved.space_before);
        let mut space_after = px(resolved.space_after);
        if extras.contextual_spacing == Some(true) {
            let same = |q: Option<&Paragraph>| q.is_some_and(|q| self.para_style_id(q) == style_id);
            if same(self.sibling(path, -1)) {
                space_before = 0.0;
            }
            if same(self.sibling(path, 1)) {
                space_after = 0.0;
            }
        }
        let spacing = match resolved.line_spacing {
            Some(LineSpacing::Multiple(m)) => Spacing::Multiple(m.fraction().max(0.06)),
            Some(LineSpacing::Exactly(e)) => Spacing::Exactly(emu_px(e).max(1.0)),
            Some(LineSpacing::AtLeast(e)) => Spacing::AtLeast(emu_px(e)),
            None => Spacing::Multiple(1.0),
        };
        let label = list.as_ref().and_then(|_| self.labels.get(path)).filter(|l| !l.is_empty()).map(|text| {
            let mut props = mark_props.clone();
            if let Some(l) = level {
                props.overlay(&l.run);
                // Bullets drawn from symbol fonts were turned into plain characters.
                if props.font.as_deref().is_some_and(|f| matches!(f, "Symbol" | "Wingdings" | "Courier New")) {
                    props.font = mark_props.font.clone();
                }
            }
            props.underline = None;
            Label { text: text.clone(), style: self.style(ctx, &props, false) }
        });
        let spec = ParaSpec {
            text: flat.text,
            items,
            align: match resolved.align {
                Some(Align::Center) => para::Align::Center,
                Some(Align::Right) => para::Align::Right,
                Some(Align::Justify | Align::Distribute) => para::Align::Justify,
                _ => para::Align::Left,
            },
            indent_start: px(indent_start),
            indent_end: px(resolved.indent_end),
            first_line: px(first_line),
            space_before,
            space_after,
            spacing,
            tabs: extras.tab_stops().into_iter().collect::<Vec<Tab>>(),
            default_tab: self.extras.default_tab,
            label,
            mark,
        };
        let keep = Keep {
            with_next: extras.keep_next.unwrap_or(false),
            together: extras.keep_lines.unwrap_or(false),
            page_break_before: extras.page_break_before.unwrap_or(false),
            widows: extras.widow_control.unwrap_or(true),
        };
        (spec, keep)
    }

    fn table(&mut self, path: &Path, t: &Table, width: f64) -> TableLook {
        let _ = path;
        let style = self.table_style(t);
        let ncols = t.columns.len().max(t.rows.iter().map(|r| r.cells.len()).max().unwrap_or(0)).max(1);
        let tbl_pr = t.origin.get().and_then(|o| o.child(ns::W, "tblPr"));
        let indent = tbl_pr.and_then(|p| p.child(ns::W, "tblInd")).and_then(|i| i.attr_ns(ns::W, "w")).and_then(|v| v.parse::<i64>().ok()).map(super::extras::twips_px).unwrap_or(0.0);
        let mut columns: Vec<f64> = (0..ncols).map(|c| t.columns.get(c).map(|e| emu_px(*e)).unwrap_or(0.0)).collect();
        let total: f64 = columns.iter().sum();
        let room = (width - indent).max(24.0);
        if total <= 1.0 {
            columns = vec![room / ncols as f64; ncols];
        } else if total > room + 0.5 {
            // Wider than the page: shrink every column alike, as Word's autofit does.
            let k = room / total;
            columns.iter_mut().for_each(|c| *c *= k);
        }
        let default_margins = [style.margins[0].unwrap_or(0.0), style.margins[3].unwrap_or(7.2), style.margins[2].unwrap_or(0.0), style.margins[1].unwrap_or(7.2)];
        let line = |b: &Option<Border>| -> Option<BorderLine> {
            let b = b.as_ref()?;
            Some(BorderLine { width: b.width, color: b.color.as_ref().map(|c| format!("#{}", c.to_ascii_lowercase())).unwrap_or_else(|| "#000000".into()), style: b.style? })
        };
        let theme = self.theme();
        let rows = t.rows.len();
        let cells = t
            .rows
            .iter()
            .enumerate()
            .map(|(r, row)| {
                row.cells
                    .iter()
                    .enumerate()
                    .map(|(c, cell)| {
                        let tc_pr = cell.origin.get().and_then(|o| o.child(ns::W, "tcPr"));
                        let last_row = r + cell.row_span.max(1) as usize >= rows;
                        let last_col = c + cell.col_span.max(1) as usize >= ncols;
                        let b = &style.borders;
                        let mut borders = Borders {
                            top: if r == 0 { b.top.clone() } else { b.inside_h.clone() },
                            bottom: if last_row { b.bottom.clone() } else { b.inside_h.clone() },
                            left: if c == 0 { b.left.clone() } else { b.inside_v.clone() },
                            right: if last_col { b.right.clone() } else { b.inside_v.clone() },
                            ..Default::default()
                        };
                        let mut fill = style.shading.clone();
                        for name in cell_parts(t, r, c).iter().rev() {
                            if let Some(part) = style.parts.get(*name) {
                                borders.overlay(&part.borders);
                                if part.shading.is_some() {
                                    fill = part.shading.clone();
                                }
                            }
                        }
                        if let Some(own) = tc_pr.and_then(|p| p.child(ns::W, "tcBorders")) {
                            borders.overlay(&Borders::read(own));
                        }
                        let fill = cell
                            .fill
                            .as_ref()
                            .map(|f| paint_color(theme, f).css())
                            .or_else(|| fill.map(|f| format!("#{}", f.to_ascii_lowercase())));
                        let mut margins = default_margins;
                        if let Some(m) = tc_pr.and_then(|p| p.child(ns::W, "tcMar")) {
                            let get = |names: &[&str]| names.iter().find_map(|n| m.child(ns::W, n)).and_then(|e| e.attr_ns(ns::W, "w")).and_then(|v| v.parse::<i64>().ok()).map(super::extras::twips_px);
                            if let Some(v) = get(&["top"]) {
                                margins[0] = v;
                            }
                            if let Some(v) = get(&["end", "right"]) {
                                margins[1] = v;
                            }
                            if let Some(v) = get(&["bottom"]) {
                                margins[2] = v;
                            }
                            if let Some(v) = get(&["start", "left"]) {
                                margins[3] = v;
                            }
                        }
                        let valign = match tc_pr.and_then(|p| p.child(ns::W, "vAlign")).and_then(val) {
                            Some("center") => 1,
                            Some("bottom") => 2,
                            _ => 0,
                        };
                        CellLook { fill, borders: [line(&borders.top), line(&borders.right), line(&borders.bottom), line(&borders.left)], margins, valign }
                    })
                    .collect()
            })
            .collect();
        let heights = t
            .rows
            .iter()
            .map(|row| {
                let h = row.height.map(emu_px)?;
                let exact = row.origin.get().and_then(|o| o.path(ns::W, &["trPr", "trHeight"])).and_then(|e| e.attr_ns(ns::W, "hRule")) == Some("exact");
                Some((h, exact))
            })
            .collect();
        TableLook { columns, indent, cells, heights }
    }
}

/// Adds items for a run's text, splitting out tabs and line breaks.
pub fn split_text(s: &str, base: u32, style: StyleId, items: &mut Vec<Item>) {
    let mut start = 0usize;
    for (i, c) in s.char_indices() {
        let kind = match c {
            '\t' => ItemKind::Tab(style),
            '\n' => ItemKind::Break(style),
            _ => continue,
        };
        if i > start {
            items.push(Item { start: base + start as u32, end: base + i as u32, kind: ItemKind::Text(style) });
        }
        items.push(Item { start: base + i as u32, end: base + i as u32 + 1, kind });
        start = i + 1;
    }
    if s.len() > start {
        items.push(Item { start: base + start as u32, end: base + s.len() as u32, kind: ItemKind::Text(style) });
    }
}
