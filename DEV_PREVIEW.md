> **Maintainer build — not a release.** Every experimental feature from the open draft pull requests, merged together from the `claude/nice-cray-kstvgo` branch, for testing before any of them goes to `main`. macOS (Apple silicon) only.

It installs as **Workspace Dev** with its own app ID, so it sits beside a normal Workspace and keeps its own settings, recents and signatures. It doesn't check for updates. Signed and notarized like a release.

| Feature | Try it | Pull request |
| --- | --- | --- |
| Command palette | ⇧⌘P, type anything; `>` for commands only | #20 |
| Focus mode, typewriter scrolling | ⌥⌘F and ⌥⌘T in a Word or Markdown document | #21 |
| PDF signing and forms | PDF inspector › **Sign**; a PDF with a form shows a **Form** section; **Save flattened copy…** | #22 |
| Version history | Save a file a few times, then File › **Version History…** (or right-click the tab) | #23 |
| Workspace folders | File › **Open Folder…** (⇧⌘O), ⇧⌘E to hide; the palette searches its files | #24 |
| `workspace` command | Settings › General › **Command line** › Install, then `workspace .` in Terminal | #25 |
| Split view | ⇧⌘\, or right-click a tab › **Open to the Side** | #26 |

A few things only exist in this build because they join two features (the folder's files in the palette, focus mode hiding the folder sidebar); they're in the "Dev preview glue" commit on the branch.

Open it the first time from Applications. If macOS still complains inside a VM, right-click › **Open**.
