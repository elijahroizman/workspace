//! The latest GitHub release, and a macOS relaunch that replaces this process
//! instead of opening a second copy of the app.

use std::path::{Path, PathBuf};

use serde::Serialize;

const LATEST_RELEASE: &str = "https://api.github.com/repos/elijahroizman/workspace/releases/latest";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    version: String,
    name: String,
    notes: String,
    url: String,
    published_at: Option<String>,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
}

/// The `.app` bundle that contains `exe`, when `exe` is `Bundle.app/Contents/MacOS/name`.
pub fn app_bundle(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    let bundle = contents.parent()?;
    if bundle.extension()? != "app" {
        return None;
    }
    Some(bundle.to_path_buf())
}

fn version_from_tag(tag: &str) -> String {
    match tag.strip_prefix('v') {
        Some(rest) if rest.starts_with(|c: char| c.is_ascii_digit()) => rest.to_string(),
        _ => tag.to_string(),
    }
}

fn notes_from_release(release: GithubRelease) -> ReleaseNotes {
    let version = version_from_tag(&release.tag_name);
    let name = release.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("Workspace {version}"));
    ReleaseNotes {
        version,
        name,
        notes: release.body.unwrap_or_default(),
        url: release.html_url,
        published_at: release.published_at,
    }
}

/// The latest GitHub release: version, notes and page. This is the changelog the
/// update panel shows, including when this copy is already current (the updater
/// feed then returns nothing).
#[tauri::command]
pub fn latest_release() -> Result<ReleaseNotes, String> {
    let mut response = crate::files::http_agent()
        .get(LATEST_RELEASE)
        .header("User-Agent", "Workspace")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|_| "Couldn't reach GitHub. Check your connection and try again.".to_string())?;
    let bytes = response
        .body_mut()
        .with_config()
        .limit(200 * 1024)
        .read_to_vec()
        .map_err(|_| "Couldn't read the release notes.".to_string())?;
    let release: GithubRelease = serde_json::from_slice(&bytes).map_err(|_| "Couldn't read the release notes.".to_string())?;
    Ok(notes_from_release(release))
}

/// Quote `path` as one shell word.
fn sh_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

/// Quit, then open this same bundle once the process is gone.
///
/// Tauri's relaunch runs `open -n` while this process is still alive. `-n` means
/// a new instance, so macOS shows a second window and a second Dock icon (the
/// running app and the one just opened). The helper waits until this process has
/// exited, then `open`s the bundle without `-n`. Launch Services starts one copy
/// in the same Dock slot, and the window-state plugin has already saved the frame
/// on `RunEvent::Exit`.
#[tauri::command]
pub fn relaunch_in_place(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        relaunch_macos(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("This restart is only used on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
fn relaunch_macos(app: tauri::AppHandle) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    // The path recorded at launch. After the updater swaps the bundle, this path
    // is the new app; resolving `current_exe` again can follow the old inode into
    // the temp directory the previous copy was moved to.
    let bundle = launch_bundle().ok_or("Workspace is not running from an app bundle.")?;
    let pid = std::process::id();
    // A short pause after the process dies lets Launch Services drop the old
    // registration. Opening any sooner focuses the copy that is still quitting.
    let script = format!(
        "while kill -0 {pid} 2>/dev/null; do sleep 0.15; done; sleep 0.5; exec /usr/bin/open {}",
        sh_quote(&bundle)
    );

    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // A new session survives this process exiting. The shell then `exec`s `open`,
    // which asks Launch Services to start the app and exits.
    unsafe {
        cmd.pre_exec(|| {
            // SAFETY: setsid is async-signal-safe, and pre_exec runs in the child
            // before anything else, so it cannot race with other threads.
            if unsafe { setsid() } == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn().map_err(|_| "Couldn't reopen Workspace.".to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn setsid() -> i32;
}

#[cfg(target_os = "macos")]
fn launch_bundle() -> Option<PathBuf> {
    LAUNCH_BUNDLE.get().cloned()
}

#[cfg(target_os = "macos")]
static LAUNCH_BUNDLE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Remember the bundle we were launched from, before an update swaps it aside.
#[cfg(target_os = "macos")]
pub fn remember_bundle() {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bundle) = app_bundle(&exe) {
            let _ = LAUNCH_BUNDLE.set(bundle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_app_bundle() {
        let exe = Path::new("/Applications/Workspace.app/Contents/MacOS/workspace");
        assert_eq!(app_bundle(exe).unwrap(), Path::new("/Applications/Workspace.app"));
    }

    #[test]
    fn ignores_a_dev_binary() {
        assert!(app_bundle(Path::new("/tmp/target/debug/workspace")).is_none());
        assert!(app_bundle(Path::new("/Applications/Workspace.app/Contents/workspace")).is_none());
    }

    #[test]
    fn strips_a_version_prefix() {
        assert_eq!(version_from_tag("v0.3.0"), "0.3.0");
        assert_eq!(version_from_tag("0.3.0"), "0.3.0");
        assert_eq!(version_from_tag("nightly"), "nightly");
    }

    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(sh_quote(Path::new("/Applications/Workspace.app")), "'/Applications/Workspace.app'");
        assert_eq!(sh_quote(Path::new("/tmp/O'Hare.app")), "'/tmp/O'\\''Hare.app'");
    }

    #[test]
    fn reads_release_notes() {
        let release = GithubRelease {
            tag_name: "v0.4.0".into(),
            name: Some("Workspace v0.4.0".into()),
            body: Some("## Changes\n\n- Fixes the Dock icon".into()),
            html_url: "https://github.com/elijahroizman/workspace/releases/tag/v0.4.0".into(),
            published_at: Some("2026-10-16T00:00:00Z".into()),
        };
        let notes = notes_from_release(release);
        assert_eq!(notes.version, "0.4.0");
        assert!(notes.notes.contains("Dock icon"));
        assert_eq!(notes.published_at.as_deref(), Some("2026-10-16T00:00:00Z"));
    }
}
