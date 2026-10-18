# Plugins

Word, PowerPoint, PDF, Markdown and text are built in. The rest are optional and off until you turn them on, in the setup screen on first launch or later in **Settings › Plugins**.

| Plugin | Opens | Size | How it arrives |
| --- | --- | --- | --- |
| [Excalidraw](https://excalidraw.com) | `.excalidraw` drawings | about 16 MB, mostly fonts | Downloaded from this repository's releases when you turn it on |
| EPUB | `.epub` books | about 200 KB | Comes with the app; turns on instantly |
| [Mermaid](https://mermaid.js.org) | `.mmd`, `.mermaid` diagrams | about 1.2 MB | Downloaded |
| LaTeX | `.tex` documents | about 120 KB (TeX itself is separate) | Downloaded |

Workspace checks every downloaded plugin's signature before installing it. Turning a downloaded plugin off removes its files; turning it back on downloads it again. Tabs using a plugin close first (Workspace asks about unsaved changes).

## EPUB

A book shows as one scrolling column, with its table of contents in the sidebar. Find and zoom work, and the book reopens where you left off. Nothing in a book runs or loads from the web.

## Mermaid and LaTeX

Both work like Markdown: source and preview side by side, and ⌘E switches between the preview, both, and the source.

Mermaid draws the diagram as you type and exports SVG or PNG.

LaTeX compiles with the TeX installed on your computer a few seconds after you stop typing (set how long in **Settings › Plugins**). The PDF shows in Workspace's own viewer, and errors and the outline are in the sidebar. A document compiles from the folder it's saved in, so `\input` and pictures beside it work.

### Getting TeX

If there's no TeX when you turn LaTeX on, Workspace offers to install it:

- **Mac:** MacTeX or the smaller BasicTeX, through Homebrew if you have it, otherwise MacTeX's own installer (its signature is checked).
- **Windows:** MiKTeX, just for your user account, through winget. If winget isn't there or fails, MiKTeX's own installer is downloaded and checked against its published SHA-256.
- **Debian, Ubuntu:** TeX Live through apt, after asking for your password.

You can hide the install window while it runs; **Settings › Plugins** shows the progress. When you turn LaTeX off, Workspace asks whether to remove TeX too (only if it knows how it was installed). It's unticked unless you choose it.

LaTeX on Windows is still being tested. If installing or removing TeX fails, the message includes what winget or the installer said; please put that in an [issue](https://github.com/elijahroizman/workspace/issues).
