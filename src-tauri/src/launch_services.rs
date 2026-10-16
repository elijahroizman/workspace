//! Finder writes the version after an app's name in Open With when more than one
//! bundle with that name can open the file. Workspace (0.3.0) beside Workspace
//! (0.1.0) means Launch Services still has an older copy: a previous install, a
//! build under `src-tauri/target`, or a disk image that is still mounted.
//! Launching this copy unregisters the others. Their files stay on disk.

use std::path::{Component, Path, PathBuf};

/// `Workspace.app` for a bundled executable at `….app/Contents/MacOS/<bin>`.
/// `tauri dev` runs the bare binary and has nothing to register.
pub fn bundle_app_dir(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    let app = contents.parent()?;
    if app.extension()? != "app" {
        return None;
    }
    Some(app.to_path_buf())
}

/// Cargo's output directory when `app` is a bundle produced by `tauri build`.
pub fn cargo_target_dir(app: &Path) -> Option<PathBuf> {
    let components: Vec<Component> = app.components().collect();
    let target_at = components.iter().position(|c| c.as_os_str() == "target")?;
    let rest = &components[target_at + 1..];
    let build_output = rest
        .iter()
        .any(|c| matches!(c.as_os_str().to_str(), Some("debug" | "release" | "bundle")));
    if !build_output {
        return None;
    }
    Some(components[..=target_at].iter().collect())
}

/// Other registrations to remove. `ours` stays, including when Launch Services
/// reports it twice under different spellings of the same path.
pub fn registrations_to_drop(ours: &Path, found: &[PathBuf]) -> Vec<PathBuf> {
    let ours_key = path_identity(ours);
    let mut seen = std::collections::BTreeSet::new();
    let mut stale = Vec::new();
    for path in found {
        let key = path_identity(path);
        if key == ours_key || !seen.insert(key) {
            continue;
        }
        stale.push(path.clone());
    }
    stale.sort();
    stale
}

/// Spotlight index to silence for a build copy, so it does not walk back into
/// Open With. Never the directory that holds the running app.
pub fn spotlight_ignore_dir(running_app: &Path, other_app: &Path) -> Option<PathBuf> {
    let other_target = cargo_target_dir(other_app)?;
    if cargo_target_dir(running_app) == Some(other_target.clone()) {
        return None;
    }
    if !other_target.is_dir() {
        return None;
    }
    Some(other_target)
}

fn path_identity(path: &Path) -> PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical;
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Bundle ids are reverse-DNS. Anything else is refused before it is placed in
/// an `mdfind` query.
fn safe_bundle_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

#[cfg(target_os = "macos")]
pub fn claim_single_open_with_entry(bundle_id: &str) {
    if !safe_bundle_id(bundle_id) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(ours) = bundle_app_dir(&exe) else {
        return;
    };

    let mut found = application_urls(bundle_id);
    found.extend(spotlight_copies(bundle_id));
    for path in registrations_to_drop(&ours, &found) {
        unregister(&path);
        if let Some(target) = spotlight_ignore_dir(&ours, &path) {
            let _ = std::fs::write(target.join(".metadata_never_index"), b"");
        }
    }
    register(&ours);
}

#[cfg(target_os = "macos")]
fn lsregister() -> &'static Path {
    Path::new("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
}

#[cfg(target_os = "macos")]
fn register(app: &Path) {
    let _ = std::process::Command::new(lsregister())
        .arg("-f")
        .arg(app)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(target_os = "macos")]
fn unregister(app: &Path) {
    // `-f` removes the record even when the bundle is already gone, which is
    // how an old version stays in the menu after the file was replaced.
    let _ = std::process::Command::new(lsregister())
        .args(["-f", "-u"])
        .arg(app)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(target_os = "macos")]
fn spotlight_copies(bundle_id: &str) -> Vec<PathBuf> {
    let query = format!("kMDItemCFBundleIdentifier == \"{bundle_id}\"");
    let Ok(output) = std::process::Command::new("mdfind")
        .arg(query)
        .stdin(std::process::Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(target_os = "macos")]
fn application_urls(bundle_id: &str) -> Vec<PathBuf> {
    use std::ffi::{c_char, c_void, CString};
    use std::os::unix::ffi::OsStrExt;

    const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            c_str: *const c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFRelease(value: *const c_void);
        fn CFArrayGetCount(array: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
        fn CFURLGetFileSystemRepresentation(
            url: *const c_void,
            resolve_against_base: u8,
            buffer: *mut u8,
            max_buf_len: isize,
        ) -> u8;
    }

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyApplicationURLsForBundleIdentifier(
            bundle_identifier: *const c_void,
            error: *mut *const c_void,
        ) -> *const c_void;
    }

    let Ok(id) = CString::new(bundle_id) else {
        return Vec::new();
    };
    // SAFETY: `id` outlives the CoreFoundation call. Created CF objects are
    // released here. Array elements are borrowed from `urls` and are not released.
    unsafe {
        let cf_id = CFStringCreateWithCString(std::ptr::null(), id.as_ptr(), UTF8);
        if cf_id.is_null() {
            return Vec::new();
        }
        let mut error: *const c_void = std::ptr::null();
        let urls = LSCopyApplicationURLsForBundleIdentifier(cf_id, &mut error);
        CFRelease(cf_id);
        if !error.is_null() {
            CFRelease(error);
        }
        if urls.is_null() {
            return Vec::new();
        }
        let count = CFArrayGetCount(urls).max(0);
        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let url = CFArrayGetValueAtIndex(urls, index);
            if url.is_null() {
                continue;
            }
            let mut buffer = [0u8; 8192];
            let ok = CFURLGetFileSystemRepresentation(
                url,
                1,
                buffer.as_mut_ptr(),
                buffer.len() as isize,
            );
            if ok == 0 {
                continue;
            }
            let Some(len) = buffer.iter().position(|&byte| byte == 0) else {
                continue;
            };
            if len == 0 {
                continue;
            }
            paths.push(PathBuf::from(std::ffi::OsStr::from_bytes(&buffer[..len])));
        }
        CFRelease(urls);
        paths
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn parts(components: &[&str]) -> PathBuf {
        components.iter().collect()
    }

    #[test]
    fn bundled_executable_resolves_to_the_app() {
        let exe = parts(&[
            "Applications",
            "Workspace.app",
            "Contents",
            "MacOS",
            "workspace",
        ]);
        assert_eq!(
            bundle_app_dir(&exe),
            Some(parts(&["Applications", "Workspace.app"]))
        );
    }

    #[test]
    fn dev_binary_is_not_a_bundle() {
        assert_eq!(
            bundle_app_dir(&parts(&["src-tauri", "target", "debug", "workspace"])),
            None
        );
        assert_eq!(
            bundle_app_dir(&parts(&["Workspace.app", "workspace"])),
            None
        );
    }

    #[test]
    fn cargo_target_dir_is_only_a_build_tree() {
        assert_eq!(
            cargo_target_dir(&parts(&[
                "src-tauri",
                "target",
                "release",
                "bundle",
                "macos",
                "Workspace.app",
            ])),
            Some(parts(&["src-tauri", "target"]))
        );
        assert_eq!(
            cargo_target_dir(&parts(&[
                "src-tauri",
                "target",
                "aarch64-apple-darwin",
                "release",
                "bundle",
                "macos",
                "Workspace.app",
            ])),
            Some(parts(&["src-tauri", "target"]))
        );
        assert_eq!(
            cargo_target_dir(&parts(&["Applications", "Workspace.app"])),
            None
        );
        assert_eq!(
            cargo_target_dir(&parts(&["notes", "target", "readme.md"])),
            None
        );
    }

    #[test]
    fn keeps_the_running_copy_and_drops_the_other() {
        let root = std::env::temp_dir().join(format!("workspace-ls-{}", std::process::id()));
        let installed = root.join("Applications/Workspace.app");
        let built = root.join("src-tauri/target/release/bundle/macos/Workspace.app");
        fs::create_dir_all(&installed).unwrap();
        fs::create_dir_all(&built).unwrap();

        let stale = registrations_to_drop(
            &installed,
            &[installed.clone(), built.clone(), installed.clone()],
        );
        assert_eq!(stale, vec![built.clone()]);

        let gone = root.join("missing/Workspace.app");
        let stale = registrations_to_drop(&installed, &[installed.clone(), gone.clone()]);
        assert_eq!(stale, vec![gone]);

        assert_eq!(
            spotlight_ignore_dir(&installed, &built),
            Some(root.join("src-tauri/target"))
        );
        assert_eq!(spotlight_ignore_dir(&built, &installed), None);

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn bundle_id_is_safe_for_the_spotlight_query() {
        assert!(safe_bundle_id("com.eliroizman.workspace"));
        assert!(!safe_bundle_id(""));
        assert!(!safe_bundle_id(".workspace"));
        assert!(!safe_bundle_id("com.eli\";touch /tmp/x"));
    }
}
