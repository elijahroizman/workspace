use office_core::model::{CellRef, Kind};
use office_sheets::view::SheetsView;

#[test]
fn typed_functions_save_with_excel_markers_and_reopen_with_visible_names() {
    let mut view = SheetsView::blank(Kind::Sheets);
    for (r, (fruit, amount)) in [("apple", "3"), ("pear", "4"), ("apple", "5")].iter().enumerate() {
        view.set_input(0, CellRef::new(r as u32, 0), fruit);
        view.set_input(0, CellRef::new(r as u32, 1), amount);
    }
    let lookup = CellRef::new(0, 2);
    let sum = CellRef::new(1, 2);
    let prefixed = CellRef::new(2, 2);
    view.set_input(0, lookup, "=XLOOKUP(\"pear\",A1:A3,B1:B3)");
    view.set_input(0, sum, "=SUMIFS(B1:B3,A1:A3,\"apple\")");
    view.set_input(0, prefixed, "=_xlfn.IFS(TRUE,_xlfn.STDEV.S(B1:B3))");
    let reopened = SheetsView::open(&view.save().unwrap(), "functions.xlsx").unwrap();
    for v in [&view, &reopened] {
        assert_eq!(v.cell_info(0, lookup).display, "4");
        assert_eq!(v.cell_info(0, sum).display, "8");
        assert_eq!(v.cell_info(0, lookup).input, "=XLOOKUP(\"pear\",A1:A3,B1:B3)");
        assert_eq!(v.cell_info(0, sum).input, "=SUMIFS(B1:B3,A1:A3,\"apple\")");
        assert_eq!(v.cell_info(0, prefixed).display, "1");
        assert_eq!(v.cell_info(0, prefixed).input, "=IFS(TRUE,STDEV.S(B1:B3))");
    }
    // The live model is unchanged by save; the file and reopened model carry the markers.
    assert_eq!(view.sheets()[0].cell(lookup).unwrap().formula.as_deref(), Some("XLOOKUP(\"pear\",A1:A3,B1:B3)"));
    let mut back = SheetsView::open(&view.save().unwrap(), "functions.xlsx").unwrap();
    assert_eq!(back.sheets()[0].cell(lookup).unwrap().formula.as_deref(), Some("_xlfn.XLOOKUP(\"pear\",A1:A3,B1:B3)"));
    assert_eq!(back.sheets()[0].cell(sum).unwrap().formula.as_deref(), Some("SUMIFS(B1:B3,A1:A3,\"apple\")"));
    assert_eq!(back.sheets()[0].cell(prefixed).unwrap().formula.as_deref(), Some("_xlfn.IFS(TRUE,_xlfn.STDEV.S(B1:B3))"));
    // Editing an input recalculates imported prefixed formulas as well.
    back.set_input(0, CellRef::new(1, 1), "9");
    assert_eq!(back.cell_info(0, lookup).display, "9");
    let again = SheetsView::open(&back.save().unwrap(), "functions.xlsx").unwrap();
    assert_eq!(again.sheets()[0].cell(lookup).unwrap().formula, back.sheets()[0].cell(lookup).unwrap().formula);
}
