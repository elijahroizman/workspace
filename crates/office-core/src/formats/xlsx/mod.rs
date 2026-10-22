//! Excel (.xlsx): the workbook's sheets, their cells and merged ranges. The style sheet, number
//! formats, column widths, conditional formatting, charts and defined names stay in the package
//! (and the sheets' origins) for the Excel layer.

mod props;
mod read;
mod write;

pub use props::{escape, read_color, read_run_props, unescape, INDEXED, THEME_INDEX};
pub use read::read;
pub use write::{color as write_color, write};

pub(crate) fn generated_sheet_names(sheets: &[crate::model::Sheet]) -> crate::Result<Vec<String>> {
    write::sheet_names(sheets, true)
}
