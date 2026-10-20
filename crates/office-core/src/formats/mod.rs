//! A front end and a back end for each format.

pub mod csv;

use crate::model::{Document, Kind};
use crate::opc::Package;
use crate::{Error, Result};

/// What a back end produces: a package (which layers may still add parts to), or finished bytes.
pub enum Output {
    Package(Package),
    Bytes(Vec<u8>),
}

/// Reads `bytes`, already known to be `kind`. `name` is the file's name, if known.
pub fn read(bytes: &[u8], kind: Kind, name: Option<&str>) -> Result<Document> {
    match kind {
        Kind::Csv => {
            let stem = name.and_then(|n| n.rsplit(['/', '\\']).next()).map(|n| n.rsplit_once('.').map_or(n, |(s, _)| s));
            let tsv = name.is_some_and(|n| n.to_ascii_lowercase().ends_with(".tsv"));
            csv::read(bytes, stem.filter(|s| !s.is_empty()).unwrap_or("Sheet1"), tsv)
        }
        Kind::Word | Kind::Slides | Kind::Sheets => Err(Error::Invalid(format!("reading .{} isn't written yet", kind.extension()))),
    }
}

/// Writes `doc` as `kind`.
pub fn write(doc: &Document, kind: Kind) -> Result<Output> {
    match kind {
        Kind::Csv => csv::write(doc).map(Output::Bytes),
        Kind::Word | Kind::Slides | Kind::Sheets => Err(Error::Invalid(format!("writing .{} isn't written yet", kind.extension()))),
    }
}
