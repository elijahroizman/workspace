//! Times opening, laying out and saving a Word file with the view: `cargo run --release --example timing -- file.docx`.
use std::time::Instant;

use office_engine::measure::FixedMeasurer;
use office_word::view::WordView;

fn main() {
    let path = std::env::args().nth(1).expect("a .docx file");
    let bytes = std::fs::read(&path).unwrap();
    let mut host = FixedMeasurer::default();
    let t = Instant::now();
    let mut v = WordView::open(&bytes).unwrap();
    let open = t.elapsed();
    let t = Instant::now();
    v.layout(&mut host);
    let layout = t.elapsed();
    let t = Instant::now();
    let out = v.save().unwrap();
    let save = t.elapsed();
    let t = Instant::now();
    let core = office_core::Compiler::new().write(&v.doc, office_core::Kind::Word).unwrap();
    let core_save = t.elapsed();
    println!("open {open:?} layout {layout:?} save {save:?} (core only {core_save:?}) pages {} bytes {} -> {} / {}", v.page_count(), bytes.len(), out.len(), core.len());
}
