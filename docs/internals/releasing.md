# Releases and signing

## Releasing a version

1. Add the version's section to the top of [CHANGELOG.md](../../CHANGELOG.md), headed `## 0.7.2 — 2026-10-18`. The release workflow copies that section into the GitHub release, and the app's update panel shows it. A version without a section isn't released.
2. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (and `package-lock.json`, `src-tauri/Cargo.lock`).
3. If a downloaded plugin's version in `plugins/<id>/plugin.json` changed, check that its `plugin-<id>-<version>` pre-release exists. The Plugins workflow makes it when the change reaches `main`; if it didn't run, push the tag.
4. Push a tag like `v0.7.2`.

The **Release** workflow (`.github/workflows/release.yml`) builds the Mac `.dmg`, the Windows `.exe`, the Debian/Ubuntu `.deb` and the Fedora `.rpm`, attaches them to the release, and publishes `latest.json`, the feed installed Mac and Windows copies check. The Linux job also refreshes the APT and dnf repositories. Running the workflow from the Actions tab only builds, unless "publish" is ticked.

The **Plugins** workflow (`.github/workflows/plugins.yml`) publishes downloaded plugins. When a `plugin.json` changes on `main`, it builds, zips and signs every plugin version that has no pre-release yet, and attaches it to a new `plugin-<id>-<version>` pre-release. A `plugin-*` tag publishes that one version.

## Signing keys

All of these are Actions secrets. None is in the repository.

| Secret | Signs | Public half | If it's lost |
| --- | --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Mac and Windows update bundles, and plugin archives | `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` | Installed copies can't verify new versions or plugins. Everyone reinstalls by hand once. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | The Mac app (Developer ID Application) | Apple | Make a new certificate in the Apple Developer account. |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Notarizing the app and the `.dmg` | Apple | Make a new App Store Connect API key. |
| `APT_SIGNING_KEY` | The APT repository's `InRelease` and `Release.gpg`, and the dnf repository's `repomd.xml.asc` (GPG, RSA 4096) | `src-tauri/linux/workspace-archive-keyring.gpg` (installed by the .deb) and its armored copy `src-tauri/linux/RPM-GPG-KEY-workspace` (installed by the .rpm) | apt and dnf refuse updates. Ship a new key in a .deb and .rpm that people install by hand. |

Keep an offline copy of the updater and APT private keys. Windows builds aren't code-signed, so SmartScreen warns on first run.

## The APT repository

It's a flat repository in the assets of the release tagged `apt` (a pre-release, so the updater and the app's "latest release" never pick it): the newest `.deb` and the one before it, `Packages`, `Packages.gz`, `Release`, `Release.gpg` and `InRelease`. The .deb's `postinst` (`src-tauri/linux/postinst`) writes `/etc/apt/sources.list.d/workspace.list` pointing at `https://github.com/elijahroizman/writan/releases/download/apt/`, signed-by the keyring the package installs. `postrm` removes the list on purge.

To rebuild the repository by hand, run the "Publish the APT repository" step's commands with the key imported into a temporary `GNUPGHOME`.

## Rename to Writan (0.10.0)

The display name is Writan. The GitHub repository is `elijahroizman/writan`. Release downloads, plugin archives, the updater endpoint, and the APT and dnf base URLs use that path. Keep `com.eliroizman.workspace`, the updater signing key, on-disk repository file names and keyring paths, `workspace.*` storage keys, and plugin tags and protocol. They identify existing installations and data. The version bump and 0.10.0 changelog belong to the release change.

In CLI 2.12.3, `productName` names the macOS `.app`, NSIS install directory and registry keys, installer artifacts, Linux package and `.desktop` file. `mainBinaryName` overrides the Cargo executable name when the CLI builds/bundles. The Cargo package is `writan`, and `mainBinaryName` is `writan` as well, producing `writan.exe`, `Contents/MacOS/writan` and `/usr/bin/writan`. See the [configuration definitions](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-utils/src/config.rs), [CLI settings](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-cli/src/interface/rust.rs) and [NSIS template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi).

Mac releases build `Writan.app`, `Writan.app.tar.gz` and `Writan_<version>_aarch64.dmg`. The [updater](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.14.0/plugins/updater/src/updater.rs) derives the destination from the running executable's enclosing `.app`, strips the archive's first path component, and replaces that destination. It does not compare the bundle filename with `productName`. An installed `/Applications/Workspace.app` therefore receives the new Writan contents at its existing path, preserving app data and defaults through the unchanged bundle ID. Its disk filename stays `Workspace.app`; a fresh installation is `Writan.app`. Relaunch uses the installed bundle path, not a hard-coded name.

Windows releases build `Writan_<version>_x64-setup.exe`. A fresh current-user install goes into `%LOCALAPPDATA%\Writan`. Before installing over 0.9.x, `hooks.nsh` reads `HKCU\Software\eliroizman\Workspace`, reuses its saved directory, including custom locations, and resets NSIS's output directory. The passive `/UPDATE` path waits for both `Workspace.exe` and `writan.exe` in that directory, then terminates either by full path if needed. After copying the new binary and uninstaller, it deletes the old executable, shortcuts and uninstall record. Only Writan's uninstall entry and shortcuts remain. No old uninstaller runs and no app-data directory is deleted. Subsequent updates find Writan's normal registry record. Default Apps uses `Software\Writan\Capabilities`, RegisteredApplications value `Writan`, and `registeredAppUser=Writan`; the existing extension ProgIDs stay unchanged so Windows' hashed UserChoice entries still work. Compile-check the hooks as described in [development.md](development.md#windows-installer-hooks). A real Windows 0.9.x-to-0.10.0 update still needs release QA.

Linux deliberately keeps the real deb `Package: workspace` and rpm `Name: workspace`. Tauri has no independent package-name override, so `tauri.linux.conf.json` retains `productName: Workspace` for Linux packaging. The custom desktop template displays `Name=Writan`, executes `writan`, and keeps the old `Workspace.desktop` identity. The real executable becomes `/usr/bin/writan`; `/usr/bin/workspace` becomes a compatibility wrapper that executes it. [Tauri caches the original executable path](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri/src/process.rs), so the 0.9.x updater needs that wrapper when it relaunches after installing the new package. Linux artifacts remain `Workspace_<version>_amd64.deb` and `Workspace-<version>-1.x86_64.rpm`. The [deb](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-bundler/src/bundle/linux/debian.rs), [rpm](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-bundler/src/bundle/linux/rpm.rs) and [desktop](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-bundler/src/bundle/linux/freedesktop/mod.rs) implementations derive these names from `productName`, not Cargo or `mainBinaryName`.

The package identity and compatibility wrapper keep plain `apt upgrade`, `dnf upgrade`, and the commands already shipped in 0.9.x working: `apt-get install -y --only-upgrade workspace` and `dnf ... upgrade workspace`. No Conflicts/Replaces/Obsoletes transition is needed. Renaming the deb package to `writan` would require a transitional `workspace` package depending on `writan` for plain `apt upgrade`; Provides/Replaces/Conflicts alone would not make that transition. Keep APT's existing `Origin: Workspace` and `Label: Workspace` too, so old clients do not require `--allow-releaseinfo-change`. The release workflow still indexes the built packages and prunes the legacy Linux artifact names. Repository file names, dnf ID `workspace`, and signing keys stay unchanged. The GitHub base URL in a newly written repository file is `https://github.com/elijahroizman/writan`. An existing `workspace.list` or `workspace.repo` is left in place, and GitHub redirects the old repository address.

On macOS, Settings installs `/usr/local/bin/writan` and removes an old `/usr/local/bin/workspace` only if it is our marked script or a link into this app's bundle. An unrelated command is left alone. Existing shell integrations should switch to `writan` after installing the new command.

The downloaded LaTeX plugin is bumped to 1.0.2 so existing users receive its renamed messages. Publish the signed `plugin-latex-1.0.2` release before tagging the app, using the unchanged Plugins workflow and tag convention. Images ships with the app and needs no separate release.
