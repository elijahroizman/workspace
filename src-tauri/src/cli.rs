//! The `workspace` shell command, like VS Code's `code`: `workspace .` opens the folder you're
//! in, `workspace notes.md` a file.
//!
//! On a Mac it's a small script (cli/workspace.sh) installed as /usr/local/bin/workspace. It
//! hands its arguments to `open -b <bundle id>`, so Launch Services finds the app wherever it is
//! and delivers the paths to the running copy (RunEvent::Opened in lib.rs). Writing to
//! /usr/local/bin usually needs an administrator, so the copy falls back to asking for one
//! through `osascript`, as VS Code does.
//!
//! On Linux the .deb already puts `workspace` on the PATH, and Windows has no installer step
//! yet. A second launch there hands its arguments to the running copy (single-instance plugin).

use serde::Serialize;
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
const SCRIPT: &str = include_str!("../cli/workspace.sh");
#[cfg(target_os = "macos")]
const TARGET: &str = "/usr/local/bin/workspace";
/// Every script Workspace installs says so, so it never removes or replaces someone else's.
#[cfg(target_os = "macos")]
const MARKER: &str = "# Installed by Workspace";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    /// This system can have the command installed from Settings.
    supported: bool,
    installed: bool,
    /// Something else called `workspace` is already where the command would go.
    taken: bool,
    path: String,
}

#[tauri::command]
pub fn cli_status<R: Runtime>(app: AppHandle<R>) -> CliStatus {
    let _ = &app;
    #[cfg(target_os = "macos")]
    {
        let existing = std::fs::read_to_string(TARGET).ok();
        let ours = existing.as_deref().is_some_and(|s| s.contains(MARKER));
        CliStatus { supported: true, installed: ours, taken: std::path::Path::new(TARGET).exists() && !ours, path: TARGET.into() }
    }
    #[cfg(target_os = "linux")]
    {
        let path = "/usr/bin/workspace";
        CliStatus { supported: false, installed: std::path::Path::new(path).exists(), taken: false, path: path.into() }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        CliStatus { supported: false, installed: false, taken: false, path: String::new() }
    }
}

/// Put the command in /usr/local/bin, asking for an administrator's password if need be.
#[tauri::command]
pub async fn cli_install<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = cli_status(app.clone());
        if status.taken {
            return Err(format!("{TARGET} is another program, so Workspace left it alone. Remove or rename it, then try again."));
        }
        let script = SCRIPT
            .replace("@BUNDLE_ID@", &app.config().identifier)
            .replace("@VERSION@", &app.package_info().version.to_string());
        tauri::async_runtime::spawn_blocking(move || install_script(&script))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Installing the command is only needed on a Mac.".into())
    }
}

#[tauri::command]
pub async fn cli_uninstall<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !cli_status(app).installed {
            return Ok(());
        }
        tauri::async_runtime::spawn_blocking(|| {
            match std::fs::remove_file(TARGET) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => as_admin(&format!("rm -f {}", shell_quote(TARGET))),
                Err(e) => Err(e.to_string()),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn install_script(script: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let direct = (|| -> std::io::Result<()> {
        std::fs::create_dir_all("/usr/local/bin")?;
        let tmp = format!("{TARGET}.workspace-installing");
        std::fs::write(&tmp, script)?;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
        std::fs::rename(&tmp, TARGET).inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })
    })();
    match direct {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            // Write it somewhere we can, then copy it into place as an administrator.
            let tmp = std::env::temp_dir().join(format!("workspace-cli-{}", std::process::id()));
            std::fs::write(&tmp, script).map_err(|e| e.to_string())?;
            let result = as_admin(&format!(
                "mkdir -p /usr/local/bin && cp {} {} && chmod 755 {}",
                shell_quote(&tmp.to_string_lossy()),
                shell_quote(TARGET),
                shell_quote(TARGET)
            ));
            let _ = std::fs::remove_file(&tmp);
            result
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Run a shell command as an administrator; macOS asks for the password with its own dialog.
#[cfg(target_os = "macos")]
fn as_admin(command: &str) -> Result<(), String> {
    let applescript = format!(
        "do shell script \"{}\" with prompt \"Workspace wants to install the workspace command.\" with administrator privileges",
        command.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &applescript])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr);
    // -128: the password dialog was cancelled.
    if message.contains("-128") {
        return Err("cancelled".into());
    }
    Err(message.trim().to_string())
}

#[cfg(any(target_os = "macos", test))]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Paths a second launch was given (`workspace notes.md` on Windows or Linux), made absolute
/// against the directory it was started in. (A Mac hands paths to the running app itself.)
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn paths_from_args(args: &[String], cwd: &str) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| std::fs::canonicalize(std::path::Path::new(cwd).join(arg)).ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_for_the_shell() {
        assert_eq!(shell_quote("/tmp/it's here"), "'/tmp/it'\\''s here'");
    }

    #[test]
    fn resolves_relative_args() {
        let dir = std::env::temp_dir().join(format!("workspace-cli-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "").unwrap();
        let args = vec!["workspace".to_string(), "a.md".into(), "--flag".into(), "missing.md".into(), ".".into()];
        let paths = paths_from_args(&args, &dir.to_string_lossy());
        assert_eq!(paths.len(), 2);
        assert!(paths[0].ends_with("a.md"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
