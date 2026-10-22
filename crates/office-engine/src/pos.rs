//! Positions in a story: a list of blocks (a Word body, header or note; a shape's text; a table
//! on a slide). A paragraph's [`Path`] is its block index, through table cells for paragraphs
//! inside tables: `[block]`, or `[table, row, column, block]`, and so on for nested tables. A
//! [`Pos`] is a paragraph and an offset into its flat text (see [`crate::text`]).
//!
//! Paths compare in reading order, so positions and selections order the way they read.

use std::cmp::Ordering;

use office_core::model::{Block, Paragraph};

/// Where a paragraph is in a story.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Path(pub Vec<u32>);

impl Path {
    pub fn top(block: u32) -> Path {
        Path(vec![block])
    }

    /// The paragraph's index among its siblings.
    pub fn block(&self) -> u32 {
        *self.0.last().unwrap_or(&0)
    }

    /// The path of the block list the paragraph is in: empty for the story's own blocks.
    pub fn container(&self) -> &[u32] {
        &self.0[..self.0.len().saturating_sub(1)]
    }

    pub fn sibling(&self, block: u32) -> Path {
        let mut p = self.0.clone();
        if let Some(last) = p.last_mut() {
            *last = block;
        }
        Path(p)
    }

    pub fn depth(&self) -> usize {
        self.0.len() / 3
    }

    /// The cell the paragraph is in, as (table path, row, column), if any.
    pub fn cell(&self) -> Option<(Path, u32, u32)> {
        let n = self.0.len();
        (n >= 4).then(|| (Path(self.0[..n - 3].to_vec()), self.0[n - 3], self.0[n - 2]))
    }
}

/// A place in a story's text.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Pos {
    pub path: Path,
    pub offset: u32,
}

impl Pos {
    pub fn new(path: Path, offset: u32) -> Pos {
        Pos { path, offset }
    }

    pub fn start() -> Pos {
        Pos { path: Path::top(0), offset: 0 }
    }
}

impl PartialOrd for Pos {
    fn partial_cmp(&self, other: &Pos) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Pos {
    fn cmp(&self, other: &Pos) -> Ordering {
        self.path.cmp(&other.path).then(self.offset.cmp(&other.offset))
    }
}

/// A selection: where it started (`anchor`) and where it's been extended to (`focus`, where the
/// caret shows). Collapsed, it's a caret.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Selection {
    pub anchor: Pos,
    pub focus: Pos,
}

impl Selection {
    pub fn caret(at: Pos) -> Selection {
        Selection { anchor: at.clone(), focus: at }
    }

    pub fn is_collapsed(&self) -> bool {
        self.anchor == self.focus
    }

    pub fn start(&self) -> &Pos {
        if self.anchor <= self.focus { &self.anchor } else { &self.focus }
    }

    pub fn end(&self) -> &Pos {
        if self.anchor <= self.focus { &self.focus } else { &self.anchor }
    }

    pub fn ordered(&self) -> (Pos, Pos) {
        (self.start().clone(), self.end().clone())
    }
}

// ---- finding blocks ----

/// The block list at `container` (a path's [`Path::container`]).
pub fn blocks_at<'a>(root: &'a [Block], container: &[u32]) -> Option<&'a [Block]> {
    if container.is_empty() {
        return Some(root);
    }
    let [b, r, c, rest @ ..] = container else { return None };
    match root.get(*b as usize)? {
        Block::Table(t) => blocks_at(&t.rows.get(*r as usize)?.cells.get(*c as usize)?.blocks, rest),
        _ => None,
    }
}

pub fn blocks_at_mut<'a>(root: &'a mut Vec<Block>, container: &[u32]) -> Option<&'a mut Vec<Block>> {
    if container.is_empty() {
        return Some(root);
    }
    let [b, r, c, rest @ ..] = container else { return None };
    match root.get_mut(*b as usize)? {
        Block::Table(t) => blocks_at_mut(&mut t.rows.get_mut(*r as usize)?.cells.get_mut(*c as usize)?.blocks, rest),
        _ => None,
    }
}

pub fn para<'a>(root: &'a [Block], path: &Path) -> Option<&'a Paragraph> {
    match blocks_at(root, path.container())?.get(path.block() as usize)? {
        Block::Paragraph(p) => Some(p),
        _ => None,
    }
}

pub fn para_mut<'a>(root: &'a mut Vec<Block>, path: &Path) -> Option<&'a mut Paragraph> {
    match blocks_at_mut(root, path.container())?.get_mut(path.block() as usize)? {
        Block::Paragraph(p) => Some(p),
        _ => None,
    }
}

/// The first paragraph at or after block `from` of the list at `container`, going into tables.
pub fn first_para_from(root: &[Block], container: &[u32], from: u32) -> Option<Path> {
    let blocks = blocks_at(root, container)?;
    for (i, b) in blocks.iter().enumerate().skip(from as usize) {
        match b {
            Block::Paragraph(_) => return Some(path_of(container, i as u32)),
            Block::Table(t) => {
                for (r, row) in t.rows.iter().enumerate() {
                    for (c, cell) in row.cells.iter().enumerate() {
                        if cell.covered {
                            continue;
                        }
                        let inner = cell_container(container, i as u32, r as u32, c as u32);
                        if let Some(p) = first_para_from(root, &inner, 0) {
                            return Some(p);
                        }
                    }
                }
            }
            Block::Raw { .. } => {}
        }
    }
    None
}

/// The last paragraph at or before block `upto` (inclusive) of the list at `container`.
pub fn last_para_upto(root: &[Block], container: &[u32], upto: u32) -> Option<Path> {
    let blocks = blocks_at(root, container)?;
    let end = (upto as usize + 1).min(blocks.len());
    for i in (0..end).rev() {
        match &blocks[i] {
            Block::Paragraph(_) => return Some(path_of(container, i as u32)),
            Block::Table(t) => {
                for (r, row) in t.rows.iter().enumerate().rev() {
                    for (c, cell) in row.cells.iter().enumerate().rev() {
                        if cell.covered {
                            continue;
                        }
                        let inner = cell_container(container, i as u32, r as u32, c as u32);
                        let n = cell.blocks.len() as u32;
                        if let Some(p) = n.checked_sub(1).and_then(|last| last_para_upto(root, &inner, last)) {
                            return Some(p);
                        }
                    }
                }
            }
            Block::Raw { .. } => {}
        }
    }
    None
}

fn path_of(container: &[u32], block: u32) -> Path {
    let mut v = container.to_vec();
    v.push(block);
    Path(v)
}

fn cell_container(container: &[u32], table: u32, row: u32, col: u32) -> Vec<u32> {
    let mut v = container.to_vec();
    v.extend([table, row, col]);
    v
}

/// The paragraph after `path` in reading order: the next block, into and out of table cells.
pub fn next_para(root: &[Block], path: &Path) -> Option<Path> {
    if let Some(p) = first_para_from(root, path.container(), path.block() + 1) {
        return Some(p);
    }
    // The cell is done: the next cell, then whatever follows the table.
    let (table, row, col) = path.cell()?;
    let Block::Table(t) = blocks_at(root, table.container())?.get(table.block() as usize)? else { return None };
    let mut r = row as usize;
    let mut c = col as usize + 1;
    while r < t.rows.len() {
        while c < t.rows[r].cells.len() {
            if !t.rows[r].cells[c].covered {
                if let Some(p) = first_para_from(root, &cell_container(table.container(), table.block(), r as u32, c as u32), 0) {
                    return Some(p);
                }
            }
            c += 1;
        }
        r += 1;
        c = 0;
    }
    next_para(root, &table)
        .or_else(|| first_para_from(root, table.container(), table.block() + 1))
        .filter(|p| p > path)
}

/// The paragraph before `path` in reading order.
pub fn prev_para(root: &[Block], path: &Path) -> Option<Path> {
    if path.block() > 0 {
        if let Some(p) = last_para_upto(root, path.container(), path.block() - 1) {
            return Some(p);
        }
    }
    let (table, row, col) = path.cell()?;
    let Block::Table(t) = blocks_at(root, table.container())?.get(table.block() as usize)? else { return None };
    let mut r = row as i64;
    let mut c = col as i64 - 1;
    while r >= 0 {
        while c >= 0 {
            let cell = &t.rows[r as usize].cells[c as usize];
            if !cell.covered {
                let inner = cell_container(table.container(), table.block(), r as u32, c as u32);
                if let Some(p) = (cell.blocks.len() as u32).checked_sub(1).and_then(|last| last_para_upto(root, &inner, last)) {
                    return Some(p);
                }
            }
            c -= 1;
        }
        r -= 1;
        if r >= 0 {
            c = t.rows[r as usize].cells.len() as i64 - 1;
        }
    }
    if table.block() == 0 {
        return prev_para(root, &table.sibling(0)).filter(|p| p < path);
    }
    last_para_upto(root, table.container(), table.block() - 1).or_else(|| prev_para(root, &table))
}

/// Every paragraph from `from` to `to` (inclusive) in reading order.
pub fn paras_between(root: &[Block], from: &Path, to: &Path) -> Vec<Path> {
    let mut out = Vec::new();
    let mut at = Some(from.clone());
    while let Some(p) = at {
        if &p > to {
            break;
        }
        at = next_para(root, &p);
        out.push(p);
    }
    out
}

/// The story's first and last positions.
pub fn story_start(root: &[Block]) -> Option<Pos> {
    first_para_from(root, &[], 0).map(|p| Pos::new(p, 0))
}

pub fn story_end(root: &[Block]) -> Option<Pos> {
    let last = last_para_upto(root, &[], (root.len() as u32).checked_sub(1)?)?;
    let len = para(root, &last).map(crate::text::len).unwrap_or(0);
    Some(Pos::new(last, len))
}

#[cfg(test)]
mod tests {
    use super::*;
    use office_core::model::{Cell, Row, Table};

    fn p(t: &str) -> Block {
        Block::Paragraph(Paragraph::text(t))
    }

    fn table() -> Block {
        Block::Table(Table {
            columns: vec![Default::default(); 2],
            rows: vec![
                Row { cells: vec![Cell::text("a"), Cell::text("b")], ..Default::default() },
                Row { cells: vec![Cell::text("c"), Cell { covered: true, ..Cell::text("") }], ..Default::default() },
            ],
            ..Default::default()
        })
    }

    #[test]
    fn reading_order_through_tables() {
        let root = vec![p("x"), table(), p("y")];
        let order: Vec<String> = {
            let mut out = Vec::new();
            let mut at = story_start(&root).map(|s| s.path);
            while let Some(path) = at {
                out.push(para(&root, &path).unwrap().plain_text());
                at = next_para(&root, &path);
            }
            out
        };
        assert_eq!(order, vec!["x", "a", "b", "c", "y"]);
        let back: Vec<String> = {
            let mut out = Vec::new();
            let mut at = story_end(&root).map(|s| s.path);
            while let Some(path) = at {
                out.push(para(&root, &path).unwrap().plain_text());
                at = prev_para(&root, &path);
            }
            out
        };
        assert_eq!(back, vec!["y", "c", "b", "a", "x"]);
    }

    #[test]
    fn paths_order_by_reading() {
        let in_table = Path(vec![1, 0, 1, 0]);
        assert!(Path::top(0) < in_table);
        assert!(in_table < Path::top(2));
        assert_eq!(in_table.cell(), Some((Path::top(1), 0, 1)));
        let root = vec![p("x"), table(), p("y")];
        assert_eq!(paras_between(&root, &Path::top(0), &Path::top(2)).len(), 5);
    }
}
