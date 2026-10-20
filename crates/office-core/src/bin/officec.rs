//! officec: the office compiler from a terminal.
//!
//!     officec inspect report.docx         the model as JSON
//!     officec text deck.pptx              the document's text
//!     officec convert data.xlsx data.csv  write it as another kind (by extension)
//!     officec save report.docx [out.docx] read and write it back, and say which parts changed
//!     officec diff a.docx b.docx          which parts of two packages differ, and where
//!
//! Build it with `cargo run --features cli --bin officec -- …` in crates/.

use std::path::Path;
use std::process::ExitCode;

use office_core::opc::Package;
use office_core::xml::{Element, Node};
use office_core::Kind;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["inspect", file] => inspect(file),
        ["text", file] => read(file).map(|doc| println!("{}", office_core::convert::plain_text(&doc))),
        ["convert", from, to] => convert(from, to),
        ["save", file] => save(file, file),
        ["save", file, out] => save(file, out),
        ["diff", a, b] => diff(a, b),
        _ => {
            eprintln!("usage: officec inspect|text FILE · convert IN OUT · save FILE [OUT] · diff A B");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("officec: {e}");
            ExitCode::FAILURE
        }
    }
}

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn read(file: &str) -> Result<office_core::Document> {
    let bytes = std::fs::read(file).map_err(|e| format!("{file}: {e}"))?;
    Ok(office_core::read(&bytes, Some(file)).map_err(|e| format!("{file}: {e}"))?)
}

fn kind_of(file: &str) -> Result<Kind> {
    Path::new(file)
        .extension()
        .and_then(|e| Kind::from_extension(e.to_str()?))
        .ok_or_else(|| format!("{file}: not a .docx, .pptx, .xlsx or .csv name").into())
}

fn inspect(file: &str) -> Result {
    let doc = read(file)?;
    println!("{}", serde_json::to_string_pretty(&doc)?);
    Ok(())
}

fn convert(from: &str, to: &str) -> Result {
    let doc = read(from)?;
    std::fs::write(to, office_core::write(&doc, kind_of(to)?)?)?;
    Ok(())
}

fn save(file: &str, out: &str) -> Result {
    let before = std::fs::read(file)?;
    let doc = read(file)?;
    let after = office_core::write(&doc, kind_of(out)?)?;
    std::fs::write(out, &after)?;
    if let (Ok(a), Ok(b)) = (Package::read(&before), Package::read(&after)) {
        report(&a, &b);
    }
    Ok(())
}

fn diff(a: &str, b: &str) -> Result {
    let (a, b) = (Package::read(&std::fs::read(a)?)?, Package::read(&std::fs::read(b)?)?);
    for part in report(&a, &b) {
        if part.ends_with(".xml") || part.ends_with(".rels") {
            if let Some(at) = first_difference(&a.xml(&part)?.root, &b.xml(&part)?.root, "") {
                println!("  {at}");
            }
        }
    }
    Ok(())
}

/// Prints the parts that are new, gone or changed, and returns the changed ones.
fn report(a: &Package, b: &Package) -> Vec<String> {
    let mut changed = Vec::new();
    for name in a.part_names() {
        match (a.part(name), b.part(name)) {
            (Ok(x), Ok(y)) if x == y => {}
            (Ok(_), Ok(_)) => {
                println!("changed: {name}");
                changed.push(name.to_string());
            }
            _ => println!("gone:    {name}"),
        }
    }
    for name in b.part_names().filter(|n| !a.has(n)) {
        println!("new:     {name}");
    }
    if changed.is_empty() && a.part_names().count() == b.part_names().count() {
        println!("no part changed");
    }
    changed
}

/// Where two elements first differ, as a path, ignoring layout whitespace.
fn first_difference(a: &Element, b: &Element, path: &str) -> Option<String> {
    let path = format!("{path}/{}", a.qname());
    if a.same_content(b) {
        return None;
    }
    let content =
        |e: &Element| e.children.iter().filter(|n| !matches!(n, Node::Text(t) if t.trim().is_empty())).cloned().collect::<Vec<_>>();
    let (ca, cb) = (content(a), content(b));
    for (i, (x, y)) in ca.iter().zip(&cb).enumerate() {
        match (x, y) {
            (Node::Element(x), Node::Element(y)) if x.local == y.local => {
                if let Some(d) = first_difference(x, y, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            (x, y) if x != y => return Some(format!("{path}[{i}]: {} vs {}", node(x), node(y))),
            _ => {}
        }
    }
    if ca.len() != cb.len() {
        return Some(format!("{path}: {} children vs {}", ca.len(), cb.len()));
    }
    Some(format!("{path}: attributes {} vs {}", attrs(a), attrs(b)))
}

fn node(n: &Node) -> String {
    match n {
        Node::Element(e) => e.to_xml_string().chars().take(200).collect(),
        other => format!("{other:?}"),
    }
}

fn attrs(e: &Element) -> String {
    e.attrs.iter().map(|a| format!("{}={:?}", a.qname(), a.value)).collect::<Vec<_>>().join(" ")
}
