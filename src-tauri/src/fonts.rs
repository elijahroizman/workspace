//! Fonts Workspace offers but can't ship. Michelangelus is free from Microsoft, but its license
//! lets people install it on their own devices without letting anyone pass it on, so each copy of
//! Workspace downloads it from Microsoft's Download Center when asked. The files are checked
//! against the hashes of the release Workspace was tested with and kept in the app's data folder.

use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, Runtime};

struct ExtraFont {
    id: &'static str,
    url: &'static str,
    /// File name in the archive and its SHA-256.
    files: &'static [(&'static str, &'static str)],
}

const FONTS: &[ExtraFont] = &[ExtraFont {
    id: "michelangelus",
    url: "https://download.microsoft.com/download/e8912dd7-c7e6-4ca1-a36b-c121d3fb238f/Michelangelus%20Fonts.zip",
    files: &[
        ("Michelangelus-Regular.ttf", "8e21078b09f6befa90ece78b55b8140d4a3b778eb48e68a7c899e02074429a4a"),
        ("Michelangelus-Italic.ttf", "36ef7b5a9a1f25c29c8ad3478d649fba2f64549bc50aab165dc55fb4418741da"),
        ("Michelangelus-Bold.ttf", "c5f07eb1d008b2ad1f75a9b5e8f91ba45827ef2b6d0f6989d0371a6168e1125f"),
        ("Michelangelus-BoldItalic.ttf", "f4815c2e4212be963d24c913c689dd2a97dc607e0e9ff0587f2ab90ad2641a52"),
    ],
}];

/// The archive is about 400 KB; anything far bigger isn't it.
const MAX_DOWNLOAD: u64 = 20 * 1024 * 1024;

fn font(id: &str) -> Result<&'static ExtraFont, String> {
    FONTS.iter().find(|f| f.id == id).ok_or_else(|| "Unknown font".to_string())
}

fn font_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("fonts").join(id))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// The extra fonts whose files are all on disk.
#[tauri::command]
pub fn installed_fonts<R: Runtime>(app: AppHandle<R>) -> Vec<&'static str> {
    FONTS
        .iter()
        .filter(|f| font_dir(&app, f.id).is_ok_and(|dir| f.files.iter().all(|(name, _)| dir.join(name).is_file())))
        .map(|f| f.id)
        .collect()
}

fn download(url: &str) -> Result<Vec<u8>, String> {
    let failed = |_| "Couldn't download the font from Microsoft. Check your connection and try again.".to_string();
    let mut response = crate::files::download_agent().get(url).header("User-Agent", "Workspace").call().map_err(failed)?;
    let mut bytes = Vec::new();
    response
        .body_mut()
        .with_config()
        .limit(MAX_DOWNLOAD)
        .reader()
        .read_to_end(&mut bytes)
        .map_err(|_| "The font download was interrupted.".to_string())?;
    Ok(bytes)
}

fn install(dir: &PathBuf, font: &ExtraFont, archive: &[u8]) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(|_| "Microsoft's download wasn't the font archive Workspace expected.".to_string())?;
    let mut found = Vec::new();
    for (name, hash) in font.files {
        // Files can sit in a folder inside the archive; match on the file name alone.
        let index = (0..zip.len())
            .find(|&i| zip.by_index(i).is_ok_and(|f| f.name().rsplit('/').next() == Some(*name)))
            .ok_or_else(|| format!("{name} is missing from Microsoft's download."))?;
        let mut bytes = Vec::new();
        zip.by_index(index).map_err(|e| e.to_string())?.take(MAX_DOWNLOAD).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if sha256_hex(&bytes) != *hash {
            return Err("Microsoft has changed this font since this version of Workspace. Update Workspace and try again.".into());
        }
        found.push((*name, bytes));
    }
    let staging = dir.with_extension("installing");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    for (name, bytes) in found {
        fs::write(staging.join(name), bytes).map_err(|e| format!("Couldn't save the font: {e}"))?;
    }
    let _ = fs::remove_dir_all(dir);
    fs::rename(&staging, dir).map_err(|e| format!("Couldn't save the font: {e}"))
}

/// Downloads a font from its maker and keeps it for Workspace's editors.
#[tauri::command]
pub async fn install_font<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let font = font(&id)?;
    let dir = font_dir(&app, font.id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive = download(font.url)?;
        install(&dir, font, &archive)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn remove_font<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let dir = font_dir(&app, font(&id)?.id)?;
    match fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Couldn't remove the font: {e}")),
        _ => Ok(()),
    }
}

/// One face's bytes, for the editors to register.
#[tauri::command]
pub fn font_file<R: Runtime>(app: AppHandle<R>, id: String, file: String) -> Result<Response, String> {
    let font = font(&id)?;
    let (name, _) = font.files.iter().find(|(name, _)| *name == file).ok_or("Unknown font file")?;
    let bytes = fs::read(font_dir(&app, font.id)?.join(name)).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_files_that_dont_match() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("workspace-fonts-{}", std::process::id()));
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            for (name, _) in FONTS[0].files {
                zip.start_file(format!("Michelangelus Fonts/{name}"), opts).unwrap();
                zip.write_all(b"not a font").unwrap();
            }
            zip.finish().unwrap();
        }
        let err = install(&dir, &FONTS[0], buf.get_ref()).unwrap_err();
        assert!(err.contains("changed"), "{err}");
        assert!(!dir.exists());
    }

    /// Fetches the real archive from Microsoft: `cargo test downloads_michelangelus -- --ignored`.
    #[test]
    #[ignore]
    fn downloads_michelangelus() {
        let dir = std::env::temp_dir().join(format!("workspace-fonts-real-{}", std::process::id()));
        install(&dir, &FONTS[0], &download(FONTS[0].url).unwrap()).unwrap();
        assert!(FONTS[0].files.iter().all(|(name, _)| dir.join(name).is_file()));
        fs::remove_dir_all(&dir).unwrap();
    }
}
