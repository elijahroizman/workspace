//! Prints the first place two parts' XML differ: cargo run --example xmldiff -- a.zip b.zip part
use office_core::xml::{Element, Node};

fn diff(a: &Element, b: &Element, path: String) -> bool {
    let path = format!("{path}/{}", a.qname());
    if a.attrs != b.attrs || a.local != b.local {
        println!("{path}: {:?}\n  vs {:?}", a.attrs, b.attrs);
        return true;
    }
    let keep = |n: &&Node| !matches!(n, Node::Text(t) if t.contains('\n') && t.trim().is_empty());
    let (ca, cb): (Vec<_>, Vec<_>) = (a.children.iter().filter(keep).collect(), b.children.iter().filter(keep).collect());
    for (i, (x, y)) in ca.iter().zip(&cb).enumerate() {
        match (x, y) {
            (Node::Element(x), Node::Element(y)) => {
                if diff(x, y, format!("{path}[{i}]")) {
                    return true;
                }
            }
            (x, y) if x != y => {
                println!("{path}[{i}]: {x:?}\n  vs {y:?}");
                return true;
            }
            _ => {}
        }
    }
    if ca.len() != cb.len() {
        println!(
            "{path}: {} children vs {}: {:?}",
            ca.len(),
            cb.len(),
            if ca.len() > cb.len() { &ca[cb.len()..] } else { &cb[ca.len()..] }
        );
        return true;
    }
    false
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let a = office_core::opc::Package::read(&std::fs::read(&args[1]).unwrap()).unwrap();
    let b = office_core::opc::Package::read(&std::fs::read(&args[2]).unwrap()).unwrap();
    diff(&a.xml(&args[3]).unwrap().root, &b.xml(&args[3]).unwrap().root, String::new());
    println!("same_content: {}", same(&a, &b, &args[3]));
}
/// What the writers use to decide a part didn't change.
fn same(a: &office_core::opc::Package, b: &office_core::opc::Package, p: &str) -> bool {
    a.xml(p).unwrap().root.same_content(&b.xml(p).unwrap().root)
}
