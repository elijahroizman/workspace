//! The latest GitHub release, and a macOS relaunch that replaces this process
//! instead of opening a second copy of the app.


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
/// feed then returns nothing). Off the main thread, which a slow network would freeze.
#[tauri::command]
pub async fn latest_release() -> Result<ReleaseNotes, String> {
    tauri::async_runtime::spawn_blocking(fetch_latest_release)
        .await
        .map_err(|e| e.to_string())?
}

fn fetch_latest_release() -> Result<ReleaseNotes, String> {
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

/// Where the .deb's install script puts Workspace's APT repository (src-tauri/linux/postinst).
#[cfg(target_os = "linux")]
const APT_SOURCES: &str = "/etc/apt/sources.list.d/workspace.list";

/// Whether this copy came with Workspace's APT repository and it's still on (its `deb` line not
/// commented out), so apt can install new versions.
#[tauri::command]
pub fn apt_updates() -> bool {
    #[cfg(target_os = "linux")]
    {
        let active = std::fs::read_to_string(APT_SOURCES).is_ok_and(|list| list.lines().any(|l| l.trim_start().starts_with("deb ")));
        active && std::path::Path::new("/usr/bin/apt-get").is_file()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Installs the newest Workspace from its APT repository, after polkit asks for the password.
/// Only Workspace's own source is refreshed, so a broken or slow mirror elsewhere can't stop it.
#[tauri::command]
pub async fn apt_upgrade() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let installed = || {
                std::process::Command::new("dpkg-query")
                    .args(["-W", "-f=${Version}", "workspace"])
                    .output()
                    .ok()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .filter(|v| !v.is_empty())
            };
            let before = installed();
            let line = format!(
                "export DEBIAN_FRONTEND=noninteractive; apt-get update -o Dir::Etc::sourcelist={APT_SOURCES} -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 && apt-get install -y --only-upgrade workspace"
            );
            crate::tex::pkexec(&line, "Updating Workspace")?;
            // apt succeeds without doing anything when its repository hasn't got the release yet
            // (the Linux build finishes after the Mac and Windows ones).
            if before.is_some() && installed() == before {
                return Err("The new version isn't in Workspace's APT repository yet. Try again in a few minutes.".into());
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("Updates through apt are for Linux.".into())
    }
}

/// Quote `path` as one shell word.
#[cfg(any(target_os = "macos", test))]
fn sh_quote(path: &std::path::Path) -> String {
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
    // Its own process group, so nothing sent to ours on the way out reaches it.
    // The shell then `exec`s `open`, which asks Launch Services to start the app.
    cmd.process_group(0);
    cmd.spawn().map_err(|_| "Couldn't reopen Workspace.".to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "macos")]
fn launch_bundle() -> Option<std::path::PathBuf> {
    LAUNCH_BUNDLE.get().cloned()
}

#[cfg(target_os = "macos")]
static LAUNCH_BUNDLE: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// Remember the bundle we were launched from, before an update swaps it aside.
#[cfg(target_os = "macos")]
pub fn remember_bundle() {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bundle) = crate::launch_services::bundle_app_dir(&exe) {
            let _ = LAUNCH_BUNDLE.set(bundle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_a_version_prefix() {
        assert_eq!(version_from_tag("v0.3.0"), "0.3.0");
        assert_eq!(version_from_tag("0.3.0"), "0.3.0");
        assert_eq!(version_from_tag("nightly"), "nightly");
    }

    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(sh_quote(std::path::Path::new("/Applications/Workspace.app")), "'/Applications/Workspace.app'");
        assert_eq!(sh_quote(std::path::Path::new("/tmp/O'Hare.app")), "'/tmp/O'\\''Hare.app'");
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
