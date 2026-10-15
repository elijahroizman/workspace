//! The native menu bar. Every custom item emits a `menu` event carrying its id;
//! the frontend routes it to the active tab. Standard Edit items (undo, copy,
//! paste…) are predefined so they go straight to the focused text field.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let mut builder = MenuItemBuilder::with_id(id, label);
        if let Some(accel) = accel {
            builder = builder.accelerator(accel);
        }
        builder.build(app)
    };

    let about = AboutMetadataBuilder::new()
        .name(Some("Workspace"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("Word, PowerPoint, PDF and Markdown in one tabbed window."))
        .build();

    let app_menu = SubmenuBuilder::new(app, "Workspace")
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        // Custom quit so unsaved tabs get a chance to prompt.
        .item(&item("quit", "Quit Workspace", Some("CmdOrCtrl+Q"))?)
        .build()?;

    let new_menu = SubmenuBuilder::new(app, "New")
        .item(&item("new-docx", "Document", Some("CmdOrCtrl+N"))?)
        .item(&item("new-pptx", "Presentation", Some("CmdOrCtrl+Shift+N"))?)
        .item(&item("new-md", "Markdown Note", Some("CmdOrCtrl+Alt+N"))?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&item("new-tab", "New Tab", Some("CmdOrCtrl+T"))?)
        .item(&new_menu)
        .item(&item("open", "Open…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item("save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&item("revert", "Revert to Saved", None)?)
        .separator()
        .item(&item("print", "Print…", Some("CmdOrCtrl+P"))?)
        .separator()
        .item(&item("reveal", "Show in Finder", None)?)
        .separator()
        .item(&item("close-tab", "Close Tab", Some("CmdOrCtrl+W"))?)
        .item(&item("reopen-tab", "Reopen Closed Tab", Some("CmdOrCtrl+Shift+T"))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item("find", "Find…", Some("CmdOrCtrl+F"))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&item("toggle-left", "Toggle Sidebar", Some("CmdOrCtrl+\\"))?)
        .item(&item("toggle-right", "Toggle Inspector", Some("CmdOrCtrl+Alt+\\"))?)
        .separator()
        .item(&item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&item("toggle-theme", "Toggle Light/Dark", Some("CmdOrCtrl+Shift+L"))?)
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&item("next-tab", "Show Next Tab", Some("CmdOrCtrl+Shift+]"))?)
        .item(&item("prev-tab", "Show Previous Tab", Some("CmdOrCtrl+Shift+["))?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
}
