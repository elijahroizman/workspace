//! Excel (.xlsx): the workbook's sheets, their cells and merged ranges. The style sheet, number
//! formats, column widths, conditional formatting, charts and defined names stay in the package
//! (and the sheets' origins) for the Excel layer.

mod props;
mod read;

pub use props::{escape, read_color, read_run_props, unescape, INDEXED, THEME_INDEX};
pub use read::read;
