# Changelog

Every release's notes. The release workflow copies a version's section into its GitHub release, and the app's update panel shows it.

## 0.8.0 — 2026-10-19

### Images
- A new optional plugin opens **PNG, JPEG and HEIC** pictures: zoom, fit to the window, and a few touch-ups (highlight, draw, box, crop, turn) with undo. ⌘C copies the picture, or the part you selected. An unchanged file is saved back exactly as it was.
- HEIC photos open for viewing (Workspace can't write HEIC); **Edit a JPEG copy** opens one to mark up. Turn Images on in **Settings › Plugins**.

### Plugins and fonts in one place
- **Settings › Plugins** now has two lists, file types and fonts, each with a switch. The fonts moved there from General, and the list of built-in file types is gone.
- Six more optional fonts for Word and PowerPoint: **Ubuntu**, **JetBrains Mono**, **Atkinson Hyperlegible**, **Courier Prime**, **Instrument Serif** and **Comic Neue**. Each downloads when you turn it on and is checked before use.

### PDFs autosave
- PDFs now autosave like other files. Saving keeps your place, and autosave waits while you're typing into a form field or text box, or drawing. If you never changed the PDF setting, it's now on; turn it off in **Settings › Autosave**.
- Opening a LaTeX document's PDF in a tab again starts at the top; while you edit, it keeps updating where you are.

### Also
- A new app icon.
- The autosave status in the title bar is just a status; clicking it no longer opens Settings.
- Plugin engines (Excalidraw, Mermaid) are checked for new releases every week, and an update arrives as a pull request.

## 0.7.2 — 2026-10-18

> **LaTeX on Windows may still have bugs.** Installing TeX with winget, the MiKTeX fallback and turning the LaTeX plugin off on Windows are still being tested. If something goes wrong, please [open an issue](https://github.com/elijahroizman/workspace/issues) with the message Workspace shows.

### Linux updates through apt
- The .deb now adds Workspace's APT repository, signed with its own key. New versions arrive with the rest of your system's updates (Software Updater, `sudo apt upgrade`).
- **Check for updates** on Linux can install a new version too: it asks for your password, installs with apt, and reopens Workspace.
- If you installed 0.7.1 or earlier, install the 0.7.2 .deb once by hand. Updates come through apt after that.

### Dialogs
- Questions and alerts ("Save changes?", "Revert?", errors) are drawn by Workspace instead of the system, so they look the same on macOS, Windows and Linux. Enter picks the highlighted button (Cancel when the other choice throws something away, as Revert and Delete do), Esc cancels.
- Deleting a custom theme asks first.

### LaTeX on Windows
- If winget can't install MiKTeX, Workspace falls back to MiKTeX's own installer (checked against its published SHA-256). The error now includes winget's exit code and last message.
- Installing or removing TeX can no longer hang Workspace: a step that takes longer than 45 minutes is stopped, and checking how TeX was installed gives up after a minute.
- Turning LaTeX off always works. Its question opens at once, and you can turn the plugin off while Workspace is still working out whether it can also remove TeX.
- The install window can be hidden while TeX installs. **Settings › Plugins** shows the progress.
- Turning off a plugin with open tabs offers to close them, instead of telling you to close them yourself.

### Fonts
- **Michelangelus**, Microsoft's free typeface based on Michelangelo's handwriting, can be added in **Settings › General**. Microsoft's license doesn't let apps include it, so Workspace downloads it from Microsoft and checks each file. It then shows in the Word and PowerPoint font menus.

### Also
- The PDF inspector's Document section is compact: each label and value share a row.
- The open-source licenses page credits T3 Code, which inspired the theme picker.
- Release notes are this changelog rather than a list of commits.
- Shorter README, with local development steps for Mac, Windows and Linux.

## 0.7.1 — 2026-10-18

- LaTeX installs TeX with Homebrew (Mac), winget (Windows) or apt (Debian, Ubuntu) when they're there, and offers to remove it when you turn the plugin off. A PDF opened in its own tab keeps updating. Errors wrap in the sidebar.
- Mermaid and LaTeX show errors in the sidebar only, and their sidebars match the rest of the app.
- Settings always opens on General. You can clear the file history and choose which file types get a tab under Recent.
- Appearance: a System option, color themes (two tones and an accent) and a theme creator.
- macOS window buttons moved down to line up with the tabs.
- A Debian/Ubuntu .deb is part of each release.

## 0.7.0 — 2026-10-18

- **Mermaid** (.mmd, .mermaid) and **LaTeX** (.tex) plugins. Both have a source and preview side by side, with the read / split / write switch Markdown uses (⌘E, ⌥⌘1–3).
- LaTeX compiles with the TeX on your computer (MacTeX, MiKTeX or TeX Live): in the document's folder, rerunning for references and running bibtex or biber. The PDF updates after you stop typing and shows in Workspace's PDF viewer. Workspace offers to install TeX when there's none.
- **EPUB** reader, a small plugin that comes with the app: one scrolling column, the table of contents in the sidebar, find, zoom, and it remembers your place.
- A plugin template and `npm run plugin:new` for writing plugins.

## 0.6.0 — 2026-10-18

- Plugins. Word, PowerPoint, PDF, Markdown and text are built in. Others are optional and off until you turn them on. **Excalidraw** is the first: it downloads from this repository's releases, and Workspace checks its signature before installing it.
- A setup screen on first launch picks plugins and default apps. Settings has General (version, default apps, setup, open-source licenses) and Plugins pages.
- ⌘N asks which kind of file to make.
- Links in documents open in the browser again.
- Full-screen slideshows no longer draw lines twice or clip slide text.

## 0.5.1 — 2026-10-17

- Crop pictures in documents and presentations.
- ⌘-click (Ctrl-click on Windows) opens a Word link in the browser. Text typed after a link at the end of a paragraph no longer takes on the link's look.
- Resting the pointer on commented text shows the comment.
- Several picked slides can be deleted at once, in one undo step.
- New untitled documents take the lowest free number.

## 0.5.0 — 2026-10-17

- Word: headers and footers, and comments (add, reply, resolve, delete) saved in the file.
- PowerPoint: slide transitions with a preview, speaker notes, picking several slides or objects with shift- or ⌘-click, styling several objects at once, group and ungroup, layer order. Zoom keeps the slide in place.
- **Settings › Keyboard Shortcuts** lists every shortcut and lets you change it.

## 0.4.1 — 2026-10-16

- Autosave writes any file that already has a location back to it a few seconds after you stop editing.

## 0.4.0 — 2026-10-16

- The PDF editor runs on PDFium: faster zoom, page edits that apply instantly and can be undone, and less memory.
- The update panel shows the latest release's notes, and on a Mac the updated app reopens in the same Dock spot.
- The Mac app is signed and notarized.
- One Workspace in the macOS Open With menu.

## 0.3.0 — 2026-10-16

- Word: links, page breaks, word count, table controls, and A4 for new documents.
- PowerPoint tables fit their frame and can be styled.
- Plain text (.txt) files.
- Embedding a YouTube video no longer crashes.

## 0.2.1 — 2026-10-15

- The downloaded Mac app no longer shows as "damaged".
- A tab's document loads the first time you look at it, so restoring a session is fast.

## 0.2.0 — 2026-10-15

- Windows: every shortcut works, labels say Ctrl/Alt/Shift, and the browser's reload keys are off.
- Automatic updates: checked after launch and every four hours, installed on quit or with **Restart to Update**.
- Pinch zoom follows your fingers.

## 0.1.0 — 2026-10-15

- First release: Word, PowerPoint, PDF and Markdown in tabs, each with its own sidebar and inspector. Native menus, Open With, session restore, printing, and light and dark themes.
