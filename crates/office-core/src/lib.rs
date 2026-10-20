//! The shared core of the office compiler.
//!
//! Front ends read Word (.docx), PowerPoint (.pptx), Excel (.xlsx) and CSV into one model,
//! layers add what only one format has, and back ends write the model out again. The core works
//! on bytes only: no file system and no platform code, so it also builds for WebAssembly.
//!
//! See `docs/internals/office-compiler.md` for the design.

pub mod drawing;
mod error;
pub mod opc;
pub mod units;
pub mod xml;

pub use error::{Error, Result};
