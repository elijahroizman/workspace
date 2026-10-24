# Core stress results, 2026-10-24

Work continues on recovered branch `t3/stress-test-office-core`, based on `b088f99`, with recovered fixes `420bdbe` through `ade662c`. This pass adds the unchanged-workbook cache fix, finishes the pending formula-tree fix, and bounds the demonstrated XML allocations and nesting. All compilation, test execution, fixture generation, and document processing ran over SSH on `eli@bbb` in `~/writan-stress-codex`. No local test/build workload ran. No parent-checkout source, `src-tauri/src/files.rs`, native plugin code, UI code, release metadata, or version was changed.

## Verified findings, highest impact first

### CORE-001, S1, fixed: opening and saving an unchanged workbook destroys formula caches

This is CORPUS-001. The real file is `~/stress-corpus-files/au-pbo-PBO---Build-your-own-budget---2026-27-Budget.xlsx` on bbb. The earlier corpus pass verified that app clock initialization replaced 173,805 valid cached results with errors on an unchanged save. `SheetsEngine.open()` calls `SheetsDoc.setNow()`, which called `SheetsView::set_now()` and recalculated the entire workbook, including unsupported Excel functions and their dependents.

`set_now()` now sets the clock for later edits without changing imported results or marking the workbook dirty. The regression checks an unsupported `_xlfn.ANCHORARRAY` formula, a dependent formula, a cached `NOW()`, identical saved part bytes, and correct `NOW()` evaluation for a newly typed formula. The small repro is `samples/S1-unchanged-formula-caches.xlsx`.

Run from the remote checkout after building the harness:

```sh
tests/stress/harness/target/release/save-app \
  ~/stress-corpus-files/au-pbo-PBO---Build-your-own-budget---2026-27-Budget.xlsx \
  results/pbo-saved.xlsx
```

The fresh native view round trip, including `set_now(46000.5)`, preserved all 376 non-directory ZIP entries byte for byte, including `xl/calcChain.xml`. There were no added entries. It completed in 3.73 seconds with 1,603,060 KiB maximum resident memory. This verifies native view behavior used by the WASM wrapper. This pass did not rerun the PBO browser suite.

Limitation: edits still trigger full recalculation. Unsupported formulas and their dependents can therefore still replace useful cached results after an edit, including formatting operations that use the shared edit path. This fix guarantees cache preservation during clock initialization and an unchanged save; it does not implement Excel's full evaluator or a dependency-aware recalculation policy. Imported volatile formulas retain their cached result until an edit recalculates them.

### CORE-002, S1, fixed: long flat formulas overflow the stack during recalculation

The pending change stored parsed expressions in `Rc<Expr>` rather than cloning the complete expression tree when evaluating a cell. The parser and evaluator already handled long flat operator chains iteratively, but the derived tree clone still recursed once per term. The original hostile log recorded stack-overflow aborts for a 200,000-term sum, a 50,000-term power chain, and a 50,000-term concatenation.

```sh
tests/stress/harness/target/release/drive --edit --stack 1024 \
  tests/stress/samples/S1-long-formula-stack-overflow.xlsx
```

The new unit regression recalculates 100,000-term addition, power, and concatenation formulas on a 1 MiB stack and asserts their results. All three original hostile formula files also completed open/paint/save/edit/undo/save on that stack. `Rc` removes the recursive clone; the existing iterative expression destructor still handles cleanup. This does not make arbitrary use of the public derived `Expr::clone` safe for unbounded trees outside the recalculation path.

### CORE-003, S1, fixed: deeply nested slide groups overflow recursive XML cloning

`~/stress-corpus/hostile/deep-groups-500.pptx` previously aborted on a 1 MiB native thread stack. A GDB run independently reproduced a SIGSEGV in recursive `Element::clone`/`Node::clone`. The XML parser accepted nesting up to 1,024 elements even though subsequent model operations recurse.

```sh
tests/stress/harness/target/release/drive --edit --stack 1024 \
  tests/stress/samples/S1-deep-groups-stack-overflow.pptx
```

XML nesting now stops at 256 elements, including self-closing leaves. The 500-group sample returns `elements nested more than 256 deep` before modeling. The original 200-group sample still opens, paints, saves, edits, undoes, and saves. A regression parses, clones, traverses, serializes, reparses, and drops the deepest accepted simple tree on a 1 MiB stack. Files exceeding this depth are refused, even if another application accepts them.

### CORE-004, S1, fixed for demonstrated inputs: individual XML parts exhaust memory before parsing

The package's 4 GiB decompressed-size allowance permitted one XML part to require multiple gigabytes of source copies and model/tree allocations. The earlier hostile run aborted for a 3 GiB Word styles part and a 1 GiB slide; a 600 MiB worksheet used about 4.1 GiB resident memory.

Read access for XML now checks a 128 MiB per-part limit before inflation. It covers content types, parsed XML, shared parsed XML, streaming worksheets, and shared strings. It does not lower the existing allowance for raw media or inflate untouched parts during ZIP passthrough.

```sh
tests/stress/harness/target/release/drive --edit --stack 1024 \
  ~/stress-corpus/hostile/bomb-3gb-styles.docx \
  ~/stress-corpus/hostile/bomb-1gb-slide.pptx \
  ~/stress-corpus/hostile/bomb-600mb-sheet.xlsx \
  ~/stress-corpus/hostile/bomb-200mb-text.docx
```

All four now return `too large to open (over 128 MB decompressed)` without an abort. The regression patches ZIP size declarations and checks the content-types, byte-source, parsed, and cached-parse entry points without allocating the declared size. The PBO workbook's largest part is 32,247,213 bytes and remains accepted.

Residual risk: multiple parts below 128 MiB can still exhaust the aggregate WASM/model heap. The package total remains 4 GiB, binary/media loading retains its existing limits, shared-string cell copies can consume up to their separate budget, and model/history copies add memory. No aggregate low-memory guarantee or claim that all ZIP bombs are safe is established. Legitimate XML parts larger than 128 MiB are now refused.

### Recovered fixes independently rechecked

- `2ddbd4e`: wrong-kind Office views return an error instead of constructing an incompatible model; the row numbered 2,147,483,648 no longer allocates a huge grid.
- `ce476ff`: the shared-string amplification sample returns the cell-text-budget error rather than exhausting memory. This test still reaches roughly 1 GiB resident memory before refusal.
- `91a8636`: the encrypted OOXML fixture returns the specific unsupported-password explanation.
- `9bcdd0a`: the backslash-named package opens and survives the view edit/undo/save path.
- `cee6b87`: the escaped sheet-name sample saves successfully.
- `ade662c`: the Word tracked table-grid change survives the view round trip; the existing unit regression covers PowerPoint column-extension preservation as well.

These fixes are retained on the branch. The native file handling, save-conflict UI, macOS quit handling, CSP, and TeX changes belong to the parent/UI passes and were not tested here.

## Exact runs and resources

Remote Rust sources were touched before the final builds. `build-harness-final.log` explicitly records recompilation of office-core, office-engine, office-word, office-slides, office-sheets, and the harness. The final workspace test build also recompiles office-wasm. Any subsequent browser pass must force the engine with `node scripts/engine.mjs --force`; this report does not claim fresh browser testing.

Commands, with `PATH="$HOME/.local/node24/bin:$HOME/.cargo/bin:$PATH"`:

```sh
find crates tests/stress/harness -name '*.rs' -exec touch {} +
CARGO_BUILD_JOBS=2 nice -n 10 cargo build --release \
  --manifest-path tests/stress/harness/Cargo.toml
CARGO_BUILD_JOBS=2 nice -n 10 cargo test --workspace --all-features --release \
  --manifest-path crates/Cargo.toml -- --test-threads=1
JOBS=2 tests/stress/run-drive.sh results/hostile-files.txt \
  results/hostile-all-final.log --edit --stack 1024
```

- Final workspace test result: 371 passed, zero failed, eight ignored, including two passing doctests. The release build took 3 minutes 16 seconds and emitted no warnings. `OFFICE_SAMPLES` was unset, so tests that require that environment variable add no external-corpus coverage. The ignored tests include the million-cell benchmark and external application/reference checks; they were not run by this pass.
- Ten committed repro fixtures: six successful view runs and four explanatory refusals, zero panic/abort/timeout. Total 0.62 seconds, peak child resident memory 1,069,100 KiB.
- Full generated hostile set: 281 files, 239 successful view runs and 42 explanatory refusals, zero panic/abort/timeout. Two processes at a time, each with an 8,000,000 KiB address-space limit and 120-second timeout; each view runs on a 1 MiB thread stack. Total 8.40 seconds, peak child resident memory 1,446,592 KiB. This is the largest individual child, not combined machine memory.
- The nine focused formula/deep-group/oversized-XML cases: four successful runs and five explanatory refusals; total 0.59 seconds, peak 107,728 KiB.
- The inherited fuzzer at `~/stress-core` was not duplicated or rebuilt by this pass. Its working directory was `~/stress-corpus`, output `fuzz2`, with 545 seeds and 16 mutation workers, plus coordinator/watchdog threads. At intentional stop it had run 1,545 seconds and used 6:39:42 cumulative CPU time, with 3,665,684 KiB resident high-water mark and 4,363,600 KiB peak virtual memory. Its address-space limit was 8,192,000,000 bytes and thread stack setting 8 MiB. No crash, hang, suspect input, or restart appeared in its log/output. It prints iteration counts only at natural completion; the interrupted run's iteration count is unavailable. Only the verified loop PID 56553 and fuzz PID 56561 were sent SIGTERM, at 02:09:30 UTC. Both are gone. This inherited binary predates the final fixes and is not represented as a fuzz pass of the final patch.

The package census reports differences for 48 hostile inputs. Forty-four concern only edit/undo output, including recalculated caches and redundant numeric type attributes. Four also change an unchanged save: missing worksheet relationships, missing slide relationships, ragged merged slide-table cells, and two worksheet entries sharing one part. These are intentionally malformed inputs; the census alone is not a semantic oracle. Those differences remain untriaged and are not counted as fidelity passes. Source XML/attribute inventories also cannot detect every order or value corruption. CORPUS-001 required exact cache/part comparisons.

Raw logs and the final PBO save remain at `eli@bbb:~/writan-stress-codex/results/`, `tests-core-final.log`, and `build-harness-final.log`. Earlier corpus/hostile/fuzz logs remain under `~/stress-corpus`. The hostile generator is `gen/hostile.py`; it requires python-docx, python-pptx, and openpyxl and intentionally writes large compressed fixtures. The small standard-library generator was renamed to `gen/core-samples.py` to avoid the UI generator's path. Its optional encrypted-fixture step requires msoffcrypto; the committed encrypted fixture was retained when that dependency was absent in the final regeneration.

## Boundaries and remaining work

Native execution uses `FixedMeasurer`; it verifies parser/model/view behavior and a small-stack approximation, not browser fonts, actual WASM heap behavior, macOS WKWebView, Windows/macOS file semantics, or visual equivalence with Office. Font-host WASM borrow errors from UI-006 remain assigned to the parent, with repros in `tests/stress/ui/css-fonts.mjs` on the UI branch. The corpus delegate owns mixed content-control cell order and optional CJK list numbering. No duplicate fix is included here. Footnotes, SmartArt, math, charts, conditional formatting, and right-to-left table layout remain the separate rendering limitations documented in `BUGS-corpus.md`.

Plugin installation failure handling and signed-PDF saves belong to the parent. No native plugin or GUI/platform result is claimed by this core pass. No release or push was performed.

## Paths changed while finishing the recovered work

Application sources and regressions:

- `crates/office-core/src/formats/xlsx/read.rs`
- `crates/office-core/src/opc/mod.rs` and `src/opc/tests.rs`
- `crates/office-core/src/xml/parse.rs` and `src/xml/tests.rs`
- `crates/office-sheets/src/lib.rs` and `src/tests.rs`
- `crates/office-sheets/src/view/mod.rs` and `src/view/tests.rs`

Stress artifacts:

- `tests/stress/harness/src/lib.rs`
- `tests/stress/harness/src/bin/drive.rs` and new `save-app.rs`
- `tests/stress/run-drive.sh`, with default concurrency reduced from 18 to two
- `tests/stress/gen/samples.py` renamed to `core-samples.py`, and recovered `gen/hostile.py` added
- New samples `S1-unchanged-formula-caches.xlsx`, `S1-long-formula-stack-overflow.xlsx`, and `S1-deep-groups-stack-overflow.pptx`
- `tests/stress/BUGS-core.md`

The branch also includes the seven recovered commits listed above. No DOCX row-order draft or `src/engine/host.ts` change is part of this finish pass.
