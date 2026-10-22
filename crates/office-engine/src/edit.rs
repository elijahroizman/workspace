//! Editing a story. Every change to text is a [`Splice`]: some neighboring blocks replaced by
//! others. Typing replaces one paragraph with its edited copy, Enter one with two, deleting
//! across paragraphs several with one. A splice keeps what it removed, so it can be undone, and
//! only the blocks it touches are copied, which keeps edits to long documents cheap.

use office_core::model::{Block, Inline, ParaProps, Paragraph, RunProps};

use crate::pos::{self, blocks_at, blocks_at_mut, para, Path, Pos, Selection};
use crate::text;

/// Blocks `index..index + removed.len()` of the list at `container` replaced by `inserted`.
#[derive(Clone, Debug, PartialEq)]
pub struct Splice {
    pub container: Vec<u32>,
    pub index: u32,
    pub removed: Vec<Block>,
    pub inserted: Vec<Block>,
}

impl Splice {
    pub fn apply(&self, root: &mut Vec<Block>) {
        if let Some(list) = blocks_at_mut(root, &self.container) {
            let i = self.index as usize;
            list.splice(i..i + self.removed.len(), self.inserted.iter().cloned());
        }
    }

    pub fn undo(&self, root: &mut Vec<Block>) {
        if let Some(list) = blocks_at_mut(root, &self.container) {
            let i = self.index as usize;
            list.splice(i..i + self.inserted.len(), self.removed.iter().cloned());
        }
    }

    /// Folds `next` into this splice, if it changes exactly what this one inserted: how a run of
    /// typing becomes one step to undo.
    pub fn absorb(&mut self, next: &Splice) -> bool {
        if next.container == self.container && next.index == self.index && next.removed == self.inserted {
            self.inserted = next.inserted.clone();
            return true;
        }
        false
    }
}

/// Replaces `n` blocks at `index` of the list at `container`, and records it.
pub fn replace(root: &mut Vec<Block>, container: &[u32], index: u32, n: usize, inserted: Vec<Block>) -> Splice {
    let list = blocks_at_mut(root, container).expect("splice into a block list that exists");
    let i = index as usize;
    let removed: Vec<Block> = list.splice(i..i + n, inserted.iter().cloned()).collect();
    Splice { container: container.to_vec(), index, removed, inserted }
}

/// Changes one paragraph through `f`, recorded as a splice.
pub fn change_para(root: &mut Vec<Block>, path: &Path, f: impl FnOnce(&mut Paragraph)) -> Option<Splice> {
    let mut p = para(root, path)?.clone();
    f(&mut p);
    Some(replace(root, path.container(), path.block(), 1, vec![Block::Paragraph(p)]))
}

/// The result of an edit: what it did, and where the selection goes.
#[derive(Clone, Debug, Default)]
pub struct Edit {
    pub splices: Vec<Splice>,
    pub selection: Option<Selection>,
}

impl Edit {
    fn caret(splices: Vec<Splice>, at: Pos) -> Edit {
        Edit { splices, selection: Some(Selection::caret(at)) }
    }
}

/// Deletes what's selected. Paragraphs at the two ends are joined; blocks between them, and any
/// table an end is inside, go entirely.
pub fn delete(root: &mut Vec<Block>, sel: &Selection) -> Edit {
    let (from, to) = sel.ordered();
    if from == to {
        return Edit::caret(Vec::new(), from);
    }
    if from.path == to.path {
        let s = change_para(root, &from.path, |p| text::delete(p, from.offset, to.offset));
        return Edit::caret(s.into_iter().collect(), from);
    }
    // Both ends in the same cell or list: join them across what's between.
    let level = common_level(&from.path, &to.path);
    let container = &from.path.0[..level];
    let a = from.path.0[level];
    let b = to.path.0[level];
    let a_is_para = from.path.0.len() == level + 1;
    let b_is_para = to.path.0.len() == level + 1;
    let list = blocks_at(root, container).unwrap_or(&[]);
    let mut merged: Vec<Block> = Vec::new();
    let mut caret_block = a;
    let mut caret_offset = 0;
    match (a_is_para, b_is_para) {
        (true, true) => {
            let (Some(Block::Paragraph(pa)), Some(Block::Paragraph(pb))) = (list.get(a as usize), list.get(b as usize)) else {
                return Edit::default();
            };
            let mut head = pa.clone();
            text::delete(&mut head, from.offset, text::len(pa));
            let mut tail = pb.clone();
            text::delete(&mut tail, 0, to.offset);
            caret_offset = from.offset;
            text::join(&mut head, tail);
            merged.push(Block::Paragraph(head));
        }
        (true, false) => {
            let Some(Block::Paragraph(pa)) = list.get(a as usize) else { return Edit::default() };
            let mut head = pa.clone();
            text::delete(&mut head, from.offset, text::len(pa));
            caret_offset = from.offset;
            merged.push(Block::Paragraph(head));
        }
        (false, true) => {
            let Some(Block::Paragraph(pb)) = list.get(b as usize) else { return Edit::default() };
            let mut tail = pb.clone();
            text::delete(&mut tail, 0, to.offset);
            merged.push(Block::Paragraph(tail));
        }
        (false, false) => merged.push(Block::Paragraph(Paragraph::default())),
    }
    let s = replace(root, container, a, (b - a + 1) as usize, merged);
    caret_block = caret_block.min(a);
    let mut path = container.to_vec();
    path.push(caret_block);
    Edit::caret(vec![s], Pos::new(Path(path), caret_offset))
}

/// How deep two paths share block lists: the index in both paths of the blocks that differ.
fn common_level(a: &Path, b: &Path) -> usize {
    let mut level = 0;
    while level + 3 < a.0.len() && level + 3 < b.0.len() && a.0[level..level + 3] == b.0[level..level + 3] {
        level += 3;
    }
    level
}

/// Types `text` over the selection. Line feeds start new paragraphs. `props` is the formatting
/// for the new text (`None`: the text before it).
pub fn insert_text(root: &mut Vec<Block>, sel: &Selection, text: &str, props: Option<&RunProps>) -> Edit {
    let mut edit = delete(root, sel);
    let mut at = edit.selection.clone().map(|s| s.focus).unwrap_or_else(|| sel.focus.clone());
    let mut parts = text.split('\n');
    let first = parts.next().unwrap_or("");
    if !first.is_empty() {
        if let Some(s) = change_para(root, &at.path, |p| text::insert_text(p, at.offset, first, props)) {
            push(&mut edit.splices, s);
        }
        at.offset += first.len() as u32;
    }
    for part in parts {
        let e = split_para(root, &at, None);
        edit.splices.extend(e.splices);
        at = e.selection.map(|s| s.focus).unwrap_or(at);
        if !part.is_empty() {
            if let Some(s) = change_para(root, &at.path, |p| text::insert_text(p, at.offset, part, props)) {
                push(&mut edit.splices, s);
            }
            at.offset += part.len() as u32;
        }
    }
    edit.selection = Some(Selection::caret(at));
    edit
}

/// Adds a splice, folding it into the last one when it just carries on from it.
pub fn push(splices: &mut Vec<Splice>, s: Splice) {
    if let Some(last) = splices.last_mut() {
        if last.absorb(&s) {
            return;
        }
    }
    splices.push(s);
}

/// Splits the paragraph at `at` (Enter). `next` gives the new paragraph's properties when it
/// differs from the first's (a heading followed by body text).
pub fn split_para(root: &mut Vec<Block>, at: &Pos, next: Option<&dyn Fn(&ParaProps, bool) -> ParaProps>) -> Edit {
    let Some(p) = para(root, &at.path) else { return Edit::default() };
    let at_end = at.offset >= text::len(p);
    let (a, mut b) = text::split(p, at.offset);
    if let Some(next) = next {
        b.props = next(&a.props, at_end);
    }
    let s = replace(root, at.path.container(), at.path.block(), 1, vec![Block::Paragraph(a), Block::Paragraph(b)]);
    Edit::caret(vec![s], Pos::new(at.path.sibling(at.path.block() + 1), 0))
}

/// Inserts an object (a picture, a page break) at the selection, replacing what's selected.
pub fn insert_inline(root: &mut Vec<Block>, sel: &Selection, inline: Inline) -> Edit {
    let mut edit = delete(root, sel);
    let at = edit.selection.clone().map(|s| s.focus).unwrap_or_else(|| sel.focus.clone());
    let n = text::inline_len(&inline);
    if let Some(s) = change_para(root, &at.path, |p| text::insert_inline(p, at.offset, inline)) {
        push(&mut edit.splices, s);
    }
    edit.selection = Some(Selection::caret(Pos::new(at.path.clone(), at.offset + n)));
    edit
}

/// Inserts whole blocks (a table, pasted paragraphs) at the selection: the paragraph there is
/// split and the blocks go between its halves. An empty half is dropped, except that a table is
/// always followed by a paragraph, as Word requires.
pub fn insert_blocks(root: &mut Vec<Block>, sel: &Selection, blocks: Vec<Block>) -> Edit {
    let mut edit = delete(root, sel);
    let at = edit.selection.clone().map(|s| s.focus).unwrap_or_else(|| sel.focus.clone());
    let Some(p) = para(root, &at.path) else { return edit };
    let (a, b) = text::split(p, at.offset);
    let mut out = Vec::new();
    let keep_a = text::len(&a) > 0;
    if keep_a {
        out.push(Block::Paragraph(a));
    }
    let n_new = blocks.len();
    let ends_with_table = matches!(blocks.last(), Some(Block::Table(_)));
    out.extend(blocks);
    let keep_b = text::len(&b) > 0 || ends_with_table || !keep_a && n_new == 0;
    if keep_b {
        out.push(Block::Paragraph(b));
    }
    let index = at.path.block();
    let caret_block = index + keep_a as u32 + n_new as u32;
    let s = replace(root, at.path.container(), index, 1, out);
    edit.splices.push(s);
    let caret = if keep_b {
        Pos::new(at.path.sibling(caret_block), 0)
    } else {
        let path = pos::last_para_upto(root, at.path.container(), caret_block.saturating_sub(1)).unwrap_or(at.path.clone());
        let len = para(root, &path).map(text::len).unwrap_or(0);
        Pos::new(path, len)
    };
    edit.selection = Some(Selection::caret(caret));
    edit
}

/// Changes the formatting of every run in the selection. A caret changes nothing here; the
/// layer keeps formatting for the next typed text instead.
pub fn format_runs(root: &mut Vec<Block>, sel: &Selection, f: &dyn Fn(&mut RunProps)) -> Vec<Splice> {
    let (from, to) = sel.ordered();
    let mut out = Vec::new();
    for path in pos::paras_between(root, &from.path, &to.path) {
        let Some(p) = para(root, &path) else { continue };
        let len = text::len(p);
        let a = if path == from.path { from.offset } else { 0 };
        let b = if path == to.path { to.offset } else { len };
        if a >= b && !(len == 0) {
            continue;
        }
        if let Some(s) = change_para(root, &path, |p| text::format(p, a, b, f)) {
            out.push(s);
        }
    }
    out
}

/// Changes the paragraph properties of every paragraph the selection touches.
pub fn format_paras(root: &mut Vec<Block>, sel: &Selection, f: &dyn Fn(&mut Paragraph)) -> Vec<Splice> {
    let (from, to) = sel.ordered();
    pos::paras_between(root, &from.path, &to.path).iter().filter_map(|path| change_para(root, path, |p| f(p))).collect()
}

/// Sets or removes the link on the selected text.
pub fn set_link(root: &mut Vec<Block>, sel: &Selection, link: Option<office_core::model::Link>) -> Vec<Splice> {
    let (from, to) = sel.ordered();
    let mut out = Vec::new();
    for path in pos::paras_between(root, &from.path, &to.path) {
        let Some(p) = para(root, &path) else { continue };
        let a = if path == from.path { from.offset } else { 0 };
        let b = if path == to.path { to.offset } else { text::len(p) };
        if let Some(s) = change_para(root, &path, |p| text::set_link(p, a, b, link.clone())) {
            out.push(s);
        }
    }
    out
}

/// The selected content as blocks: partial paragraphs at the ends, whole blocks between.
pub fn copy(root: &[Block], sel: &Selection) -> Vec<Block> {
    let (from, to) = sel.ordered();
    if from.path == to.path {
        let Some(p) = para(root, &from.path) else { return Vec::new() };
        return vec![Block::Paragraph(Paragraph { props: p.props.clone(), content: text::slice(p, from.offset, to.offset), ..Default::default() })];
    }
    let level = common_level(&from.path, &to.path);
    let container = &from.path.0[..level];
    let (a, b) = (from.path.0[level] as usize, to.path.0[level] as usize);
    let Some(list) = blocks_at(root, container) else { return Vec::new() };
    let mut out = Vec::new();
    for (i, block) in list.iter().enumerate().take(b + 1).skip(a) {
        match block {
            Block::Paragraph(p) if i == a && from.path.0.len() == level + 1 => {
                out.push(Block::Paragraph(Paragraph { props: p.props.clone(), content: text::slice(p, from.offset, text::len(p)), ..Default::default() }))
            }
            Block::Paragraph(p) if i == b && to.path.0.len() == level + 1 => {
                out.push(Block::Paragraph(Paragraph { props: p.props.clone(), content: text::slice(p, 0, to.offset), ..Default::default() }))
            }
            other => out.push(strip_origins(other.clone())),
        }
    }
    out
}

/// A block without the markup it was read from, so a pasted copy is written as new content.
pub fn strip_origins(block: Block) -> Block {
    match block {
        Block::Paragraph(mut p) => {
            p.origin = Default::default();
            Block::Paragraph(p)
        }
        Block::Table(mut t) => {
            t.origin = Default::default();
            for row in &mut t.rows {
                row.origin = Default::default();
                for cell in &mut row.cells {
                    cell.origin = Default::default();
                    cell.blocks = std::mem::take(&mut cell.blocks).into_iter().map(strip_origins).collect();
                }
            }
            Block::Table(t)
        }
        raw => raw,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use office_core::model::{Cell, Row, Table};

    fn doc(texts: &[&str]) -> Vec<Block> {
        texts.iter().map(|t| Block::Paragraph(Paragraph::text(*t))).collect()
    }

    fn texts(root: &[Block]) -> Vec<String> {
        root.iter()
            .map(|b| match b {
                Block::Paragraph(p) => p.plain_text(),
                Block::Table(_) => "[table]".into(),
                Block::Raw { .. } => "[raw]".into(),
            })
            .collect()
    }

    fn at(block: u32, offset: u32) -> Pos {
        Pos::new(Path::top(block), offset)
    }

    #[test]
    fn typing_and_undo() {
        let mut root = doc(&["Hello"]);
        let mut splices = Vec::new();
        let mut sel = Selection::caret(at(0, 5));
        for c in [" ", "w", "o"] {
            let e = insert_text(&mut root, &sel, c, None);
            for s in e.splices {
                push(&mut splices, s);
            }
            sel = e.selection.unwrap();
        }
        assert_eq!(texts(&root), vec!["Hello wo"]);
        assert_eq!(splices.len(), 1);
        splices[0].undo(&mut root);
        assert_eq!(texts(&root), vec!["Hello"]);
        splices[0].apply(&mut root);
        assert_eq!(texts(&root), vec!["Hello wo"]);
    }

    #[test]
    fn enter_and_multi_line_paste() {
        let mut root = doc(&["onetwo"]);
        let e = insert_text(&mut root, &Selection::caret(at(0, 3)), "\n", None);
        assert_eq!(texts(&root), vec!["one", "two"]);
        assert_eq!(e.selection.unwrap().focus, at(1, 0));
        let e = insert_text(&mut root, &Selection::caret(at(1, 0)), "a\nb\n", None);
        assert_eq!(texts(&root), vec!["one", "a", "b", "two"]);
        assert_eq!(e.selection.unwrap().focus, at(3, 0));
    }

    #[test]
    fn deleting_across_paragraphs_and_tables() {
        let mut root = doc(&["abc", "def", "ghi"]);
        let e = delete(&mut root, &Selection { anchor: at(2, 1), focus: at(0, 1) });
        assert_eq!(texts(&root), vec!["ahi"]);
        assert_eq!(e.selection.unwrap().focus, at(0, 1));
        e.splices[0].undo(&mut root);
        assert_eq!(texts(&root), vec!["abc", "def", "ghi"]);

        let table = Block::Table(Table { columns: vec![Default::default()], rows: vec![Row { cells: vec![Cell::text("x")], ..Default::default() }], ..Default::default() });
        let mut root = vec![Block::Paragraph(Paragraph::text("before")), table, Block::Paragraph(Paragraph::text("after"))];
        // From inside "before" to inside the table's cell: the table goes too.
        delete(&mut root, &Selection { anchor: at(0, 3), focus: Pos::new(Path(vec![1, 0, 0, 0]), 1) });
        assert_eq!(texts(&root), vec!["bef", "after"]);
    }

    #[test]
    fn inserting_a_table_splits_the_paragraph() {
        let mut root = doc(&["leftright"]);
        let table = Block::Table(Table::from_text(&[vec!["a".into()]], Default::default()));
        let e = insert_blocks(&mut root, &Selection::caret(at(0, 4)), vec![table.clone()]);
        assert_eq!(texts(&root), vec!["left", "[table]", "right"]);
        assert_eq!(e.selection.unwrap().focus, at(2, 0));
        // At the end of a paragraph, an empty paragraph still follows the table.
        let mut root = doc(&["end"]);
        insert_blocks(&mut root, &Selection::caret(at(0, 3)), vec![table]);
        assert_eq!(texts(&root), vec!["end", "[table]", ""]);
    }

    #[test]
    fn formatting_across_paragraphs() {
        let mut root = doc(&["abc", "def"]);
        let s = format_runs(&mut root, &Selection { anchor: at(0, 1), focus: at(1, 2) }, &|r| r.bold = Some(true));
        assert_eq!(s.len(), 2);
        let Block::Paragraph(p) = &root[1] else { panic!() };
        assert_eq!(p.runs().next().unwrap().props.bold, Some(true));
        assert_eq!(p.runs().nth(1).unwrap().text, "f");
    }

    #[test]
    fn copying() {
        let root = doc(&["abc", "def", "ghi"]);
        let c = copy(&root, &Selection { anchor: at(0, 1), focus: at(2, 2) });
        assert_eq!(texts(&c), vec!["bc", "def", "gh"]);
    }
}
