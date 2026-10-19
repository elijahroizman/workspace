# What each editor can do

Every file opens as a tab across the top. Each kind of document gets its own sidebar on the left and an inspector on the right; ⌘\ and ⌥⌘\ hide them.

| Type | Left sidebar | Inspector (right) |
| --- | --- | --- |
| Word | Heading outline, page and word count | Style, font, size, bold/italic/…, color, highlight, alignment, lists, line spacing; insert table, image, link or page break; header and footer with page numbers; comments with replies (rest the pointer on commented text to read one); ⌘-click a link to open it; image size and crop; table rows, columns, shading and borders; page size (A4 for new documents) and margins |
| PowerPoint | Slide thumbnails (drag to reorder, shift- or ⌘-click to pick several, right-click for more); speaker notes under the slide | Insert text boxes, shapes, tables, images, video links and slides; text formatting for one object or several; table styles; fill and line; position, size, rotation, flip and layer order; crop; group and ungroup; links; align; slide layout; transitions; Present |
| PDF | Page thumbnails (drag to reorder) or the PDF's outline | Highlight, add text, draw or sign, place images; rotate, move, duplicate, delete, insert and extract pages; document info |
| Markdown | Heading outline | Hidden by default. Read / Split / Write switch at the bottom (⌘E). Front matter, such as an Agent Skill's name and description, shows as a table |
| Text | None | None |

## Tabs

Open as many files as you like and switch with ⌘1–⌘9 or ⇧⌘[ / ⇧⌘]. Drag tabs to reorder them. Right-click a tab to duplicate it (⇧⌘D), for example to keep a textbook's questions and answers side by side. Open tabs come back the next time you launch. A restored tab loads its document the first time you look at it.

## New files

⌘N asks which kind of file to make, from the plugins you have on. The Home tab has a button for each too. New Word documents are A4.

## Autosave

A file you've already saved is written back to the same place a few seconds after you stop editing. That place can be any folder, including one iCloud Drive, Dropbox, OneDrive or another sync app watches; the sync app uploads it. Workspace doesn't sign in to anything. A new document isn't saved until you use Save.

In **Settings › Autosave** you can turn it off, change the delay, or leave some file types on manual save. Saving doesn't move a PDF: it stays on the page you're reading. While you're typing into a PDF form field or a text box, or drawing, autosave waits until you finish.

## Fonts

Word documents use open-licensed stand-ins for Calibri, Cambria, Arial, Times New Roman and Courier New, with the same widths, so lines break where Word breaks them.

**Settings › Plugins** can add more: Michelangelus, Ubuntu, JetBrains Mono, Atkinson Hyperlegible, Courier Prime, Instrument Serif and Comic Neue. Each downloads when you turn it on and appears in the Word and PowerPoint font menus. See [Plugins › Fonts](plugins.md#fonts).

## Appearance

**Settings › Appearance** picks light, dark or the system's setting (⇧⌘L switches), and a color theme for each. You can make your own themes: two tones and an accent.

## Command line

Like `code` for VS Code, `workspace` opens things from a terminal:

```sh
workspace .              # this folder, in the folder sidebar
workspace notes.md       # a file; a new Markdown, text or LaTeX file is created empty
workspace a.pdf b.docx   # several files, each in a tab
```

On a Mac, install it from **Settings › General › Command line** or **Workspace › Install Command Line Tool…**. It goes in `/usr/local/bin`, which usually asks for your password. It finds Workspace by its app ID, so moving the app doesn't break it. On Debian and Ubuntu the .deb puts `workspace` on the PATH already. On Windows and Linux, running it while Workspace is open hands the files to the open window instead of starting a second copy.

## Default apps

The setup screen on first launch asks which file types Workspace should open, and **Settings › General › Default apps** can change that later. On Windows, each one is confirmed in Windows' own Default apps settings. Workspace also appears in every Open With menu.
