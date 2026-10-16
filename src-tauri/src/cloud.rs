//! Finds the folders that iCloud Drive, Dropbox, OneDrive and Google Drive keep in sync on
//! this computer. Autosave writes into one of them and the provider's own app uploads the
//! file, so Workspace never signs in to anything or talks to a cloud service itself.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudFolder {
    /// `icloud`, `dropbox`, `onedrive` or `gdrive`.
    provider: &'static str,
    /// What to call it in the UI, e.g. “OneDrive – Contoso” for a work account.
    label: String,
    path: String,
}

/// Off the main thread: probing drive letters on Windows can stall on a sleeping network drive.
#[tauri::command]
pub async fn cloud_folders() -> Vec<CloudFolder> {
    tauri::async_runtime::spawn_blocking(detect).await.unwrap_or_default()
}

fn detect() -> Vec<CloudFolder> {
    let Some(home) = home_dir() else { return Vec::new() };
    let mut found = Vec::new();
    find_icloud(&home, &mut found);
    find_dropbox(&home, &dropbox_configs(&home), &mut found);
    find_cloud_storage(&home, &mut found);
    find_onedrive(&home, &mut found);
    find_google_drive(&home, &mut found);
    dedupe(found)
}

/// Creates a folder (and its parents) if it doesn't exist yet.
#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Couldn't create the folder “{path}”: {e}"))
}

fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn push(found: &mut Vec<CloudFolder>, provider: &'static str, label: impl Into<String>, path: &Path) {
    if path.is_dir() {
        found.push(CloudFolder { provider, label: label.into(), path: path.to_string_lossy().into_owned() });
    }
}

fn find_icloud(home: &Path, found: &mut Vec<CloudFolder>) {
    if cfg!(target_os = "macos") {
        push(found, "icloud", "iCloud Drive", &home.join("Library/Mobile Documents/com~apple~CloudDocs"));
    } else {
        // iCloud for Windows.
        push(found, "icloud", "iCloud Drive", &home.join("iCloudDrive"));
    }
}

/// Dropbox writes where its folders are to info.json, which survives moving the folder.
fn dropbox_configs(home: &Path) -> Vec<PathBuf> {
    let mut configs = vec![home.join(".dropbox/info.json")];
    for var in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(dir) = std::env::var_os(var) {
            configs.push(PathBuf::from(dir).join("Dropbox").join("info.json"));
        }
    }
    configs
}

fn find_dropbox(home: &Path, configs: &[PathBuf], found: &mut Vec<CloudFolder>) {
    for config in configs {
        let Ok(text) = fs::read_to_string(&config) else { continue };
        for (account, path) in dropbox_accounts(&text) {
            let label = if account == "business" { "Dropbox (Business)" } else { "Dropbox" };
            push(found, "dropbox", label, Path::new(&path));
        }
    }
    push(found, "dropbox", "Dropbox", &home.join("Dropbox"));
}

fn dropbox_accounts(json: &str) -> Vec<(String, String)> {
    let Ok(serde_json::Value::Object(accounts)) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let mut out: Vec<(String, String)> = accounts
        .into_iter()
        .filter_map(|(account, info)| Some((account, info.get("path")?.as_str()?.to_string())))
        .collect();
    // Personal first.
    out.sort_by_key(|(account, _)| account != "personal");
    out
}

/// macOS keeps file-provider folders in ~/Library/CloudStorage: “Dropbox”, “OneDrive-Personal”,
/// “OneDrive-Contoso”, “GoogleDrive-me@example.com”.
fn find_cloud_storage(home: &Path, found: &mut Vec<CloudFolder>) {
    let Ok(entries) = fs::read_dir(home.join("Library/CloudStorage")) else { return };
    let mut names: Vec<String> = entries.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    for name in names {
        let path = home.join("Library/CloudStorage").join(&name);
        if name == "Dropbox" || name.starts_with("Dropbox-") {
            let label = match name.strip_prefix("Dropbox-") {
                Some(team) if team != "Personal" => format!("Dropbox – {team}"),
                _ => "Dropbox".to_string(),
            };
            push(found, "dropbox", label, &path);
        } else if let Some(account) = name.strip_prefix("OneDrive-") {
            push(found, "onedrive", onedrive_label(account), &path);
        } else if name == "OneDrive" {
            push(found, "onedrive", "OneDrive", &path);
        } else if let Some(account) = name.strip_prefix("GoogleDrive-") {
            if let Some(my_drive) = google_my_drive(&path) {
                push(found, "gdrive", format!("Google Drive ({account})"), &my_drive);
            }
        }
    }
}

fn onedrive_label(account: &str) -> String {
    let account = account.trim_start_matches(['-', ' ']).trim();
    if account.is_empty() || account.eq_ignore_ascii_case("personal") {
        "OneDrive".to_string()
    } else {
        format!("OneDrive – {account}")
    }
}

/// Only “My Drive” inside a Google Drive mount takes new files. Its name is translated, so
/// fall back to the first ordinary folder that isn't one of the shared ones.
fn google_my_drive(root: &Path) -> Option<PathBuf> {
    let english = root.join("My Drive");
    if english.is_dir() {
        return Some(english);
    }
    let mut dirs: Vec<PathBuf> = fs::read_dir(root)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            !name.starts_with('.') && name != "Shared drives" && name != "Other computers"
        })
        .map(|e| e.path())
        .collect();
    dirs.sort();
    dirs.into_iter().next()
}

fn find_onedrive(home: &Path, found: &mut Vec<CloudFolder>) {
    // The OneDrive app on Windows sets these for every signed-in account.
    for var in ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"] {
        let Some(dir) = std::env::var_os(var).filter(|v| !v.is_empty()) else { continue };
        let path = PathBuf::from(dir);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        // Work folders are called “OneDrive - Contoso”.
        let label = match name.strip_prefix("OneDrive") {
            Some(rest) => onedrive_label(rest),
            None => "OneDrive".to_string(),
        };
        push(found, "onedrive", label, &path);
    }
    push(found, "onedrive", "OneDrive", &home.join("OneDrive"));
}

fn find_google_drive(home: &Path, found: &mut Vec<CloudFolder>) {
    // Google Drive for desktop on Windows streams to a drive letter (G: by default).
    if cfg!(windows) {
        for letter in b'D'..=b'Z' {
            push(found, "gdrive", "Google Drive", Path::new(&format!("{}:\\My Drive", letter as char)));
        }
    }
    // Mirroring mode, and the old Backup and Sync app.
    push(found, "gdrive", "Google Drive", &home.join("My Drive"));
    push(found, "gdrive", "Google Drive", &home.join("Google Drive"));
}

/// The same folder can turn up twice (info.json and ~/Dropbox, an env var and ~/OneDrive).
fn dedupe(found: Vec<CloudFolder>) -> Vec<CloudFolder> {
    let mut seen = HashSet::new();
    found
        .into_iter()
        .filter(|f| {
            let key = fs::canonicalize(&f.path).unwrap_or_else(|_| PathBuf::from(&f.path));
            seen.insert(key)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_dropbox_info_json() {
        let json = r#"{"business": {"path": "/Users/e/Dropbox (Acme)", "host": 1}, "personal": {"path": "/Users/e/Dropbox"}}"#;
        assert_eq!(
            dropbox_accounts(json),
            vec![
                ("personal".to_string(), "/Users/e/Dropbox".to_string()),
                ("business".to_string(), "/Users/e/Dropbox (Acme)".to_string()),
            ]
        );
        assert!(dropbox_accounts("not json").is_empty());
    }

    #[test]
    fn labels_onedrive_accounts() {
        assert_eq!(onedrive_label("Personal"), "OneDrive");
        assert_eq!(onedrive_label(""), "OneDrive");
        assert_eq!(onedrive_label(" - Contoso"), "OneDrive – Contoso");
        assert_eq!(onedrive_label("Contoso"), "OneDrive – Contoso");
    }

    #[test]
    fn finds_folders_and_skips_duplicates() {
        let home = std::env::temp_dir().join(format!("workspace-cloud-{}", std::process::id()));
        let storage = home.join("Library/CloudStorage");
        fs::create_dir_all(storage.join("OneDrive-Personal")).unwrap();
        fs::create_dir_all(storage.join("GoogleDrive-me@example.com/My Drive")).unwrap();
        fs::create_dir_all(storage.join("GoogleDrive-me@example.com/Shared drives")).unwrap();
        fs::create_dir_all(home.join("Dropbox")).unwrap();

        let mut found = Vec::new();
        find_cloud_storage(&home, &mut found);
        // No info.json, so the test doesn't pick up this machine's own Dropbox.
        find_dropbox(&home, &[], &mut found);
        find_dropbox(&home, &[], &mut found);
        let found = dedupe(found);
        let providers: Vec<_> = found.iter().map(|f| (f.provider, f.label.as_str())).collect();
        assert_eq!(
            providers,
            vec![("gdrive", "Google Drive (me@example.com)"), ("onedrive", "OneDrive"), ("dropbox", "Dropbox")]
        );
        assert!(found[0].path.ends_with("My Drive"));
        fs::remove_dir_all(&home).unwrap();
    }
}
