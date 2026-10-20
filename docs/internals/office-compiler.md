# The office compiler

Status: work in progress. Only the shared core exists so far; the Word, PowerPoint and Excel layers are planned but not started.

Today each Office format has its own JavaScript engine: docx-editor for Word, pptx-react-viewer and ooxml-ui for PowerPoint, and nothing for Excel. Each one parses the file its own way, keeps its own model of text and colors, and saves by patching the original zip. The office compiler replaces the parsing and saving under all of them with one Rust library that reads and writes Word (.docx), PowerPoint (.pptx), Excel (.xlsx) and CSV.

It works like a compiler: a **front end** for each format reads the file into one shared **model**, **passes** work on the model, and a **back end** writes it out again, in the same format or another one.

```
 .docx ─┐                                         ┌─ .docx
 .pptx ─┤  front ends   ┌──────────────┐  back    ├─ .pptx
 .xlsx ─┼─────────────▶ │ shared model │ ───────▶ ├─ .xlsx
 .csv  ─┘               └──────┬───────┘  ends    └─ .csv
                               │
                  layers: Word, PowerPoint, Excel
                  (passes over the model + their own parts)
```

## Goals

1. **One model for what the formats share.** A bold red run of Calibri is the same thing in a Word paragraph, a slide's text box and a spreadsheet's rich-text cell. A table is a table in Word and PowerPoint. A sheet is a sheet in Excel and CSV. Themes, colors, pictures, hyperlinks and document properties are shared too.
2. **Lossless round trips.** Opening and saving a file must not drop what the compiler doesn't understand. Untouched parts of the package are copied byte for byte; inside parts it rewrites, anything it doesn't model is kept as raw XML in its original place.
3. **Format-only features live in layers.** Word's styles, numbering, sections, comments and tracked changes; PowerPoint's masters, layouts, notes, transitions and animations; Excel's formulas, number formats, merged-cell rules and conditional formatting. Each layer is its own crate on top of the core, and the core never depends on a layer.
4. **No file system, no platform code.** The core takes bytes and returns bytes, so the same code runs in the Tauri app and, compiled to WebAssembly, in the browser version used for development.
5. **Cross-format conversion falls out.** Because every format meets in one model, a Word table can become a CSV, a CSV can become a workbook, and a sheet can become a table on a slide.

Not goals for the core: rendering, layout (line breaking, pagination), formula evaluation, or any UI. Those sit above it.

## What the current engines taught us

We read how the engines we ship handle these formats, and kept the ideas, not the code:

- **docx-editor** keeps a document model separate from its editing view and saves by updating the original package, which is why Word files survive a save. The compiler keeps the same split, and goes further by keeping unknown XML in place inside rewritten parts.
- **pptx-react-viewer** turns each slide into a flat list of typed elements (text, shape, picture, table, group) with a position and size. The shared model's `Frame` is that idea, and Word's floating pictures and Excel's drawings use it too.
- Both engines resolve theme colors and fonts on their own, slightly differently. The compiler does it once, in `drawing::theme` and `drawing::color`.
- Both treat the zip, `[Content_Types].xml` and relationships as plumbing they each rewrite. The compiler has one OPC package layer for all three formats.

## Crates

```
crates/
  Cargo.toml             workspace (separate from src-tauri, which keeps its own lock file and target/)
  office-core/           the shared compiler (this PR)
  office-word/           Word-only layer (planned)
  office-slides/         PowerPoint-only layer (planned)
  office-sheets/         Excel-only layer (planned)
```

`src-tauri` will depend on `office-core` and the layers by path once the editors start using them. Nothing in the app uses the compiler yet.

## The core, module by module

| Module | What it does |
| --- | --- |
| `xml` | A small XML tree that keeps everything: element and attribute order, namespace declarations, comments, processing instructions, whitespace. Parsed with quick-xml, written back exactly. Namespace-aware lookups (`child(ns::W, "p")`). |
| `opc` | The Open Packaging Conventions package every Office file is: the zip, `[Content_Types].xml`, relationships (`_rels/*.rels`), part names and how relationship targets resolve, and the core and app properties (title, author, dates). Parts that are never touched are written back as the bytes they were read as. |
| `units` | EMUs, twips, points, half-points and percentages, with lossless conversions. Each format measures in its own unit; the model uses EMUs for lengths and hundredths of a point for font sizes. |
| `drawing` | DrawingML, the part of OOXML the three formats share: themes (color and font schemes), colors with their transforms (`lumMod`, `tint`, `shade`, `alpha`…) resolved to RGB, 2D transforms (offset, size, rotation, flip), and picture references. |
| `model` | The shared model: `Document`, rich text (`Paragraph`, `Run`, `RunProps`, `ParaProps`), `Table`, `Sheet` and `Cell`, `Frame` for positioned objects, `Slide`, media and hyperlinks. Every container has a `Raw` variant holding XML it doesn't model. |
| `formats` | A front end and back end per format: `docx`, `pptx`, `xlsx`, `csv`. Each reads what the shared model covers and keeps the rest raw. |
| `layer` | The contract layers implement: hooks that run after reading and before writing, and a typed slot on `Document` for a layer's own data. |
| `convert` | Shared passes between model shapes: table ↔ sheet, any document to plain text, and changing a document's kind. |

### The model

```rust
pub struct Document {
    pub kind: Kind,                 // Word, Slides, Sheets or Csv
    pub properties: Properties,     // title, author, created, modified…
    pub theme: Option<Theme>,
    pub media: Media,               // pictures and other binary parts, by id
    pub body: Body,
    pub package: Option<Package>,   // the source package, for lossless writes
    pub layers: LayerData,          // each layer's own typed data
}

pub enum Body {
    Flow(Vec<Block>),               // Word: paragraphs and tables, top to bottom
    Slides { size: Size, slides: Vec<Slide> },
    Workbook(Vec<Sheet>),           // Excel, and CSV as a one-sheet workbook
}
```

Text is the same everywhere: a `Block` is a `Paragraph`, a `Table` or `Raw`; a paragraph holds `Inline`s (runs of text, tabs, breaks, pictures, hyperlinks, or `Raw`). Run formatting covers what all three formats can say directly: font, size, bold, italic, underline, strike, color, highlight, superscript and subscript, caps. A slide is a list of `Frame`s. A frame is a shape with an optional text body, a picture, a table, a group of frames, or `Raw`. A sheet is sparse: cells keyed by row and column, each with a value (number, text, rich text, boolean, error) and, kept as-is for the Excel layer, its formula and style index.

What the model doesn't cover stays raw rather than being dropped: a paragraph's unknown properties, an unknown run child, a slide object it can't read. Property containers (`w:rPr`, `a:rPr`, `w:pPr`…) keep unknown children too, and the writer puts them back in schema order.

### Lossless writing

A document opened from a file keeps its `Package`. Saving it in the same format:

1. Copies every part the compiler didn't read, and every part it read but the model didn't change, byte for byte.
2. Regenerates only the parts whose model changed, putting raw XML back where it came from.
3. Keeps content types and relationships in step with added and removed parts (a new picture gets a media part, a content type and a relationship).

Saving a document that was made from scratch, or converted from another format, writes a fresh minimal package that Office, LibreOffice and the current editors open.

### Layers

A layer is a crate that implements `office_core::Layer`:

```rust
pub trait Layer {
    fn name(&self) -> &'static str;
    fn kinds(&self) -> &[Kind];                                   // which documents it applies to
    fn after_read(&self, doc: &mut Document) -> Result<()>;       // parse its parts, resolve inheritance
    fn before_write(&self, doc: &mut Document) -> Result<()>;     // write its data back into parts/raw XML
}
```

A layer reads the parts it owns from `doc.package` and keeps its typed data in `doc.layers`. It can also turn the core's `Raw` nodes into its own typed data and back again. Planned layers:

- **Word** (`office-word`): styles and their inheritance (resolving `pStyle`/`rStyle` into effective formatting), numbering and lists, sections and page setup, headers and footers, footnotes, comments, tracked changes, fields, bookmarks, floating-drawing anchors.
- **PowerPoint** (`office-slides`): slide masters and layouts, placeholder inheritance, speaker notes, transitions, animations, hidden slides, comments.
- **Excel** (`office-sheets`): the style sheet (fonts, fills, borders, number formats), dates, formulas (parsing; evaluation later), defined names, merged cells, column widths and row heights, conditional formatting, data validation, charts.

## Milestones

1. **Plan and crate skeleton.** This document, `crates/` workspace, `office-core` with its module layout.
2. **XML.** Lossless tree, parser, writer, namespace helpers.
3. **Packages.** OPC read and write, content types, relationships, document properties.
4. **Units and DrawingML.** Unit conversions, themes, colors and transforms.
5. **The shared model, and CSV.** Model types, the layer contract, CSV in and out (delimiter and encoding detection).
6. **Word, PowerPoint and Excel front ends.** Reading each format's shared subset into the model.
7. **Back ends.** Writing each format, lossless for untouched content, and fresh packages for new or converted documents.
8. **Conversion and a command line.** Shared passes (table ↔ sheet, plain text) and `officec`, a small tool to inspect a file's model as JSON and convert between formats.

After this PR: the three layers, then WebAssembly bindings and moving the editors onto the compiler one at a time, Excel first since it has no engine today.

## Testing

`cd crates && cargo test`. Tests build their sample files in code or with the round trip itself, so nothing binary is checked in. Round-trip tests check that reading and writing an unchanged document gives back identical parts, and that edited documents still open: when `soffice` (LibreOffice) is on the PATH, the ignored tests convert the compiler's output to PDF to prove it opens (`cargo test -- --ignored`).
