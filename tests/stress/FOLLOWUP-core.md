# Core findings recovered after 0.10.5

The original worker resumed after the replacement stress pass and the 0.10.5 release. Most of its fixes were already included. Commit `2e4de14` contained four additional changes that had never compiled. They are validated on `stress-followup-core`; they are not included in 0.10.5.

| ID | Severity | Finding and fix | Reproduction |
| --- | --- | --- | --- |
| CORE-012 | S2 | A workbook main part in an unsupported namespace reads as no sheets, so saving removes its worksheets. Main roots must match the expected Word, PowerPoint, or Excel namespace and element. Strict OOXML namespaces remain accepted. | [Beta workbook](samples/S2-beta-namespace-workbook.xlsx); `formats::review_tests::a_main_part_in_another_namespace_is_an_error`. |
| CORE-013 | S3 | A page/column break loses its containing run's formatting and attributes when written. Breaks now retain the imported run, including formatting when split from adjacent text. | [Page-break document](samples/S3-page-break-run-formatting-lost.docx); `formats::review_tests::page_break_runs_keep_their_formatting`. |
| CORE-014 | S3 | Reading a nested slide group first clones its complete subtree, then replaces that clone with modeled children. Skipping that discarded clone removes the repeated subtree copies. | `formats::review_tests::nested_groups_read_whole_and_save_unchanged` generates 200 nested groups and checks their depth and exact unchanged slide XML. |
| CORE-015 | S3 | UTF-8 XML is copied during decoding, and streamed worksheet content is copied again. Both now borrow the source bytes; UTF-16 still owns decoded text. | `xml::stream::tests::utf8_content_borrows_the_part_and_utf16_keeps_owned_text` checks borrowed UTF-8 and equivalent owned UTF-16 in both byte orders. |

The inherited DOCX writer did not compile because its break match arm returned `&mut Element` instead of `()`. The follow-up corrects that and adds root checks for Word/PowerPoint to the inherited workbook regression, plus explicit UTF-8 borrowing and UTF-16 equivalence coverage.

The 128 MiB XML-part and depth limits remain in force. This follow-up does not raise those limits or establish an aggregate memory bound. The performance changes remove specific source copies; no new large-file peak-memory measurements are claimed.

## Validation

bbb was unavailable over SSH. Local builds and tests run sequentially with `CARGO_BUILD_JOBS=1` and test threads limited to one. Results:

- Workspace/all-feature tests: 382 passed, zero failed, eight ignored. External-corpus environment variables were unset.
- Workspace Clippy, all targets/features with warnings denied: passed.
- Workspace formatting: passed.
- Forced release WASM build and wasm-bindgen: passed; all six Office crates recompiled.
- Production app build and app/plugin typecheck: passed.
- Native Tauri `cargo check --locked`: passed.
- Freshly built CLI: beta-namespace workbook refuses before creating output; the page-break DOCX keeps exact `word/document.xml` bytes.

Local logs: `/tmp/writan-followup-{workspace,clippy,wasm,app-build,native-check,typecheck,cli-build}.log`. No fresh 102-file corpus pass or browser pass is claimed. These are separate changes from the verified 0.10.5 release; no further version bump, tag, or release was made.
