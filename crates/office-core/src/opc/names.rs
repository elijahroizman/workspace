//! Part names and relationship targets.
//!
//! Part names are kept the way zip entries name them: no leading slash, `word/document.xml`.
//! Relationship targets are relative to the folder of the part that owns the relationship
//! (`media/image1.png` from `word/document.xml`), or absolute from the package root
//! (`/xl/workbook.xml`), and may be percent-encoded.

/// The part a relationship target points at, from the part that owns the relationship
/// (`""` for the package's own relationships).
pub fn resolve(source: &str, target: &str) -> String {
    // The fragment and query go first: an encoded `%23` is part of the name.
    let target = percent_encode(target.split(['#', '?']).next().unwrap_or(""));
    let mut segments: Vec<&str> =
        if target.starts_with('/') { Vec::new() } else { folder(source).split('/').filter(|s| !s.is_empty()).collect() };
    for seg in target.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            s => segments.push(s),
        }
    }
    segments.join("/")
}

/// The target to write in `source`'s relationships so it points at `part`.
pub fn relative(source: &str, part: &str) -> String {
    let from: Vec<&str> = folder(source).split('/').filter(|s| !s.is_empty()).collect();
    let to: Vec<&str> = part.split('/').collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    // Keep the last segment (the file) out of the shared prefix.
    let common = common.min(to.len() - 1);
    let mut out: Vec<&str> = std::iter::repeat_n("..", from.len() - common).collect();
    out.extend(&to[common..]);
    percent_encode(&out.join("/"))
}

/// The folder a part is in, `word` for `word/document.xml`.
pub fn folder(part: &str) -> &str {
    part.rsplit_once('/').map(|(f, _)| f).unwrap_or("")
}

/// The relationships part for `part`: `word/_rels/document.xml.rels`, or `_rels/.rels` for the
/// package (`""`).
pub fn rels_part(part: &str) -> String {
    match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None => format!("_rels/{part}.rels"),
    }
}

/// The lowercase extension, `png` for `word/media/image1.PNG`.
pub fn extension(part: &str) -> String {
    let file = part.rsplit('/').next().unwrap_or(part);
    file.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut bytes = s.bytes().peekable();
    while let Some(b) = bytes.next() {
        match b {
            b'%' if bytes.clone().take(2).count() == 2 && bytes.clone().take(2).all(|b| b.is_ascii_hexdigit()) => {
                out.push('%');
                out.push(bytes.next().unwrap().to_ascii_uppercase() as char);
                out.push(bytes.next().unwrap().to_ascii_uppercase() as char);
            }
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~'
            | b'/'
            | b'!'
            | b'$'
            | b'&'
            | b'\''
            | b'('
            | b')'
            | b'*'
            | b'+'
            | b','
            | b';'
            | b'='
            | b':'
            | b'@' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_targets() {
        assert_eq!(resolve("", "word/document.xml"), "word/document.xml");
        assert_eq!(resolve("", "/xl/workbook.xml"), "xl/workbook.xml");
        assert_eq!(resolve("word/document.xml", "media/image1.png"), "word/media/image1.png");
        assert_eq!(resolve("ppt/slides/slide1.xml", "../slideLayouts/slideLayout2.xml"), "ppt/slideLayouts/slideLayout2.xml");
        assert_eq!(resolve("xl/workbook.xml", "worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
        assert_eq!(resolve("word/document.xml", "media/my%20picture.png"), "word/media/my%20picture.png");
        assert_eq!(resolve("word/document.xml", "./a/../b.xml"), "word/b.xml");
    }

    #[test]
    fn relative_targets() {
        assert_eq!(relative("", "word/document.xml"), "word/document.xml");
        assert_eq!(relative("word/document.xml", "word/media/image1.png"), "media/image1.png");
        assert_eq!(relative("ppt/slides/slide1.xml", "ppt/media/image1.png"), "../media/image1.png");
        assert_eq!(relative("ppt/slides/slide1.xml", "ppt/slides/slide2.xml"), "slide2.xml");
        assert_eq!(relative("word/document.xml", "word/media/a b.png"), "media/a%20b.png");
        for (src, part) in [
            ("ppt/slides/slide1.xml", "ppt/media/x.png"),
            ("", "docProps/core.xml"),
            ("a/b/c.xml", "d/e.xml"),
            ("word/document.xml", "word/media/a%23b%3F.png"),
        ] {
            assert_eq!(resolve(src, &relative(src, part)), part);
        }
    }

    #[test]
    fn rels_parts() {
        assert_eq!(rels_part(""), "_rels/.rels");
        assert_eq!(rels_part("word/document.xml"), "word/_rels/document.xml.rels");
        assert_eq!(extension("word/media/image1.PNG"), "png");
        assert_eq!(extension("README"), "");
    }
}
