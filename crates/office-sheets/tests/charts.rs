//! Charts: made from cells, saved as Excel chart parts, read back, moved, changed and deleted.

use office_core::model::{CellRef, ChartKind, LegendPosition, Range};
use office_core::opc::Package;
use office_core::Kind;
use office_sheets::view::{ChartPatch, SheetsView};

fn range(s: &str) -> Range {
    Range::parse(s).unwrap()
}

fn book() -> SheetsView {
    let mut v = SheetsView::blank(Kind::Sheets);
    let rows = [["Month", "Sales", "Costs"], ["Jan", "10", "4"], ["Feb", "12", "5"], ["Mar", "9", "7"]];
    for (r, row) in rows.iter().enumerate() {
        for (c, text) in row.iter().enumerate() {
            v.set_input(0, CellRef::new(r as u32, c as u32), text);
        }
    }
    v
}

fn part(bytes: &[u8], name: &str) -> Option<String> {
    let pkg = Package::read(bytes).unwrap();
    pkg.has(name).then(|| String::from_utf8(pkg.part(name).unwrap().to_vec()).unwrap())
}

#[test]
fn a_chart_from_a_block_of_cells() {
    let mut v = book();
    // From one cell, the whole block around it.
    assert_eq!(v.add_chart(0, range("B2"), ChartKind::Column), Some(0));
    let c = &v.sheets()[0].charts[0];
    assert_eq!(c.series.len(), 2);
    assert_eq!(c.series[0].name_ref.as_deref(), Some("Sheet1!$B$1"));
    assert_eq!(c.series[0].categories.as_deref(), Some("Sheet1!$A$2:$A$4"));
    assert_eq!(c.series[1].values, "Sheet1!$C$2:$C$4");
    assert_eq!(c.legend, Some(LegendPosition::Bottom));
    let shown = v.charts(0);
    assert_eq!(shown[0].categories, ["Jan", "Feb", "Mar"]);
    assert_eq!(shown[0].series[0].name, "Sales");
    assert_eq!(shown[0].series[1].values, [Some(4.0), Some(5.0), Some(7.0)]);
    assert_eq!(shown[0].range.as_deref(), Some("A1:C4"));
    assert!(shown[0].x > 200.0 && shown[0].w > 400.0, "{:?}", (shown[0].x, shown[0].w));

    let bytes = v.save().unwrap();
    let sheet = part(&bytes, "xl/worksheets/sheet1.xml").unwrap();
    assert!(sheet.contains("<drawing r:id="), "{sheet}");
    let chart = part(&bytes, "xl/charts/chart1.xml").unwrap();
    assert!(chart.contains("<c:barDir val=\"col\"/>") && chart.contains("<c:f>Sheet1!$B$2:$B$4</c:f>"), "{chart}");
    assert!(part(&bytes, "xl/drawings/drawing1.xml").unwrap().contains("r:id=\"rId1\""));
    let pkg = Package::read(&bytes).unwrap();
    assert_eq!(pkg.content_type("xl/charts/chart1.xml"), Some("application/vnd.openxmlformats-officedocument.drawingml.chart+xml"));
    assert_eq!(pkg.content_type("xl/drawings/drawing1.xml"), Some("application/vnd.openxmlformats-officedocument.drawing+xml"));

    // Read back: the same chart, which saves again without changes.
    let mut back = SheetsView::open(&bytes, "book.xlsx").unwrap();
    let c2 = back.sheets()[0].charts[0].clone();
    let refs = |c: &office_core::model::Chart| c.series.iter().map(|s| (s.name_ref.clone(), s.categories.clone(), s.values.clone())).collect::<Vec<_>>();
    assert_eq!(refs(&c2), refs(&v.sheets()[0].charts[0]));
    assert_eq!(c2.series[1].cache.values, [Some(4.0), Some(5.0), Some(7.0)]);
    assert_eq!(c2.anchor, v.sheets()[0].charts[0].anchor);
    assert!(c2.untouched());
    let again = back.save().unwrap();
    assert_eq!(part(&again, "xl/charts/chart1.xml"), Some(chart.clone()));

    // Moved: the chart part stays, the anchor moves.
    back.move_chart(0, 0, 10.0, 200.0, 300.0, 200.0);
    let moved = back.save().unwrap();
    assert_eq!(part(&moved, "xl/charts/chart1.xml"), Some(chart));
    let reread = SheetsView::open(&moved, "book.xlsx").unwrap();
    assert_eq!(reread.sheets()[0].charts[0].anchor.from.col, 0);

    // Changed: written fresh.
    back.set_chart(0, 0, &ChartPatch { kind: Some(ChartKind::Line), title: Some("Money".into()), ..Default::default() });
    let changed = back.save().unwrap();
    let xml = part(&changed, "xl/charts/chart1.xml").unwrap();
    assert!(xml.contains("<c:lineChart>") && xml.contains("Money"), "{xml}");
    let reread = SheetsView::open(&changed, "book.xlsx").unwrap();
    assert_eq!(reread.sheets()[0].charts[0].kind, ChartKind::Line);
    assert_eq!(reread.sheets()[0].charts[0].title.as_deref(), Some("Money"));

    // Deleted: the drawing goes, and the sheet stops pointing at it.
    back.delete_chart(0, 0);
    let gone = back.save().unwrap();
    assert!(part(&gone, "xl/charts/chart1.xml").is_none());
    assert!(part(&gone, "xl/drawings/drawing1.xml").is_none());
    assert!(!part(&gone, "xl/worksheets/sheet1.xml").unwrap().contains("<drawing"));
}

#[test]
fn charts_follow_rows_names_and_undo() {
    let mut v = book();
    v.add_chart(0, range("A1:C4"), ChartKind::Pie).unwrap();
    v.shift_rows(0, 0, 2);
    assert_eq!(v.sheets()[0].charts[0].series[0].values, "Sheet1!$B$4:$B$6");
    assert_eq!(v.sheets()[0].charts[0].anchor.from.row, 2);
    v.rename_sheet(0, "Q 1");
    assert_eq!(v.sheets()[0].charts[0].series[0].values, "'Q 1'!$B$4:$B$6");
    assert_eq!(v.charts(0)[0].series[0].values, [Some(10.0), Some(12.0), Some(9.0)]);
    v.undo();
    v.undo();
    v.undo();
    assert!(v.sheets()[0].charts.is_empty());
    v.redo();
    assert_eq!(v.sheets()[0].charts.len(), 1);
}

#[test]
fn scatter_plots_x_against_y() {
    let mut v = SheetsView::blank(Kind::Sheets);
    for (r, (x, y)) in [(1, 2), (2, 4), (3, 9)].iter().enumerate() {
        v.set_input(0, CellRef::new(r as u32, 0), &x.to_string());
        v.set_input(0, CellRef::new(r as u32, 1), &y.to_string());
    }
    v.add_chart(0, range("A1:B3"), ChartKind::Scatter).unwrap();
    let c = &v.charts(0)[0];
    assert_eq!(c.series.len(), 1);
    assert_eq!(c.series[0].x, Some(vec![Some(1.0), Some(2.0), Some(3.0)]));
    let bytes = v.save().unwrap();
    let xml = part(&bytes, "xl/charts/chart1.xml").unwrap();
    assert!(xml.contains("<c:xVal><c:numRef><c:f>Sheet1!$A$1:$A$3</c:f>"), "{xml}");
}

/// A workbook from another app with charts (set CHART_SAMPLES to a folder of .xlsx files).
#[test]
fn other_apps_charts_survive() {
    let Ok(dir) = std::env::var("CHART_SAMPLES") else { return };
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "xlsx") {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        let mut v = SheetsView::open(&bytes, "x.xlsx").unwrap();
        let count: usize = v.sheets().iter().map(|s| s.charts.len()).sum();
        eprintln!("{}: {count} charts", path.display());
        for (i, s) in v.sheets().to_vec().iter().enumerate() {
            for c in v.charts(i) {
                eprintln!("  {} {:?} {:?} {} series, {} categories, {:?}", s.name, c.kind, c.title, c.series.len(), c.categories.len(), c.range);
            }
        }
        let pkg = Package::read(&bytes).unwrap();
        let charts: Vec<String> = pkg.part_names().filter(|n| n.starts_with("xl/charts/chart")).map(str::to_string).collect();
        let saved = v.save().unwrap();
        for c in &charts {
            assert_eq!(part(&saved, c), part(&bytes, c), "{c} changed on an unchanged save");
        }
        // Move every chart: parts stay, the file reads back with as many charts.
        for i in 0..v.sheets().len() {
            for (k, c) in v.charts(i).iter().enumerate() {
                v.move_chart(i, k, c.x + 20.0, c.y + 20.0, c.w, c.h);
            }
        }
        let saved = v.save().unwrap();
        let back = SheetsView::open(&saved, "x.xlsx").unwrap();
        assert_eq!(back.sheets().iter().map(|s| s.charts.len()).sum::<usize>(), count);
        // Change every chart's title: written fresh, still read back.
        for i in 0..v.sheets().len() {
            for k in 0..v.sheets()[i].charts.len() {
                v.set_chart(i, k, &ChartPatch { title: Some(format!("T{k}")), ..Default::default() });
            }
        }
        let saved = v.save().unwrap();
        let back = SheetsView::open(&saved, "x.xlsx").unwrap();
        assert_eq!(back.sheets().iter().map(|s| s.charts.len()).sum::<usize>(), count);
        std::fs::write(format!("/tmp/chart-samples/out-{}", path.file_name().unwrap().to_string_lossy()), &saved).ok();
    }
}
