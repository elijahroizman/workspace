# Native and PDF stress findings

Tested on Linux on 2026-10-24. Browser checks ran on bbb in Chromium and WebKit with the repository's documented Playwright workflow and a faked Tauri backend. They exercise the real React editors and save flow, not macOS or Windows native UI.

## Fixed findings, sorted by severity

| ID | Severity | Before the fix | Reproduction or sample | Regression |
| --- | --- | --- | --- | --- |
| NATIVE-001 | S1 | Saving silently overwrote a file changed by another app or a sync service. Later outside versions were missing from history. | `native/save-conflict.mjs` embeds `/docs/notes.md`, edits the disk version after opening, then attempts autosave and manual save. | Both browsers verify blocked autosave, Cancel, Save Anyway, and resumed autosave. Rust history tests preserve outside versions. |
| NATIVE-002 | S1 | The fixed temporary save name followed a pre-existing symlink, overwriting another file. Concurrent saves also shared the same temporary file. | Rust test `predictable_temp_symlink_cannot_overwrite_another_file` creates `other.md` and `.notes.md.workspace-saving` pointing to it. | Exclusive, randomly named temporary files. Symlink and concurrent-save regressions pass. |
| CORPUS-002 | S1 | Saving an unchanged signed PDF rewrote its bytes and broke its signature. | `us-budget-2025-appendix.pdf` in `corpus/manifest.tsv`; run `native/pdf-unchanged.mjs`. | Clean saves return the opened or last saved bytes. Both browsers preserve the original SHA-256 and pass `pdfsig` digest validation. Rotation is saved, undo restores the original bytes, and repeated clean saves remain identical. |
| NATIVE-003 | S1 | macOS Dock Quit or logout could bypass the unsaved-changes flow. | Open a text file, change it with autosave disabled, then Quit from the Dock or log out. | Native termination handler routes through the app's quit flow. Linux compilation/tests pass; actual macOS Dock/logout behavior remains unverified. |
| NATIVE-004 | S2 | Saving a read-only file succeeded by replacing it. Saving through a symlink replaced the link itself. | Rust `refuses_read_only_files`, `saves_through_symlinks`, and `refuses_to_replace_a_broken_symlink` create their own sample files. | Read-only targets are refused; symlinks retain their target and identity; unresolved links are refused. |
| NATIVE-005 | S2 | A failed partial write left a hidden partial temporary file, consuming space after the save failed. Errors exposed raw OS messages. | `partial_write_failure_keeps_original_and_removes_temp` writes partial bytes and injects `StorageFull`; `failed_replacement_removes_temp` attempts replacement of a directory. | Original bytes survive, temporary files disappear, and common failures have actionable messages. |
| NATIVE-006 | S2 | Windows command-line canonicalization added a verbatim path prefix, defeating duplicate-tab matching against an ordinary dialog path. | `cli::tests::drops_the_verbatim_prefix` includes drive and UNC paths. | Prefix normalization regression passes on Linux. Native Windows file associations and path casing remain unverified. |
| NATIVE-007 | S3 | The Linux launcher omitted `%F`. GNOME appended files as a fallback, but launched once per file. | `src-tauri/linux/main.desktop`, open two files from a file manager. | Launcher now explicitly accepts multiple file arguments. `native/desktop-open.py` verifies two paths, including spaces and Unicode, arrive together through GIO. Launching the packaged Writan app remains unverified. |

The PDF fix preserves digital signatures only while returning an unchanged saved revision. Editing and rewriting a signed PDF can still invalidate its signature. The GPO certificate itself is expired, independently of the digest validation above.

## Checks that held up

- Plugin signature verification accepts the matching signed bytes and rejects altered bytes and a signature naming another archive.
- Invalid plugin manifests and damaged ZIP upgrades leave the installed version intact and remove staging directories.
- An unavailable plugin download reports a connection error.
- Read-only, partial-write, failed-replacement, concurrent-save, and symlink cases preserve the expected files.
- The external-change flow keeps the tab dirty after refusing autosave.

## Limits

A real full filesystem could not be mounted with the available user namespace permissions. The deterministic partial-write regression covers cleanup after an ENOSPC-style error; the ignored `full_disk_keeps_the_original_and_no_scraps` test remains for a genuinely full test filesystem. It was not counted as executed.

No live iCloud or OneDrive account, Windows sharing lock, macOS logout, multi-monitor hardware, installer update, or release was exercised. TeX was not installed, so the earlier restricted-shell command flags remain unverified against a running TeX engine. Those flags do not sandbox TeX's filesystem access. No releases, tags, updater feeds, or package repositories were changed.
