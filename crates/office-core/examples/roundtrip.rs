//! Reads a file, writes it back (or as another kind), and says what changed.
//!     cargo run --example roundtrip -- in.pptx out.pptx

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).unwrap();
    let doc = office_core::read(&bytes, Some(&args[1])).unwrap();
    let kind = args[2].rsplit_once('.').and_then(|(_, e)| office_core::Kind::from_extension(e)).unwrap();
    let out = office_core::write(&doc, kind).unwrap();
    std::fs::write(&args[2], &out).unwrap();
    let back = office_core::read(&out, Some(&args[2])).unwrap();
    println!("model unchanged: {}", back.body == doc.body);
    if let (Ok(a), Ok(b)) = (office_core::opc::Package::read(&bytes), office_core::opc::Package::read(&out)) {
        for name in a.part_names() {
            match b.part(name) {
                Ok(p) if p == a.part(name).unwrap() => {}
                Ok(_) => println!("rewritten: {name}"),
                Err(_) => println!("gone: {name}"),
            }
        }
        for name in b.part_names().filter(|n| !a.has(n)) {
            println!("new: {name}");
        }
    }
}
