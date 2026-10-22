use office_core::model::{CellRef, Range};
use office_engine::display::Item;
use office_engine::measure::FixedMeasurer;

use super::*;

fn texts(items: &[Item]) -> Vec<String> {
    let mut out = Vec::new();
    for i in items {
        match i {
            Item::Text { text, .. } => out.push(text.clone()),
            Item::Group { items, .. } => out.extend(texts(items)),
            _ => {}
        }
    }
    out
}

#[test]
fn csv_opens_draws_edits_and_saves() {
    let mut host = FixedMeasurer::default();
    let mut v = SheetsView::open(b"name,qty\nApple,3\nPear,4\n", "fruit.csv").unwrap();
    assert_eq!(v.kind, Kind::Csv);
    let p = v.paint(&mut host, 0, 0, 10, 0, 5);
    assert_eq!(texts(&p.items), vec!["name", "qty", "Apple", "3", "Pear", "4"]);
    v.set_input(0, CellRef::new(3, 0), "Total");
    v.set_input(0, CellRef::new(3, 1), "=SUM(B2:B3)");
    assert_eq!(v.cell_info(0, CellRef::new(3, 1)).display, "7");
    assert_eq!(v.cell_info(0, CellRef::new(3, 1)).input, "=SUM(B2:B3)");
    v.set_input(0, CellRef::new(1, 1), "10");
    assert_eq!(v.cell_info(0, CellRef::new(3, 1)).display, "14");
    v.undo();
    assert_eq!(v.cell_info(0, CellRef::new(3, 1)).display, "7");
    let out = String::from_utf8(v.save().unwrap()).unwrap();
    assert!(out.contains("Total,7"), "{out}");
}

#[test]
fn workbook_formats_columns_and_sheets() {
    let mut host = FixedMeasurer::default();
    let mut v = SheetsView::blank(Kind::Sheets);
    v.set_input(0, CellRef::new(0, 0), "12%");
    assert_eq!(v.cell_info(0, CellRef::new(0, 0)).display, "12%");
    v.set_input(0, CellRef::new(1, 0), "2026-01-31");
    assert_eq!(v.cell_info(0, CellRef::new(1, 0)).display, "2026-01-31");
    let a1 = Range { start: CellRef::new(0, 0), end: CellRef::new(0, 0) };
    v.format(0, a1, &FormatPatch { bold: Some(true), fill: Some("FFFF00".into()), ..Default::default() });
    let info = v.cell_info(0, CellRef::new(0, 0));
    assert!(info.bold);
    assert_eq!(info.fill.as_deref(), Some("FFFF00"));
    v.set_column_width(0, 0, Some(120.0));
    assert_eq!(v.grid(0).width(0), 120.0);
    v.shift_rows(0, 0, 1);
    assert_eq!(v.cell_info(0, CellRef::new(1, 0)).display, "12%");
    v.toggle_merge(0, Range { start: CellRef::new(5, 0), end: CellRef::new(6, 2) });
    assert!(v.cell_info(0, CellRef::new(6, 1)).merged);
    v.add_sheet();
    v.rename_sheet(1, "Data");
    assert_eq!(v.sheets()[1].name, "Data");
    v.paste(1, Range { start: CellRef::new(0, 0), end: CellRef::new(0, 0) }, "a\tb\n1\t2\n");
    assert_eq!(v.copy(1, Range { start: CellRef::new(0, 0), end: CellRef::new(1, 1) }), "a\tb\n1\t2\n");
    let found = v.find("b");
    assert_eq!(found, vec![(1, CellRef::new(0, 1))]);
    let bytes = v.save().unwrap();
    let mut back = SheetsView::open(&bytes, "Book.xlsx").unwrap();
    assert_eq!(back.sheets().len(), 2);
    assert!(back.cell_info(0, CellRef::new(1, 0)).bold);
    assert_eq!(back.grid(0).width(0), 120.0);
    assert!(!back.paint(&mut host, 0, 0, 10, 0, 5).items.is_empty());
}
