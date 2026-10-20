//! Word (.docx): the body's paragraphs and tables. Styles, numbering, sections, headers and
//! footers, notes, comments and tracked changes stay in the package (and in raw nodes) for the
//! Word layer.

mod props;
mod read;
mod write;

pub use props::{patch_para_props, patch_run_props, read_para_props, read_run_props, write_color};
pub use read::read;
pub use write::write;
