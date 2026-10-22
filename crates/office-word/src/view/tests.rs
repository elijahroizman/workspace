use office_core::model::{Block, Body, Document, Paragraph, Run, RunProps};
use office_core::{Compiler, Kind};
use office_engine::measure::FixedMeasurer;
use office_engine::pos::{Path, Pos, Selection};

use super::*;
use crate::Words;

fn doc_bytes(paras: &[&str]) -> Vec<u8> {
    let mut doc = Document::new(Kind::Word);
    doc.body = Body::Flow { blocks: paras.iter().map(|t| Block::Paragraph(Paragraph::text(*t))).collect() };
    Compiler::new().with_layer(Words).write(&doc, Kind::Word).unwrap()
}

fn texts(v: &WordView) -> Vec<String> {
    v.blocks(StoryId::Body)
        .iter()
        .map(|b| match b {
            Block::Paragraph(p) => p.plain_text(),
            Block::Table(_) => "[table]".into(),
            Block::Raw { .. } => "[raw]".into(),
        })
        .collect()
}

#[test]
fn opens_lays_out_and_paints() {
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&doc_bytes(&["Hello world", "Second paragraph"])).unwrap();
    v.layout(&mut host);
    assert_eq!(v.page_count(), 1);
    let (w, h) = v.page_size(0);
    // A4 at 96 px per inch.
    assert!((w - 793.7).abs() < 1.0 && (h - 1122.5).abs() < 1.0, "{w} x {h}");
    let page = v.paint(&mut host, 0);
    let texts: Vec<&str> = page.items.iter().filter_map(|i| if let Item::Text { text, .. } = i { Some(text.as_str()) } else { None }).collect();
    assert_eq!(texts, vec!["Hello world", "Second paragraph"]);
    assert!(!v.new_styles().is_empty());
}

#[test]
fn many_paragraphs_make_pages() {
    let mut host = FixedMeasurer::default();
    let lines: Vec<String> = (0..200).map(|i| format!("Paragraph number {i}")).collect();
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let mut v = WordView::open(&doc_bytes(&refs)).unwrap();
    v.layout(&mut host);
    assert!(v.page_count() > 2, "{}", v.page_count());
    // Every paragraph is drawn on exactly one page.
    let mut seen = 0;
    for i in 0..v.page_count() {
        seen += v.paint(&mut host, i).items.iter().filter(|i| matches!(i, Item::Text { .. })).count();
    }
    assert_eq!(seen, 200);
}

#[test]
fn typing_enter_undo_and_save() {
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&doc_bytes(&["Hello"])).unwrap();
    v.layout(&mut host);
    v.set_selection(Selection::caret(Pos::new(Path::top(0), 5)));
    for c in [",", " ", "w", "o", "r", "l", "d"] {
        v.insert_text(c);
    }
    assert_eq!(texts(&v), vec!["Hello, world"]);
    v.enter();
    v.insert_text("Next");
    assert_eq!(texts(&v), vec!["Hello, world", "Next"]);
    assert!(v.is_dirty());
    v.undo();
    v.undo();
    assert_eq!(texts(&v), vec!["Hello, world"]);
    v.undo();
    assert_eq!(texts(&v), vec!["Hello,"]);
    v.redo();
    assert_eq!(texts(&v), vec!["Hello, world"]);
    let bytes = v.save().unwrap();
    let back = WordView::open(&bytes).unwrap();
    assert_eq!(texts(&back), vec!["Hello, world"]);
}

#[test]
fn caret_moves_and_overlay() {
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&doc_bytes(&["abc", "defgh"])).unwrap();
    v.layout(&mut host);
    v.move_caret(&mut host, Move::Right, false);
    v.move_caret(&mut host, Move::Right, false);
    assert_eq!(v.selection().focus, Pos::new(Path::top(0), 2));
    v.move_caret(&mut host, Move::Down, false);
    assert_eq!(v.selection().focus.path, Path::top(1));
    v.move_caret(&mut host, Move::LineEnd, true);
    assert_eq!(v.selection().focus, Pos::new(Path::top(1), 5));
    let ov = v.overlay(&mut host);
    assert!(!ov.rects.is_empty());
    assert!(ov.caret.is_some());
    v.move_caret(&mut host, Move::DocStart, false);
    assert_eq!(v.selection().focus, Pos::new(Path::top(0), 0));
}

#[test]
fn clicking_places_the_caret() {
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&doc_bytes(&["Hello world"])).unwrap();
    v.layout(&mut host);
    let page = v.pages[0].clone();
    // Calibri 11 pt (default) is about 14.67 px: 7.33 px a character here.
    let x = page.body_x + 7.33 * 4.0 + 1.0;
    assert!(v.click(&mut host, 0, x, page.body_y + 5.0, false, 1));
    assert_eq!(v.selection().focus, Pos::new(Path::top(0), 4));
    v.click(&mut host, 0, x, page.body_y + 5.0, false, 2);
    assert_eq!(v.selection().ordered(), (Pos::new(Path::top(0), 0), Pos::new(Path::top(0), 5)));
}

#[test]
fn formatting_and_state() {
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&doc_bytes(&["Hello world"])).unwrap();
    v.layout(&mut host);
    v.set_selection(Selection { anchor: Pos::new(Path::top(0), 0), focus: Pos::new(Path::top(0), 5) });
    assert!(!v.state().bold);
    v.toggle(Toggle::Bold);
    assert!(v.state().bold);
    v.set_size(28);
    assert_eq!(v.state().size, Some(28));
    v.set_color("FF0000");
    assert_eq!(v.state().color.as_deref(), Some("FF0000"));
    v.align("center");
    assert_eq!(v.state().align, Some("center"));
    v.toggle(Toggle::Bold);
    assert!(!v.state().bold);
    // With a caret, formatting applies to what's typed next.
    v.set_selection(Selection::caret(Pos::new(Path::top(0), 11)));
    v.toggle(Toggle::Italic);
    v.insert_text("!");
    let Block::Paragraph(p) = &v.blocks(StoryId::Body)[0] else { panic!() };
    assert_eq!(p.runs().last().unwrap().text, "!");
    assert_eq!(p.runs().last().unwrap().props.italic, Some(true));
}

#[test]
fn page_breaks_tables_and_lists() {
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&doc_bytes(&["one", "two"])).unwrap();
    v.layout(&mut host);
    v.set_selection(Selection::caret(Pos::new(Path::top(0), 3)));
    v.page_break();
    v.layout(&mut host);
    assert_eq!(v.page_count(), 2);
    v.undo();
    v.layout(&mut host);
    assert_eq!(v.page_count(), 1);

    v.set_selection(Selection::caret(Pos::new(Path::top(1), 3)));
    v.insert_table(2, 3);
    assert_eq!(texts(&v), vec!["one", "two", "[table]", ""]);
    assert_eq!(v.state().table.as_ref().map(|t| (t.rows, t.columns)), Some((2, 3)));
    v.insert_text("cell");
    v.tab(false);
    v.insert_text("next");
    v.table_op(super::commands::TableOp::InsertRow { below: true });
    assert_eq!(v.state().table.as_ref().map(|t| t.rows), Some(3));
    v.layout(&mut host);
    let items = v.paint(&mut host, 0).items;
    assert!(items.iter().any(|i| matches!(i, Item::Line { .. })), "table borders drawn");

    v.set_selection(Selection::caret(Pos::new(Path::top(0), 0)));
    v.list(Some(crate::ListKind::Numbers));
    assert_eq!(v.state().list.as_deref(), Some("numbered"));
    v.layout(&mut host);
    let items = v.paint(&mut host, 0).items;
    assert!(items.iter().any(|i| matches!(i, Item::Text { text, .. } if text == "1.")), "{items:?}");
    let bytes = v.save().unwrap();
    let mut back = WordView::open(&bytes).unwrap();
    back.layout(&mut host);
    assert_eq!(back.state().list.as_deref(), Some("numbered"));
    assert!(back.paint(&mut host, 0).items.iter().any(|i| matches!(i, Item::Text { text, .. } if text == "1.")));
}

#[test]
fn headers_with_page_numbers() {
    let mut host = FixedMeasurer::default();
    let mut v = WordView::open(&doc_bytes(&["body"])).unwrap();
    v.layout(&mut host);
    assert!(v.edit_header_footer(0, crate::StoryKind::Footer));
    v.insert_text("Page ");
    v.insert_page_field("PAGE_X_OF_Y");
    v.exit_header_footer();
    v.layout(&mut host);
    let items = v.paint(&mut host, 0).items;
    let footer: String = items
        .iter()
        .filter_map(|i| if let Item::Group { items, .. } = i { Some(items) } else { None })
        .flatten()
        .filter_map(|i| if let Item::Text { text, .. } = i { Some(text.clone()) } else { None })
        .collect();
    assert_eq!(footer, "Page 1 of 1");
    let bytes = v.save().unwrap();
    let mut back = WordView::open(&bytes).unwrap();
    back.layout(&mut host);
    assert!(back.pages[0].footer.is_some());
}

#[test]
fn find_and_replace() {
    let mut v = WordView::open(&doc_bytes(&["the cat sat", "a cat"])).unwrap();
    let m = v.find("cat", false, false);
    assert_eq!(m.len(), 2);
    v.replace(&m, "dog");
    assert_eq!(texts(&v), vec!["the dog sat", "a dog"]);
    v.undo();
    assert_eq!(texts(&v), vec!["the cat sat", "a cat"]);
    assert_eq!(v.find("CAT", true, false).len(), 0);
    assert_eq!(v.find("ca", false, true).len(), 0);
}

#[test]
fn copy_and_paste_keep_formatting() {
    let mut doc = Document::new(Kind::Word);
    let mut p = Paragraph::text("plain ");
    p.content.push(office_core::model::Inline::Text(Run::new("bold").with_props(RunProps { bold: Some(true), ..Default::default() })));
    doc.body = Body::Flow { blocks: vec![Block::Paragraph(p), Block::Paragraph(Paragraph::text("end"))] };
    let bytes = Compiler::new().with_layer(Words).write(&doc, Kind::Word).unwrap();
    let mut v = WordView::open(&bytes).unwrap();
    v.set_selection(Selection { anchor: Pos::new(Path::top(0), 0), focus: Pos::new(Path::top(0), 10) });
    let (text, json) = v.copy();
    assert_eq!(text, "plain bold");
    v.set_selection(Selection::caret(Pos::new(Path::top(1), 3)));
    v.paste(&text, Some(&json));
    assert_eq!(texts(&v)[1], "endplain bold");
    let Block::Paragraph(p) = &v.blocks(StoryId::Body)[1] else { panic!() };
    assert_eq!(p.runs().last().unwrap().props.bold, Some(true));
}
