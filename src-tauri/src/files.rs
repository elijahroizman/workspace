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
#[tauri::command]
pub fn write_file(request: Request<'_>) -> Result<(), String> {
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing destination path")?;
    let path = PathBuf::from(percent_decode(encoded)?);
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw file bytes".into());
    };
    atomic_write(&path, bytes)
        .map_err(|e| format!("Couldn't save “{}”: {e}", display_name(&path.to_string_lossy())))
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
fn http_agent() -> &'static ureq::Agent {
    static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
        ureq::Agent::config_builder()
            .tls_config(
                ureq::tls::TlsConfig::builder()
                    .provider(ureq::tls::TlsProvider::NativeTls)
                    .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                    .build(),
            )
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .new_agent()
    });
    &AGENT
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    exists: bool,
    size: u64,
    modified_ms: u64,
}

#[tauri::command]
pub fn path_info(path: String) -> PathInfo {
    match fs::metadata(&path) {
        Ok(meta) => PathInfo {
            exists: true,
            size: meta.len(),
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        },
        Err(_) => PathInfo { exists: false, size: 0, modified_ms: 0 },
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
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
    })
}

fn percent_decode(input: &str) -> Result<String, String> {
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
