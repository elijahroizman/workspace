mod files;
mod menu;

use std::sync::Mutex;

use tauri::{Emitter, Manager};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::RunEvent;

/// Paths the OS asked us to open (Finder "Open With", double-click, CLI args)
/// that the frontend hasn't picked up yet. The frontend drains this on startup
/// and whenever it receives an `open-requested` event, so nothing is lost if a
/// file arrives before the webview has finished loading.
#[derive(Default)]
pub struct PendingOpens(pub Mutex<Vec<String>>);

impl PendingOpens {
    fn push(&self, paths: impl IntoIterator<Item = String>) {
        self.0.lock().unwrap().extend(paths);
    }
}

#[tauri::command]
fn take_pending_opens(state: tauri::State<'_, PendingOpens>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn queue_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<PendingOpens>().push(paths);
    let _ = app.emit("open-requested", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_paths: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| std::fs::canonicalize(arg).ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PendingOpens(Mutex::new(cli_paths)))
        .menu(menu::build)
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .invoke_handler(tauri::generate_handler![
            files::read_file,
            files::write_file,
            files::path_info,
            take_pending_opens,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Workspace");

    app.run(|app, event| match event {
        // Finder: double-click, "Open With", or dropping files on the Dock icon.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            queue_open(app, paths);
        }
        // Clicking the Dock icon with no visible window brings the window back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
        _ => {
            let _ = app;
        }
    });
}
