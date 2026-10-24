# Final verification

The fixes are committed on `stress-test`. The branch is published in PR #34; PR #33 was merged and integrated before the review follow-up. Release work follows the PR merge. The severity-sorted result, including open findings, is [BUGS.md](BUGS.md). Repro files and generators are under this directory.

## Results

| Check | Result |
| --- | --- |
| Native Rust tests on this Linux machine | 39 passed, 0 failed, 3 ignored (including new-file umask and existing permission preservation). Workloads ran sequentially. |
| Native Clippy, all targets with warnings denied | Passed. |
| Combined Office workspace, release and all features, on bbb | 378 passed, 0 failed, 8 ignored. `CORPUS_FILES` supplied for the original CJK fixtures. |
| Forced WASM compilation | Passed; logs show compilation of all six Office crates, followed by wasm-bindgen. |
| App/plugin typecheck and production build | Passed. A later text-only fix was rebuilt and its affected regressions repeated. |
| Office Rust formatting | Passed after formatting one inherited test closure. |
| Data safety in Chromium and WebKit | 133 assertions per browser after CodeRabbit fixes, including byte preservation, undo, failed saves, equal-size/equal-time conflicts, concurrent tabs, and queued Save As. |
| Hidden sheets, malformed files, document links, and hostile fonts | Passed in both browsers. Hostile-font documents must serialize and save, not merely leave the app chrome visible. |
| Session reload observation | 8 assertions per browser confirm the existing limitation: unsaved edits and untitled tabs are lost. This is an open finding, not recovered data. |
| Native save-flow browser regression | Both browsers block conflicting autosave, preserve Cancel, allow explicit overwrite, and resume autosave. |
| Signed GPO PDF | Both browsers preserve its SHA-256 and valid signature digest on unchanged save and after undo. Rotation persists at 90 degrees; repeated clean saves are identical. The original certificate is expired. |
| PBO workbook on the combined browser build | Both browsers preserve all 376 non-directory package entries exactly, with no added parts. |
| NZ RFP on the combined browser build | Both saved files preserve table/control order and render as 22 pages in the same LibreOffice reference setup, matching the original. |
| CJK lists on the combined browser build | Both browsers paint all 20 expected markers for each original fixture; saved table/control order is preserved. |
| Controlled Linux GIO launch | Two sample paths, including spaces and Unicode, arrive together. This does not launch the packaged app. |

[Machine-readable final evidence](corpus/evidence/final-2026-10-24.json) records the combined core counts, browser assertions, exact workbook preservation, PDF digests, reference page counts, and actual CJK markers. The original 108-assertion pass included eight checks for malformed BOM-marked UTF-8 and truncated UTF-16. Both failed byte preservation before the final text fix; unchanged saves and undo now return the original bytes. Edited saves of malformed BOM-marked UTF-8 or UTF-16 are now refused with an explanation; disk bytes and the dirty buffer are preserved. The follow-up includes incomplete code units and unpaired surrogates in both byte orders.

The original corpus pass covered 102 files in both browsers, 81 CLI round trips, and 387 reference opens. The final combined corpus rerun intentionally targets the four files affected by the workbook/table/numbering fixes, in both browsers. Those are eight follow-up open/save flows, not a second complete 102-file pass. The separate PDF script checks the 1,298-page signed document.

The core hostile pass processed 281 inputs: 239 successful view operations and 42 explicit refusals, with no abort, panic, or timeout. Its largest child reached about 1.38 GiB RSS; the separate PBO native-view run reached about 1.53 GiB. The inherited 16-worker fuzz run was stopped after 1,545 seconds without recorded failures. It predates the final patch, has no available iteration count, and is not claimed as a final-patch fuzz pass. See [core results](BUGS-core.md).

## Environment and commands

UI suites used `http://localhost:4173/` on bbb. Viewports were 1400 by 900 for UI suites, 1280 by 900 for PDF, and 1440 by 1100 for corpus/marker checks. The Browser plugin was unavailable. The repository's documented Playwright workflow provided Chromium and WebKit; WebKit does not establish behavior of the actual macOS application.

Final browser suites:

```sh
for engine in chromium webkit; do
  for suite in datasafety session hidden-sheets nasty security css-fonts; do
    ENGINE="$engine" WRITAN_URL=http://localhost:4173/ timeout 180 \
      node "tests/stress/ui/$suite.mjs"
  done
done
```

Final core command on bbb:

```sh
CORPUS_FILES=$HOME/stress-corpus-files CARGO_BUILD_JOBS=4 \
  cargo test --workspace --all-features --release \
  --manifest-path crates/Cargo.toml -- --test-threads=1
```

Use [native/README.md](native/README.md), [corpus/README.md](corpus/README.md), and [FIXES-corpus.md](FIXES-corpus.md) for PDF, corpus, marker, and reference-render commands. After each build, restore `dist/dev-samples` pointing to the fetched corpus. The runner now verifies every served sample against the manifest hash, waits explicitly for serialization readiness, and exits unsuccessfully if a file fails. This prevents an app-page fallback or early editor registration from becoming a false result. The first final run caught a missing corpus link; its failed setup attempt is excluded from the verified results.

Remote clock skew made copied source mtimes older than build outputs. Rust sources were touched on bbb before the final compile, and the WASM build used `node scripts/engine.mjs --force`. Logs confirm recompilation. Builds and browser processes used separate test directories from unrelated projects.

## Evidence and limits

On bbb, final build/test logs are `/tmp/stress-final-{engine,build,core}.log`, `/tmp/stress-final-<suite>-<browser>.log`, `/tmp/stress-final-corpus.log`, `/tmp/stress-final-cjk.log`, and `/tmp/stress-final-reference.log`. Saved corpus files and reference PDFs are in `~/stress-native/tests/stress/corpus/results-final/`. Screenshots are in `/tmp/writan-stress/` and `/tmp/writan-pdf-<browser>-edited.png`. The raw files are retained there without committing material whose redistribution rights were not established.

Screenshots, DOM assertions, save/download checks, and console checks establish a rendered, responsive app without a framework overlay. Deliberately missing Markdown images produce expected 404 resource messages. A WebKit preload warning also occurs. Neither is counted as an unhandled application exception; the suites assert the absence of unhandled page errors.

Native tests still ignore the actual full-filesystem mount, TeX execution, and all-font download. Office tests still ignore eight external-reference/performance cases. Native Windows/macOS app behavior, actual cloud synchronization, filesystem aliases, another process writing in the final check/write window, installer upgrades, physical multi-monitor/high-DPI hardware, IME/clipboard interoperability, and sustained memory soaks remain unverified. Aggregate/media OOM, recalculation after edits to unsupported formulas, crash recovery, and the documented rendering gaps remain material limitations.

The task-owned preview servers on ports 1420, 1443, and 4173 were stopped after verification. Source copies, samples, logs, saved outputs, and reference artifacts remain on bbb.

## CodeRabbit follow-up on the renamed combined build

PR #33's Debian repack now forces root ownership for every archive entry and verifies it. The ordinary-user package fixture passed on bbb. The native helper contract comments were added in the same review response.

PR #34's application fixes preserve umask permissions for new Unix files, check disk contents after export, refuse destructive malformed-text saves, allow empty TSV, and route every native macOS termination request to the page's current-state Quit handler. There is no asynchronous native dirty cache. The browser event path is tested; the AppKit callback itself still requires a Mac and is not claimed as exercised on Linux.

After integration, native tests (39 passed, 3 ignored), native Clippy, app/plugin typecheck and production build passed. Chromium and WebKit each passed 133 data-safety assertions. The focused empty TSV run passed 8 assertions per browser. The fuzz harness now rejects empty seeds/zero workers and propagates worker failure; the wrapper checks its executable and delays restarts. Its rebuilt release binary refused the empty-seed fixture with status 1. These checks are not a new sustained fuzz run.

Follow-up logs on bbb are `/tmp/writan-pr34-{build,chromium,webkit,tsv,fuzz}.log`; native test/Clippy output on prodesk is `/tmp/writan-pr34-native-local.log`. An initial native build attempt on bbb stopped for missing system D-Bus development files; native verification used the configured prodesk environment sequentially.

The corpus audit follow-up passes 21 focused regressions on bbb with warnings treated as errors. It rejects oversized downloads, stale reference PDFs, failed CLI comparisons, missing worksheets/cells, signature regressions, and unexpected missing DOCX saves. A real Poppler smoke run accepted preserved signatures and rejected a tampered PDF while recording digest evidence. Six readable generated DOCX fixtures and eight expected refusals matched the explicit classification. The README Bash startup recipe passes syntax validation. Evidence is retained under `/tmp/writan-corpus-pr34.1q7H6oJE/` on bbb, including `audit-regressions.log`. The dedicated regression command is `python3 -W error tests/stress/corpus/test-audit-regressions.py`.
