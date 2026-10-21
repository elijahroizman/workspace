//! The Word layer on real files (OFFICE_SAMPLES, made by crates/samples.py).

use office_core::{Compiler, Kind};

#[test]
fn samples() {
    let Some(dir) = std::env::var_os("OFFICE_SAMPLES") else { return };
    let compiler = Compiler::new().with_layer(office_word::Words);
    for name in ["pydocx.docx", "lo/pydocx.docx"] {
        let path = std::path::Path::new(&dir).join(name);
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let doc = compiler.read(&bytes, path.to_str()).unwrap();
        let paragraphs = office_word::paragraphs(&doc);
        let labels = office_word::list_labels(&doc);
        // "Bullet" is in python-docx's List Bullet style, whose list comes from the style.
        let bullet = paragraphs.iter().position(|p| p.plain_text() == "Bullet").unwrap();
        assert!(labels[bullet].as_deref().is_some_and(|l| !l.is_empty()), "{name}: {labels:?}");
        assert!(labels.iter().filter(|l| l.is_some()).count() == 1, "{name}: {labels:?}");
        // The heading is bigger than the body text once styles are applied.
        let heading = paragraphs.iter().find(|p| p.plain_text() == "Hello & welcome").unwrap();
        let size = |p: &office_core::model::Paragraph| office_word::resolved_run(&doc, p, p.runs().next().unwrap()).size;
        assert!(size(heading) > size(paragraphs[1]), "{name}");
        // Saved unchanged with the layer, nothing changes.
        let saved = compiler.write(&doc, Kind::Word).unwrap();
        assert_eq!(compiler.read(&saved, Some("x.docx")).unwrap().body, doc.body);
        assert!(office_core::opc::Package::read(&saved).unwrap().part_names().eq(office_core::opc::Package::read(&bytes).unwrap().part_names()), "{name}: no parts added or lost");
    }
}
