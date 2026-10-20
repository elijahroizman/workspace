//! Tables, as Word and PowerPoint have them: rows of cells that hold paragraphs (and, in Word,
//! more tables), on a grid of columns, with cells that span columns and rows.

use serde::{Deserialize, Serialize};

use super::{Block, Origin};
use crate::drawing::Color;
use crate::units::Emu;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    /// The grid's column widths.
    pub columns: Vec<Emu>,
    pub rows: Vec<Row>,
    /// Word's table style id, or PowerPoint's table style GUID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip)]
    pub origin: Origin,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub cells: Vec<Cell>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<Emu>,
    /// Repeats at the top of each page (Word), or styled as the header (PowerPoint's first row).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub header: bool,
    #[serde(skip)]
    pub origin: Origin,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub blocks: Vec<Block>,
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub col_span: u32,
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub row_span: u32,
    /// Covered by a neighbor's span. PowerPoint keeps a cell in the grid under every span; Word
    /// only under row spans (`w:vMerge`), so its column spans have no covered cells.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub covered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(skip)]
    pub origin: Origin,
}

fn one() -> u32 {
    1
}

fn is_one(n: &u32) -> bool {
    *n == 1
}

impl Default for Cell {
    fn default() -> Cell {
        Cell { blocks: Vec::new(), col_span: 1, row_span: 1, covered: false, fill: None, origin: Origin::default() }
    }
}

impl Cell {
    pub fn text(text: impl Into<String>) -> Cell {
        Cell { blocks: vec![Block::Paragraph(super::Paragraph::text(text))], ..Default::default() }
    }

    /// The cell's text, paragraphs joined with line breaks.
    pub fn plain_text(&self) -> String {
        super::blocks_text(&self.blocks)
    }
}

impl Table {
    /// A table of plain text, one string per cell, with equal columns across `width`.
    pub fn from_text(rows: &[Vec<String>], width: Emu) -> Table {
        let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
        let col = Emu(if cols == 0 { 0 } else { width.0 / cols as i64 });
        Table {
            columns: vec![col; cols],
            rows: rows
                .iter()
                .map(|r| Row {
                    cells: (0..cols).map(|i| Cell::text(r.get(i).cloned().unwrap_or_default())).collect(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }
}
