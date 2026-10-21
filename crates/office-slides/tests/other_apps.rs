//! LibreOffice and python-pptx read what the PowerPoint layer writes: speaker notes on a deck
//! that had none, a transition, a slide added on a layout. Needs `soffice` and python-pptx, so
//! it's ignored by default: `cargo test -p office-slides -- --ignored`.

use std::process::Command;

use office_core::model::{Body, Frame, Paragraph, Slide};
use office_core::units::Emu;
use office_core::{Compiler, Document, Kind};
use office_slides::*;

fn deck() -> Document {
    let mut doc = Document::new(Kind::Slides);
    let frame = Frame::text_box(
        2,
        office_core::drawing::Xfrm { x: Emu(914_400), y: Emu(914_400), width: Emu(4_572_000), height: Emu(914_400), ..Default::default() },
        vec![Paragraph::text("On the slide")],
    );
    let Body::Slides { slides, .. } = &mut doc.body else { unreachable!() };
    slides.push(Slide { frames: vec![frame], ..Default::default() });
    slides.push(Slide::default());
    set_notes(&mut doc, 0, vec![Paragraph::text("Say this out loud")]);
    let Body::Slides { slides, .. } = &mut doc.body else { unreachable!() };
    let t = Transition { kind: "fade".into(), direction: None, duration_ms: Some(1000), on_click: true, after_ms: Some(2000) };
    set_transition(&mut slides[1], Some(&t));
    doc
}

#[test]
#[ignore]
fn libreoffice_reads_our_notes_and_transitions() {
    let dir = std::env::temp_dir().join(format!("office-slides-apps-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("talk.pptx");
    std::fs::write(&path, Compiler::new().with_layer(Decks).write(&deck(), Kind::Slides).unwrap()).unwrap();
    let out = Command::new("soffice")
        .args(["--headless", "--convert-to", "fodp", "--outdir"])
        .arg(&dir)
        .arg(&path)
        .output()
        .expect("soffice should be on the PATH");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let odf = std::fs::read_to_string(dir.join("talk.fodp")).unwrap();
    let notes = odf.find("<presentation:notes").expect("the first slide should have notes");
    assert!(odf[notes..].contains("Say this out loud"), "{odf}");
    assert!(odf.contains("On the slide"));
    // ODF writes a slide's transition into its page style.
    assert!(odf.contains("smil:type=\"fade\"") && odf.contains("smil:dur=\"1s\""), "the second slide fades in over a second");
    assert!(
        odf.contains("presentation:transition-type=\"automatic\"") && odf.contains("presentation:duration=\"PT2S\""),
        "and moves on after two seconds"
    );
}

#[test]
#[ignore]
fn python_pptx_reads_our_notes() {
    let dir = std::env::temp_dir().join(format!("office-slides-py-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("talk.pptx");
    std::fs::write(&path, Compiler::new().with_layer(Decks).write(&deck(), Kind::Slides).unwrap()).unwrap();
    let script = "import sys, pptx\np = pptx.Presentation(sys.argv[1])\nfor s in p.slides:\n    print(repr(s.notes_slide.notes_text_frame.text if s.has_notes_slide else None))";
    let out = Command::new("python3").args(["-P", "-c", script]).arg(&path).output().expect("python3 should be on the PATH");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(String::from_utf8_lossy(&out.stdout).lines().collect::<Vec<_>>(), ["'Say this out loud'", "None"]);
}
