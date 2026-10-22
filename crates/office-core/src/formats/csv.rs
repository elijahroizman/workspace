//! CSV in and out. A CSV file is a one-sheet workbook. How the file was written (delimiter,
//! line endings, encoding, quoting) is kept as a [`Dialect`] in the document's extensions, so
//! saving it again writes it the same way.

use crate::model::{format_number, Body, Document, Kind, Sheet, SheetRow, Value};
use crate::{Error, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dialect {
    pub delimiter: char,
    pub line_ending: LineEnding,
    pub encoding: Encoding,
    /// Every field in quotes, not just the ones that need them.
    pub quote_all: bool,
    /// The file ends with a line ending.
    pub trailing_newline: bool,
    /// The file starts with Excel's `sep=;` line naming the delimiter.
    pub sep_line: bool,
    /// Fields that start or end with a space go in quotes, so nothing trims them. Off when
    /// the file had such fields unquoted (`name, age`).
    pub quote_spaces: bool,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum LineEnding {
    CrLf,
    Lf,
    Cr,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    /// Old Excel on Windows, and anything that isn't valid UTF-8.
    Windows1252,
}

impl Default for Dialect {
    /// What Excel's "CSV UTF-8" writes: commas, CRLF, a byte order mark so Excel reads the
    /// encoding right.
    fn default() -> Dialect {
        Dialect {
            delimiter: ',',
            line_ending: LineEnding::CrLf,
            encoding: Encoding::Utf8Bom,
            quote_all: false,
            trailing_newline: true,
            sep_line: false,
            quote_spaces: true,
        }
    }
}

/// Reads a CSV (or TSV) file into a one-sheet workbook named `sheet_name`.
///
/// Fields that are numbers written the way the compiler would write them back (`3`, `-1.25`,
/// not `007` or `1.50`) become numbers; everything else stays text, so writing the file out
/// again gives back the same fields.
pub fn read(bytes: &[u8], sheet_name: &str, tab_hint: bool) -> Result<Document> {
    let (text, encoding) = decode(bytes)?;
    let mut text = text.as_str();
    let mut sep_line = false;
    let mut delimiter = None;
    // Excel's `sep=;` first line.
    if let Some(rest) = text.strip_prefix("sep=") {
        let mut chars = rest.chars();
        if let (Some(d), Some(next)) = (chars.next(), chars.next()) {
            if next == '\n' || next == '\r' {
                delimiter = Some(d);
                sep_line = true;
                text = &rest[d.len_utf8()..];
                text = text.strip_prefix("\r\n").or_else(|| text.strip_prefix('\n')).or_else(|| text.strip_prefix('\r')).unwrap_or(text);
            }
        }
    }
    let delimiter = delimiter.unwrap_or_else(|| sniff_delimiter(text, tab_hint));
    let trailing_newline = text.ends_with(['\n', '\r']);

    let Parsed { records, quote_all, line_ending, spaces_unquoted } = parse(text, delimiter);
    let mut sheet = Sheet::new(sheet_name);
    for (r, fields) in records.into_iter().enumerate() {
        let mut row = SheetRow { index: r as u32, ..Default::default() };
        let last = fields.len().saturating_sub(1);
        let blank = fields.len() == 1;
        for (c, field) in fields.into_iter().enumerate() {
            let value = infer(field);
            // Inner empty fields are implied by the columns around them; a row's last one marks
            // how long the row is, so `a,b,` keeps its trailing comma.
            if value.is_empty() && c != last {
                continue;
            }
            row.cells.push(crate::model::SheetCell { col: c as u32, value, ..Default::default() });
        }
        // A blank line is one empty field; there's nothing to keep but the row. (`,,` is three
        // empty fields, and keeps its last one so it's written back the same.)
        if blank && row.cells.len() == 1 && row.cells[0].value.is_empty() {
            row.cells.clear();
        }
        sheet.rows.push(row);
    }

    let mut doc = Document::new(Kind::Csv);
    doc.body = Body::Workbook { sheets: vec![sheet] };
    let line_ending = line_ending.unwrap_or(LineEnding::Lf);
    doc.extensions.insert(Dialect {
        delimiter,
        line_ending,
        encoding,
        quote_all,
        trailing_newline,
        sep_line,
        quote_spaces: !spaces_unquoted,
    });
    Ok(doc)
}

/// Writes the document's first visible sheet as CSV, in the document's dialect if it was read
/// from CSV, else [`Dialect::default`]. Formulas write their last result.
pub fn write(doc: &Document) -> Result<Vec<u8>> {
    let Body::Workbook { sheets } = &doc.body else {
        return Err(Error::Invalid("only a workbook can be saved as CSV".into()));
    };
    let dialect = doc.extensions.get::<Dialect>().cloned().unwrap_or_default();
    let sheet = sheets.iter().find(|s| !s.hidden).or(sheets.first());
    let mut out = String::new();
    let eol = match dialect.line_ending {
        LineEnding::CrLf => "\r\n",
        LineEnding::Lf => "\n",
        LineEnding::Cr => "\r",
    };
    if dialect.sep_line {
        out.push_str(&format!("sep={}{eol}", dialect.delimiter));
    }
    let rows = sheet.map(|s| s.rows.as_slice()).unwrap_or_default();
    let count = rows.last().map(|r| r.index as usize + 1).unwrap_or(0);
    let mut next = rows.iter().peekable();
    for r in 0..count {
        if r > 0 {
            out.push_str(eol);
        }
        let Some(row) = next.next_if(|row| row.index as usize == r) else { continue };
        let width = row.cells.last().map(|c| c.col as usize + 1).unwrap_or(0);
        let mut cells = row.cells.iter().peekable();
        for c in 0..width {
            if c > 0 {
                out.push(dialect.delimiter);
            }
            let text = match cells.next_if(|cell| cell.col as usize == c) {
                Some(cell) => cell.value.display(),
                None => String::new(),
            };
            write_field(&mut out, &text, &dialect);
        }
    }
    if dialect.trailing_newline && count > 0 {
        out.push_str(eol);
    }
    Ok(encode(&out, dialect.encoding))
}

fn write_field(out: &mut String, text: &str, d: &Dialect) {
    let needs =
        d.quote_all || text.contains([d.delimiter, '"', '\n', '\r']) || (d.quote_spaces && (text.starts_with(' ') || text.ends_with(' ')));
    if needs {
        out.push('"');
        out.push_str(&text.replace('"', "\"\""));
        out.push('"');
    } else {
        out.push_str(text);
    }
}

fn infer(field: String) -> Value {
    if field.is_empty() {
        return Value::Empty;
    }
    let first = field.as_bytes()[0];
    if first.is_ascii_digit() || first == b'-' || first == b'.' {
        if let Ok(n) = field.parse::<f64>() {
            if n.is_finite() && format_number(n) == field {
                return Value::Number(n);
            }
        }
    }
    Value::Text(field)
}

/// Splits CSV text into records. Lenient where files are commonly wrong: a quote inside an
/// unquoted field is just a character, and text after a closing quote joins the field.
struct Parsed {
    records: Vec<Vec<String>>,
    /// Every field was quoted.
    quote_all: bool,
    /// The first line ending outside quotes (inside them, line breaks are field text).
    line_ending: Option<LineEnding>,
    /// Some unquoted field starts or ends with a space.
    spaces_unquoted: bool,
}

fn parse(text: &str, delimiter: char) -> Parsed {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted_fields = 0usize;
    let mut fields = 0usize;
    let mut chars = text.chars().peekable();
    let mut at_start = true;
    let mut in_quotes = false;
    let mut was_quoted = false;
    let mut line_ending = None;
    let mut spaces_unquoted = false;
    let mut end_field = |record: &mut Vec<String>, field: &mut String, was_quoted: &mut bool, fields: &mut usize, quoted: &mut usize| {
        if !*was_quoted && (field.starts_with(' ') || field.ends_with(' ')) {
            spaces_unquoted = true;
        }
        record.push(std::mem::take(field));
        *fields += 1;
        if *was_quoted {
            *quoted += 1;
        }
        *was_quoted = false;
    };
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' if at_start => {
                in_quotes = true;
                was_quoted = true;
                at_start = false;
            }
            c if c == delimiter => {
                end_field(&mut record, &mut field, &mut was_quoted, &mut fields, &mut quoted_fields);
                at_start = true;
            }
            '\r' | '\n' => {
                let ending = if c == '\n' {
                    LineEnding::Lf
                } else if chars.next_if_eq(&'\n').is_some() {
                    LineEnding::CrLf
                } else {
                    LineEnding::Cr
                };
                line_ending.get_or_insert(ending);
                end_field(&mut record, &mut field, &mut was_quoted, &mut fields, &mut quoted_fields);
                records.push(std::mem::take(&mut record));
                at_start = true;
            }
            c => {
                field.push(c);
                at_start = false;
            }
        }
    }
    // The last line, unless the file ended with a line ending.
    if !at_start || !record.is_empty() || in_quotes || !field.is_empty() {
        end_field(&mut record, &mut field, &mut was_quoted, &mut fields, &mut quoted_fields);
        records.push(record);
    }
    let quote_all = fields > 0 && quoted_fields == fields;
    Parsed { records, quote_all, line_ending, spaces_unquoted }
}

/// The delimiter that splits the first lines into the same number of fields most often:
/// comma, semicolon (Excel in much of Europe), tab or pipe.
fn sniff_delimiter(text: &str, tab_hint: bool) -> char {
    if tab_hint {
        return '\t';
    }
    let sample: String = text.chars().take(64 * 1024).collect();
    let mut best = (if tab_hint { '\t' } else { ',' }, 0usize, 0usize);
    for d in [',', ';', '\t', '|'] {
        let records = parse(&sample, d).records;
        let lines: Vec<usize> = records.iter().take(50).filter(|r| !(r.len() == 1 && r[0].is_empty())).map(Vec::len).collect();
        let Some(&first) = lines.first() else { continue };
        if first < 2 {
            continue;
        }
        // Lines that agree with the first, then how many fields: more agreement wins.
        let agree = lines.iter().filter(|&&n| n == first).count();
        if (agree, first) > (best.1, best.2) {
            best = (d, agree, first);
        }
    }
    best.0
}

fn decode(bytes: &[u8]) -> Result<(String, Encoding)> {
    let utf16 = |b: &[u8], f: fn([u8; 2]) -> u16| -> Result<String> {
        let units: Vec<u16> = b.as_chunks::<2>().0.iter().map(|c| f(*c)).collect();
        String::from_utf16(&units).map_err(|e| Error::Invalid(format!("not valid UTF-16 text: {e}")))
    };
    Ok(match bytes {
        [0xEF, 0xBB, 0xBF, rest @ ..] => (String::from_utf8_lossy(rest).into_owned(), Encoding::Utf8Bom),
        [0xFF, 0xFE, rest @ ..] => (utf16(rest, u16::from_le_bytes)?, Encoding::Utf16Le),
        [0xFE, 0xFF, rest @ ..] => (utf16(rest, u16::from_be_bytes)?, Encoding::Utf16Be),
        _ => match std::str::from_utf8(bytes) {
            Ok(s) => (s.to_string(), Encoding::Utf8),
            Err(_) => (bytes.iter().map(|&b| windows_1252(b)).collect(), Encoding::Windows1252),
        },
    })
}

fn encode(text: &str, encoding: Encoding) -> Vec<u8> {
    match encoding {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Utf8Bom => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        Encoding::Utf16Le => [0xFF, 0xFE].into_iter().chain(text.encode_utf16().flat_map(u16::to_le_bytes)).collect(),
        Encoding::Utf16Be => [0xFE, 0xFF].into_iter().chain(text.encode_utf16().flat_map(u16::to_be_bytes)).collect(),
        Encoding::Windows1252 => {
            let bytes: Option<Vec<u8>> = text.chars().map(to_windows_1252).collect();
            // Text that Windows-1252 can't hold (it was edited) is saved as UTF-8 with a BOM.
            bytes.unwrap_or_else(|| encode(text, Encoding::Utf8Bom))
        }
    }
}

/// Windows-1252 is Latin-1 except for 0x80–0x9F.
const CP1252_HIGH: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}', '\u{90}', '‘', '’', '“', '”', '•', '–',
    '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
];

fn windows_1252(b: u8) -> char {
    match b {
        0x80..=0x9F => CP1252_HIGH[(b - 0x80) as usize],
        b => b as char,
    }
}

fn to_windows_1252(c: char) -> Option<u8> {
    match c as u32 {
        n @ (0..=0x7F | 0xA0..=0xFF) => Some(n as u8),
        _ => CP1252_HIGH.iter().position(|&h| h == c).map(|i| 0x80 + i as u8),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CellRef;

    fn round_trip(src: &[u8]) -> Document {
        let doc = read(src, "Sheet1", false).unwrap();
        assert_eq!(write(&doc).unwrap(), src, "{:?}", String::from_utf8_lossy(src));
        doc
    }

    #[test]
    fn reads_rfc_4180() {
        let doc = round_trip(b"name,qty,note\r\n\"Smith, J\",3,\"said \"\"hi\"\"\"\r\nLee,4,\r\n");
        assert_eq!(doc.sheet_value(CellRef::new(1, 0)), Some(&Value::Text("Smith, J".into())));
        assert_eq!(doc.sheet_value(CellRef::new(1, 1)), Some(&Value::Number(3.0)));
        assert_eq!(doc.sheet_value(CellRef::new(1, 2)), Some(&Value::Text("said \"hi\"".into())));
        assert_eq!(doc.sheet_value(CellRef::new(2, 2)), Some(&Value::Empty));
        let d = doc.extensions.get::<Dialect>().unwrap();
        assert_eq!((d.delimiter, d.line_ending, d.encoding, d.trailing_newline), (',', LineEnding::CrLf, Encoding::Utf8, true));
    }

    #[test]
    fn keeps_what_isnt_a_plain_number() {
        let doc = round_trip(b"007,1.50,1e5,-0,inf,+3,3,-2.5,.5\n");
        let v = |c| doc.sheet_value(CellRef::new(0, c)).unwrap().clone();
        for c in 0..6 {
            assert!(matches!(v(c), Value::Text(_)), "{:?}", v(c));
        }
        assert_eq!(v(6), Value::Number(3.0));
        assert_eq!(v(7), Value::Number(-2.5));
        assert!(matches!(v(8), Value::Text(_)), ".5 writes back as 0.5");
    }

    #[test]
    fn dialects() {
        let doc = round_trip(b"a;b;c\n1;2;3\n");
        assert_eq!(doc.extensions.get::<Dialect>().unwrap().delimiter, ';');
        let doc = round_trip(b"a\tb, c\td\n1\t2\t3");
        assert_eq!(doc.extensions.get::<Dialect>().unwrap().delimiter, '\t');
        assert!(!doc.extensions.get::<Dialect>().unwrap().trailing_newline);
        let doc = round_trip(b"sep=;\r\na;b\r\n");
        assert!(doc.extensions.get::<Dialect>().unwrap().sep_line);
        assert_eq!(doc.sheet_value(CellRef::new(0, 1)), Some(&Value::Text("b".into())));
        round_trip(b"\"a\",\"b\"\n\"1\",\"x\"\n");
        round_trip(b"one\rtwo\r");
    }

    #[test]
    fn ragged_rows_blank_lines_and_line_breaks_in_fields() {
        let doc = round_trip(b"a,b,c\n\nd\n,,e\n\"two\nlines\",x\n");
        assert_eq!(doc.sheet_value(CellRef::new(4, 0)), Some(&Value::Text("two\nlines".into())));
        assert_eq!(doc.sheet_value(CellRef::new(3, 2)), Some(&Value::Text("e".into())));
        round_trip(b"a,b,\n");
    }

    #[test]
    fn line_endings_come_from_outside_quotes() {
        let doc = round_trip(b"\"a\r\nb\",c\nd,e\n");
        assert_eq!(doc.extensions.get::<Dialect>().unwrap().line_ending, LineEnding::Lf);
        let doc = round_trip(b"one,\"x\ny\"\rtwo\r");
        assert_eq!(doc.extensions.get::<Dialect>().unwrap().line_ending, LineEnding::Cr);
    }

    #[test]
    fn empty_rows_in_the_used_range_keep_their_commas() {
        let doc = round_trip(b"a,b,c\r\n,,\r\n1,2,3\r\n");
        let Body::Workbook { sheets } = &doc.body else { unreachable!() };
        assert_eq!(sheets[0].rows[1].cells.len(), 1, "the last field marks the width");
    }

    #[test]
    fn spaces_are_quoted_only_if_the_file_quoted_them() {
        round_trip(b"name, age\nBob, 3\n");
        round_trip(b"\" padded \",x\n");
    }

    #[test]
    fn encodings() {
        round_trip("\u{feff}café,1\r\n".as_bytes());
        let mut utf16 = vec![0xFF, 0xFE];
        utf16.extend("naïve\t2\r\n".encode_utf16().flat_map(u16::to_le_bytes));
        let doc = round_trip(&utf16);
        assert_eq!(doc.sheet_value(CellRef::new(0, 0)), Some(&Value::Text("naïve".into())));
        // "café €5" in Windows-1252.
        let doc = round_trip(b"caf\xe9,\x805\n");
        assert_eq!(doc.sheet_value(CellRef::new(0, 1)), Some(&Value::Text("€5".into())));
        assert_eq!(doc.extensions.get::<Dialect>().unwrap().encoding, Encoding::Windows1252);
    }

    #[test]
    fn new_workbooks_write_excel_style() {
        let mut doc = Document::new(Kind::Sheets);
        let Body::Workbook { sheets } = &mut doc.body else { unreachable!() };
        sheets[0].set(CellRef::new(0, 0), Value::Text("x, y".into()));
        sheets[0].set(CellRef::new(0, 2), Value::Bool(true));
        sheets[0].set(CellRef::new(1, 1), Value::Number(0.5));
        assert_eq!(write(&doc).unwrap(), b"\xEF\xBB\xBF\"x, y\",,TRUE\r\n,0.5\r\n");
    }

    #[test]
    fn empty_input() {
        let doc = read(b"", "Sheet1", false).unwrap();
        assert_eq!(write(&doc).unwrap(), b"");
    }
}
