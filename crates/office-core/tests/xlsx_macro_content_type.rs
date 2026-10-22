//! A same-package save must not rewrite a macro workbook's main-part content type.

use office_core::model::{Body, Document, Kind};
use office_core::opc::content_types::types;
use office_core::opc::Package;

const XLSM_MAIN: &str = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";

#[test]
fn same_package_save_keeps_the_macro_workbook_content_type() {
    let fresh = office_core::write(&Document::new(Kind::Sheets), Kind::Sheets).unwrap();
    let fresh_pkg = Package::read(&fresh).unwrap();
    assert_eq!(fresh_pkg.content_type("xl/workbook.xml"), Some(types::XLSX_MAIN), "a new workbook is a plain xlsx");

    let mut pkg = fresh_pkg;
    let main = pkg.main_part().unwrap();
    let bytes = pkg.part(&main).unwrap().to_vec();
    pkg.put(&main, bytes, XLSM_MAIN);
    pkg.put("xl/vbaProject.bin", b"vba-bytes".to_vec(), "application/vnd.ms-office.vbaProject");
    let xlsm = pkg.to_bytes().unwrap();

    let mut doc = office_core::read(&xlsm, Some("book.xlsm")).unwrap();
    let Body::Workbook { sheets } = &mut doc.body else { panic!("workbook") };
    sheets[0].name = "Renamed".into();
    let saved = office_core::write(&doc, Kind::Sheets).unwrap();

    let out = Package::read(&saved).unwrap();
    assert_eq!(out.content_type(&out.main_part().unwrap()), Some(XLSM_MAIN));
    assert_eq!(out.part("xl/vbaProject.bin").unwrap(), b"vba-bytes");
    let workbook = String::from_utf8(out.part("xl/workbook.xml").unwrap().to_vec()).unwrap();
    assert!(workbook.contains("Renamed"), "{workbook}");
}
