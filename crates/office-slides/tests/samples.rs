//! The PowerPoint layer on real files (OFFICE_SAMPLES, made by crates/samples.py).

use office_core::model::{Body, FrameContent, Paragraph};
use office_core::units::FontSize;
use office_core::{Compiler, Kind};
use office_slides::*;

#[test]
fn samples() {
    let Some(dir) = std::env::var_os("OFFICE_SAMPLES") else { return };
    let compiler = Compiler::new().with_layer(Decks);
    for name in ["pypptx.pptx", "lo/pypptx.pptx"] {
        let path = std::path::Path::new(&dir).join(name);
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let mut doc = compiler.read(&bytes, path.to_str()).unwrap();
        let Body::Slides { slides, .. } = &doc.body else { panic!() };
        let s = &slides[0];
        let size = |i: usize| resolve(&doc, s, &s.frames[i]).paragraphs[0].1[0].size;
        if name == "pypptx.pptx" {
            // python-pptx's template: 44 pt titles, 32 pt first-level body text.
            assert_eq!(size(0), Some(FontSize(4400)), "{name}");
            assert_eq!(size(1), Some(FontSize(3200)), "{name}");
            assert_eq!(layouts(&doc).len(), 11, "{name}");
        }
        assert!(size(0) > size(1), "{name}: the title is bigger than the body");
        assert!(resolve(&doc, s, &s.frames[0]).xfrm.is_some(), "{name}: the title's position comes from its layout");

        // Saved unchanged with the layer, nothing changes.
        let saved = compiler.write(&doc, Kind::Slides).unwrap();
        assert_eq!(compiler.read(&saved, Some("x.pptx")).unwrap().body, doc.body, "{name}");

        // A slide added on a layout, with notes.
        let layout = layout(&doc, "Title and Content").or_else(|| layout(&doc, "obj")).map(|l| l.part.clone()).unwrap();
        let i = add_slide(&mut doc, &layout).unwrap();
        let Body::Slides { slides, .. } = &mut doc.body else { panic!() };
        if let FrameContent::Shape { text: Some(body), .. } = &mut slides[i].frames[0].content {
            body.paragraphs = vec![Paragraph::text("Added")];
        }
        set_notes(&mut doc, i, vec![Paragraph::text("Notes for the new slide")]);
        let doc = compiler.read(&compiler.write(&doc, Kind::Slides).unwrap(), Some("x.pptx")).unwrap();
        let Body::Slides { slides, .. } = &doc.body else { panic!() };
        assert_eq!(slides[i].layout.as_deref(), Some(layout.as_str()), "{name}");
        assert_eq!(slides[i].frames[0].paragraphs()[0].plain_text(), "Added", "{name}");
        assert_eq!(notes(&doc, i).iter().map(|p| p.plain_text()).collect::<Vec<_>>(), ["Notes for the new slide"], "{name}");
        assert!(resolve(&doc, &slides[i], &slides[i].frames[0]).xfrm.is_some(), "{name}");
    }
}
