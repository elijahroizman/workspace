<img src="assets/app-icon.svg" width="72" height="72" alt="">

# Workspace

A small, fast Mac and Windows app for the document types most people actually use: **Word (.docx), PowerPoint (.pptx), PDF, Markdown and plain text (.txt)**, plus optional plugins: **Excalidraw** drawings, **EPUB** books, **Mermaid** diagrams and **LaTeX** documents. Everything opens as a tab in one window, and each kind of document gets its own sidebar and inspector.

- **Plugins.** Office, PDF, Markdown and text are built in. Others are optional: turn them on in the setup screen that opens the first time you launch Workspace, or later in **Settings › Plugins**. The first optional plugin is [Excalidraw](https://excalidraw.com) for `.excalidraw` drawings. It's about 16 MB, mostly fonts, so Workspace downloads it from this repository's releases when you turn it on and checks its signature before installing it. The EPUB reader is small, so it comes with the app and turns on instantly. It shows a book as one scrolling column with its table of contents in the sidebar, and reopens a book where you left off. **Mermaid** and **LaTeX** work like Markdown: source and preview side by side, and ⌘E switches between the preview, both, and the source. Mermaid draws the diagram as you type. LaTeX compiles with the TeX installed on your computer (MacTeX on a Mac, MiKTeX or TeX Live on Windows) a few seconds after you stop typing (set how long in **Settings › Plugins**), shows the PDF in Workspace's own viewer, and lists errors and the outline in the sidebar. If there's no TeX, Workspace offers to install it when you turn the plugin on. Both plugins download when you turn them on.

- **Tabs across the top.** Open as many files as you like and switch with ⌘1–⌘9 or ⇧⌘[ / ⇧⌘]. Drag tabs to reorder them, and right-click a tab to duplicate it (⇧⌘D), for example to keep a textbook's questions and answers open side by side. Open tabs come back the next time you launch.
- **Sidebars that fit the document.**

  | Type | Left sidebar | Inspector (right) |
  | --- | --- | --- |
  | Word | Heading outline, page and word count | Style, font, size, bold/italic/…, color, highlight, alignment, lists, line spacing, insert table/image/link/page break; header and footer with page numbers; comments with replies (rest the pointer on commented text to read one); ⌘-click a link to open it; image size (or drag a corner) and crop; table rows, columns, shading and borders; page size (A4 for new documents) & margins |
  | PowerPoint | Slide thumbnails (drag to reorder, shift- or ⌘-click to pick several, right-click for more); speaker notes under the slide | Insert text boxes, shapes, tables, images, video links and slides; font, size, bold/italic/…, color, alignment and lists, for one object or several at once; table styles, rows and columns; fill and line; position, size, rotation, flip and layer order; crop pictures; group and ungroup; links; align several objects; slide layout; transitions for one or many slides; Present |
  | PDF | Page thumbnails (drag to reorder) or the PDF's outline | Highlight, add text, draw/sign, place images; rotate/move/duplicate/delete/insert/extract pages; document info |
  | Markdown | Heading outline | Hidden by default: Markdown is mostly for reading. Save a copy or print. Read / Split / Write switch at the bottom (⌘E). Front matter, such as an Agent Skill's name and description, shows as a table |
  | Text | None: just the text | None |

- **Fast.** Built on [Tauri](https://tauri.app), so it uses the web view built into the system (WebKit on macOS, WebView2 on Windows) instead of bundling a browser. The app is small and launches quickly. Each editor engine loads only when you first open that kind of file.
- **New files.** ⌘N asks which kind of file to make, from the plugins you have on. The Home tab has a button for each too.
- **Autosave.** A file you have already saved is written back to that same place a few seconds after you stop editing. That place can be any folder, including one that iCloud Drive, Dropbox, OneDrive or another sync app already watches. The sync app uploads the file. Workspace does not sign in to anything. A new document is not saved until you use Save. In **Settings** (⌘,) you can turn autosave off, change the delay, or leave PDFs on manual save, because saving a PDF rewrites the whole file.
- **Works offline, no accounts.** Every document engine runs locally on your computer.
- **Keeps itself up to date.** New versions download in the background and install when you quit. To install one straight away, click **Restart to Update** in the tab bar.

## Install

Download the latest build from [Releases](https://github.com/elijahroizman/workspace/releases/latest):

- **Mac (Apple silicon):** open `Workspace_…_aarch64.dmg` and drag Workspace to Applications.
- **Windows (x64):** run `Workspace_…_x64-setup.exe`. Windows may say "Windows protected your PC" because the app isn't signed. Click **More info** → **Run anyway**.
- **Debian, Ubuntu (x64):** run `sudo apt install ./Workspace_…_amd64.deb`. Needs Ubuntu 22.04 or Debian 12 or newer.

On Mac and Windows, updates install themselves. On Linux, the update button shows the latest release's notes; install each new `.deb` the same way.

## Build it yourself on a Mac

It takes about five minutes, most of it compiling. A copy you build yourself doesn't update itself.

1. **Install the build tools** (skip any you already have):

   ```sh
   xcode-select --install                                           # Apple's command-line tools
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust (accept the defaults)
   brew install node                                                # Node.js 20 or newer (or use nodejs.org)
   ```

   Open a new Terminal window afterwards so `cargo` and `npm` are on your PATH.

2. **Build Workspace** from this folder:

   ```sh
   npm install
   npm run app:build
   ```

   The finished app is at `src-tauri/target/release/bundle/macos/Workspace.app`, and a disk image is next to it in `bundle/dmg/`.

3. **Move it to Applications.** Remove the previous copy first so the new bundle replaces it:

   ```sh
   rm -rf /Applications/Workspace.app
   cp -R src-tauri/target/release/bundle/macos/Workspace.app /Applications/
   ```

4. **First launch.** You built the app yourself, so it isn't signed by Apple. The first time, **right-click Workspace in Applications → Open → Open**. After that it opens normally. If macOS still refuses, run `xattr -cr /Applications/Workspace.app` once.

5. **Optional: make it the default app** for a file type. The setup screen asks on first launch, and **Settings › General › Default apps** can do it later. Workspace also appears in every *Open With* menu.

Finder lists every `Workspace.app` it can find. The build left in `src-tauri/target`, a disk image that is still mounted, or an older copy in Downloads shows up beside the installed app with its version after the name, as in "Workspace (0.3.0)" and "Workspace (0.1.0)". Opening the current app removes the other copies from that menu. The files stay where they are.

To update later, pull the new code and repeat steps 2–3.

## Keyboard shortcuts

These are the defaults. **Settings → Keyboard Shortcuts** (⌘,) lists every shortcut, including the document and presentation ones, and lets you change any of them: click it and press the new keys.

On Windows, use Ctrl for ⌘, Alt for ⌥ and Shift for ⇧. Ctrl+Tab and Ctrl+Shift+Tab also switch tabs, and F11 toggles full screen.

| | |
| --- | --- |
| New file (pick the kind) | ⌘N |
| Open… | ⌘O |
| Save / Save As… | ⌘S / ⇧⌘S |
| Close tab / Reopen closed tab | ⌘W / ⇧⌘T |
| Home tab | ⌘T or ⌘1 |
| Switch tabs | ⌘1–⌘9, ⇧⌘] / ⇧⌘[ |
| Find | ⌘F |
| Toggle sidebar / inspector | ⌘\ / ⌥⌘\ |
| Zoom in / out / reset | ⌘+ / ⌘− / ⌘0 |
| Print (and Save as PDF from the print panel) | ⌘P |
| Duplicate tab | ⇧⌘D |
| Markdown, Mermaid, LaTeX: next view / preview only / source and preview / source only | ⌘E / ⌥⌘1 / ⌥⌘2 / ⌥⌘3 |
| Zoom (Word, PowerPoint, PDF) | Pinch on the trackpad, or ⌘ + scroll |
| Light / dark appearance | ⇧⌘L |
| Word: add comment | ⌥⌘A (Ctrl+Alt+M on Windows) |
| Word: open a link in the browser | ⌘-click (Ctrl+click on Windows) |
| PowerPoint: bring to front / send to back | ⇧⌘F / ⇧⌘B |
| PowerPoint: bring forward / send backward | ⌥⇧⌘F / ⌥⇧⌘B |
| PowerPoint: group / ungroup | ⌘G / ⇧⌘G |
| PowerPoint: play from this slide / from the start | ⌘↩ / ⇧⌘↩ |

You can also drop files from Finder onto the window or the Dock icon.

## What it's built on

All of these are open source and run locally:

| Job | Project | License |
| --- | --- | --- |
| App shell, windows, menus, file access | [Tauri 2](https://github.com/tauri-apps/tauri) | MIT / Apache-2.0 |
| Word editing (keeps formatting it doesn't understand when saving) | [docx-editor](https://github.com/eigenpal/docx-editor) + bundled substitutes for Calibri, Cambria, Arial, Times New Roman and Courier New | Apache-2.0, fonts SIL OFL |
| PowerPoint viewing & editing | [pptx-react-viewer](https://github.com/ChristopherVR/ooxml) | Apache-2.0 |
| New presentations | [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | MIT |
| PDF viewing, annotation, forms & page operations | [PDFium](https://pdfium.googlesource.com/pdfium/) (Chrome's PDF engine) compiled to WebAssembly by [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) | BSD-3-Clause / MIT |
| Markdown | [markdown-it](https://github.com/markdown-it/markdown-it), [CodeMirror 6](https://codemirror.net), [highlight.js](https://highlightjs.org), [yaml](https://github.com/eemeli/yaml) | MIT / BSD / ISC |
| Drawings (optional plugin) | [Excalidraw](https://github.com/excalidraw/excalidraw) | MIT |
| Books (optional plugin) | Workspace's own EPUB reader, on [JSZip](https://github.com/Stuk/jszip) and [DOMPurify](https://github.com/cure53/DOMPurify) | MIT / MPL-2.0 or Apache-2.0 |
| Diagrams (optional plugin) | [Mermaid](https://github.com/mermaid-js/mermaid), [CodeMirror 6](https://codemirror.net) | MIT |
| LaTeX (optional plugin) | Your system's TeX ([MacTeX](https://tug.org/mactex/), [MiKTeX](https://miktex.org), [TeX Live](https://tug.org/texlive/)); not shipped with Workspace | various free licenses |

**Settings › General › Open-source licenses** lists every package in the app, its plugins and the native shell, with their license texts.

## What it doesn't do (yet)

- **PowerPoint:** videos are added as their thumbnail with a link, which is how a link to an online video travels between apps. In Workspace's slideshow they play right on the slide; in PowerPoint or Keynote, clicking one opens the video in the browser. The slideshow plays slide transitions but not object animations.
- **Word:** tracked changes can’t be accepted or rejected. A comment covers text within one paragraph, and adding or removing comments isn't part of undo. When printing, table borders are left out.
- **PDF:** text, checkbox, radio and list form fields can be filled; buttons, signature fields and form scripts don't do anything. Forms made only with Adobe's XFA show their placeholder page. Chinese, Japanese or Korean text in a font the PDF doesn't include (some older PDFs) may not show.
- **EPUB:** books are for reading: no highlights, notes or editing. Pages scroll rather than turn. Books with DRM don't open, and audio narration (Media Overlays) doesn't play.
- **LaTeX:** needs TeX on the computer. A document compiles from the folder it's saved in, so `\input` and pictures beside it work; a new, unsaved one can't use other files. Clicking in the PDF doesn't jump to the source (no SyncTeX yet). A PDF opened in its own tab is a snapshot: open it again after changes.
- **Mermaid:** one diagram per file. Exports are SVG and PNG.
- Excel and other formats are intentionally out of scope.

## Developing

```sh
npm install
npm run app:dev        # runs the app with hot reload
npm run dev            # just the UI in a browser at http://localhost:1420
VITE_TEST_HOOKS=1 npx vite build && npx vite preview --port 1420   # lighter: a production build in the browser
npm run typecheck      # type checks with tsc-rs, a Rust port of the TypeScript compiler
npm run plugins        # builds optional plugins into plugins/<id>/dist; dev and preview serve them at /plugins/<id>/
cd src-tauri && cargo test
```

In browser mode, `http://localhost:1420/?open=/dev-samples/File.pdf` opens a file from `dev-samples/` (git-ignored) without a dialog. For the preview build, link the folder into the output once with `ln -s ../dev-samples dist/dev-samples`.

```
src/
  App.tsx                 shell: tabs, menu commands, session restore, drag & drop
  state/workspace.ts      open tabs, saving, recents, panel visibility
  lib/platform.ts         native file dialogs and file I/O (browser fallback for dev)
  components/             title bar + tabs, home screen, setup screen, settings, three-pane workbench
  editors/{docx,pptx,pdf,markdown,text}/   built-in editors, each loaded the first time it's needed
  plugins/catalog.ts      every plugin and the file types it opens
  plugins/api.ts          the contract an optional plugin's editor implements
plugins/<id>/             optional plugins, built and released apart from the app (see plugins/README.md)
scripts/licenses.mjs      collects license texts for Settings (runs in npm run build)
src-tauri/
  src/lib.rs              app setup, Finder “Open With” handling
  src/plugins.rs          downloads, checks and serves optional plugins (wsplugin: scheme)
  src/defaults.rs         makes Workspace the default app for its file types
  src/launch_services.rs  one Workspace entry in Finder's Open With menu
  src/files.rs            raw-bytes file reading and atomic saving
  src/menu.rs             the native menu bar
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you change anything. It covers who can push to `main` and what every pull request must say.

The **Release** workflow (`.github/workflows/release.yml`) builds a Windows x64 installer (`.exe`), a Mac Apple-silicon `.dmg` and a Debian/Ubuntu x64 `.deb` on GitHub's runners and attaches them to a GitHub Release. Run it from the Actions tab, or push a tag such as `v0.3.0` after bumping the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. The workflow also signs the update bundles and publishes `latest.json`, the feed installed copies check (the `.deb` has no update bundle, so the Linux job doesn't touch it). The signing key is in the repository's Actions secrets (`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), and its public half is in `tauri.conf.json`. If the key is lost, installed copies can't verify new versions, and everyone has to reinstall by hand once. On Windows, a local build is `npx tauri build --bundles nsis`; on Debian or Ubuntu it's `npx tauri build --bundles deb` (needs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev` and `patchelf`).

Optional plugins have their own **Plugins** workflow (`.github/workflows/plugins.yml`): push a tag like `plugin-excalidraw-0.18.1-1` and it builds, zips and signs that plugin with the same key, and attaches it to a pre-release. Do that whenever a plugin's version in `plugins/<id>/plugin.json` changes, before releasing an app version that wants it.
