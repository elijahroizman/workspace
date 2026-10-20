//! Documents built in code, for the tests to write and read.
#![allow(dead_code)]

use office_core::drawing::{Color, Rgb, ShapeProps, Xfrm};
use office_core::model::*;
use office_core::units::{Emu, FontSize, Percent};
use office_core::{Document, Kind};

/// A 1×1 PNG.
pub const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63,
    0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
    0xAE, 0x42, 0x60, 0x82,
];

pub fn rich_paragraph() -> Paragraph {
    let bold_red =
        RunProps { bold: Some(true), color: Some(Color::rgb(Rgb(0xC0, 0, 0))), size: Some(FontSize(1400)), ..Default::default() };
    let themed = RunProps {
        italic: Some(true),
        color: Some(Color::scheme("accent1").with("lumMod", 74_902)),
        font: Some("Georgia".into()),
        ..Default::default()
    };
    let mut p = Paragraph::text("Plain, ");
    p.content.push(Inline::Text(Run::new("bold red").with_props(bold_red)));
    p.content.push(Inline::Text(Run::new(" and\tthemed\nnext line").with_props(themed)));
    p.content.push(Inline::Text(Run {
        text: " a link".into(),
        link: Some(Link { url: Some("https://example.com/a?b=1&c=2".into()), ..Default::default() }),
        ..Default::default()
    }));
    p.props = ParaProps {
        align: Some(Align::Center),
        space_after: Some(Emu::from_points(6.0)),
        line_spacing: Some(LineSpacing::Multiple(Percent(115_000))),
        ..Default::default()
    };
    p
}

pub fn grid() -> Table {
    // A 3×3 table whose top-left cell spans two columns and two rows.
    let mut t = Table::from_text(
        &[vec!["span".into(), "".into(), "c".into()], vec!["".into(), "".into(), "f".into()], vec!["g".into(), "h".into(), "i".into()]],
        Emu::from_inches(6.0),
    );
    t.rows[0].cells[0].col_span = 2;
    t.rows[0].cells[0].row_span = 2;
    for (r, c) in [(0, 1), (1, 0), (1, 1)] {
        t.rows[r].cells[c] = Cell { covered: true, ..Cell::text("") };
    }
    t.rows[2].cells[2].fill = Some(Color::rgb(Rgb(0xFF, 0xF2, 0xCC)));
    t
}

/// A Word document with headings, formatted runs, a link, a table with spans, a picture and a page break.
pub fn word() -> Document {
    let mut doc = Document::new(Kind::Word);
    let png = doc.add_media("image/png", PNG.to_vec());
    let picture = Paragraph {
        content: vec![
            Inline::Image(Image {
                media: png,
                width: Emu::from_inches(1.0),
                height: Emu::from_inches(1.0),
                name: "Dot".into(),
                description: Some("A dot".into()),
                origin: Default::default(),
            }),
            Inline::Break { kind: BreakKind::Page },
            Inline::Text(Run::new("after the break")),
        ],
        ..Default::default()
    };
    let heading = Paragraph { props: ParaProps { style: Some("Heading1".into()), ..Default::default() }, ..Paragraph::text("Title") };
    let table = grid();
    doc.body = Body::Flow {
        blocks: vec![Block::Paragraph(heading), Block::Paragraph(rich_paragraph()), Block::Table(table), Block::Paragraph(picture)],
    };
    doc.properties.title = Some("From scratch".into());

    doc
}

/// Two slides: text, a picture, a table and a group on the first; the second hidden.
pub fn slides() -> Document {
    let mut doc = Document::new(Kind::Slides);
    let png = doc.add_media("image/png", PNG.to_vec());
    let at = |x: f64, y: f64, w: f64, h: f64| Xfrm {
        x: Emu::from_inches(x),
        y: Emu::from_inches(y),
        width: Emu::from_inches(w),
        height: Emu::from_inches(h),
        ..Default::default()
    };
    let text = Frame::text_box(2, at(1.0, 1.0, 6.0, 1.0), vec![rich_paragraph(), Paragraph::text("Second paragraph")]);
    let picture = Frame {
        id: 3,
        name: "Dot".into(),
        description: Some("A dot".into()),
        hidden: false,
        shape: ShapeProps { xfrm: Some(at(8.0, 1.0, 1.0, 1.0)), preset: Some("rect".into()), ..Default::default() },
        placeholder: None,
        content: FrameContent::Picture {
            image: Image {
                media: png,
                width: Emu::from_inches(1.0),
                height: Emu::from_inches(1.0),
                name: "Dot".into(),
                description: Some("A dot".into()),
                origin: Default::default(),
            },
        },
        origin: Default::default(),
    };
    let mut table = grid();
    table.style = Some("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}".into());
    for row in &mut table.rows {
        row.height = Some(Emu::from_inches(0.4));
    }
    table.rows[0].header = true;
    let table = Frame {
        id: 4,
        name: "Table".into(),
        description: None,
        hidden: false,
        shape: ShapeProps { xfrm: Some(at(1.0, 3.0, 6.0, 1.2)), ..Default::default() },
        placeholder: None,
        content: FrameContent::Table { table },
        origin: Default::default(),
    };
    let child = Frame::text_box(6, at(1.0, 5.0, 2.0, 0.5), vec![Paragraph::text("grouped")]);
    let mut group_shape = ShapeProps { xfrm: Some(at(1.0, 5.0, 2.0, 0.5)), ..Default::default() };
    group_shape.xfrm.as_mut().unwrap().child =
        Some((Emu::from_inches(1.0), Emu::from_inches(5.0), Emu::from_inches(2.0), Emu::from_inches(0.5)));
    let group = Frame {
        id: 5,
        name: "Group".into(),
        description: None,
        hidden: false,
        shape: group_shape,
        placeholder: None,
        content: FrameContent::Group { frames: vec![child] },
        origin: Default::default(),
    };
    doc.body = Body::Slides {
        size: SlideSize::default(),
        slides: vec![
            Slide { frames: vec![text, picture, table, group], ..Default::default() },
            Slide { hidden: true, ..Default::default() },
        ],
    };

    doc
}

/// Two sheets: every kind of value, rich text, a formula and a merge; the second hidden.
pub fn sheets() -> Document {
    let mut doc = Document::new(Kind::Sheets);
    let Body::Workbook { sheets } = &mut doc.body else { panic!() };
    let s = &mut sheets[0];
    s.name = "Data".into();
    s.set(CellRef::new(0, 0), Value::Text("Name".into()));
    s.set(CellRef::new(0, 1), Value::Text(" padded ".into()));
    s.set(CellRef::new(1, 0), Value::Number(0.1 + 0.2));
    s.set(CellRef::new(1, 1), Value::Number(1e20));
    s.set(CellRef::new(1, 2), Value::Number(-2.5e-9));
    s.set(CellRef::new(2, 0), Value::Bool(true));
    s.set(CellRef::new(2, 1), Value::Error("#DIV/0!".into()));
    s.set(CellRef::new(2, 2), Value::Text("control \u{1} char and _x0041_".into()));
    let rich = Value::Rich(vec![Run::new("bold").with_props(RunProps { bold: Some(true), ..Default::default() }), Run::new(" plain")]);
    s.set(CellRef::new(3, 0), rich);
    let f = s.cell_mut(CellRef::new(4, 0));
    f.formula = Some("SUM(A2:B2)".into());
    f.value = Value::Number(1e20);
    s.merges.push(Range::parse("A6:C6").unwrap());
    s.set(CellRef::new(5, 0), Value::Text("merged".into()));
    let mut second = Sheet::new("Hidden");
    second.hidden = true;
    second.set(CellRef::new(0, 0), Value::Text("Name".into()));
    sheets.push(second);

    doc
}
