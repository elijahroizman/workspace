//! Workbooks with a lot of cells: they read and write a row at a time, and saving leaves
//! the sheets nobody touched alone without reading them again.

use std::time::Instant;

use office_core::model::{Body, CellRef, Sheet, Value};
use office_core::opc::Package;
use office_core::{Document, Kind};

fn workbook(rows: u32, cols: u32) -> Document {
    let mut doc = Document::new(Kind::Sheets);
    let mut big = Sheet::new("Big");
    for r in 0..rows {
        for c in 0..cols {
            let v = if c == 0 { Value::Text(format!("row {}", r % 1000)) } else { Value::Number((r * cols + c) as f64 / 4.0) };
            big.set(CellRef::new(r, c), v);
        }
    }
    let mut small = Sheet::new("Small");
    small.set(CellRef::new(0, 0), Value::Text("hello".into()));
    doc.body = Body::Workbook { sheets: vec![big, small] };
    doc
}

fn sheets(doc: &mut Document) -> &mut Vec<Sheet> {
    match &mut doc.body {
        Body::Workbook { sheets } => sheets,
        _ => unreachable!(),
    }
}

fn check(rows: u32, cols: u32) {
    let started = Instant::now();
    let bytes = office_core::write(&workbook(rows, cols), Kind::Sheets).unwrap();
    let wrote = started.elapsed();
    let started = Instant::now();
    let mut doc = office_core::read(&bytes, Some("big.xlsx")).unwrap();
    let read = started.elapsed();
    assert_eq!(doc.sheet_value(CellRef::new(rows - 1, cols - 1)), Some(&Value::Number(((rows - 1) * cols + cols - 1) as f64 / 4.0)));
    // Cells as plain as these keep no markup of their own.
    assert!(sheets(&mut doc)[0].rows.iter().flat_map(|r| &r.cells).all(|c| c.origin.get().is_none()));

    // Saved unchanged: the same bytes, without writing any sheet.
    let started = Instant::now();
    let again = office_core::write(&doc, Kind::Sheets).unwrap();
    let saved = started.elapsed();
    assert_eq!(again, bytes);

    // One cell changed on the small sheet: the big one is left alone.
    sheets(&mut doc)[1].set(CellRef::new(0, 1), Value::Text("new".into()));
    let edited = office_core::write(&doc, Kind::Sheets).unwrap();
    let (a, b) = (Package::read(&bytes).unwrap(), Package::read(&edited).unwrap());
    assert_eq!(a.part("xl/worksheets/sheet1.xml").unwrap(), b.part("xl/worksheets/sheet1.xml").unwrap());
    assert_ne!(a.part("xl/worksheets/sheet2.xml").unwrap(), b.part("xl/worksheets/sheet2.xml").unwrap());
    let back = office_core::read(&edited, Some("big.xlsx")).unwrap();
    let Body::Workbook { sheets } = &back.body else { unreachable!() };
    assert_eq!(sheets[1].value(CellRef::new(0, 1)), &Value::Text("new".into()));
    assert_eq!(sheets[0].value(CellRef::new(5, 0)), &Value::Text("row 5".into()));
    eprintln!("{rows}×{cols}: wrote {wrote:?}, read {read:?}, saved unchanged {saved:?}, {} KB", bytes.len() / 1024);
}

#[test]
fn fifty_thousand_cells() {
    check(10_000, 5);
}

/// A million cells; slow in a debug build, so `cargo test --release --test big_sheets -- --ignored`.
#[test]
#[ignore]
fn a_million_cells() {
    check(100_000, 10);
}
