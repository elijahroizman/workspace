//! The running app's icon. The installed bundle and launcher keep the default artwork.

fn png(variant: &str) -> Result<&'static [u8], String> {
    match variant {
        "dark" => Ok(include_bytes!("../icons/variants/dark.png")),
        "blue" => Ok(include_bytes!("../icons/variants/blue.png")),
        "light" => Ok(include_bytes!("../icons/variants/light.png")),
        _ => Err(format!("Unknown app icon: {variant}")),
    }
}

#[tauri::command]
pub async fn set_app_icon<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    variant: String,
) -> Result<(), String> {
    let bytes = png(&variant)?;
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(set_dock_icon(&variant, bytes));
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())??
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::Manager;
        let image = tauri::image::Image::from_bytes(bytes).map_err(|e| e.to_string())?;
        for window in app.webview_windows().into_values() {
            window.set_icon(image.clone()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn set_dock_icon(variant: &str, bytes: &[u8]) -> Result<(), String> {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let mtm = MainThreadMarker::new().ok_or("App icons must be set on the main thread")?;
    let image = if variant == "dark" {
        None
    } else {
        Some(
            NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes))
                .ok_or("Could not decode the app icon")?,
        )
    };
    // NSApplication accepts nil to restore the bundle's default icon.
    unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(image.as_deref()) };
    Ok(())
}
