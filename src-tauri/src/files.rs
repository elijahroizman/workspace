use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

/// Returns the file's bytes as a raw IPC response (no JSON/base64 round trip),
/// so opening a 50 MB PDF costs one copy.
#[tauri::command]
pub fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Couldn't open “{}”: {e}", display_name(&path)))
}

/// Receives raw bytes as the request body and the destination path in the
/// percent-encoded `x-path` header. Writes atomically: a crash or full disk
/// mid-save leaves the original file untouched.
///
/// With an `x-history` header the save is also kept in version history (see history.rs),
/// named by the percent-encoded `x-history-label` if there is one.
#[tauri::command]
pub fn write_file<R: tauri::Runtime>(app: tauri::AppHandle<R>, request: Request<'_>) -> Result<(), String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let encoded = header("x-path").ok_or("Missing destination path")?;
    let path = PathBuf::from(percent_decode(encoded)?);
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw file bytes".into());
    };
    let history = header("x-history").and_then(|_| crate::history::history_root(&app));
    let label = header("x-history-label").map(percent_decode).transpose()?;
    if let Some(root) = &history {
        crate::history::remember_original(root, &path);
    }
    atomic_write(&path, bytes)
        .map_err(|e| format!("Couldn't save “{}”: {e}", display_name(&path.to_string_lossy())))?;
    if let Some(root) = history {
        let disk = crate::history::stamp(&path);
        // Off the save's path: hashing and copying a big file shouldn't hold up the next edit.
        let bytes = bytes.clone();
        std::thread::spawn(move || {
            if let Err(e) = crate::history::record(&root, &path, &bytes, label, disk) {
                eprintln!("version history: {e}");
            }
        });
    }
    Ok(())
}

/// Downloads a small public resource (a video's thumbnail image) for embedding in a
/// presentation. Only https URLs, capped at 10 MB.
#[tauri::command]
pub async fn fetch_bytes(url: String) -> Result<Response, String> {
    if !url.starts_with("https://") {
        return Err("Only https links are supported".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut response = http_agent().get(&url).call().map_err(|e| e.to_string())?;
        let bytes = response
            .body_mut()
            .with_config()
            .limit(10 * 1024 * 1024)
            .read_to_vec()
            .map_err(|e| e.to_string())?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `ureq` is built with `default-features = false, features = ["native-tls"]`,
/// but `ureq::get` still defaults to `TlsProvider::Rustls` and panics on any
/// `https://` connection unless the agent explicitly selects `NativeTls`.
/// The timeout keeps a stalled download from blocking the video insert, which
/// waits for the poster.
pub(crate) fn http_agent() -> &'static ureq::Agent {
    static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| agent(Some(Duration::from_secs(15)), None));
    &AGENT
}

/// For large downloads (plugins): 15 s to connect, 30 s for the reply to start, and 15 minutes
/// for the body, enough for 100 MB on a slow line, so a stalled transfer still ends.
pub(crate) fn download_agent() -> &'static ureq::Agent {
    static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| agent(None, Some(Duration::from_secs(15 * 60))));
    &AGENT
}

fn agent(global: Option<Duration>, body: Option<Duration>) -> ureq::Agent {
    ureq::Agent::config_builder()
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .provider(ureq::tls::TlsProvider::NativeTls)
                .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                .build(),
        )
        .timeout_global(global)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_recv_body(body)
        .build()
        .new_agent()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    exists: bool,
    is_dir: bool,
    size: u64,
    modified_ms: u64,
}

#[tauri::command]
pub fn path_info(path: String) -> PathInfo {
    match fs::metadata(&path) {
        Ok(meta) => PathInfo {
            exists: true,
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        },
        Err(_) => PathInfo { exists: false, is_dir: false, size: 0, modified_ms: 0 },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Folders a document app has no business listing: hidden ones, version control, dependencies.
fn skipped(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "__pycache__" | "target" | "$RECYCLE.BIN" | "System Volume Information")
}

/// A folder's contents for the folder sidebar: subfolders first, then files, each by name
/// (natural order, ignoring case). Hidden files are left out.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(|e| format!("Couldn't open the folder “{}”: {e}", display_name(&path)))?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if skipped(&name) {
                return None;
            }
            // Follows symlinks, so a linked folder opens like a folder.
            let is_dir = fs::metadata(entry.path()).map(|m| m.is_dir()).unwrap_or(false);
            Some(DirEntry { path: entry.path().to_string_lossy().into_owned(), name, is_dir })
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| natural_cmp(&a.name, &b.name)));
    Ok(entries)
}

/// Every file under `root` with one of `extensions`, for searching a folder by name. Stops after
/// `limit` files or 20 folders deep, so pointing it at a home folder can't run away.
#[tauri::command]
pub async fn walk_dir(root: String, extensions: Vec<String>, limit: usize) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let extensions: Vec<String> = extensions.iter().map(|e| e.to_lowercase()).collect();
        let mut out = Vec::new();
        let mut stack = vec![(PathBuf::from(&root), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            let Ok(read) = fs::read_dir(&dir) else { continue };
            let mut subdirs = Vec::new();
            for entry in read.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if skipped(&name) {
                    continue;
                }
                let Ok(kind) = entry.file_type() else { continue };
                if kind.is_dir() {
                    if depth < 20 {
                        subdirs.push(entry.path());
                    }
                } else if let Some(ext) = Path::new(&name).extension() {
                    if extensions.contains(&ext.to_string_lossy().to_lowercase()) {
                        out.push(entry.path().to_string_lossy().into_owned());
                        if out.len() >= limit {
                            return out;
                        }
                    }
                }
            }
            subdirs.sort();
            stack.extend(subdirs.into_iter().rev().map(|d| (d, depth + 1)));
        }
        out
    })
    .await
    .map_err(|e| e.to_string())
}

/// "file2" before "file10", ignoring case.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(c) = a.peek().copied().filter(|c| c.is_ascii_digit()) {
                    na.push(c);
                    a.next();
                }
                let mut nb = String::new();
                while let Some(c) = b.peek().copied().filter(|c| c.is_ascii_digit()) {
                    nb.push(c);
                    b.next();
                }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
                a.next();
                b.next();
            }
        }
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    // Saving through a symlink changes the file it points to and keeps the link.
    let linked = fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink());
    let resolved = if linked { fs::canonicalize(path).ok() } else { None };
    let path = resolved.as_deref().unwrap_or(path);
    // Replacing the file would succeed on a Mac or Linux, since only its folder needs to be
    // writable, but a read-only file is one someone meant not to change.
    if fs::metadata(path).is_ok_and(|m| m.permissions().readonly()) {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "the file is read-only. Use Save As to save a copy"));
    }
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.workspace-saving"));
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    // Keep the original file's permissions when overwriting.
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })?;
    // So the rename itself survives a power cut.
    #[cfg(unix)]
    if let Ok(dir) = fs::File::open(dir) {
        let _ = dir.sync_all();
    }
    Ok(())
}

pub(crate) fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "Invalid path encoding")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Invalid path encoding".into())
}

fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_unicode_paths() {
        assert_eq!(percent_decode("%2FUsers%2Fe%2FR%C3%A9sum%C3%A9.docx").unwrap(), "/Users/e/Résumé.docx");
        assert_eq!(percent_decode("plain").unwrap(), "plain");
    }

    #[test]
    fn sorts_names_naturally() {
        let mut names = vec!["file10.md", "File2.md", "file1.md", "notes.md"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["file1.md", "File2.md", "file10.md", "notes.md"]);
    }

    #[test]
    fn writes_atomically() {
        let dir = std::env::temp_dir().join(format!("workspace-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        atomic_write(&file, b"one").unwrap();
        atomic_write(&file, b"two").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"two");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "temp file left behind");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_read_only_files() {
        let dir = std::env::temp_dir().join(format!("workspace-test-ro-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        fs::write(&file, b"one").unwrap();
        let mut perms = fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&file, perms.clone()).unwrap();
        assert!(atomic_write(&file, b"two").is_err());
        assert_eq!(fs::read(&file).unwrap(), b"one");
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&file, perms).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn saves_through_symlinks() {
        let dir = std::env::temp_dir().join(format!("workspace-test-link-{}", std::process::id()));
        fs::create_dir_all(dir.join("real")).unwrap();
        let target = dir.join("real/a.md");
        let link = dir.join("a.md");
        fs::write(&target, b"one").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        atomic_write(&link, b"two").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&target).unwrap(), b"two");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn https_agent_uses_native_tls_without_panicking() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let _ = listener.accept();
        });
        // Calling `ureq::get` here panics because `ureq` defaults to `TlsProvider::Rustls`
        // while only the `native-tls` feature is enabled. `http_agent()` should instead
        // attempt a native-tls handshake and return a normal `Err` when the peer closes.
        let result = http_agent().get(&format!("https://127.0.0.1:{}/", addr.port())).call();
        assert!(result.is_err());
    }
}
