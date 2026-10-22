//! LibreOffice reads what the Excel layer writes as Excel would: formats, formulas, widths.
//! Needs `soffice`, so it's ignored by default: `cargo test -p office-sheets -- --ignored`.

use std::process::Command;

use office_core::model::{Body, CellRef, Value};
use office_core::{Compiler, Document, Kind};
use office_sheets::*;

#[test]
#[ignore]
fn libreoffice_shows_our_formats() {
    let mut doc = Document::new(Kind::Sheets);
    let Body::Workbook { sheets } = &mut doc.body else { unreachable!() };
    let s = &mut sheets[0];
    s.set(CellRef::new(0, 0), Value::Number(1234.5));
    s.set(CellRef::new(0, 1), Value::Number(45000.75));
    s.set(CellRef::new(0, 2), Value::Number(0.256));
    s.cell_mut(CellRef::new(0, 3)).formula = Some("A1*2".into());
    for (col, code) in [(0, "\"$\"#,##0.00"), (1, "yyyy-mm-dd hh:mm"), (2, "0.0%"), (3, "#,##0")] {
        let mut f = format_of(&doc, 0, CellRef::new(0, col));
        f.number_format = code.into();
        set_format(&mut doc, 0, CellRef::new(0, col), &f);
    }
    recalculate(&mut doc, None);
    set_column_width(&mut doc, 0, 1, Some(18.0));
    let ours: Vec<String> = (0..4).map(|c| display(&doc, 0, CellRef::new(0, c))).collect();
    assert_eq!(ours, ["$1,234.50", "2023-03-15 18:00", "25.6%", "2,469"]);

    let dir = std::env::temp_dir().join(format!("office-sheets-apps-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("formats.xlsx");
    std::fs::write(&path, Compiler::new().with_layer(Sheets).write(&doc, Kind::Sheets).unwrap()).unwrap();
    // Comma-separated, quoted, UTF-8, with "save cell contents as shown" on (it's off by default).
    let filter = "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true";
    let out = Command::new("soffice")
        .args(["--headless", "--convert-to", filter, "--outdir"])
        .arg(&dir)
        .arg(&path)
        .output()
        .expect("soffice should be on the PATH");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let csv = std::fs::read_to_string(dir.join("formats.csv")).unwrap();
    // LibreOffice's CSV has the values as shown, so it formatted them as we do.
    assert_eq!(csv.trim(), "\"$1,234.50\",2023-03-15 18:00,25.6%,\"2,469\"");
}
