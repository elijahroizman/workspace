//! A layer's hooks run in order, and what it keeps on the document survives.

use std::sync::atomic::{AtomicUsize, Ordering};

use office_core::model::{Body, CellRef, Value};
use office_core::{Compiler, Document, Error, Kind, Layer, Result};

#[derive(Clone, Debug, PartialEq)]
struct RowCount(usize);

#[derive(Default)]
struct Counting {
    writes: AtomicUsize,
}

impl Layer for Counting {
    fn name(&self) -> &'static str {
        "Counting"
    }
    fn kinds(&self) -> &[Kind] {
        &[Kind::Csv]
    }
    fn after_read(&self, doc: &mut Document) -> Result<()> {
        let Body::Workbook { sheets } = &doc.body else { return Err(Error::Invalid("not a workbook".into())) };
        doc.extensions.insert(RowCount(sheets[0].rows.len()));
        Ok(())
    }
    fn before_write(&self, doc: &mut Document, _to: Kind) -> Result<()> {
        self.writes.fetch_add(1, Ordering::Relaxed);
        let n = doc.extensions.get::<RowCount>().map(|r| r.0).unwrap_or(0);
        let Body::Workbook { sheets } = &mut doc.body else { unreachable!() };
        sheets[0].set(CellRef::new(n as u32, 0), Value::Text(format!("{n} rows")));
        Ok(())
    }
}

struct Failing;

impl Layer for Failing {
    fn name(&self) -> &'static str {
        "Failing"
    }
    fn kinds(&self) -> &[Kind] {
        &[Kind::Csv]
    }
    fn after_read(&self, _doc: &mut Document) -> Result<()> {
        Err(Error::Invalid("no".into()))
    }
}

#[test]
fn hooks_run_and_data_survives() {
    let compiler = Compiler::new().with_layer(Counting::default());
    let doc = compiler.read(b"a\nb\n", Some("list.csv")).unwrap();
    assert_eq!(doc.extensions.get::<RowCount>(), Some(&RowCount(2)));
    let out = compiler.write(&doc, Kind::Csv).unwrap();
    assert_eq!(out, b"a\nb\n2 rows\n");
    // The layer worked on a copy; the document itself is as it was read.
    assert_eq!(doc.sheet_value(CellRef::new(2, 0)), Some(&Value::Empty));
}

#[test]
fn layer_errors_name_the_layer() {
    let err = Compiler::new().with_layer(Failing).read(b"a\n", Some("x.csv")).unwrap_err();
    assert!(matches!(err, Error::Layer { layer: "Failing", .. }), "{err}");
}

#[test]
fn detection() {
    assert_eq!(office_core::detect(b"a,b\n", None).unwrap(), Kind::Csv);
    assert_eq!(office_core::detect(b"a\tb\n", Some("x.TSV")).unwrap(), Kind::Csv);
    assert!(matches!(office_core::detect(b"\x00\x01binary", None), Err(Error::UnknownFormat)));
    assert!(matches!(office_core::detect(b"plain", Some("report.docx")), Err(Error::Zip(_))));
    assert!(matches!(office_core::detect(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1], Some("old.doc")), Err(Error::Invalid(_))));
}
