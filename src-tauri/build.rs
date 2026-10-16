fn main() {
    tauri_build::build();

    // A `tauri build` copy under target/ is a real Workspace.app, so Spotlight
    // will offer it in Open With next to the installed app. The empty marker
    // keeps that directory out of the index. Launching the installed app also
    // writes this if it finds an older build that was already indexed.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        ignore_in_spotlight(&manifest.join("target"));
        if let Ok(dir) = std::env::var("CARGO_TARGET_DIR") {
            ignore_in_spotlight(std::path::Path::new(&dir));
        }
    }
}

fn ignore_in_spotlight(dir: &std::path::Path) {
    if std::fs::create_dir_all(dir).is_ok() {
        let _ = std::fs::write(dir.join(".metadata_never_index"), b"");
    }
}
