//! The LaTeX plugin compiles with the TeX that's installed on the system (MacTeX on a Mac,
//! MiKTeX or TeX Live on Windows). This finds it, runs it, and installs it when it's missing.
//!
//! A compile copies the editor's text to `<cache>/tex/<tab>/<job>.tex` and runs the engine
//! from the document's own folder, so `\input` and `\includegraphics` find the files beside it,
//! while the .aux, .log and .pdf go to the cache instead of next to the user's file. The .aux
//! stays between compiles, so references settle without running TeX twice every time.

// Installing is for macOS and Windows only.
#![cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code, unused_imports))]

use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::http::header;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const ENGINES: [&str; 3] = ["pdflatex", "xelatex", "lualatex"];
/// A runaway document (an endless loop in a macro) is stopped after this long.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_RUNS: usize = 4;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexStatus {
    installed: bool,
    distribution: Option<String>,
    engines: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    received: u64,
    total: u64,
}

/// Folders TeX may be in. An app started from the Dock or Start menu doesn't get the shell's
/// PATH (and one started before TeX was installed has an old one), so the usual places are
/// checked too.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.push("/Library/TeX/texbin".into());
        dirs.extend(texlive_bins(Path::new("/usr/local/texlive"), "universal-darwin"));
        dirs.push("/opt/homebrew/bin".into());
        dirs.push("/usr/local/bin".into());
    }
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join(r"Programs\MiKTeX\miktex\bin\x64"));
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(programs) = std::env::var_os(var) {
                dirs.push(PathBuf::from(programs).join(r"MiKTeX\miktex\bin\x64"));
            }
        }
        dirs.extend(texlive_bins(Path::new(r"C:\texlive"), "windows"));
        dirs.extend(texlive_bins(Path::new(r"C:\texlive"), "win64"));
        dirs.extend(texlive_bins(Path::new(r"C:\texlive"), "win32"));
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        dirs.extend(texlive_bins(Path::new("/usr/local/texlive"), "x86_64-linux"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs
}

/// `<root>/<year>/bin/<platform>`, newest year first.
fn texlive_bins(root: &Path, platform: &str) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut years: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.len() == 4 && n.bytes().all(|b| b.is_ascii_digit())))
        .collect();
    years.sort();
    years.into_iter().rev().map(|y| y.join("bin").join(platform)).collect()
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// The folder holding a TeX program, and the program's path.
fn find(name: &str) -> Option<PathBuf> {
    let file = exe(name);
    search_dirs().into_iter().map(|dir| dir.join(&file)).find(|p| p.is_file())
}

/// A command that doesn't flash a console window on Windows.
fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // TeX's own programs (bibtex, kpsewhich) must be the ones beside the engine.
    if let Some(dir) = program.parent().filter(|d| !d.as_os_str().is_empty()) {
        let mut path = OsString::from(dir.as_os_str());
        if let Some(old) = std::env::var_os("PATH") {
            path.push(if cfg!(windows) { ";" } else { ":" });
            path.push(old);
        }
        cmd.env("PATH", path);
    }
    cmd
}

/// "TeX Live 2026" or "MiKTeX 25.12", from the first line of `pdflatex --version`.
fn distribution(engine: &Path) -> Option<String> {
    let output = command(engine).arg("--version").stdin(Stdio::null()).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?;
    let start = first.rfind('(')? + 1;
    let end = first[start..].find(')')? + start;
    Some(first[start..end].trim().to_string()).filter(|s| !s.is_empty())
}

/// Whether an engine is MiKTeX's, remembered per program so each compile doesn't ask again.
fn is_miktex(program: &Path) -> bool {
    static SEEN: std::sync::Mutex<Vec<(PathBuf, bool)>> = std::sync::Mutex::new(Vec::new());
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, miktex)) = seen.iter().find(|(p, _)| p == program) {
        return *miktex;
    }
    let miktex = distribution(program).is_some_and(|d| d.contains("MiKTeX"));
    seen.push((program.to_path_buf(), miktex));
    miktex
}

fn status() -> TexStatus {
    let engines: Vec<String> = ENGINES.iter().filter(|e| find(e).is_some()).map(|e| e.to_string()).collect();
    let distribution = engines.first().and_then(|e| find(e)).and_then(|p| distribution(&p));
    TexStatus { installed: !engines.is_empty(), distribution, engines }
}

#[tauri::command]
pub async fn tex_status() -> TexStatus {
    tauri::async_runtime::spawn_blocking(status).await.unwrap_or(TexStatus { installed: false, distribution: None, engines: Vec::new() })
}

/// A tab id or file stem, reduced to characters that are safe in a folder name and to TeX.
fn safe_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(64).collect();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

/// Runs a program to completion, killing it after COMPILE_TIMEOUT.
fn run(mut cmd: Command) -> Result<bool, String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Couldn't start TeX: {e}"))?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(status.success());
        }
        if started.elapsed() > COMPILE_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("TeX took more than two minutes and was stopped.".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn read_lossy(path: &Path) -> String {
    fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default()
}

fn needs_rerun(log: &str) -> bool {
    log.contains("Rerun to get")
        || log.contains("Label(s) may have changed")
        || log.contains("Please rerun LaTeX")
        || log.contains("Rerun LaTeX")
        || log.contains("(rerunfilecheck)")
}

fn compile(build_root: PathBuf, key: &str, source: &str, dir: Option<&str>, engine: &str, job: &str) -> Result<(Option<Vec<u8>>, PathBuf, String), String> {
    if !ENGINES.contains(&engine) {
        return Err(format!("Unknown TeX engine “{engine}”."));
    }
    let program = find(engine).ok_or_else(|| {
        if find("pdflatex").is_some() {
            format!("{engine} isn't installed. Use pdflatex, or add {engine} to your TeX.")
        } else {
            "TeX isn't installed.".to_string()
        }
    })?;
    let build = build_root.join(safe_name(key, "document"));
    fs::create_dir_all(&build).map_err(|e| e.to_string())?;
    let job = safe_name(job, "document");
    let tex = build.join(format!("{job}.tex"));
    fs::write(&tex, source).map_err(|e| e.to_string())?;
    let pdf = build.join(format!("{job}.pdf"));
    let log_path = build.join(format!("{job}.log"));
    // A failed compile mustn't hand back the last good PDF as if it were new.
    let _ = fs::remove_file(&pdf);

    let cwd = dir.map(PathBuf::from).filter(|d| d.is_dir()).unwrap_or_else(|| build.clone());
    let miktex = is_miktex(&program);
    let latex = || {
        let mut cmd = command(&program);
        // One message per log line, so errors can be read back (TeX Live wraps at 79 otherwise).
        cmd.current_dir(&cwd)
            .env("max_print_line", "10000")
            .env("error_line", "254")
            .env("half_error_line", "238")
            .arg("-interaction=nonstopmode")
            .arg("-file-line-error")
            .arg(format!("-output-directory={}", build.display()));
        if miktex {
            // Packages the document needs install by themselves instead of asking.
            cmd.arg("--enable-installer");
        }
        cmd.arg(&tex);
        cmd
    };

    let mut bib_done = false;
    for _ in 0..MAX_RUNS {
        run(latex())?;
        let log = read_lossy(&log_path);
        if !bib_done {
            bib_done = true;
            let aux = read_lossy(&build.join(format!("{job}.aux")));
            let bbl = build.join(format!("{job}.bbl"));
            let bcf = build.join(format!("{job}.bcf"));
            let biber = bcf.is_file() && (!bbl.is_file() || log.contains("Please (re)run Biber"));
            let bibtex = !bcf.is_file() && aux.contains("\\bibdata") && (!bbl.is_file() || log.contains("Citation") && log.contains("undefined"));
            if biber || bibtex {
                let tool = if biber { "biber" } else { "bibtex" };
                if let Some(program) = find(tool) {
                    let mut cmd = command(&program);
                    if biber {
                        cmd.current_dir(&build).arg("--input-directory").arg(&cwd).arg(&job);
                    } else {
                        // bibtex reads .bib files from where it runs; BIBINPUTS adds the document's folder.
                        let sep = if cfg!(windows) { ";" } else { ":" };
                        let mut inputs = OsString::from(cwd.as_os_str());
                        inputs.push(sep);
                        cmd.current_dir(&build).env("BIBINPUTS", inputs).arg(&job);
                    }
                    run(cmd)?;
                    continue;
                }
            }
        }
        if !needs_rerun(&log) {
            break;
        }
    }
    let log = read_lossy(&log_path);
    Ok((fs::read(&pdf).ok(), tex, log))
}

/// Compiles and answers in one binary message: the PDF's length (u32, little-endian; 0 for
/// none), the PDF, the compiled file's path (u32 length, UTF-8; the log names it in errors),
/// then the log as UTF-8.
#[tauri::command]
pub async fn tex_compile<R: Runtime>(app: AppHandle<R>, key: String, source: String, dir: Option<String>, engine: String, job: String) -> Result<Response, String> {
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("tex");
    let (pdf, file, log) = tauri::async_runtime::spawn_blocking(move || compile(root, &key, &source, dir.as_deref(), &engine, &job))
        .await
        .map_err(|e| e.to_string())??;
    let pdf = pdf.unwrap_or_default();
    let file = file.to_string_lossy();
    let mut out = Vec::with_capacity(8 + pdf.len() + file.len() + log.len());
    out.extend_from_slice(&(pdf.len() as u32).to_le_bytes());
    out.extend_from_slice(&pdf);
    out.extend_from_slice(&(file.len() as u32).to_le_bytes());
    out.extend_from_slice(file.as_bytes());
    out.extend_from_slice(log.as_bytes());
    Ok(Response::new(out))
}

/// A closed tab's build folder.
#[tauri::command]
pub fn tex_forget<R: Runtime>(app: AppHandle<R>, key: String) {
    if let Ok(root) = app.path().app_cache_dir() {
        let _ = fs::remove_dir_all(root.join("tex").join(safe_name(&key, "document")));
    }
}

// ── Installing

fn download_to(url: &str, to: &Path, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let failed = |_| "Couldn't download TeX. Check your connection and try again.".to_string();
    let mut response = crate::files::download_agent().get(url).header("User-Agent", "Workspace").call().map_err(failed)?;
    let total = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let mut reader = response.body_mut().with_config().limit(u64::MAX).reader();
    let mut file = fs::File::create(to).map_err(|e| e.to_string())?;
    let mut chunk = vec![0u8; 1024 * 1024];
    let mut received = 0u64;
    let mut last = Instant::now();
    loop {
        let n = reader.read(&mut chunk).map_err(|_| "The TeX download was interrupted.".to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&chunk[..n]).map_err(|e| format!("Couldn't save the TeX installer: {e}"))?;
        received += n as u64;
        if last.elapsed() > Duration::from_millis(200) {
            last = Instant::now();
            progress(received, total);
        }
    }
    progress(received, total);
    if total > 0 && received != total {
        return Err("The TeX download was interrupted.".into());
    }
    Ok(())
}

/// The MiKTeX installer Workspace offers, and its SHA-256 from miktex.org/download. MiKTeX
/// doesn't code-sign it, so the checksum is what vouches for it. CTAN keeps old versions, so
/// this keeps working until an app update moves it on.
#[cfg_attr(not(windows), allow(dead_code))]
const MIKTEX: (&str, &str) = ("basic-miktex-25.12-x64.exe", "14b42dd9f4b4a7813a8bfd69c8f99316c2888cc4ee26f631f397e163d85d6c62");

/// MacTeX's packages are signed by its maintainer's Developer ID (Team ID RBGCY5RJWM).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const MACTEX_SIGNER: &str = "Developer ID Installer: Richard Koch (RBGCY5RJWM)";

#[cfg_attr(not(windows), allow(dead_code))]
fn sha256_hex(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(target_os = "macos")]
fn install(app: &AppHandle<impl Runtime>, variant: &str, dir: &Path) -> Result<(), String> {
    let name = match variant {
        "basictex" => "BasicTeX.pkg",
        _ => "MacTeX.pkg",
    };
    let pkg = dir.join(name);
    let emit = |stage, received, total| {
        let _ = app.emit("tex-progress", Progress { stage, received, total });
    };
    download_to(&format!("https://mirror.ctan.org/systems/mac/mactex/{name}"), &pkg, |r, t| emit("download", r, t))?;
    emit("verify", 0, 0);
    // A signature macOS trusts, from MacTeX's own Developer ID.
    let check = Command::new("/usr/sbin/pkgutil").arg("--check-signature").arg(&pkg).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&check.stdout);
    if !check.status.success() || !text.contains("signed by a developer certificate issued by Apple") || !text.contains(MACTEX_SIGNER) {
        return Err("The TeX installer's signature didn't check out, so it wasn't installed.".into());
    }
    emit("install", 0, 0);
    // macOS asks for an administrator's password, then installs it without its wizard.
    let path = pkg.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("do shell script \"/usr/sbin/installer -pkg \" & quoted form of \"{path}\" & \" -target /\" with administrator privileges");
    let output = Command::new("/usr/bin/osascript").arg("-e").arg(script).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(if err.contains("-128") { "Installing TeX was cancelled.".into() } else { format!("Installing TeX failed: {}", err.trim()) });
    }
    Ok(())
}

#[cfg(windows)]
fn install(app: &AppHandle<impl Runtime>, _variant: &str, dir: &Path) -> Result<(), String> {
    let emit = |stage, received, total| {
        let _ = app.emit("tex-progress", Progress { stage, received, total });
    };
    let (name, sha256) = MIKTEX;
    let setup = dir.join(name);
    let url = format!("https://mirror.ctan.org/systems/win32/miktex/setup/windows-x64/{name}");
    download_to(&url, &setup, |r, t| emit("download", r, t))?;
    emit("verify", 0, 0);
    if sha256_hex(&setup)? != sha256 {
        return Err("The MiKTeX installer didn't match its published checksum, so it wasn't installed.".into());
    }
    emit("install", 0, 0);
    // Just for this user, so Windows doesn't ask for an administrator.
    let status = Command::new(&setup).args(["--unattended", "--private"]).status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("The MiKTeX installer didn't finish.".into());
    }
    // Missing packages install as a document needs them, without a dialog each time.
    if let Some(initexmf) = find("initexmf") {
        let _ = command(&initexmf).arg("--set-config-value=[MPM]AutoInstall=1").status();
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn install(_app: &AppHandle<impl Runtime>, _variant: &str, _dir: &Path) -> Result<(), String> {
    Err("Install TeX Live with your package manager (for example, texlive-latex-extra).".into())
}

/// Downloads and installs TeX: `mactex` or `basictex` on a Mac, MiKTeX on Windows.
#[tauri::command]
pub async fn tex_install<R: Runtime>(app: AppHandle<R>, variant: String) -> Result<TexStatus, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("tex-installer");
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let result = install(&app, &variant, &dir);
        let _ = fs::remove_dir_all(&dir);
        result?;
        Ok(status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_files() {
        let path = std::env::temp_dir().join(format!("ws-sha-{}", std::process::id()));
        fs::write(&path, b"abc").unwrap();
        assert_eq!(sha256_hex(&path).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn names_are_safe() {
        assert_eq!(safe_name("../../etc", "document"), "etc");
        assert_eq!(safe_name("My Thesis (final)", "document"), "MyThesisfinal");
        assert_eq!(safe_name("…", "document"), "document");
    }

    /// Needs TeX on the PATH: `cargo test compiles_with_tex -- --ignored`.
    #[test]
    #[ignore]
    fn compiles_with_tex() {
        let root = std::env::temp_dir().join(format!("ws-tex-test-{}", std::process::id()));
        let dir = root.join("doc");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("chapter.tex"), "\\section{Included}\\label{sec:inc}\nFrom a file beside the document.\n").unwrap();
        fs::write(dir.join("refs.bib"), "@book{knuth, author={Donald Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}\n").unwrap();
        let source = "\\documentclass{article}\n\\begin{document}\nSee section~\\ref{sec:inc} and \\cite{knuth}.\n\\input{chapter}\n\\bibliographystyle{plain}\\bibliography{refs}\n\\end{document}\n";
        let (pdf, file, log) = compile(root.join("build"), "tab1", source, dir.to_str(), "pdflatex", "My Doc").unwrap();
        assert!(pdf.is_some_and(|p| p.starts_with(b"%PDF")), "{log}");
        assert!(file.ends_with("MyDoc.tex"));
        // References settled (a rerun) and the citation resolved (bibtex found refs.bib).
        assert!(!log.contains("undefined"), "{log}");
        assert!(!dir.join("MyDoc.aux").exists(), "nothing is written beside the document");

        let (pdf, _, log) = compile(root.join("build"), "tab1", "\\documentclass{article}\n\\begin{document}\nText.\n\\nosuchcommand\n\\end{document}\n", dir.to_str(), "pdflatex", "My Doc").unwrap();
        assert!(log.contains(":4: Undefined control sequence"), "{log}");
        assert!(pdf.is_some());

        let (pdf, _, _) = compile(root.join("build"), "tab1", "\\documentclass{article}\n\\begin{document}\n\\input{missing}\n", dir.to_str(), "pdflatex", "My Doc").unwrap();
        assert!(pdf.is_none(), "a fatal error makes no PDF, and the last one isn't handed back");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sees_reruns() {
        assert!(needs_rerun("LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right."));
        assert!(!needs_rerun("Output written on main.pdf (1 page)."));
    }
}
