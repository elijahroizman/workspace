//! Times typing into a Word file with the view: `cargo run --release --example typing -- file.docx`.
use std::time::Instant;

use office_engine::measure::FixedMeasurer;
use office_engine::pos::{Path, Pos, Selection};
use office_word::view::WordView;

fn main() {
    let path = std::env::args().nth(1).expect("a .docx file");
    let bytes = std::fs::read(&path).unwrap();
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&bytes).unwrap();
    v.layout(&mut host);
    v.set_selection(Selection::caret(Pos::new(Path::top(3), 5)));
    let mut times = Vec::new();
    for _ in 0..30 {
        let t = Instant::now();
        v.insert_text("q");
        let a = t.elapsed();
        v.layout(&mut host);
        let b = t.elapsed();
        let page = v.caret_page(&mut host);
        let _ = v.paint(&mut host, page);
        let c = t.elapsed();
        let _ = v.overlay(&mut host);
        let _ = v.state();
        let d = t.elapsed();
        times.push((a, b - a, c - b, d - c));
    }
    let n = times.len() as u32;
    let sum = |f: fn(&(std::time::Duration, std::time::Duration, std::time::Duration, std::time::Duration)) -> std::time::Duration| {
        times.iter().map(f).sum::<std::time::Duration>() / n
    };
    println!("per key: edit {:?} layout {:?} paint {:?} overlay+state {:?}", sum(|t| t.0), sum(|t| t.1), sum(|t| t.2), sum(|t| t.3));
}
