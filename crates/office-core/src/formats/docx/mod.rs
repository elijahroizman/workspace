//! Word (.docx): the body's paragraphs and tables. Styles, numbering, sections, headers and
//! footers, notes, comments and tracked changes stay in the package (and in raw nodes) for the
//! Word layer.

mod props;
mod read;

pub use props::{read_para_props, read_run_props};
pub use read::read;
