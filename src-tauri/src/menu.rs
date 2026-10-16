//! The native menu bar. Every custom item emits a `menu` event carrying its id;
//! the frontend routes it to the active tab. Standard Edit items (undo, copy,
//! paste…) are predefined so they go straight to the focused text field.
//!
//! On Windows, WebView2 keeps keystrokes to itself, so menu accelerators never
//! fire while a document has focus. There the frontend handles every shortcut,
//! and the menu only shows the keys next to each item (Win32 right-aligns the
//! text after a tab).

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, accel: Option<&str>) -> tauri::Result<MenuItem<R>> {
    #[cfg(target_os = "macos")]
    {
        let mut builder = MenuItemBuilder::with_id(id, label);
        if let Some(accel) = accel {
            builder = builder.accelerator(accel);
        }
        builder.build(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let label = match accel {
            Some(accel) => format!("{label}\t{}", accel.replace("CmdOrCtrl", "Ctrl")),
            None => label.to_string(),
        };
        MenuItemBuilder::with_id(id, label).build(app)
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Workspace"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("Word, PowerPoint, PDF, Markdown and text files in one tabbed window."))
        .build();

    let new_menu = SubmenuBuilder::new(app, "New")
        .item(&item(app, "new-docx", "Document", Some("CmdOrCtrl+N"))?)
        .item(&item(app, "new-pptx", "Presentation", Some("CmdOrCtrl+Shift+N"))?)
        .item(&item(app, "new-md", "Markdown Note", Some("CmdOrCtrl+Alt+N"))?)
        .item(&item(app, "new-txt", "Text File", None)?)
        .build()?;

    let reveal_label = if cfg!(target_os = "macos") {
        "Show in Finder"
    } else if cfg!(windows) {
        "Show in File Explorer"
    } else {
        "Show in Folder"
    };

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&item(app, "new-tab", "New Tab", Some("CmdOrCtrl+T"))?)
        .item(&item(app, "duplicate-tab", "Duplicate Tab", Some("CmdOrCtrl+Shift+D"))?)
        .item(&new_menu)
        .item(&item(app, "open", "Open…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item(app, "save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item(app, "save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&item(app, "revert", "Revert to Saved", None)?)
        .separator()
        .item(&item(app, "print", "Print…", Some("CmdOrCtrl+P"))?)
        .separator()
        .item(&item(app, "reveal", reveal_label, None)?)
        .separator()
        .item(&item(app, "close-tab", "Close Tab", Some("CmdOrCtrl+W"))?)
        .item(&item(app, "reopen-tab", "Reopen Closed Tab", Some("CmdOrCtrl+Shift+T"))?);
    // Windows apps keep settings and Exit in the File menu; a Mac app has them in the app menu.
    #[cfg(not(target_os = "macos"))]
    let file_menu = file_menu
        .separator()
        .item(&item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&item(app, "quit", "Exit", Some("Alt+F4"))?);
    let file_menu = file_menu.build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item(app, "find", "Find…", Some("CmdOrCtrl+F"))?)
        .build()?;

    let markdown_menu = SubmenuBuilder::new(app, "Markdown View")
        .item(&item(app, "view-read", "Read", Some("CmdOrCtrl+Alt+1"))?)
        .item(&item(app, "view-split", "Split", Some("CmdOrCtrl+Alt+2"))?)
        .item(&item(app, "view-write", "Write", Some("CmdOrCtrl+Alt+3"))?)
        .separator()
        .item(&item(app, "view-cycle", "Next View", Some("CmdOrCtrl+E"))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&markdown_menu)
        .separator()
        .item(&item(app, "toggle-left", "Toggle Sidebar", Some("CmdOrCtrl+\\"))?)
        .item(&item(app, "toggle-right", "Toggle Inspector", Some("CmdOrCtrl+Alt+\\"))?)
        .separator()
        .item(&item(app, "zoom-in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item(app, "zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item(app, "zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&item(app, "toggle-theme", "Toggle Light/Dark", Some("CmdOrCtrl+Shift+L"))?)
        .separator();
    #[cfg(target_os = "macos")]
    let view_menu = view_menu.fullscreen();
    #[cfg(not(target_os = "macos"))]
    let view_menu = view_menu.item(&item(app, "toggle-fullscreen", "Full Screen", Some("F11"))?);
    let view_menu = view_menu.build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&item(app, "next-tab", "Show Next Tab", Some(if cfg!(target_os = "macos") { "CmdOrCtrl+Shift+]" } else { "Ctrl+Tab" }))?)
        .item(&item(app, "prev-tab", "Show Previous Tab", Some(if cfg!(target_os = "macos") { "CmdOrCtrl+Shift+[" } else { "Ctrl+Shift+Tab" }))?)
        .build()?;

    let menus: Vec<Submenu<R>> = if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "Workspace")
            .about(Some(about))
            .separator()
            .item(&item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?)
            .item(&item(app, "check-updates", "Check for Updates…", None)?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            // Custom quit so unsaved tabs get a chance to prompt.
            .item(&item(app, "quit", "Quit Workspace", Some("CmdOrCtrl+Q"))?)
            .build()?;
        vec![app_menu, file_menu, edit_menu, view_menu, window_menu]
    } else {
        // No app menu: its Hide item would make the window vanish with no way back on Windows.
        let help_menu = SubmenuBuilder::new(app, "Help")
            .item(&item(app, "check-updates", "Check for Updates…", None)?)
            .separator()
            .about(Some(about))
            .build()?;
        vec![file_menu, edit_menu, view_menu, window_menu, help_menu]
    };
    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = menus.iter().map(|m| m as &dyn tauri::menu::IsMenuItem<R>).collect();
    Menu::with_items(app, &refs)
}
