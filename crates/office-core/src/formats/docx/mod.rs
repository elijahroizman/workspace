//! Word (.docx): the body's paragraphs and tables. Styles, numbering, sections, headers and
//! footers, notes, comments and tracked changes stay in the package (and in raw nodes) for the
//! Word layer.

mod props;
mod read;
mod write;

pub use props::{patch_para_props, patch_run_props, read_para_props, read_run_props, toggle, val, write_color, PPR};
pub use read::{read, read_blocks_in, read_inlines_in};
pub use write::{default_styles, write, write_blocks};
