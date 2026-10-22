//! Document properties: `docProps/core.xml` (title, author, dates) and `docProps/app.xml`
//! (the application that wrote the file, the company). Every format has the same two parts.
//!
//! Writing patches the parts that are there, so properties the model doesn't cover (language,
//! content status, Word's page and word counts) stay.

use serde::{Deserialize, Serialize};

use super::content_types::types;
use super::rels::kind;
use super::Package;
use crate::xml::{ns, Element, Node, XmlDoc};
use crate::Result;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Properties {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// The author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keywords: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    /// W3C date-times, as written: `2026-10-20T09:30:00Z`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    /// From app.xml.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company: Option<String>,
}

const CORE_PART: &str = "docProps/core.xml";
const APP_PART: &str = "docProps/app.xml";

/// (field, namespace, element) for each core property, in the order Office writes them.
fn core_fields(p: &mut Properties) -> [(&mut Option<String>, &'static str, &'static str); 10] {
    [
        (&mut p.title, ns::DC, "title"),
        (&mut p.subject, ns::DC, "subject"),
        (&mut p.creator, ns::DC, "creator"),
        (&mut p.keywords, ns::CP, "keywords"),
        (&mut p.description, ns::DC, "description"),
        (&mut p.last_modified_by, ns::CP, "lastModifiedBy"),
        (&mut p.revision, ns::CP, "revision"),
        (&mut p.created, ns::DCTERMS, "created"),
        (&mut p.modified, ns::DCTERMS, "modified"),
        (&mut p.category, ns::CP, "category"),
    ]
}

impl Properties {
    pub fn read(pkg: &Package) -> Result<Properties> {
        let mut props = Properties::default();
        if let Some(part) = props_part(pkg, kind::CORE_PROPERTIES, CORE_PART)? {
            let doc = pkg.xml(&part)?;
            for (field, uri, local) in core_fields(&mut props) {
                *field = doc.root.child(uri, local).map(Element::text);
            }
        }
        if let Some(part) = props_part(pkg, kind::EXTENDED_PROPERTIES, APP_PART)? {
            let doc = pkg.xml(&part)?;
            props.application = doc.root.child(ns::EP, "Application").map(Element::text);
            props.company = doc.root.child(ns::EP, "Company").map(Element::text);
        }
        Ok(props)
    }

    /// Writes the properties into `pkg`, making the parts (and their relationships) if needed.
    /// Does nothing to a part whose properties haven't changed.
    pub fn write(&self, pkg: &mut Package) -> Result<()> {
        if self == &Properties::read(pkg)? {
            return Ok(());
        }
        let mut props = self.clone();

        let core = props_part(pkg, kind::CORE_PROPERTIES, CORE_PART)?;
        let mut doc = match &core {
            Some(part) => pkg.xml(part)?,
            None => XmlDoc::new(new_core_root()),
        };
        let root = &mut doc.root;
        for (value, uri, local) in core_fields(&mut props) {
            let at = root.children.iter().position(|n| matches!(n, Node::Element(e) if e.is(uri, local)));
            match (value.take(), at) {
                (None, Some(i)) => {
                    root.children.remove(i);
                }
                (None, None) => {}
                (Some(v), Some(i)) => {
                    if let Node::Element(e) = &mut root.children[i] {
                        e.children = vec![Node::Text(v)];
                    }
                }
                (Some(v), None) => {
                    let mut el = Element::new(uri, local).with_text(v);
                    if uri == ns::DCTERMS {
                        let bound = root
                            .attrs
                            .iter()
                            .find(|a| a.is_ns_decl() && a.prefix.is_some() && a.value == ns::DCTERMS)
                            .map(|a| a.local.as_str());
                        let prefix = bound.unwrap_or("dcterms");
                        if bound.is_none() {
                            el.declare(Some(prefix), ns::DCTERMS);
                        }
                        el.set_attr(ns::XSI, "type", format!("{prefix}:W3CDTF"));
                    }
                    root.push(el);
                }
            }
        }
        let core = core.unwrap_or_else(|| CORE_PART.to_string());
        pkg.put_xml(&core, &doc, types::CORE_PROPERTIES);
        pkg.relate("", kind::CORE_PROPERTIES, &core)?;

        let app = props_part(pkg, kind::EXTENDED_PROPERTIES, APP_PART)?;
        if app.is_some() || self.application.is_some() || self.company.is_some() {
            let mut doc = match &app {
                Some(part) => pkg.xml(part)?,
                None => {
                    let mut root = Element::new(ns::EP, "Properties");
                    root.declare(None, ns::EP);
                    root.declare(Some("vt"), ns::VT);
                    XmlDoc::new(root)
                }
            };
            for (value, local) in [(&self.application, "Application"), (&self.company, "Company")] {
                match value {
                    Some(v) => doc.root.child_or_insert(ns::EP, local).children = vec![Node::Text(v.clone())],
                    None => {
                        doc.root.remove_children(ns::EP, local);
                    }
                }
            }
            let app = app.unwrap_or_else(|| APP_PART.to_string());
            pkg.put_xml(&app, &doc, types::EXTENDED_PROPERTIES);
            pkg.relate("", kind::EXTENDED_PROPERTIES, &app)?;
        }
        Ok(())
    }
}

/// Where the package's relationships say a properties part is, else the usual place if a part is there.
fn props_part(pkg: &Package, rel: &str, usual: &str) -> Result<Option<String>> {
    let rels = pkg.rels("")?;
    if let Some(r) = rels.first(rel) {
        if let Some(part) = pkg.target("", r).filter(|p| pkg.has(p)) {
            return Ok(Some(part));
        }
    }
    Ok(pkg.has(usual).then(|| usual.to_string()))
}

fn new_core_root() -> Element {
    let mut root = Element::new(ns::CP, "coreProperties");
    root.declare(Some("cp"), ns::CP);
    root.declare(Some("dc"), ns::DC);
    root.declare(Some("dcterms"), ns::DCTERMS);
    root.declare(Some("dcmitype"), ns::DCMITYPE);
    root.declare(Some("xsi"), ns::XSI);
    root
}
