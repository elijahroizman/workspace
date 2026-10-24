# Real document fidelity stress corpus

This corpus tests published documents through the production browser build and through `officec`. Run all builds, browsers, and analysis on bbb. The local checkout is for scripts, the report, and small permitted samples only.

The fixed inputs are in `manifest.tsv`. Each row records a filename, source URL, SHA-256, redistribution note, category, and byte count. `published` means an actual public document or template. `regression` means a supplemental LibreOffice or PDF.js fixture. `derivative` means an IRS form rasterized or password protected by our script. Do not describe regression fixtures as real-world publications.

The report is [../BUGS-corpus.md](../BUGS-corpus.md). The committed `evidence/2026-10-24.json` records browser outcomes, changed package parts, feature inventories, formula-cache changes, and reference reopen results. Full screenshots, saved files, extracted text, and raw logs remain on bbb under `~/stress-corpus/tests/stress/corpus/results/`. Raw downloads remain in `~/stress-corpus-files/`. The preview uses port 1443 to avoid the other agents' servers.

## Reproduce on bbb

From this worktree on the local machine:

```sh
rsync -az --exclude=node_modules --exclude=target --exclude=.git --exclude=dist ./ eli@bbb:stress-corpus/
ssh eli@bbb
export PATH=$HOME/.local/node24/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
cd ~/stress-corpus
```

Stop the previous preview on port 1443 before running the complete runner. To add LibreOffice on Ubuntu 26.04 without installing system packages:

```sh
python3 tests/stress/corpus/install-lo.py
export LD_LIBRARY_PATH=$HOME/stress-corpus-lo/root/usr/lib/libreoffice/program:$HOME/stress-corpus-lo/root/usr/lib/x86_64-linux-gnu
export SOFFICE=$HOME/stress-corpus-lo/root/usr/lib/libreoffice/program/soffice
"$SOFFICE" --headless --version
```

The helper downloads Ubuntu packages with `apt-get download`, extracts them under the home directory, relocates paths, and copies the configuration normally created by Debian's postinst. It never runs package scripts or writes system directories. Other Linux versions should supply a working `SOFFICE` executable. Poppler's `pdfinfo`, `pdftotext`, and `pdftoppm` are also required. LibreOffice Math is required for equation references. Missing filters can make LibreOffice say `source file could not be loaded`; that is a reference setup failure, not a Writan failure.

Run the checks:

```sh
bash tests/stress/corpus/run.sh
python3 tests/stress/corpus/summarize.py
```

`fetch.sh [destination]` retrieves the exact manifest inputs and rejects hash mismatches. Mutable government URLs and GitHub `master` URLs may change. Do not update hashes just to make a failing download pass. `collect.py` is the exploratory source discovery script, not the reproducibility command. Rerunning it replaces the manifest and requires a separate review. The generated IRS derivatives are checked in; `derive-pdfs.py` documents how they were made. The test password is `corpus`.

## Focused checks against an existing test preview

```sh
CORPUS_FILTER='^au-pbo-' CORPUS_APPEND=1 node tests/stress/corpus/browser.mjs
python3 tests/stress/corpus/structure.py --app-only
python3 tests/stress/corpus/values.py
CORPUS_FILTER='footnote|smartart|cjklist|table-rtl' node tests/stress/corpus/audit-pages.mjs
node tests/stress/corpus/verify.mjs
python3 tests/stress/corpus/signatures.py
python3 tests/stress/corpus/reference.py --filter 'footnote|smartart|cjklist|table-rtl'
uv run --with pypdf --with fonttools tests/stress/corpus/pdf-audit.py
```

`CORPUS_BROWSER=chromium` or `webkit` restricts a browser run. `CORPUS_URL` changes the preview address and `CORPUS_RESULTS` changes browser output. Keep the other analysis scripts on their default results directory. `audit-pages.mjs` normally replaces its output; use a separate `CORPUS_RESULTS` directory for focused runs that must preserve a previous audit.

The browser runner opens `?open=/dev-samples/<name>`, waits for an editor and a successful `getBytes()`, then calls `window.__workspace.useWorkspace.getState().save(...)` and captures the actual browser download. DOCX therefore includes the app's comment writer and spreadsheet saving includes the app's initial `setNow` recalculation. CLI round trips alone do not cover those paths.

Each browser run captures console errors, page errors, open time, engine phase timings where exposed, DOM counts, a viewport screenshot, and saved bytes. Chromium exposes a JavaScript heap snapshot with precise memory enabled. WebKit does not expose a comparable heap API, so its heap value is null. These are snapshots, not peak process or total WASM memory. The readiness probe serializes once before the measured open completes, so timings include that probe.

`audit-pages.mjs` scrolls every Word page before collecting text and screenshots of the first, middle, and last page. This avoids mistaking unpainted virtual pages for missing content. Viewport screenshots of decks and sheets cover their initial view; they are not an exhaustive audit of every slide and cell. Reference PDFs include all pages/slides and workbook print ranges. LibreOffice recalculates formulas on opening and is not ground truth for Excel-only workbooks. Its page counts alone are not proof of a bug.

`structure.py` lists every changed, removed, and added ZIP member and before/after feature counts. Empty ZIP directory entries are distinguished from document parts when summarizing lossless saves. Counts do not prove semantic preservation: the RFP cell-order bug preserves all tag counts. `values.py` compares cell values/types and formula nodes to detect the PBO cache overwrite. `pdf-audit.py` compares page text, boxes, annotations, field values, encryption, attachments, outlines, and tagged-structure presence. It rounds PDF coordinates to 0.001 point to ignore PDFium's float serialization.

## Redistribution

Only small generated IRS derivatives are committed as binary documents. Their source is the public-domain federal text of [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf). Government seals and agency marks do not imply endorsement. The other raw inputs and screenshots stay on bbb because their individual redistribution rights were not established. The manifest preserves their public URLs and hashes.

Coverage includes public government forms and procurement templates, university theses and a Japanese resume, real NASA decks, Australian and US budgets, a 1,298-page PDF, Arabic/Hebrew/Chinese/Japanese/Korean PDF text, CJK numbering and RTL Word fixtures, equations, SmartArt, charts, conditional formatting, validation, defined names, and generated scanned/password PDF variants. This run does not establish coverage of Microsoft Create downloads, authentic Google Docs/Sheets/Slides exports, Apple iWork exports, or embedded-font decks. Those remain gaps, not passing tests.
