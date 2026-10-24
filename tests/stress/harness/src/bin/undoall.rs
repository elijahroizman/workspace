//! undoall FILE OUT_SAVED OUT_UNDONE: writes the unchanged save and the edited-then-undone save
//! of a workbook, for diffing with officec.
use office_core::model::CellRef;
use office_sheets::view::SheetsView;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut v = SheetsView::open(&bytes, &a[1]).unwrap();
    std::fs::write(&a[2], v.save().unwrap()).unwrap();
    v.set_input(0, CellRef::new(0, 0), "=1+2");
    v.set_input(0, CellRef::new(3, 2), "hello");
    while v.undo() {}
    std::fs::write(&a[3], v.save().unwrap()).unwrap();
}
