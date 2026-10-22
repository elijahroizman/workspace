//! The Excel layer on real files (OFFICE_SAMPLES, made by crates/samples.py).

use office_core::model::{Body, CellRef, Value};
use office_core::{Compiler, Kind};

#[test]
fn samples() {
    let Some(dir) = std::env::var_os("OFFICE_SAMPLES") else { return };
    let compiler = Compiler::new().with_layer(office_sheets::Sheets);
    for path in ["openpyxl.xlsx", "lo/openpyxl.xlsx", "lo/sample.xlsx"].map(|p| std::path::Path::new(&dir).join(p)) {
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let mut doc = compiler.read(&bytes, path.to_str()).unwrap();
        office_sheets::recalculate(&mut doc, None);
        let Body::Workbook { sheets } = &doc.body else { panic!() };
        if path.ends_with("openpyxl.xlsx") {
            // E2 is =B2*C2, which openpyxl leaves uncalculated.
            assert_eq!(sheets[0].value(CellRef::new(1, 4)), &Value::Number(3.75), "{}", path.display());
            assert_eq!(office_sheets::display(&doc, 0, CellRef::new(1, 3)), "TRUE");
        }
        // Saving with the layer keeps what the layer didn't change.
        let saved = compiler.write(&doc, Kind::Sheets).unwrap();
        let back = compiler.read(&saved, Some("x.xlsx")).unwrap();
        assert_eq!(back.body, doc.body, "{}", path.display());
    }
}
