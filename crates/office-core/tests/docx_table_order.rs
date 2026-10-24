//! Raw table content controls must keep their place beside editable rows and cells.
use office_core::model::{Block, Body, Cell, Paragraph, Row, Table};
use office_core::opc::Package;
use office_core::xml::{ns, Element, Node};
use office_core::{Document, Kind};

const SAMPLE: &[u8] = include_bytes!("../../../tests/stress/samples/table-content-controls.docx");

fn table_mut(doc: &mut Document) -> &mut Table {
    let Body::Flow { blocks } = &mut doc.body else { panic!() };
    let Block::Table(table) = &mut blocks[0] else { panic!() };
    table
}

fn saved_table(bytes: &[u8]) -> Element {
    Package::read(bytes).unwrap().xml("word/document.xml").unwrap().root.descendant(ns::W, "tbl").unwrap().clone()
}

fn names(el: &Element) -> Vec<&str> {
    el.elements().filter(|e| !e.is(ns::W, "trPr")).map(|e| e.local.as_str()).collect()
}

fn assert_order(before: &Element, after: &Element) {
    assert_eq!(names(after), names(before));
    for (old, new) in before.elements().zip(after.elements()) {
        if old.is(ns::W, "tr") {
            assert_eq!(names(new), names(old));
            let raw = |row: &Element| {
                row.children
                    .iter()
                    .filter(|n| !matches!(n, Node::Element(e) if e.is(ns::W, "tc") || e.is(ns::W, "trPr")))
                    .cloned()
                    .collect::<Vec<_>>()
            };
            assert_eq!(raw(new), raw(old));
        } else if old.is(ns::W, "sdt") {
            assert_eq!(new, old, "raw wrapped rows must survive unchanged");
        }
    }
}

#[test]
fn unchanged_table_keeps_cell_and_row_content_control_order() {
    let original = saved_table(SAMPLE);
    let mut bytes = SAMPLE.to_vec();
    for _ in 0..2 {
        let doc = office_core::read(&bytes, Some("order.docx")).unwrap();
        bytes = office_core::write(&doc, Kind::Word).unwrap();
        assert_order(&original, &saved_table(&bytes));
    }
}

#[test]
fn edited_table_keeps_raw_siblings_and_merged_cell_order() {
    let mut doc = office_core::read(SAMPLE, Some("order.docx")).unwrap();
    let table = table_mut(&mut doc);
    table.rows[0].cells[0].blocks = vec![Block::Paragraph(Paragraph::text("Edited label"))];
    table.rows[0].header = true;
    assert_eq!(table.rows[2].cells[0].col_span, 2);
    assert!(table.rows[2].cells[1].covered);
    let saved = office_core::write(&doc, Kind::Word).unwrap();
    let out = saved_table(&saved);
    assert_order(&saved_table(SAMPLE), &out);
    assert_eq!(out.children_named(ns::W, "tr").next().unwrap().child(ns::W, "tc").unwrap().text(), "Edited label");
    let mut back = office_core::read(&saved, Some("order.docx")).unwrap();
    let table = table_mut(&mut back);
    assert!(table.rows[0].header);
    assert_eq!(table.rows[2].cells[0].col_span, 2);
}

#[test]
fn added_or_removed_model_children_do_not_duplicate_saved_slots() {
    let mut doc = office_core::read(SAMPLE, Some("order.docx")).unwrap();
    let table = table_mut(&mut doc);
    table.rows[0].cells.push(Cell::text("New cell"));
    table.rows.push(Row { cells: vec![Cell::text("New row")], ..Default::default() });
    let saved = office_core::write(&doc, Kind::Word).unwrap();
    let out = saved_table(&saved);
    assert_eq!(names(&out), ["tblPr", "tblGrid", "sdt", "tr", "sdt", "tr", "tr", "tr", "tr", "sdt"]);
    let first = out.children_named(ns::W, "tr").next().unwrap();
    assert_eq!(names(first), ["tc", "tc", "sdt"]);
    assert_eq!(first.children_named(ns::W, "tc").nth(1).unwrap().text(), "New cell");
    let mut doc = office_core::read(&saved, Some("order.docx")).unwrap();
    let table = table_mut(&mut doc);
    table.rows.truncate(1);
    table.rows[0].cells.clear();
    let out = saved_table(&office_core::write(&doc, Kind::Word).unwrap());
    assert_eq!(out.children_named(ns::W, "tr").count(), 1);
    assert_eq!(names(out.children_named(ns::W, "tr").next().unwrap()), ["sdt"]);
    assert_eq!(out.children_named(ns::W, "sdt").count(), 3);
}
