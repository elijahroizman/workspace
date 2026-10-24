//! The shared core of the office compiler.
//!
//! Front ends read Word (.docx), PowerPoint (.pptx), Excel (.xlsx) and CSV into one model,
//! layers add what only one format has, and back ends write the model out again. The core works
//! on bytes only: no file system and no platform code, so it also builds for WebAssembly.
//!
//! ```
//! let csv = b"name,qty\r\nApple,3\r\n";
//! let doc = office_core::read(csv, Some("fruit.csv")).unwrap();
//! assert_eq!(doc.kind, office_core::Kind::Csv);
//! assert_eq!(office_core::write(&doc, office_core::Kind::Csv).unwrap(), csv);
//! ```
//!
//! See `docs/internals/office-compiler.md` for the design.

pub mod convert;
pub mod drawing;
mod error;
pub mod formats;
pub mod layer;
pub mod model;
pub mod opc;
pub mod units;
pub mod xml;

pub use error::{Error, Result};
pub use layer::Layer;
pub use model::{Document, Kind};

use formats::Output;
use opc::Package;

/// Reads and writes documents, running the layers it has been given.
#[derive(Default)]
pub struct Compiler {
    layers: Vec<Box<dyn Layer>>,
}

impl Compiler {
    pub fn new() -> Compiler {
        Compiler::default()
    }

    pub fn with_layer(mut self, layer: impl Layer + 'static) -> Compiler {
        self.layers.push(Box::new(layer));
        self
    }

    /// Reads a document. `name` is the file's name, if known; it helps tell CSV from other text
    /// and names a CSV file's sheet.
    pub fn read(&self, bytes: &[u8], name: Option<&str>) -> Result<Document> {
        let kind = detect(bytes, name)?;
        let mut doc = formats::read(bytes, kind, name)?;
        for layer in self.layers_for(doc.kind) {
            layer.after_read(&mut doc).map_err(|e| layer_error(layer, e))?;
        }
        Ok(doc)
    }

    /// Writes a document as `kind`: its own kind to save it, another to convert it (see
    /// [`convert::to_kind`]).
    pub fn write(&self, doc: &Document, kind: Kind) -> Result<Vec<u8>> {
        let mut prepared;
        let mut doc = doc;
        if !convert::fits(doc, kind) || (doc.kind != kind && doc.package.is_some()) {
            prepared = convert::to_kind(doc, kind)?;
            doc = &prepared;
        }
        if self.layers_for(kind).next().is_some() {
            prepared = doc.clone();
            for layer in self.layers_for(kind) {
                layer.before_write(&mut prepared, kind).map_err(|e| layer_error(layer, e))?;
            }
            doc = &prepared;
        }
        match formats::write(doc, kind)? {
            Output::Bytes(bytes) => Ok(bytes),
            Output::Package(mut pkg) => {
                for layer in self.layers_for(kind) {
                    layer.write_parts(doc, &mut pkg, kind).map_err(|e| layer_error(layer, e))?;
                }
                pkg.to_bytes()
            }
        }
    }

    fn layers_for(&self, kind: Kind) -> impl Iterator<Item = &dyn Layer> {
        self.layers.iter().map(|l| l.as_ref()).filter(move |l| l.kinds().contains(&kind))
    }
}

fn layer_error(layer: &dyn Layer, e: Error) -> Error {
    match e {
        Error::Layer { .. } => e,
        e => Error::Layer { layer: layer.name(), message: e.to_string() },
    }
}

/// Reads a document with no layers.
pub fn read(bytes: &[u8], name: Option<&str>) -> Result<Document> {
    Compiler::new().read(bytes, name)
}

/// Writes a document with no layers.
pub fn write(doc: &Document, kind: Kind) -> Result<Vec<u8>> {
    Compiler::new().write(doc, kind)
}

/// What kind of document `bytes` is. A zip is told apart by its main part's content type; other
/// bytes are CSV if the name says so, or if there's no name and they look like text.
pub fn detect(bytes: &[u8], name: Option<&str>) -> Result<Kind> {
    if bytes.starts_with(b"PK\x03\x04") {
        let pkg = Package::read(bytes)?;
        let main = pkg.main_part()?;
        return pkg.content_type(&main).and_then(Kind::from_main_content_type).ok_or(Error::UnknownFormat);
    }
    if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
        // Office saves a password-protected .docx, .pptx or .xlsx as a compound file too, holding
        // the encrypted zip in a stream named EncryptedPackage.
        if is_encrypted_package(bytes) {
            return Err(Error::Invalid(
                "this file is protected with a password, which isn't supported: remove the password in Office and open it again".into(),
            ));
        }
        return Err(Error::Invalid("this is an old binary Office file (.doc, .ppt or .xls), which isn't supported".into()));
    }
    let ext = name.and_then(|n| n.rsplit_once('.')).map(|(_, e)| e);
    match ext.and_then(Kind::from_extension) {
        Some(Kind::Csv) => Ok(Kind::Csv),
        Some(_) => Err(Error::Zip("the file isn't a zip, so it's damaged or not really an Office file".into())),
        None if name.is_none() && looks_like_text(bytes) => Ok(Kind::Csv),
        None => Err(Error::UnknownFormat),
    }
}

/// Whether a compound file has the stream an encrypted Office package is kept in: its name in
/// the file's directory, which is UTF-16.
fn is_encrypted_package(bytes: &[u8]) -> bool {
    let name: Vec<u8> = "EncryptedPackage".encode_utf16().flat_map(u16::to_le_bytes).collect();
    bytes.windows(name.len()).any(|w| w == name)
}

fn looks_like_text(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(4096)];
    sample.starts_with(&[0xFF, 0xFE]) || sample.starts_with(&[0xFE, 0xFF]) || !sample.contains(&0)
}
