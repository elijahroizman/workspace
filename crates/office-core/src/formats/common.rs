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
