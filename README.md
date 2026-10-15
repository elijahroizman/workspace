<img src="assets/app-icon.svg" width="72" height="72" alt="">

# Workspace

A small, fast Mac app for the four document types most people actually use: **Word (.docx), PowerPoint (.pptx), PDF and Markdown**. Everything opens as a tab in one window, and each file type gets its own sidebar and inspector.

- **Tabs across the top.** Open as many files as you like and switch with ⌘1–⌘9 or ⇧⌘[ / ⇧⌘]. Drag tabs to reorder them, and right-click a tab to duplicate it (⇧⌘D), for example to keep a textbook's questions and answers open side by side. Open tabs come back the next time you launch.
- **Sidebars that fit the document.**

  | Type | Left sidebar | Inspector (right) |
  | --- | --- | --- |
  | Word | Heading outline | Style, font, size, bold/italic/…, color, highlight, alignment, lists, line spacing, insert table/image/link/page break/contents, page size & margins |
  | PowerPoint | Slide thumbnails (drag to reorder, right-click for more) | Insert text boxes, shapes, tables, images, video links and slides; font, size, bold/italic/…, color, alignment and lists; fill and line; position, size, rotation, flip and layer order; links; align several objects; slide layout; Present |
  | PDF | Page thumbnails (drag to reorder) or the PDF's outline | Highlight, add text, draw/sign, place images; rotate/move/duplicate/delete/insert/extract pages; document info |
  | Markdown | Heading outline | Hidden by default: Markdown is mostly for reading. Read / Split / Write modes (⌘E to switch) and word count. Front matter, such as an Agent Skill's name and description, shows as a table |

- **Fast.** Built on [Tauri](https://tauri.app), so it uses the WebKit that ships with macOS instead of bundling a browser. The app is small and launches quickly. Each editor engine loads only when you first open that kind of file.
- **Works offline, no accounts.** Every document engine runs locally on your Mac.

## Install on your Mac

You build the app once on your Mac. It takes about five minutes, most of it compiling.

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

3. **Move it to Applications**:

   ```sh
   cp -R src-tauri/target/release/bundle/macos/Workspace.app /Applications/
   ```

4. **First launch.** You built the app yourself, so it isn't signed by Apple. The first time, **right-click Workspace in Applications → Open → Open**. After that it opens normally. If macOS still refuses, run `xattr -cr /Applications/Workspace.app` once.

5. **Optional: make it the default app** for a file type. In Finder, select any `.pdf` (or `.docx`, `.pptx`, `.md`), press ⌘I, choose **Workspace** under *Open with*, then click **Change All…**. Workspace also appears in every *Open With* menu.

To update later, pull the new code and repeat steps 2–3.

## Keyboard shortcuts

| | |
| --- | --- |
| New document / presentation / note | ⌘N / ⇧⌘N / ⌥⌘N |
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
| Markdown: next view / Read / Split / Write | ⌘E / ⌥⌘1 / ⌥⌘2 / ⌥⌘3 |
| Zoom | Pinch on the trackpad, or ⌘ + scroll |
| Light / dark appearance | ⇧⌘L |

You can also drop files from Finder onto the window or the Dock icon.

## What it's built on

All of these are open source and run locally:

| Job | Project | License |
| --- | --- | --- |
| App shell, windows, menus, file access | [Tauri 2](https://github.com/tauri-apps/tauri) | MIT / Apache-2.0 |
| Word editing (keeps formatting it doesn't understand when saving) | [docx-editor](https://github.com/eigenpal/docx-editor) + bundled substitutes for Calibri, Cambria, Arial, Times New Roman and Courier New | Apache-2.0, fonts SIL OFL |
| PowerPoint viewing & editing | [pptx-react-viewer](https://github.com/ChristopherVR/ooxml) | Apache-2.0 |
| New presentations | [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | MIT |
| PDF viewing & annotation | [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| PDF page operations | [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT |
| Markdown | [markdown-it](https://github.com/markdown-it/markdown-it), [CodeMirror 6](https://codemirror.net), [highlight.js](https://highlightjs.org), [yaml](https://github.com/eemeli/yaml) | MIT / BSD / ISC |

## What it doesn't do (yet)

- **PowerPoint:** videos are added as their thumbnail with a link, which is how a link to an online video travels between apps. In Workspace's slideshow they play right on the slide; in PowerPoint or Keynote, clicking one opens the video in the browser. The slideshow doesn't play animations or transitions yet.
- **Word:** no editing of comments or tracked changes. When printing, table borders are left out.
- **PDF:** form filling works where the PDF supports it. Encrypted PDFs can be viewed and annotated, but their pages can't be rearranged.
- Excel and other formats are intentionally out of scope.

## Developing

```sh
npm install
npm run app:dev        # runs the app with hot reload
npm run dev            # just the UI in a browser at http://localhost:1420
VITE_TEST_HOOKS=1 npx vite build && npx vite preview --port 1420   # lighter: a production build in the browser
npm run typecheck
cd src-tauri && cargo test
```

In browser mode, `http://localhost:1420/?open=/dev-samples/File.pdf` opens a file from `dev-samples/` (git-ignored) without a dialog. For the preview build, link the folder into the output once with `ln -s ../dev-samples dist/dev-samples`.

```
src/
  App.tsx                 shell: tabs, menu commands, session restore, drag & drop
  state/workspace.ts      open tabs, saving, recents, panel visibility
  lib/platform.ts         native file dialogs and file I/O (browser fallback for dev)
  components/             title bar + tabs, home screen, three-pane workbench, inspector controls
  editors/{docx,pptx,pdf,markdown}/   one lazily loaded editor per file type
src-tauri/
  src/lib.rs              app setup, Finder “Open With” handling
  src/files.rs            raw-bytes file reading and atomic saving
  src/menu.rs             the native menu bar
```

The GitHub Actions workflow in `.github/workflows/macos.yml` builds a `.dmg` on a Mac runner if you push this repository to GitHub.
