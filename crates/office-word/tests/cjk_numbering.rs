use office_engine::display::Item;
use office_engine::measure::FixedMeasurer;
use office_word::numbering::{format_number, Numbering};
use office_word::view::WordView;

const SAMPLE: &[u8] = include_bytes!("../../../tests/stress/samples/cjk-list-markers.docx");

fn markers(sequence: &str, count: usize) -> Vec<String> {
    let mut out: Vec<_> = sequence.chars().map(|c| format!("{c}.")).collect();
    out.extend((out.len() + 1..=count).map(|n| format!("{n}.")));
    out
}

#[test]
fn cjk_sequences_use_ideographs_then_decimal() {
    for (format, sequence) in [("ideographTraditional", "甲乙丙丁戊己庚辛壬癸"), ("ideographZodiac", "子丑寅卯辰巳午未申酉戌亥")]
    {
        assert_eq!(format_number(0, format), "0");
        assert_eq!(format_number(u32::MAX, format), u32::MAX.to_string());
        for (i, label) in markers(sequence, 20).iter().enumerate() {
            assert_eq!(format!("{}.", format_number(i as u32 + 1, format)), *label);
        }
    }
}

#[test]
fn cjk_nested_labels_keep_their_formats_punctuation_and_start_override() {
    let xml = office_core::xml::parse(
        br#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="ideographTraditional"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="ideographZodiac"/><w:lvlText w:val="%1/%2)"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num>
    </w:numbering>"#,
    )
    .unwrap();
    let labels = Numbering::parse(&xml).labels([0, 1, 1, 0, 1].map(|level| Some(("1".into(), level))));
    assert_eq!(labels, ["丙.", "丙/子)", "丙/丑)", "丁.", "丁/子)"].map(|s| Some(s.to_string())));
}

fn assert_render_and_round_trip(bytes: &[u8], expected: &[String]) {
    let mut view = WordView::open(bytes).unwrap();
    for _ in 0..2 {
        let labels: Vec<_> = office_word::list_labels(&view.doc).into_iter().flatten().collect();
        assert_eq!(labels, expected);
        let mut host = FixedMeasurer::default();
        view.layout(&mut host);
        let mut painted = Vec::new();
        for page in 0..view.page_count() {
            for item in view.paint(&mut host, page).items {
                if let Item::Text { text, .. } = item {
                    if expected.contains(&text) {
                        painted.push(text);
                    }
                }
            }
        }
        assert_eq!(painted, expected, "markers must appear in the actual display list");
        view = WordView::open(&view.save().unwrap()).unwrap();
    }
}

#[test]
fn cjk_sample_markers_are_painted_and_survive_saving() {
    let mut expected = markers("甲乙丙丁戊己庚辛壬癸", 12);
    expected.extend(markers("子丑寅卯辰巳午未申酉戌亥", 14));
    assert_render_and_round_trip(SAMPLE, &expected);
}

#[test]
fn original_corpus_cjk_markers_are_painted_and_survive_saving() {
    let Some(dir) = std::env::var_os("CORPUS_FILES") else { return };
    for (name, sequence) in [("lo-cjklist30.docx", "甲乙丙丁戊己庚辛壬癸"), ("lo-cjklist31.docx", "子丑寅卯辰巳午未申酉戌亥")]
    {
        let bytes = std::fs::read(std::path::Path::new(&dir).join(name)).unwrap();
        assert_render_and_round_trip(&bytes, &markers(sequence, 20));
    }
}
