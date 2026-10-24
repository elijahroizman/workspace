# Real document fidelity findings

Tested 2026-10-24 on bbb against application baseline `b088f996153b1a639dedcd9ca5119ee050e892e5`. No application code was changed. The corpus contains 102 files: 77 published documents/templates, 23 explicitly labeled regression fixtures, and 2 generated derivatives of a federal IRS form. Sources, hashes, and redistribution decisions are in [corpus/manifest.tsv](corpus/manifest.tsv).

Two S1 bugs are confirmed. An unchanged app save destroys cached spreadsheet results in a real government workbook and invalidates a real GPO PDF signature. The CLI does not reproduce the spreadsheet failure. Successful opening and ZIP feature counts alone miss both problems.

## Reproduction environment and evidence

Follow [corpus/README.md](corpus/README.md) to fetch and serve the test build on bbb. For any sample below, open `http://127.0.0.1:1443/?open=/dev-samples/<manifest-name>` in Chromium or WebKit. The report's bugs reproduce in both. The files named below are manifest entries unless a committed path is given.

To save through the actual app without edits, run this in the browser console after loading:

```js
const w = window.__workspace;
const state = w.useWorkspace.getState();
await state.save(state.activeId, { to: '/corpus-saved/SAMPLE.ext', quiet: true });
```

Substitute the original sample's extension. Capture the resulting download. `browser.mjs` performs that operation and stores it as `results/<browser>/<manifest-name>`. The CLI comparison is `crates/target/release/officec save INPUT OUTPUT`, followed by `officec diff INPUT OUTPUT`.

[corpus/evidence/2026-10-24.json](corpus/evidence/2026-10-24.json) contains the compact results, every changed/added/removed package part, feature inventories, cell-cache comparisons, signature checks, and reference reopen results. Full downloaded originals remain at `eli@bbb:~/stress-corpus-files/`; screenshots, saved files, all-page reference PDFs, and extracted text remain at `~/stress-corpus/tests/stress/corpus/results/`. Screenshots of documents with unverified redistribution rights are not committed.

## S1

### CORPUS-001: An unchanged app save overwrites 173,805 valid cached cell results with errors

Sample: `au-pbo-PBO---Build-your-own-budget---2026-27-Budget.xlsx`, 16 MB, 47 sheets. This is the Australian Parliamentary Budget Office's published economic model. Its source explicitly targets Excel. Unsupported calculations should not destroy the source's cached results during an unchanged save.

Repro:

1. Open the sample, wait for the workbook to finish loading, and save without editing using the app path above.
2. Run `python3 tests/stress/corpus/values.py`, or inspect original and saved `xl/worksheets/sheet5.xml`, cell `I38` on the `your changes` sheet.
3. The formula remains `INDEX('form controls'!H272:H276,'form controls'!$X$280)`. Its original cached value is `-29721.01943738828`. The app writes `t="e"` and `<v>#NAME?</v>`. `window.__sheets.doc.cell(4,37,8)` also exposes the wrong displayed value before saving.
4. Compare with `officec save`: the CLI leaves every source part unchanged.

Both browser saves change 379,560 raw cell values or types. Of those, 173,805 formerly non-error cells become errors: 121,895 `#NAME?`, 42,041 `#DIV/0!`, 7,004 `#VALUE!`, 2,400 `#REF!`, and 465 `#N/A`. Formula nodes themselves are unchanged. Thirty-one package parts change and `xl/calcChain.xml` disappears. The complete part list is in the evidence JSON. The workbook still opens in LibreOffice; it can recalculate differently itself, so its numerical output is not the oracle for this Excel-only model. Excel may recover caches by recalculating, but downstream readers receive the corrupted cached results.

Likely owner: `src/engine/sheets/engine.ts:SheetsEngine.open` calls `doc.setNow` unconditionally. `crates/office-sheets/src/view/mod.rs:SheetsView::set_now` recalculates the whole workbook. `crates/office-sheets/src/lib.rs:recalculate` replaces cached values with unsupported-function/dependency errors, and `SheetsView::save` persists them. The sample uses `_xlfn.ANCHORARRAY`, `_xlfn.XLOOKUP`, `_xlfn._xlws.SORT`, `OFFSET`, and `TREND`.

### CORPUS-002: Saving a signed government PDF unchanged invalidates its signature

Sample: `us-budget-2025-appendix.pdf`, 14.9 MB, 1,298 pages, signed by the Government Publishing Office.

Repro:

1. Run `pdfsig ~/stress-corpus-files/us-budget-2025-appendix.pdf`. It reports `Signature Validation: Signature is Valid.` The certificate is expired; that is separate from digest validity.
2. Open the sample in Writan and save unchanged.
3. Run `pdfsig` on the downloaded save. In both browsers it reports `Signature Validation: Digest Mismatch.` The original byte ranges remain in the signature dictionary but no longer cover the rewritten file correctly.

All pages, text, form inventory, and signature dictionary content survive; the cryptographic attestation does not. Both saves still render all 1,298 pages in Poppler. See `results/signatures.json` and the committed evidence. An unchanged save must preserve the signed bytes or explicitly handle the signature consequence.

Likely owner: `src/editors/pdf/PdfEditor.tsx:saveBytes` always serializes through the worker. `src/editors/pdf/engine/worker.ts:save` calls `engine.saveAsCopy(doc!)`, including when no document edit occurred.

## S2

### CORPUS-003: An unchanged DOCX save reverses checklist label and checkbox cells

Sample: `nz-template-rfp-government-model.docx`.

Repro:

1. Open the original in LibreOffice and inspect the initial checklist. Each row has its text cell followed by a content-control checkbox cell.
2. Save unchanged through Writan, or run `officec save` on the original.
3. Compare `word/document.xml`. In the first checklist, rows 1 through 7 change from direct children `[w:tc, w:sdt]` to `[w:sdt, w:tc]`. The text and checkbox remain in the same row but swap column order and inherit different grid positions.
4. Convert both documents to PDF with the same LibreOffice instance. The original renders as 22 pages; both app saves and the CLI save render as 32 pages. Inspect the narrow, displaced checklist content.

Only `word/document.xml` changes. No tag-count or feature-count loss flags this semantic corruption. Other NZ forms with content-control table cells show the same sibling-order rewrite.

Likely owner: `crates/office-core/src/formats/docx/read.rs:read_table` reads only direct `w:tc` children and leaves `w:sdt` cells in the row origin. `crates/office-core/src/formats/docx/write.rs:write_table` retains those raw children and appends the modeled cells with `tr.push(tc)`, losing their original relative order.

### CORPUS-004: A university thesis's table of contents is invisible

Sample: `ucsd-ThesisTemplate_Master_v2.3.docx`. The doctoral and joint doctoral variants also reproduce it.

Repro:

1. Open the sample and find the table-of-contents section by scrolling or using the engine display-list probe in `verify.mjs`.
2. Compare with the LibreOffice reference or the source `word/document.xml`.
3. A body-level `w:sdt/w:sdtContent` contains the TOC entries and page references. Writan draws none of that block. Entry text such as `THESIS APPROVAL PAGE` and the chapter-title rows is missing from the displayed TOC.

Saving preserves the raw content-control block. This is invisible content on open, not deletion on save. `lo-SdtContent.docx` is a supplemental fixture exposing another invisible structured-content case; it contains its text in a separate story, so do not treat its blank body as the sole evidence for the thesis bug.

Likely owner: `crates/office-core/src/formats/docx/read.rs:read_blocks` leaves block content controls as `Block::Raw`. `crates/office-engine/src/flow.rs:layout_block` maps every `Block::Raw` to `BlockBox::Empty`. Inline content controls have a text fallback in `office-word/src/view/resolve.rs:raw_show`; block controls do not.

### CORPUS-005: Footnote reference marks appear but their note bodies do not

Samples: `lo-footnote.docx` is the smallest reproducer. The published `au-budget-bp1_bs-4.docx` provides real budget text with footnotes.

Repro:

1. Open `lo-footnote.docx`. Writan displays `Foo` with superscript `1`.
2. Inspect the bottom of the sole page. The reference has a separator and note `bar`; Writan displays neither.
3. `verify.mjs` confirms the note body is absent from the engine's display list, not merely outside the viewport. Source and saved `word/footnotes.xml` remain present.

Likely owner: `crates/office-word/src/view/paginate.rs:paginate` places body, headers, and footers but does not allocate or paint note bodies. `crates/office-word/src/view/resolve.rs:raw_show` and the `RawShow::NoteRef` branch draw only the reference mark. The stories parser already reads the notes.

### CORPUS-006: PowerPoint charts render as empty placeholder rectangles

Sample: `lo-chart_pt_color_bg1.pptx`.

Repro:

1. Open the only slide.
2. Compare with `results/references/original/lo-chart_pt_color_bg1.pptx/page-1.png`. The reference contains a blue and gray doughnut chart.
3. Writan draws an empty dashed rectangle in the chart's position and no chart series. The package's chart and embedded data survive an unchanged save.

Likely owner: `crates/office-slides/src/view/draw.rs:Paint::raw` only tries a descendant `a:blip` fallback and otherwise paints a quiet placeholder. The chart part and embedded workbook are not rendered through that path.

### CORPUS-007: SmartArt disappears in Word and PowerPoint

Samples: `lo-smartart-accent-process.pptx` and `lo-smartart.docx`.

Repro:

1. Open the deck's only slide. The LibreOffice reference shows two blue card groups with text and an arrow. Writan shows an empty dashed placeholder.
2. Open the Word sample. Its reference shows SmartArt text and shapes, while Writan's document page is blank.
3. Compare the engine paint counts and original/saved diagram parts. The diagram XML survives saving; its text and shapes are absent from the display list.

Likely owner: PowerPoint uses `crates/office-slides/src/view/draw.rs:Paint::raw`, which does not follow diagram relationships to the cached DrawingML drawing. Word uses `crates/office-word/src/view/resolve.rs:raw_show`, which hides unsupported drawing markup. These are related fidelity gaps with separate rendering paths.

### CORPUS-008: Office Math equations render as a blank page

Sample: `lo-math-accents.docx`.

Repro:

1. Open the sample. Writan draws no equation text or shapes.
2. Inspect `m:oMath` in `word/document.xml`; it contains the accented mathematical expressions.
3. Render with LibreOffice Writer plus the LibreOffice Math package installed. The reference shows the expressions. Omitting the Math package also makes the reference blank, so use the documented user-space setup before comparing.

The equation markup survives an unchanged save. Both browser display lists omit it.

Likely owner: `crates/office-word/src/view/resolve.rs:raw_show` has no Office Math fallback. Unsupported raw math is hidden instead of converted to a mathematical display list.

### CORPUS-009: Hidden and veryHidden sheets are exposed and selected on open

Samples: `pa-budgetprep-issue-form.xlsx` and the PBO workbook from CORPUS-001.

Repro:

1. Open the PA form. It opens on an empty `_com.sap.ip.bi.xl.hiddensheet` sheet.
2. Inspect `xl/workbook.xml`. That sheet is `state="veryHidden"`; the saved view specifies `activeTab="1"`, the visible `TICKET` form. The ordinary hidden `data` sheet is also listed in Writan.
3. Open the PBO sample. It likewise opens on the veryHidden `Front end >>` separator and lists internal calculation sheets.

This hides the intended form on first open and exposes sheets the document's producer deliberately concealed. The source hidden flags survive saving; the UI ignores them.

Likely owner: `crates/office-sheets/src/view/mod.rs:SheetsView::from_document` initializes `SheetSel::default()` instead of respecting the visible active sheet. `src/editors/xlsx/SheetEditor.tsx:Book` renders `engine.sheets.map(...)` without filtering hidden sheets.

### CORPUS-010: Conditional formatting colors are absent

Sample: `lo-conditional_fmt_checkpriority.xlsx`.

Repro:

1. Open Sheet1 and inspect `A1` containing `ABC` and `A3` containing `BAC`.
2. The source rules and LibreOffice reference give `A1` a green fill and `A3` a red fill. Writan shows both with no fill.
3. Inspect `window.__sheets.doc.cell(0,0,0)` and `.cell(0,2,0)`. Neither exposes the rule's resolved fill.

The conditional-formatting XML and differential styles survive unchanged. This is a rendering gap, already listed as unsupported in the internals documentation.

Likely owner: `crates/office-sheets/src/view/mod.rs:SheetsView::paint` and its style resolution use the base cell format without evaluating worksheet conditional-formatting rules.

### CORPUS-011: Right-to-left Word tables display their columns in the wrong order

Sample: `lo-table-rtl.docx`.

Repro:

1. Open the sample and inspect its 2-by-2 table.
2. Writan shows row one as `A1 | B1` and row two as `A2 | B2`.
3. The source marks the table `w:bidiVisual`; the reference correctly displays `B1 | A1` and `B2 | A2`.

The source markup survives saving. This is a column-order error rather than a font fallback problem.

Likely owner: `crates/office-core/src/formats/docx/read.rs:read_table` does not put `w:bidiVisual` in the modeled table look. `crates/office-engine/src/flow.rs:table` lays out cells left to right.

### CORPUS-012: CJK list-number formats become decimal numbers

Samples: `lo-cjklist30.docx` and `lo-cjklist31.docx`.

Repro:

1. Open either file and inspect the list markers.
2. The first uses `ideographTraditional`; its first markers should be `甲`, `乙`, `丙`. The second uses `ideographZodiac`; it begins `子`, `丑`, `寅` in the reference.
3. Writan renders `1.`, `2.`, `3.` instead. The document text is present, so a text-only content check misses this substitution.

Likely owner: `crates/office-word/src/numbering.rs:format_number` falls back to `n.to_string()` for these formats.

## S3

### CORPUS-013: Unchanged PowerPoint saves drop unknown table-column metadata

Samples: `nasa-SEWP_Provider_Training_Slides_05_12_25.pptx` and `nasa-SEWP_CH_Training_Presentation_05_12_25.pptx`.

Repro:

1. Run `officec save` or save unchanged through either browser.
2. Diff `ppt/slides/slide3.xml` in the Provider deck. Its two `a:gridCol/a:extLst/a:ext/a16:colId` elements disappear.
3. In the CH deck the same loss occurs in slides 5, 11, 21, and 30, removing 11 column IDs in total.

No visible damage was established, so this is S3. It violates the documented preservation of unknown XML and is distinct from missing chart/SmartArt rendering. All original table text remains.

Likely owner: `crates/office-core/src/formats/pptx/read.rs:read_table` keeps column widths but strips the original grid. `crates/office-core/src/formats/pptx/write.rs:write_table` constructs fresh `a:gridCol` elements and drops their extension children.

## Pass rates and limits

Opening and saving a file successfully does not establish fidelity. These are separate measures, with identical browser outcomes:

| Format | Files | Chromium open/save | WebKit open/save | CLI unchanged parts or CSV bytes | App unchanged parts or CSV bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| DOCX | 50 | 50/50 | 50/50 | 17/50 | 17/50 |
| PPTX | 9 | 9/9 | 9/9 | 6/9 | 6/9 |
| XLSX | 19 | 19/19 | 19/19 | 19/19 | 18/19 |
| CSV | 3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PDF | 21 | 21/21 | 21/21 | Not supported by officec | See PDF checks below |

All 204 browser runs completed without console errors or page errors. All 81 CLI round trips succeeded. Empty ZIP directory entries do not count as removed document parts. The DOCX differences include cell sibling-order changes and stripped formatting from runs split around page breaks; not every changed part proves a visible defect. The evidence lists each exact part and tag delta.

Every original and saved file was reopened through LibreOffice export or Poppler for PDF inputs. All produced a reference PDF/render. Text/page-box/annotation/form/encryption checks pass for the 20 PDF inputs the Python library could fully inspect, while the independent signature check detects CORPUS-002. The remaining PDF.js sample opens and renders but contains an encrypted embedded attachment that pypdf cannot extract; attachment preservation for that sample is unverified. The generated scanned W-9 and password-protected W-9 retain their checked content and encryption state.

Chromium median open/probe/save-readiness times were about 0.4 to 0.8 seconds for the smaller formats. The PBO workbook took 13.2 seconds in Chromium and 13.4 seconds in WebKit. These timings include one readiness serialization and are not a native-app startup benchmark. Chromium JavaScript heap snapshots are recorded; WebKit's comparable metric is unavailable. Peak process and total WASM memory were not measured.

Visual checks include initial screenshots for every file, 619 Word pages across all 50 DOCX files scrolled for text collection, first/middle/last Word-page screenshots, all-page LibreOffice reference PDFs, and focused engine display-list checks in both browsers for the representative bugs. There is no defensible whole-corpus visual pass percentage: every slide and worksheet was not manually reviewed. LibreOffice pagination differs from Word, so isolated page-count differences were not filed as bugs. CORPUS-003 compares original and saved files in the same reference engine and has an independent XML-order defect.

Coverage gaps remain for authentic Google Docs/Sheets/Slides and Apple iWork exports, Microsoft Create downloads, and embedded-font decks. Some script-specific coverage uses labeled regression files or PDFs rather than a published Office document. No crash on open was found in this corpus. No app code, release metadata, or versions were changed, and nothing was pushed.
