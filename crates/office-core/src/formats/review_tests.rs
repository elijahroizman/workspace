use crate::model::*;
use crate::opc::{rels::kind, Package};
use crate::units::Emu;
use crate::xml::ns;
use crate::{Document, Kind};
fn read(pkg: &Package, kind: Kind) -> Document {
    crate::read(&pkg.to_bytes().unwrap(), Some(&format!("x.{}", kind.extension()))).unwrap()
}
fn save(doc: &Document, kind: Kind) -> Package {
    Package::read(&crate::write(doc, kind).unwrap()).unwrap()
}
fn sheet_doc() -> Document {
    let mut d = Document::new(Kind::Sheets);
    if let Body::Workbook { sheets } = &mut d.body {
        sheets[0].set(CellRef::new(0, 0), Value::Number(1.));
    }
    d
}
fn edit_b1(d: &mut Document) {
    if let Body::Workbook { sheets } = &mut d.body {
        sheets[0].set(CellRef::new(0, 1), Value::Number(2.));
    }
}
#[test]
fn calc_chain_relation_removed() {
    let mut p = save(&sheet_doc(), Kind::Sheets);
    p.put(
        "xl/calcChain.xml",
        format!(r#"<calcChain xmlns="{}"><c r="A1" i="1"/></calcChain>"#, ns::X).into_bytes(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml",
    );
    p.relate("xl/workbook.xml", "calcChain", "xl/calcChain.xml").unwrap();
    let mut d = read(&p, Kind::Sheets);
    edit_b1(&mut d);
    let out = save(&d, Kind::Sheets);
    assert!(!out.has("xl/calcChain.xml"));
    assert!(out.related("xl/workbook.xml", "calcChain").unwrap().is_empty(), "deleted calcChain retains a dangling relationship");
}
#[test]
fn inline_phonetics_survive_neighbor_edit() {
    let mut p = save(&sheet_doc(), Kind::Sheets);
    p.replace("xl/worksheets/sheet1.xml",format!(r#"<worksheet xmlns="{}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>漢</t><rPh sb="0" eb="1"><t>カン</t></rPh><phoneticPr fontId="0"/></is></c></row></sheetData></worksheet>"#,ns::X).into_bytes()).unwrap();
    let mut d = read(&p, Kind::Sheets);
    edit_b1(&mut d);
    let out = save(&d, Kind::Sheets);
    assert!(out.xml("xl/worksheets/sheet1.xml").unwrap().root.descendant(ns::X, "rPh").is_some(), "untouched inline string lost phonetics");
}
#[test]
fn distinct_shared_strings_keep_their_indices() {
    let mut p = save(&sheet_doc(), Kind::Sheets);
    p.put("xl/sharedStrings.xml",format!(r#"<sst xmlns="{}" count="2" uniqueCount="2"><si><t>漢</t><rPh sb="0" eb="1"><t>カン</t></rPh></si><si><t>漢</t><rPh sb="0" eb="1"><t>ハン</t></rPh></si></sst>"#,ns::X).into_bytes(),"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml");
    p.relate("xl/workbook.xml", kind::SHARED_STRINGS, "xl/sharedStrings.xml").unwrap();
    p.replace("xl/worksheets/sheet1.xml",format!(r#"<worksheet xmlns="{}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>"#,ns::X).into_bytes()).unwrap();
    let mut d = read(&p, Kind::Sheets);
    edit_b1(&mut d);
    let out = save(&d, Kind::Sheets);
    let ws = out.xml("xl/worksheets/sheet1.xml").unwrap();
    let c = ws.root.descendant(ns::X, "sheetData").unwrap().children_named(ns::X, "row").nth(1).unwrap().child(ns::X, "c").unwrap();
    assert_eq!(c.child(ns::X, "v").unwrap().text(), "1", "A2 remapped to A1's different phonetic string");
}
#[test]
fn copied_sheets_get_distinct_parts() {
    let p = save(&sheet_doc(), Kind::Sheets);
    let mut d = read(&p, Kind::Sheets);
    if let Body::Workbook { sheets } = &mut d.body {
        let mut copy = sheets[0].clone();
        copy.name = "Copy".into();
        copy.set(CellRef::new(0, 0), Value::Number(9.));
        sheets.push(copy);
    }
    let out = save(&d, Kind::Sheets);
    let back = read(&out, Kind::Sheets);
    if let Body::Workbook { sheets } = &back.body {
        assert_eq!(sheets[0].value(CellRef::new(0, 0)), &Value::Number(1.), "editing the copied sheet overwrote the original");
        assert_ne!(sheets[0].part, sheets[1].part);
    }
}
#[test]
fn unchanged_word_hyperlink_keeps_bytes() {
    let mut p = save(&Document::new(Kind::Word), Kind::Word);
    let mut rels = p.rels("word/document.xml").unwrap();
    let id = rels.add(kind::HYPERLINK, "https://example.org", true);
    p.put_rels("word/document.xml", &rels);
    let text = format!(
        r#"<w:document xmlns:w="{}" xmlns:r="{}"><w:body><w:p><w:hyperlink r:id="{}" w:tgtFrame="_blank"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#,
        ns::W,
        ns::R,
        id
    );
    p.replace("word/document.xml", text.into_bytes()).unwrap();
    let d = read(&p, Kind::Word);
    let out = save(&d, Kind::Word);
    assert_eq!(
        p.part("word/document.xml").unwrap(),
        out.part("word/document.xml").unwrap(),
        "unchanged hyperlink rewrites and loses tgtFrame"
    );
}
#[test]
fn omitted_word_grid_cells_do_not_shift_vertical_merges() {
    let mut p = save(&Document::new(Kind::Word), Kind::Word);
    p.replace("word/document.xml",format!(r#"<w:document xmlns:w="{}"><w:body><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>"#,ns::W).into_bytes()).unwrap();
    let d = read(&p, Kind::Word);
    if let Body::Flow { blocks } = &d.body {
        if let Block::Table(t) = &blocks[0] {
            assert_eq!(t.rows[0].cells[1].row_span, 2, "B should own the vertical merge");
        }
    }
}
#[test]
fn page_break_within_paragraph_splits_the_text_at_the_break() {
    let mut d = Document::new(Kind::Word);
    d.body = Body::Flow {
        blocks: vec![Block::Paragraph(Paragraph {
            content: vec![Inline::Text(Run::new("before")), Inline::Break { kind: BreakKind::Page }, Inline::Text(Run::new("after"))],
            ..Default::default()
        })],
    };
    let out = crate::convert::to_kind(&d, Kind::Slides).unwrap();
    if let Body::Slides { slides, .. } = &out.body {
        assert_eq!(slides.len(), 2, "text on both sides of the break was placed together");
        let text = |slide: &Slide| {
            slide
                .frames
                .iter()
                .filter_map(|f| {
                    if let FrameContent::Shape { text: Some(body), .. } = &f.content {
                        Some(body.paragraphs.iter().map(Paragraph::plain_text).collect::<Vec<_>>().join("\n"))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        };
        assert_eq!(text(&slides[0]), "before");
        assert_eq!(text(&slides[1]), "after");
    }
}
#[test]
fn single_long_paragraph_gets_multiple_slides() {
    let mut d = Document::new(Kind::Word);
    d.body = Body::Flow {
        blocks: vec![Block::Paragraph(Paragraph::text((0..100).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n")))],
    };
    let out = crate::convert::to_kind(&d, Kind::Slides).unwrap();
    if let Body::Slides { slides, .. } = &out.body {
        assert!(slides.len() > 1, "100 lines are clipped into one slide");
        let mut lines = Vec::new();
        for slide in slides {
            for frame in &slide.frames {
                if let FrameContent::Shape { text: Some(body), .. } = &frame.content {
                    let height = frame.shape.xfrm.as_ref().unwrap().height.0;
                    let needed = 2 * 91_440
                        + body
                            .paragraphs
                            .iter()
                            .map(|p| Emu::from_points(18.0 * 1.2 * (1 + p.plain_text().matches('\n').count()) as f64).0)
                            .sum::<i64>();
                    assert!(needed <= height, "text overflows its capped frame");
                    for p in &body.paragraphs {
                        lines.extend(p.plain_text().lines().map(str::to_string));
                    }
                }
            }
        }
        assert_eq!(lines, (0..100).map(|i| format!("line {i}")).collect::<Vec<_>>());
    }
}
#[test]
fn tsv_hint_wins_when_data_contains_commas() {
    let d = crate::formats::csv::read(b"a,b\tc,d\ne,f\tg,h\n", "s", true).unwrap();
    assert_eq!(d.sheet_value(CellRef::new(0, 0)), Some(&Value::Text("a,b".into())), "TSV fields were split on commas");
}
#[test]
fn max_word_drawing_id_does_not_panic_on_unchanged_save() {
    let bytes: &[u8] = include_bytes!("test_data/high-id.docx");
    let d = crate::read(bytes, Some("x.docx")).unwrap();
    let _ = save(&d, Kind::Word);
}
#[test]
fn real_powerpoint_merged_cells_keep_their_markup() {
    let bytes: &[u8] = include_bytes!("test_data/merged.pptx");
    let d = crate::read(bytes, Some("x.pptx")).unwrap();
    let out = crate::write(&d, Kind::Slides).unwrap();
    let p = Package::read(&out).unwrap();
    let s = p.xml("ppt/slides/slide1.xml").unwrap();
    let tbl = s.root.descendant(ns::A, "tbl").unwrap();
    let rows: Vec<_> = tbl.children_named(ns::A, "tr").collect();
    assert_eq!(rows[0].children_named(ns::A, "tc").nth(1).unwrap().attr("rowSpan"), Some("2"), "top-right cell must retain vertical span");
    assert_eq!(
        rows[1].children_named(ns::A, "tc").next().unwrap().attr("gridSpan"),
        Some("2"),
        "bottom-left cell must retain horizontal span"
    );
    assert_eq!(
        rows[1].children_named(ns::A, "tc").nth(1).unwrap().attr("hMerge"),
        Some("1"),
        "bottom-right cell participates in both merges"
    );
}
#[test]
fn powerpoint_paragraph_alternate_content_survives() {
    let bytes = crate::write(&slide_doc(), Kind::Slides).unwrap();
    let mut p = Package::read(&bytes).unwrap();
    let mut xml = p.xml("ppt/slides/slide1.xml").unwrap();
    let para = xml
        .root
        .child_mut(ns::P, "cSld")
        .unwrap()
        .child_mut(ns::P, "spTree")
        .unwrap()
        .children
        .iter_mut()
        .find_map(|n| if let crate::xml::Node::Element(e) = n { e.child_mut(ns::P, "txBody") } else { None })
        .unwrap()
        .child_mut(ns::A, "p")
        .unwrap();
    para.remove_children(ns::A, "r");
    para.push(crate::xml::parse_element(&format!(r#"<mc:AlternateContent xmlns:mc="{}" xmlns:a="{}" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><mc:Choice Requires="a14"><a:r><a:t>choice</a:t></a:r></mc:Choice><mc:Fallback><a:r><a:t>fallback</a:t></a:r></mc:Fallback></mc:AlternateContent>"#,ns::MC,ns::A)).unwrap());
    p.put_xml("ppt/slides/slide1.xml", &xml, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
    let d = read(&p, Kind::Slides);
    let out = save(&d, Kind::Slides);
    assert!(
        out.xml("ppt/slides/slide1.xml").unwrap().root.descendant(ns::MC, "AlternateContent").is_some(),
        "untouched paragraph alternate content was discarded"
    );
}
#[test]
fn iso_date_can_be_replaced_with_ordinary_text() {
    let mut p = save(&sheet_doc(), Kind::Sheets);
    p.replace(
        "xl/worksheets/sheet1.xml",
        format!(
            r#"<worksheet xmlns="{}"><sheetData><row r="1"><c r="A1" t="d"><v>2024-03-01T00:00:00</v></c></row></sheetData></worksheet>"#,
            ns::X
        )
        .into_bytes(),
    )
    .unwrap();
    let mut d = read(&p, Kind::Sheets);
    if let Body::Workbook { sheets } = &mut d.body {
        sheets[0].set(CellRef::new(0, 0), Value::Text("hello".into()));
    }
    let out = save(&d, Kind::Sheets);
    let ws = out.xml("xl/worksheets/sheet1.xml").unwrap();
    assert_ne!(ws.root.descendant(ns::X, "c").unwrap().attr("t"), Some("d"), "ordinary text has been written as an invalid ISO date");
}
#[test]
fn table_sheet_roundtrip_keeps_merged_extent() {
    let mut t = Table::from_text(&[vec!["a".into(), "".into()], vec!["".into(), "".into()]], Emu(1000000));
    t.rows[0].cells[0].col_span = 2;
    t.rows[0].cells[0].row_span = 2;
    for (r, c) in [(0, 1), (1, 0), (1, 1)] {
        t.rows[r].cells[c].covered = true;
    }
    let s = crate::convert::table_to_sheet(&t, "Data");
    let back = crate::convert::sheet_to_table(&s, Emu(1000000)).unwrap();
    assert_eq!(back.columns.iter().map(|w| w.0).sum::<i64>(), 1000000);
    assert_eq!(
        (back.rows.len(), back.columns.len(), back.rows[0].cells[0].row_span, back.rows[0].cells[0].col_span),
        (2, 2, 2, 2),
        "merged extent clipped to nonempty cell bounds"
    );
}
#[test]
fn csv_filename_produces_a_legal_excel_sheet_name() {
    let d = crate::read(b"a,b\n1,2\n", Some("Q1 [draft].csv")).unwrap();
    let bytes = crate::write(&d, Kind::Sheets).unwrap();
    let p = Package::read(&bytes).unwrap();
    let w = p.xml("xl/workbook.xml").unwrap();
    let name = w.root.descendant(ns::X, "sheet").unwrap().attr("name").unwrap();
    assert!(!name.chars().any(|c| "[]:*?/\\".contains(c)), "CSV filename created invalid sheet name {name}");
}

fn slide_doc() -> Document {
    let mut d = Document::new(Kind::Slides);
    if let Body::Slides { slides, .. } = &mut d.body {
        slides.push(Slide {
            frames: vec![Frame::text_box(2, crate::drawing::Xfrm::default(), vec![Paragraph::text("text")])],
            ..Default::default()
        });
    }
    d
}
#[test]
fn added_slide_ids_stay_in_powerpoint_range() {
    let mut p = save(&slide_doc(), Kind::Slides);
    let mut xml = p.xml("ppt/presentation.xml").unwrap();
    xml.root.child_mut(ns::P, "sldIdLst").unwrap().child_mut(ns::P, "sldId").unwrap().set_attr("", "id", "2147483647");
    p.put_xml("ppt/presentation.xml", &xml, "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
    let mut d = read(&p, Kind::Slides);
    if let Body::Slides { slides, .. } = &mut d.body {
        slides.push(Slide::default());
    }
    let out = save(&d, Kind::Slides);
    let xml = out.xml("ppt/presentation.xml").unwrap();
    let ids: Vec<u32> =
        xml.root.child(ns::P, "sldIdLst").unwrap().children_named(ns::P, "sldId").map(|s| s.attr("id").unwrap().parse().unwrap()).collect();
    assert!(ids.iter().all(|id| (256..=2147483647).contains(id)), "{ids:?}");
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn copied_untouched_sheet_uses_original_source_bytes() {
    let p = save(&sheet_doc(), Kind::Sheets);
    let mut d = read(&p, Kind::Sheets);
    if let Body::Workbook { sheets } = &mut d.body {
        let mut copy = sheets[0].clone();
        copy.name = "Copy".into();
        sheets[0].set(CellRef::new(0, 0), Value::Number(2.));
        sheets.push(copy);
    }
    let p = save(&d, Kind::Sheets);
    let d = read(&p, Kind::Sheets);
    let Body::Workbook { sheets } = &d.body else { panic!() };
    assert_eq!(sheets[0].value(CellRef::new(0, 0)), &Value::Number(2.));
    assert_eq!(sheets[1].value(CellRef::new(0, 0)), &Value::Number(1.));
    let w = p.xml("xl/workbook.xml").unwrap();
    let entries: Vec<_> = w.root.child(ns::X, "sheets").unwrap().elements().collect();
    assert_ne!(entries[0].attr("sheetId"), entries[1].attr("sheetId"));
    assert_ne!(entries[0].attr_ns(ns::R, "id"), entries[1].attr_ns(ns::R, "id"));
}

#[test]
fn generated_sheet_names_follow_excel_rules_and_explicit_names_are_validated() {
    let mut d = Document::new(Kind::Csv);
    d.body = Body::Workbook {
        sheets: [
            "Q1 [draft]",
            "a:b/c\\d?e*f",
            "'quoted'",
            "History",
            "history",
            "",
            "DATA",
            "data",
            "123456789012345678901234567890123456",
        ]
        .into_iter()
        .map(Sheet::new)
        .collect(),
    };
    // Also exercise callers that explicitly convert before writing.
    let converted = crate::convert::to_kind(&d, Kind::Sheets).unwrap();
    for doc in [&d, &converted] {
        let p = save(doc, Kind::Sheets);
        let w = p.xml("xl/workbook.xml").unwrap();
        let mut seen = std::collections::HashSet::new();
        for sheet in w.root.child(ns::X, "sheets").unwrap().elements() {
            let name = sheet.attr("name").unwrap();
            assert!(!name.is_empty() && name.chars().count() <= 31);
            assert!(!name.chars().any(|c| ":\\/?*[]".contains(c)));
            assert!(!name.starts_with('\'') && !name.ends_with('\''));
            assert!(!name.eq_ignore_ascii_case("History"));
            assert!(seen.insert(name.to_lowercase()));
        }
    }
    for name in ["", "History", "bad:name", "[bad]", "'bad", "bad'", "12345678901234567890123456789012"] {
        let mut d = sheet_doc();
        if let Body::Workbook { sheets } = &mut d.body {
            sheets[0].name = name.into();
        }
        assert!(crate::write(&d, Kind::Sheets).is_err(), "{name:?}");
    }
    let mut d = sheet_doc();
    if let Body::Workbook { sheets } = &mut d.body {
        sheets.push(Sheet::new(sheets[0].name.to_uppercase()));
    }
    assert!(crate::write(&d, Kind::Sheets).is_err());
}

#[test]
fn tsv_sep_directive_overrides_extension() {
    let d = crate::formats::csv::read(b"sep=;\na,b;c,d\n", "s", true).unwrap();
    assert_eq!(d.sheet_value(CellRef::new(0, 1)), Some(&Value::Text("c,d".into())));
}

#[test]
fn edited_word_hyperlink_patches_only_modeled_attributes() {
    let mut p = save(&Document::new(Kind::Word), Kind::Word);
    let id = p.relate_external("word/document.xml", kind::HYPERLINK, "https://example.org").unwrap();
    p.replace("word/document.xml", format!(r#"<w:document xmlns:w="{}" xmlns:r="{}"><w:body><w:p><w:hyperlink r:id="{id}" w:history="0" w:tgtFrame="_blank"><w:r><w:t>one</w:t></w:r><w:r><w:t>two</w:t></w:r></w:hyperlink><w:hyperlink r:id="{id}" w:history="0" w:tgtFrame="_blank"><w:r><w:t>three</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#, ns::W, ns::R).into_bytes()).unwrap();
    let mut d = read(&p, Kind::Word);
    assert_eq!(save(&d, Kind::Word).part("word/document.xml").unwrap(), p.part("word/document.xml").unwrap());
    if let Body::Flow { blocks } = &mut d.body {
        if let Block::Paragraph(p) = &mut blocks[0] {
            for run in p.runs_mut() {
                run.link.as_mut().unwrap().url = Some("https://example.net".into());
                run.link.as_mut().unwrap().tooltip = Some("new tip".into());
                run.props.bold = Some(true);
            }
        }
    }
    let p = save(&d, Kind::Word);
    let xml = p.xml("word/document.xml").unwrap();
    let para = xml.root.descendant(ns::W, "p").unwrap();
    assert_eq!(para.children_named(ns::W, "hyperlink").count(), 2);
    for h in para.children_named(ns::W, "hyperlink") {
        assert_eq!(h.attr_ns(ns::W, "tgtFrame"), Some("_blank"));
        assert_eq!(h.attr_ns(ns::W, "history"), Some("0"));
        assert_eq!(h.attr_ns(ns::W, "tooltip"), Some("new tip"));
        assert_eq!(p.rels("word/document.xml").unwrap().get(h.attr_ns(ns::R, "id").unwrap()).unwrap().target, "https://example.net");
    }
}

#[test]
fn word_grid_before_and_after_survive_save_and_can_be_filled() {
    let mut p = save(&Document::new(Kind::Word), Kind::Word);
    p.replace("word/document.xml", format!(r#"<w:document xmlns:w="{}"><w:body><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="1"/></w:trPr><w:tc><w:tcPr/><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#, ns::W).into_bytes()).unwrap();
    let mut d = read(&p, Kind::Word);
    let out = save(&d, Kind::Word);
    let xml = out.xml("word/document.xml").unwrap();
    let row = xml.root.descendant(ns::W, "tr").unwrap();
    assert_eq!(row.children_named(ns::W, "tc").count(), 1);
    assert_eq!(row.child(ns::W, "trPr").unwrap().child(ns::W, "gridAfter").unwrap().attr_ns(ns::W, "val"), Some("1"));
    if let Body::Flow { blocks } = &mut d.body {
        if let Block::Table(t) = &mut blocks[0] {
            assert_eq!(t.rows[0].cells.len(), 3);
            assert_eq!(t.rows[0].cells[1].plain_text(), "B");
            t.rows[0].cells[0] = Cell::text("A");
            t.rows[0].cells[2] = Cell::text("C");
        }
    }
    let p = save(&d, Kind::Word);
    let xml = p.xml("word/document.xml").unwrap();
    let row = xml.root.descendant(ns::W, "tr").unwrap();
    assert_eq!(row.children_named(ns::W, "tc").count(), 3);
    assert!(row.child(ns::W, "trPr").unwrap().child(ns::W, "gridBefore").is_none());
    assert!(row.child(ns::W, "trPr").unwrap().child(ns::W, "gridAfter").is_none());
}

#[test]
fn new_word_picture_gets_a_free_id_beside_the_maximum() {
    let bytes: &[u8] = include_bytes!("test_data/high-id.docx");
    let mut d = crate::read(bytes, Some("x.docx")).unwrap();
    if let Body::Flow { blocks } = &mut d.body {
        let image = blocks
            .iter()
            .filter_map(|b| if let Block::Paragraph(p) = b { Some(p) } else { None })
            .flat_map(|p| &p.content)
            .find_map(|i| if let Inline::Image(image) = i { Some(image.clone()) } else { None })
            .unwrap();
        blocks.push(Block::Paragraph(Paragraph {
            content: vec![Inline::Image(Image { origin: Origin::default(), ..image })],
            ..Default::default()
        }));
    }
    let p = save(&d, Kind::Word);
    let xml = p.xml("word/document.xml").unwrap();
    fn ids(e: &crate::xml::Element, out: &mut Vec<u32>) {
        if e.is(ns::WP, "docPr") {
            out.push(e.attr("id").unwrap().parse().unwrap());
        }
        for c in e.elements() {
            ids(c, out);
        }
    }
    let mut used = Vec::new();
    ids(&xml.root, &mut used);
    assert!(used.contains(&u32::MAX));
    let count = used.len();
    used.sort_unstable();
    used.dedup();
    assert_eq!(used.len(), count);
}

#[test]
fn sheet_to_table_includes_every_merge_even_without_values() {
    let mut s = Sheet::new("S");
    s.merges = vec![Range::parse("B2:C3").unwrap(), Range::parse("D4:F6").unwrap()];
    let t = crate::convert::sheet_to_table(&s, Emu(6000)).unwrap();
    assert_eq!((t.rows.len(), t.columns.len()), (6, 6));
    assert_eq!((t.rows[3].cells[3].row_span, t.rows[3].cells[3].col_span), (3, 3));
    assert_eq!(t.owner(5, 5), Some((3, 3)));
}

#[test]
fn cells_sharing_one_long_string_stop_at_the_text_budget() {
    // Every cell holds its own copy of its shared string: 12,000 cells of a 1 MB string once
    // needed 12 GB. In tests the budget is a megabyte.
    let mut p = save(&sheet_doc(), Kind::Sheets);
    let long = "x".repeat(64 * 1024);
    p.put(
        "xl/sharedStrings.xml",
        format!(r#"<sst xmlns="{}"><si><t>{long}</t></si><si><t>short</t></si></sst>"#, ns::X).into_bytes(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
    );
    p.relate("xl/workbook.xml", kind::SHARED_STRINGS, "xl/sharedStrings.xml").unwrap();
    let sheet = |cells: usize, si: u32| {
        let cells: String = (1..=cells).map(|r| format!(r#"<row r="{r}"><c r="A{r}" t="s"><v>{si}</v></c></row>"#)).collect();
        format!(r#"<worksheet xmlns="{}"><sheetData>{cells}</sheetData></worksheet>"#, ns::X).into_bytes()
    };
    let rows = |p: &Package| match read(p, Kind::Sheets).body {
        Body::Workbook { sheets } => sheets[0].rows.len(),
        _ => unreachable!(),
    };
    // Twelve copies are fine, and so are thousands of short ones.
    p.replace("xl/worksheets/sheet1.xml", sheet(12, 0)).unwrap();
    assert_eq!(rows(&p), 12);
    p.replace("xl/worksheets/sheet1.xml", sheet(5000, 1)).unwrap();
    assert_eq!(rows(&p), 5000);
    p.replace("xl/worksheets/sheet1.xml", sheet(20, 0)).unwrap();
    let e = crate::read(&p.to_bytes().unwrap(), Some("x.xlsx")).unwrap_err().to_string();
    assert!(e.contains("too large to open"), "{e}");
}

#[test]
fn a_sheet_name_with_an_escaped_character_saves() {
    // 28 characters, the last a line break Excel wrote as `_x000a_`: it once failed to save as
    // a 34-character name.
    let name = "Контрольний список  \"Школа\"_x000a_";
    let mut p = save(&sheet_doc(), Kind::Sheets);
    let wb = String::from_utf8(p.part("xl/workbook.xml").unwrap().to_vec()).unwrap();
    let wb = wb.replace(r#"name="Sheet1""#, &format!(r#"name="{}""#, name.replace('"', "&quot;")));
    p.replace("xl/workbook.xml", wb.into_bytes()).unwrap();
    let mut d = read(&p, Kind::Sheets);
    edit_b1(&mut d);
    let out = save(&d, Kind::Sheets);
    let wb = out.xml("xl/workbook.xml").unwrap();
    assert_eq!(wb.root.descendant(ns::X, "sheet").unwrap().attr("name"), Some(name));
}

#[test]
fn table_grids_keep_what_their_columns_carry() {
    // Word: a tracked change to the grid. PowerPoint: column ids. Both went on an unchanged save.
    let mut d = Document::new(Kind::Word);
    d.body = Body::Flow { blocks: vec![Block::Paragraph(Paragraph::text("x"))] };
    let mut p = save(&d, Kind::Word);
    let tbl = r#"<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/><w:tblGridChange w:id="7"><w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid></w:tblGridChange></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p/></w:tc><w:tc><w:tcPr/><w:p/></w:tc></w:tr></w:tbl>"#;
    let xml = String::from_utf8(p.part("word/document.xml").unwrap().to_vec()).unwrap().replacen("<w:body>", &format!("<w:body>{tbl}"), 1);
    p.replace("word/document.xml", xml.into_bytes()).unwrap();
    let text = |p: &Package, part: &str| String::from_utf8(p.part(part).unwrap().to_vec()).unwrap();
    let mut d = read(&p, Kind::Word);
    assert_eq!(text(&save(&d, Kind::Word), "word/document.xml"), text(&p, "word/document.xml"));
    // A changed width keeps the change record.
    if let Body::Flow { blocks } = &mut d.body {
        let Block::Table(t) = &mut blocks[0] else { panic!() };
        t.columns[1] = Emu::from_twips(3500);
    }
    let xml = String::from_utf8(save(&d, Kind::Word).part("word/document.xml").unwrap().to_vec()).unwrap();
    assert!(xml.contains(r#"<w:gridCol w:w="2000"/><w:gridCol w:w="3500"/><w:tblGridChange w:id="7">"#), "{xml}");

    let a16 = "http://schemas.microsoft.com/office/drawing/2014/main";
    let col = |w: u32, id: u32| {
        format!(
            r#"<a:gridCol w="{w}"><a:extLst><a:ext uri="{{9D8B030D-6E8A-4147-A177-3AD203B41FA5}}"><a16:colId xmlns:a16="{a16}" val="{id}"/></a:ext></a:extLst></a:gridCol>"#
        )
    };
    let mut table = Table::from_text(&[vec!["a".into(), "b".into()]], Emu(3_000_000));
    table.columns = vec![Emu(1_000_000), Emu(2_000_000)];
    let mut frame = Frame::text_box(2, crate::drawing::Xfrm { width: Emu(3_000_000), height: Emu(400_000), ..Default::default() }, vec![]);
    frame.content = FrameContent::Table { table };
    let mut d = Document::new(Kind::Slides);
    d.body = Body::Slides { size: SlideSize::default(), slides: vec![Slide { frames: vec![frame], ..Default::default() }] };
    let mut p = save(&d, Kind::Slides);
    let part = "ppt/slides/slide1.xml";
    let xml = String::from_utf8(p.part(part).unwrap().to_vec()).unwrap();
    let xml = xml.replace(r#"<a:gridCol w="1000000"/><a:gridCol w="2000000"/>"#, &(col(1_000_000, 11) + &col(2_000_000, 22)));
    assert!(xml.contains("a16:colId"), "{xml}");
    p.replace(part, xml.into_bytes()).unwrap();
    assert_eq!(text(&save(&read(&p, Kind::Slides), Kind::Slides), part), text(&p, part));
}
