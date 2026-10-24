//! Helpers every front end and back end uses.

use crate::model::{Document, Media, MediaData, Origin};
use crate::opc::{rels::kind, Package, Relationships};
use crate::xml::{ns, Element, Node};

/// `el` without the children `owned` says the model reads, as a node's [`Origin`].
pub fn shell(el: &Element, owned: impl Fn(&Element) -> bool) -> Origin {
    let mut copy = Element {
        prefix: el.prefix.clone(),
        local: el.local.clone(),
        ns: el.ns.clone(),
        attrs: el.attrs.clone(),
        children: Vec::with_capacity(4),
    };
    for n in &el.children {
        match n {
            Node::Element(e) if owned(e) => {}
            // Whitespace between elements comes back where the writer puts it, if anywhere.
            Node::Text(t) if t.trim().is_empty() => {}
            n => copy.children.push(n.clone()),
        }
    }
    Origin::new(copy)
}

/// One part's relationships, read once, for resolving `r:id`s while reading it.
pub struct PartRels<'a> {
    pub pkg: &'a Package,
    pub part: String,
    pub rels: Relationships,
}

impl<'a> PartRels<'a> {
    pub fn new(pkg: &'a Package, part: &str) -> crate::Result<PartRels<'a>> {
        Ok(PartRels { pkg, part: part.to_string(), rels: pkg.rels(part)? })
    }

    /// The part an internal relationship points at.
    pub fn part(&self, id: &str) -> Option<String> {
        self.rels.get(id).and_then(|r| self.pkg.target(&self.part, r))
    }

    /// An external relationship's URL (a hyperlink).
    pub fn url(&self, id: &str) -> Option<String> {
        self.rels.get(id).filter(|r| r.external).map(|r| r.target.clone())
    }

    /// Registers the picture a relationship points at as the document's media, and returns its id.
    pub fn media(&self, doc: &mut Document, id: &str) -> Option<String> {
        let rel = self.rels.get(id)?;
        if !rel.is(kind::IMAGE) && !rel.rel_type.ends_with("/media") && !rel.rel_type.ends_with("/video") {
            return None;
        }
        let part = self.pkg.target(&self.part, rel)?;
        if !self.pkg.has(&part) {
            return None;
        }
        if doc.media(&part).is_none() {
            let content_type = self.pkg.content_type(&part).unwrap_or("application/octet-stream").to_string();
            doc.media.push(Media { id: part.clone(), content_type, data: MediaData::InPackage });
        }
        Some(part)
    }
}

/// The `r:id`-style attribute in the relationships namespace.
pub fn rel_attr<'e>(el: &'e Element, local: &str) -> Option<&'e str> {
    el.attr_ns(ns::R, local)
}

/// What a theme part a main part relates to says, if it has one.
pub fn read_theme(pkg: &Package, part: &str) -> crate::Result<Option<crate::drawing::Theme>> {
    let Some((_, theme)) = pkg.related(part, kind::THEME)?.into_iter().next() else { return Ok(None) };
    if !pkg.has(&theme) {
        return Ok(None);
    }
    Ok(crate::drawing::Theme::parse(&pkg.xml(&theme)?))
}

// ---- writing ----

/// The origin's element, if it's `local` in `ns`. Origins from another format (a Word run in a
/// document being saved as PowerPoint) don't apply, and the writer starts fresh.
pub fn origin_as(origin: &Origin, ns: &str, local: &str) -> Option<Element> {
    origin.get().filter(|e| e.is(ns, local)).cloned()
}

/// Whether an element (or anything in it) names another part by relationship id.
pub fn names_parts(el: &Element) -> bool {
    el.attrs.iter().any(|a| a.ns.as_deref().is_some_and(|n| crate::xml::ns::same(n, crate::xml::ns::R))) || el.elements().any(names_parts)
}

/// A package being written, with where each of the document's media went.
pub struct Out<'a> {
    pub doc: &'a Document,
    pub pkg: Package,
    /// Whether `pkg` started as the document's own package.
    pub same: bool,
    media: std::collections::HashMap<String, String>,
    media_folder: &'static str,
}

impl<'a> Out<'a> {
    pub fn new(doc: &'a Document, pkg: Package, same: bool, media_folder: &'static str) -> Out<'a> {
        Out { doc, pkg, same, media: Default::default(), media_folder }
    }

    /// The part holding media `id` in the package being written, copying or adding it if needed.
    pub fn media_part(&mut self, id: &str) -> crate::Result<String> {
        if let Some(part) = self.media.get(id) {
            return Ok(part.clone());
        }
        let m = self.doc.media(id).ok_or_else(|| crate::Error::MissingPart(id.to_string()))?;
        let part = if self.same && matches!(m.data, MediaData::InPackage) && self.pkg.has(id) {
            id.to_string()
        } else {
            let ext = crate::opc::content_types::types::extension_for(&m.content_type).unwrap_or_else(|| crate::opc::names::extension(id));
            let ext = if ext.is_empty() { "bin".to_string() } else { ext };
            let part = self.pkg.unused_name(&format!("{}/image{{}}.{ext}", self.media_folder));
            let bytes = self.doc.media_bytes(id)?;
            self.pkg.put(&part, bytes.to_vec(), &m.content_type);
            part
        };
        self.media.insert(id.to_string(), part.clone());
        Ok(part)
    }
}

/// One part's relationships while the part is written: read once, updated in memory, written
/// back by [`PartCtx::finish`].
pub struct PartCtx {
    pub part: String,
    pub rels: Relationships,
}

impl PartCtx {
    pub fn load(pkg: &Package, part: &str) -> crate::Result<PartCtx> {
        Ok(PartCtx { part: part.to_string(), rels: pkg.rels(part)? })
    }

    pub fn finish(self, pkg: &mut Package) {
        pkg.put_rels(&self.part, &self.rels);
    }

    pub fn url(&self, id: &str) -> Option<&str> {
        self.rels.get(id).filter(|r| r.external).map(|r| r.target.as_str())
    }

    /// The id of an external hyperlink to `url`, made if there isn't one.
    pub fn link(&mut self, url: &str) -> String {
        self.rels.link(url)
    }

    /// The id of a relationship of type `kind_` to `part`, made if there isn't one.
    pub fn relate(&mut self, kind_: &str, part: &str) -> String {
        let me = self.part.clone();
        if let Some(r) = self.rels.of_kind(kind_).find(|r| !r.external && crate::opc::names::resolve(&me, &r.target) == part) {
            return r.id.clone();
        }
        self.rels.add(kind_, crate::opc::names::relative(&me, part), false)
    }

    /// The id to use for picture `media`, from this part.
    pub fn image(&mut self, out: &mut Out, media: &str) -> crate::Result<String> {
        let part = out.media_part(media)?;
        Ok(self.relate(kind::IMAGE, &part))
    }
}

/// Writes a part unless it says the same as it does now, so an untouched part keeps its bytes.
/// A part that's there already keeps its declaration and whatever surrounds its root.
pub fn put_if_changed(pkg: &mut Package, part: &str, mut doc: crate::xml::XmlDoc, media: &str) -> crate::Result<()> {
    if let Some(old) = pkg.has(part).then(|| pkg.xml_shared(part).ok()).flatten() {
        doc.declaration = old.declaration.clone();
        doc.before = old.before.clone();
        doc.after = old.after.clone();
        if old.root.same_content(&doc.root) {
            return Ok(());
        }
    }
    pkg.put_xml(part, &doc, media);
    Ok(())
}

/// A table's grid for its column widths, made from the grid it was read with: each column
/// reuses the one at its place (`col` keeps what it carries and sets the width), and the grid's
/// other children (Word's tracked grid change) stay after them.
pub fn grid(
    had: Option<&Element>,
    widths: &[crate::units::Emu],
    new: impl Fn() -> Element,
    col: impl Fn(Option<Element>, crate::units::Emu) -> Element,
) -> Element {
    let mut grid = had.cloned().unwrap_or_else(new);
    let ns = grid.ns.clone();
    let mut old = Vec::new();
    grid.children.retain(|n| match n {
        Node::Element(e) if e.local == "gridCol" && e.ns == ns => {
            old.push(e.clone());
            false
        }
        Node::Text(t) => !t.trim().is_empty(),
        _ => true,
    });
    let mut old = old.into_iter();
    let cols = widths.iter().map(|w| Node::Element(col(old.next(), *w)));
    grid.children.splice(0..0, cols);
    grid
}

/// Fails unless a main part's root is the element its format says. One in another namespace
/// (Excel 2007's beta wrote its own) would read as an empty document, and saving it would then
/// remove what the file held.
pub fn expect_root(root: &Element, part: &str, ns: &str, local: &str) -> crate::Result<()> {
    if root.is(ns, local) {
        return Ok(());
    }
    let found = root.ns.as_deref().unwrap_or("no namespace");
    Err(crate::Error::Invalid(format!("{part} isn't a document this app reads: its root is {} in {found}", root.local)))
}
