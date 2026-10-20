//! Passes between the model's shapes: a document's body into another kind's, tables to sheets
//! and back, and any document to plain text. [`crate::Compiler::write`] runs [`to_kind`]
//! when it's asked for a kind the body isn't.

use crate::drawing::{ShapeProps, Xfrm};
use crate::model::*;
use crate::units::Emu;
use crate::Result;

/// Whether a document's body is what `kind` holds.
pub fn fits(doc: &Document, kind: Kind) -> bool {
    matches!(
        (&doc.body, kind),
        (Body::Flow { .. }, Kind::Word) | (Body::Slides { .. }, Kind::Slides) | (Body::Workbook { .. }, Kind::Sheets | Kind::Csv)
    )
}

/// The document as `kind`: its body reshaped if need be, its pictures loaded into memory (the
/// package they're in doesn't come along), its theme and properties kept.
pub fn to_kind(doc: &Document, kind: Kind) -> Result<Document> {
    let mut out = Document::new(kind);
    out.properties = doc.properties.clone();
    out.theme = doc.theme.clone();
    out.extensions = doc.extensions.clone();
    for m in &doc.media {
        let data = MediaData::Bytes(doc.media_bytes(&m.id)?);
        out.media.push(Media { id: m.id.clone(), content_type: m.content_type.clone(), data });
    }
    out.body = match (&doc.body, kind) {
        (body, _) if fits(doc, kind) => body.clone(),
        (Body::Flow { blocks }, Kind::Slides) => flow_to_slides(blocks),
        (Body::Flow { blocks }, _) => Body::Workbook { sheets: blocks_to_sheets(blocks) },
        (Body::Slides { slides, .. }, Kind::Word) => Body::Flow { blocks: slides_to_blocks(slides) },
        (Body::Slides { slides, .. }, _) => {
            let blocks = slides_to_blocks(slides);
            Body::Workbook { sheets: blocks_to_sheets(&blocks) }
        }
        (Body::Workbook { sheets }, Kind::Word) => Body::Flow { blocks: sheets_to_blocks(sheets) },
        (Body::Workbook { sheets }, _) => sheets_to_slides(sheets),
    };
    // A CSV file's dialect only means something to CSV.
    if kind != Kind::Csv {
        out.extensions.remove::<crate::formats::csv::Dialect>();
    }
    Ok(out)
}

/// A table's text as a sheet, its spans as merged ranges.
pub fn table_to_sheet(table: &Table, name: &str) -> Sheet {
    let mut sheet = Sheet::new(name);
    for (r, row) in table.rows.iter().enumerate() {
        for (c, cell) in row.cells.iter().enumerate() {
            if cell.covered {
                continue;
            }
            let text = cell.plain_text();
            if !text.is_empty() {
                sheet.set(CellRef::new(r as u32, c as u32), text_value(text));
            }
            if cell.col_span > 1 || cell.row_span > 1 {
                let end = CellRef::new(r as u32 + cell.row_span - 1, c as u32 + cell.col_span - 1);
                sheet.merges.push(Range { start: CellRef::new(r as u32, c as u32), end });
            }
        }
    }
    sheet
}

/// Text that reads as a number becomes one, the way a spreadsheet takes typed text.
fn text_value(text: String) -> Value {
    match text.trim().parse::<f64>() {
        Ok(n) if n.is_finite() && format_number(n) == text.trim() => Value::Number(n),
        _ => Value::Text(text),
    }
}

/// A sheet's used range as a table of text, its merged ranges as spans. Columns share `width`.
pub fn sheet_to_table(sheet: &Sheet, width: Emu) -> Table {
    let Some(used) = sheet.used_range().or_else(|| sheet.merges.first().copied()) else { return Table::default() };
    let (rows, cols) = (used.end.row as usize + 1, used.end.col as usize + 1);
    let text = sheet.to_text_rows();
    let mut table = Table::from_text(&(0..rows).map(|r| text.get(r).cloned().unwrap_or_default()).collect::<Vec<_>>(), width);
    for row in &mut table.rows {
        row.cells.resize_with(cols, || Cell::text(""));
    }
    table.columns.resize(cols, Emu(width.0 / cols.max(1) as i64));
    for m in &sheet.merges {
        let (r0, c0) = (m.start.row as usize, m.start.col as usize);
        if r0 >= rows || c0 >= cols {
            continue;
        }
        for r in r0..=(m.end.row as usize).min(rows - 1) {
            for c in c0..=(m.end.col as usize).min(cols - 1) {
                table.rows[r].cells[c].covered = (r, c) != (r0, c0);
            }
        }
        let owner = &mut table.rows[r0].cells[c0];
        owner.col_span = m.cols().min((cols - c0) as u32);
        owner.row_span = m.rows().min((rows - r0) as u32);
    }
    table
}

/// Every table as a sheet; with no tables, one sheet with a paragraph per row.
fn blocks_to_sheets(blocks: &[Block]) -> Vec<Sheet> {
    let tables: Vec<&Table> = blocks.iter().filter_map(|b| if let Block::Table(t) = b { Some(t) } else { None }).collect();
    if tables.is_empty() {
        let mut sheet = Sheet::new("Sheet1");
        let lines = blocks.iter().filter_map(|b| if let Block::Paragraph(p) = b { Some(p.plain_text()) } else { None });
        for (r, line) in lines.enumerate().filter(|(_, l)| !l.is_empty()) {
            sheet.set(CellRef::new(r as u32, 0), Value::Text(line));
        }
        return vec![sheet];
    }
    tables.iter().enumerate().map(|(i, t)| table_to_sheet(t, &format!("Table {}", i + 1))).collect()
}

/// Each sheet as a table, after a paragraph with its name when there's more than one.
fn sheets_to_blocks(sheets: &[Sheet]) -> Vec<Block> {
    let mut blocks = Vec::new();
    for s in sheets.iter().filter(|s| !s.hidden) {
        if sheets.len() > 1 {
            let mut heading = Paragraph::text(&s.name);
            heading.props.style = Some("Heading1".into());
            blocks.push(Block::Paragraph(heading));
        }
        // 6.27 in: an A4 page's text width at Word's default margins.
        blocks.push(Block::Table(sheet_to_table(s, Emu(5_731_510))));
    }
    if blocks.is_empty() {
        blocks.push(Block::Paragraph(Paragraph::default()));
    }
    blocks
}

/// A slide's frames in reading order: top to bottom, then left to right.
fn reading_order(frames: &[Frame]) -> Vec<&Frame> {
    let mut v: Vec<&Frame> = frames.iter().collect();
    let at = |f: &Frame| f.shape.xfrm.as_ref().map(|x| (x.y, x.x)).unwrap_or_default();
    v.sort_by_key(|f| at(f));
    v
}

fn slides_to_blocks(slides: &[Slide]) -> Vec<Block> {
    fn frame_blocks(f: &Frame, out: &mut Vec<Block>) {
        match &f.content {
            FrameContent::Shape { text: Some(body), .. } => out.extend(body.paragraphs.iter().cloned().map(Block::Paragraph)),
            FrameContent::Table { table } => out.push(Block::Table(table.clone())),
            FrameContent::Picture { image } => {
                out.push(Block::Paragraph(Paragraph { content: vec![Inline::Image(image.clone())], ..Default::default() }))
            }
            FrameContent::Group { frames } => reading_order(frames).into_iter().for_each(|f| frame_blocks(f, out)),
            _ => {}
        }
    }
    let mut blocks = Vec::new();
    for (i, slide) in slides.iter().filter(|s| !s.hidden).enumerate() {
        if i > 0 {
            blocks.push(Block::Paragraph(Paragraph { content: vec![Inline::Break { kind: BreakKind::Page }], ..Default::default() }));
        }
        for f in reading_order(&slide.frames) {
            frame_blocks(f, &mut blocks);
        }
    }
    blocks
}

/// Margins on a 16:9 slide, and a box filling the rest.
const MARGIN: i64 = 457_200;

fn body_box(size: SlideSize) -> Xfrm {
    Xfrm {
        x: Emu(MARGIN),
        y: Emu(MARGIN),
        width: Emu(size.width.0 - 2 * MARGIN),
        height: Emu(size.height.0 - 2 * MARGIN),
        ..Default::default()
    }
}

/// A slide for each page (split at page breaks and top-level headings), with the paragraphs in
/// a text box and each table and picture as its own frame below them.
fn flow_to_slides(blocks: &[Block]) -> Body {
    let size = SlideSize::default();
    let mut slides: Vec<Vec<&Block>> = vec![Vec::new()];
    for b in blocks {
        let starts = match b {
            Block::Paragraph(p) => {
                p.content.iter().any(|i| matches!(i, Inline::Break { kind: BreakKind::Page }))
                    || matches!(p.props.style.as_deref(), Some("Title" | "Heading1"))
            }
            _ => false,
        };
        if starts && slides.last().is_some_and(|s| !s.is_empty()) {
            slides.push(Vec::new());
        }
        slides.last_mut().unwrap().push(b);
    }
    let slides = slides
        .into_iter()
        .filter(|s| !s.is_empty())
        .map(|blocks| {
            let mut frames = Vec::new();
            let mut text = Vec::new();
            let area = body_box(size);
            let mut next_y = area.y;
            let mut id = 2;
            let flush = |text: &mut Vec<Paragraph>, frames: &mut Vec<Frame>, id: &mut u32, next_y: &mut Emu| {
                if text.iter().all(|p| p.plain_text().trim().is_empty()) {
                    text.clear();
                    return;
                }
                // Each line as tall as its largest text (18 pt where a run doesn't say), with the
                // paragraph's line and paragraph spacing, inside the box's 0.1 in insets.
                let lines: i64 = text
                    .iter()
                    .map(|p| {
                        let largest = p.runs().map(|r| r.props.size.map(|s| s.points()).unwrap_or(18.0)).fold(f64::NAN, f64::max);
                        // An empty paragraph is as tall as its mark.
                        let size = if largest.is_nan() {
                            p.mark.as_ref().and_then(|m| m.size).map(|s| s.points()).unwrap_or(18.0)
                        } else {
                            largest
                        };
                        let spacing = match p.props.line_spacing {
                            Some(LineSpacing::Multiple(m)) => m.fraction().max(1.0),
                            _ => 1.0,
                        };
                        let count = 1.0 + p.plain_text().matches('\n').count() as f64;
                        let around = p.props.space_before.unwrap_or_default().0 + p.props.space_after.unwrap_or_default().0;
                        Emu::from_points(size * 1.2 * spacing * count).0 + around
                    })
                    .sum::<i64>()
                    + 2 * 91_440;
                let height = Emu(lines.min(area.height.0));
                frames.push(Frame::text_box(*id, Xfrm { y: *next_y, height, ..area.clone() }, std::mem::take(text)));
                *id += 1;
                *next_y = *next_y + height;
            };
            for b in blocks {
                match b {
                    Block::Paragraph(p) => {
                        let mut p = p.clone();
                        p.content.retain(|i| !matches!(i, Inline::Break { .. }));
                        let images: Vec<Image> =
                            p.content.iter().filter_map(|i| if let Inline::Image(img) = i { Some(img.clone()) } else { None }).collect();
                        p.content.retain(|i| !matches!(i, Inline::Image(_)));
                        p.origin = Origin::default();
                        text.push(p);
                        for image in images {
                            flush(&mut text, &mut frames, &mut id, &mut next_y);
                            let xfrm = Xfrm { x: area.x, y: next_y, width: image.width, height: image.height, ..Default::default() };
                            next_y = next_y + image.height;
                            frames.push(Frame {
                                id,
                                name: format!("Picture {id}"),
                                description: image.description.clone(),
                                hidden: false,
                                shape: ShapeProps { xfrm: Some(xfrm), preset: Some("rect".into()), ..Default::default() },
                                placeholder: None,
                                content: FrameContent::Picture { image },
                                origin: Origin::default(),
                            });
                            id += 1;
                        }
                    }
                    Block::Table(t) => {
                        flush(&mut text, &mut frames, &mut id, &mut next_y);
                        let mut t = t.clone();
                        let total: i64 = t.columns.iter().map(|c| c.0).sum();
                        // Fit the table to the slide's width.
                        if total > area.width.0 && total > 0 {
                            for c in &mut t.columns {
                                c.0 = c.0 * area.width.0 / total;
                            }
                        }
                        let height = Emu(t.rows.len() as i64 * 370_840);
                        let xfrm =
                            Xfrm { x: area.x, y: next_y, width: Emu(t.columns.iter().map(|c| c.0).sum()), height, ..Default::default() };
                        next_y = next_y + height;
                        frames.push(Frame {
                            id,
                            name: format!("Table {id}"),
                            description: None,
                            hidden: false,
                            shape: ShapeProps { xfrm: Some(xfrm), ..Default::default() },
                            placeholder: None,
                            content: FrameContent::Table { table: t },
                            origin: Origin::default(),
                        });
                        id += 1;
                    }
                    Block::Raw { .. } => {}
                }
            }
            flush(&mut text, &mut frames, &mut id, &mut next_y);
            Slide { frames, ..Default::default() }
        })
        .collect();
    Body::Slides { size, slides }
}

/// A slide per visible sheet, each holding the sheet as a table.
fn sheets_to_slides(sheets: &[Sheet]) -> Body {
    let size = SlideSize::default();
    let area = body_box(size);
    let slides = sheets
        .iter()
        .filter(|s| !s.hidden)
        .map(|s| {
            let table = sheet_to_table(s, area.width);
            let height = Emu(table.rows.len() as i64 * 370_840);
            let frame = Frame {
                id: 2,
                name: s.name.clone(),
                description: None,
                hidden: false,
                shape: ShapeProps { xfrm: Some(Xfrm { height, ..area.clone() }), ..Default::default() },
                placeholder: None,
                content: FrameContent::Table { table },
                origin: Origin::default(),
            };
            Slide { frames: vec![frame], name: Some(s.name.clone()), ..Default::default() }
        })
        .collect();
    Body::Slides { size, slides }
}

/// The document's text: paragraphs on lines, table cells split by tabs, slides and sheets one
/// after another.
pub fn plain_text(doc: &Document) -> String {
    match &doc.body {
        Body::Flow { blocks } => blocks_text(blocks),
        Body::Slides { slides, .. } => blocks_text(&slides_to_blocks(slides)).replace('\u{c}', ""),
        Body::Workbook { sheets } => sheets
            .iter()
            .map(|s| s.to_text_rows().into_iter().map(|r| r.join("\t")).collect::<Vec<_>>().join("\n"))
            .collect::<Vec<_>>()
            .join("\n\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_and_sheets_keep_spans() {
        let mut t = Table::from_text(&[vec!["a".into(), "".into(), "3".into()], vec!["".into(), "".into(), "x".into()]], Emu(3000));
        t.rows[0].cells[0].col_span = 2;
        t.rows[0].cells[0].row_span = 2;
        for (r, c) in [(0, 1), (1, 0), (1, 1)] {
            t.rows[r].cells[c].covered = true;
        }
        let sheet = table_to_sheet(&t, "T");
        assert_eq!(sheet.merges, vec![Range::parse("A1:B2").unwrap()]);
        assert_eq!(sheet.value(CellRef::new(0, 2)), &Value::Number(3.0));
        let back = sheet_to_table(&sheet, Emu(3000));
        assert_eq!((back.rows[0].cells[0].col_span, back.rows[0].cells[0].row_span), (2, 2));
        assert!(back.rows[1].cells[1].covered);
        assert_eq!(back.rows[1].cells[2].plain_text(), "x");
    }

    #[test]
    fn every_kind_converts_to_every_other() {
        let mut word = Document::new(Kind::Word);
        word.body = Body::Flow {
            blocks: vec![
                Block::Paragraph(Paragraph {
                    props: ParaProps { style: Some("Title".into()), ..Default::default() },
                    ..Paragraph::text("Report")
                }),
                Block::Paragraph(Paragraph::text("Intro")),
                Block::Table(Table::from_text(&[vec!["k".into(), "v".into()], vec!["n".into(), "2".into()]], Emu(1_000_000))),
                Block::Paragraph(Paragraph {
                    content: vec![Inline::Break { kind: BreakKind::Page }, Inline::Text(Run::new("Page two"))],
                    ..Default::default()
                }),
            ],
        };
        let slides = to_kind(&word, Kind::Slides).unwrap();
        let Body::Slides { slides: s, .. } = &slides.body else { panic!() };
        assert_eq!(s.len(), 2, "a slide per page");
        assert!(matches!(s[0].frames[1].content, FrameContent::Table { .. }));
        let sheets = to_kind(&word, Kind::Sheets).unwrap();
        assert_eq!(sheets.sheet_value(CellRef::new(1, 1)), Some(&Value::Number(2.0)));
        let csv = to_kind(&sheets, Kind::Csv).unwrap();
        assert_eq!(crate::formats::csv::write(&csv).unwrap(), b"\xEF\xBB\xBFk,v\r\nn,2\r\n");
        let back = to_kind(&sheets, Kind::Word).unwrap();
        assert!(plain_text(&back).contains("k\tv\nn\t2"));
        let from_slides = to_kind(&slides, Kind::Word).unwrap();
        assert_eq!(plain_text(&from_slides).replace('\u{c}', ""), "Report\nIntro\nk\tv\nn\t2\n\nPage two");
        assert!(plain_text(&to_kind(&sheets, Kind::Slides).unwrap()).contains("n\t2"));
    }
}
