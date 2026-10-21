//! The Open Packaging Conventions: the zip of parts every Word, PowerPoint and Excel file is.
//!
//! A [`Package`] read from a file keeps the file's bytes. Parts are decompressed only when
//! something asks for them, and a part nobody replaced is copied into the saved zip still
//! compressed, so saving a 200 MB deck with one edited slide costs one slide's worth of work.

pub mod content_types;
pub mod names;
pub mod props;
pub mod rels;

use std::io::{Cursor, Read, Write};
use std::sync::{Arc, OnceLock};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub use content_types::ContentTypes;
pub use props::Properties;
pub use rels::{Relationship, Relationships};

use crate::xml::{self, XmlDoc};
use crate::{Error, Result};

/// The most a package may hold once decompressed, so a zip bomb fails instead of eating memory.
const MAX_SIZE: u64 = 4 << 30;

type Archive = ZipArchive<Cursor<Arc<[u8]>>>;

#[derive(Clone, Default)]
pub struct Package {
    content_types: ContentTypes,
    /// Entry of `[Content_Types].xml` in the source zip, while the types are unchanged.
    content_types_entry: Option<usize>,
    parts: Vec<Part>,
    /// The zip this package was read from; cloning one shares the parsed directory.
    source: Option<Archive>,
}

#[derive(Clone)]
struct Part {
    name: String,
    /// Entry in the source zip, while the part is unchanged.
    entry: Option<usize>,
    data: OnceLock<Vec<u8>>,
}

impl std::fmt::Debug for Package {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Package").field("parts", &self.part_names().collect::<Vec<_>>()).finish()
    }
}

impl Package {
    /// An empty package: just the standard content types.
    pub fn new() -> Package {
        Package { content_types: ContentTypes::standard(), ..Default::default() }
    }

    pub fn read(bytes: &[u8]) -> Result<Package> {
        let data: Arc<[u8]> = Arc::from(bytes);
        let mut archive = ZipArchive::new(Cursor::new(data))?;
        let mut parts: Vec<Part> = Vec::new();
        let mut content_types_entry = None;
        let mut total = 0u64;
        for i in 0..archive.len() {
            let file = archive.by_index_raw(i)?;
            if file.is_dir() {
                continue;
            }
            total = total
                .checked_add(file.size())
                .filter(|t| *t <= MAX_SIZE)
                .ok_or_else(|| Error::Zip("the file is too large once decompressed".into()))?;
            let name = file.name().trim_start_matches('/').to_string();
            if name.eq_ignore_ascii_case(content_types::PART) {
                content_types_entry = Some(i);
            } else if !parts.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
                parts.push(Part { name, entry: Some(i), data: OnceLock::new() });
            }
        }
        let mut pkg = Package { content_types: ContentTypes::default(), content_types_entry, parts, source: Some(archive) };
        let entry = content_types_entry.ok_or_else(|| Error::MissingPart(content_types::PART.into()))?;
        let ct = pkg.decompress(entry)?;
        let doc = xml::parse(&ct).map_err(|message| Error::Xml { part: content_types::PART.into(), message })?;
        pkg.content_types = ContentTypes::parse(&doc);
        Ok(pkg)
    }

    /// The package as a zip. Unchanged parts are copied from the source still compressed.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut source = self.source.clone();
        let mut copy = |zip: &mut ZipWriter<_>, entry: usize| -> Result<()> {
            let archive = source.as_mut().expect("parts with an entry come from a source zip");
            zip.raw_copy_file(archive.by_index_raw(entry)?)?;
            Ok(())
        };
        // [Content_Types].xml goes first, as Office writes it.
        match self.content_types_entry {
            Some(entry) => copy(&mut zip, entry)?,
            None => {
                zip.start_file(content_types::PART, options)?;
                write_all(&mut zip, &self.content_types.to_xml().to_bytes())?;
            }
        }
        for part in &self.parts {
            match (part.entry, part.data.get()) {
                (Some(entry), _) => copy(&mut zip, entry)?,
                (None, Some(data)) => {
                    zip.start_file(part.name.as_str(), options)?;
                    write_all(&mut zip, data)?;
                }
                (None, None) => unreachable!("a new part always has its bytes"),
            }
        }
        Ok(zip.finish()?.into_inner())
    }

    fn decompress(&self, entry: usize) -> Result<Vec<u8>> {
        let mut archive = self.source.clone().expect("parts with an entry come from a source zip");
        let file = archive.by_index(entry)?;
        // The declared size is the limit: `read` added them up against MAX_SIZE, so an entry
        // that inflates past its own can't get round that.
        let declared = file.size();
        let mut out = Vec::with_capacity(declared.min(1 << 24) as usize);
        file.take(declared + 1).read_to_end(&mut out).map_err(|e| Error::Zip(e.to_string()))?;
        if out.len() as u64 > declared {
            return Err(Error::Zip("a part is larger than the file says".into()));
        }
        Ok(out)
    }

    fn find(&self, name: &str) -> Option<usize> {
        let name = name.trim_start_matches('/');
        self.parts.iter().position(|p| p.name == name).or_else(|| self.parts.iter().position(|p| p.name.eq_ignore_ascii_case(name)))
    }

    // ---- reading ----

    /// Every part's name, in zip order (not `[Content_Types].xml`).
    pub fn part_names(&self) -> impl Iterator<Item = &str> {
        self.parts.iter().map(|p| p.name.as_str())
    }

    pub fn has(&self, name: &str) -> bool {
        self.find(name).is_some()
    }

    /// A part's bytes. Part names compare without case when there's no exact match, as OPC says.
    pub fn part(&self, name: &str) -> Result<&[u8]> {
        let part = &self.parts[self.find(name).ok_or_else(|| Error::MissingPart(name.into()))?];
        if let Some(data) = part.data.get() {
            return Ok(data);
        }
        let entry = part.entry.expect("a part without bytes comes from the source zip");
        let data = self.decompress(entry)?;
        Ok(part.data.get_or_init(|| data))
    }

    /// A part, parsed.
    pub fn xml(&self, name: &str) -> Result<XmlDoc> {
        xml::parse(self.part(name)?).map_err(|message| Error::Xml { part: name.into(), message })
    }

    pub fn content_types(&self) -> &ContentTypes {
        &self.content_types
    }

    pub fn content_type(&self, name: &str) -> Option<&str> {
        self.content_types.get(name)
    }

    /// The relationships owned by `source` (`""` for the package's own). None is an empty list.
    pub fn rels(&self, source: &str) -> Result<Relationships> {
        let name = names::rels_part(source);
        if !self.has(&name) {
            return Ok(Relationships::default());
        }
        Ok(Relationships::parse(&self.xml(&name)?))
    }

    /// The part a relationship of `source`'s points at, if it's internal.
    pub fn target(&self, source: &str, rel: &Relationship) -> Option<String> {
        (!rel.external).then(|| names::resolve(source, &rel.target))
    }

    /// The parts `source` relates to with relationships of type `kind`, in relationship order.
    pub fn related(&self, source: &str, kind: &str) -> Result<Vec<(Relationship, String)>> {
        let rels = self.rels(source)?;
        Ok(rels.of_kind(kind).filter_map(|r| Some((r.clone(), self.target(source, r)?))).collect())
    }

    /// The document's main part: `word/document.xml`, `ppt/presentation.xml` or `xl/workbook.xml`.
    pub fn main_part(&self) -> Result<String> {
        let rels = self.rels("")?;
        let rel = rels.first(rels::kind::OFFICE_DOCUMENT).ok_or_else(|| Error::MissingPart("main document part".into()))?;
        Ok(names::resolve("", &rel.target))
    }

    /// The first name from `pattern` (with `{}` for a number from 1) that no part has:
    /// `unused_name("word/media/image{}.png")`.
    pub fn unused_name(&self, pattern: &str) -> String {
        (1..).map(|n| pattern.replacen("{}", &n.to_string(), 1)).find(|name| !self.has(name)).unwrap()
    }

    // ---- writing ----

    /// Adds or replaces a part.
    pub fn put(&mut self, name: &str, data: Vec<u8>, media_type: &str) {
        let name = name.trim_start_matches('/');
        let data = OnceLock::from(data);
        match self.find(name) {
            Some(i) => {
                let part = &mut self.parts[i];
                part.entry = None;
                part.data = data;
            }
            None => self.parts.push(Part { name: name.to_string(), entry: None, data }),
        }
        if self.content_types.get(name) != Some(media_type) {
            self.content_types.set(name, media_type);
            self.content_types_entry = None;
        }
    }

    pub fn put_xml(&mut self, name: &str, doc: &XmlDoc, media_type: &str) {
        self.put(name, doc.to_bytes(), media_type);
    }

    /// Replaces a part's bytes, keeping its media type. For parts the package already has.
    pub fn replace(&mut self, name: &str, data: Vec<u8>) -> Result<()> {
        let i = self.find(name).ok_or_else(|| Error::MissingPart(name.into()))?;
        self.parts[i].entry = None;
        self.parts[i].data = OnceLock::from(data);
        Ok(())
    }

    /// Removes a part, its relationships part and its content type override.
    pub fn remove(&mut self, name: &str) {
        let Some(i) = self.find(name) else { return };
        let part = self.parts.remove(i);
        let before = self.content_types.overrides.len();
        self.content_types.remove(&part.name);
        if self.content_types.overrides.len() != before {
            self.content_types_entry = None;
        }
        self.remove(&names::rels_part(&part.name));
    }

    /// Writes `source`'s relationships. An empty list removes the relationships part.
    pub fn put_rels(&mut self, source: &str, rels: &Relationships) {
        let name = names::rels_part(source);
        if rels.0.is_empty() {
            self.remove(&name);
        } else if self.rels(source).ok().as_ref() != Some(rels) {
            self.put_xml(&name, &rels.to_xml(), content_types::types::RELS);
        }
    }

    /// Relates `source` to `part` with a relationship of type `kind`, reusing one that already
    /// does, and returns its id.
    pub fn relate(&mut self, source: &str, kind: &str, part: &str) -> Result<String> {
        let mut rels = self.rels(source)?;
        let target = names::relative(source, part);
        if let Some(r) = rels.of_kind(kind).find(|r| !r.external && names::resolve(source, &r.target) == part) {
            return Ok(r.id.clone());
        }
        let id = rels.add(kind, target, false);
        self.put_rels(source, &rels);
        Ok(id)
    }

    /// Adds an external relationship (a hyperlink) from `source` and returns its id.
    pub fn relate_external(&mut self, source: &str, kind: &str, url: &str) -> Result<String> {
        let mut rels = self.rels(source)?;
        if let Some(r) = rels.of_kind(kind).find(|r| r.external && r.target == url) {
            return Ok(r.id.clone());
        }
        let id = rels.add(kind, url, true);
        self.put_rels(source, &rels);
        Ok(id)
    }
}

fn write_all(zip: &mut ZipWriter<Cursor<Vec<u8>>>, data: &[u8]) -> Result<()> {
    zip.write_all(data).map_err(|e| Error::Zip(e.to_string()))
}

#[cfg(test)]
mod tests;
