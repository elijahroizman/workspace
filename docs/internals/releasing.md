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

It's a flat repository in the assets of the release tagged `apt` (a pre-release, so the updater and the app's "latest release" never pick it): the newest `.deb` and the one before it, `Packages`, `Packages.gz`, `Release`, `Release.gpg` and `InRelease`. The .deb's `postinst` (`src-tauri/linux/postinst`) writes `/etc/apt/sources.list.d/workspace.list` pointing at `https://github.com/elijahroizman/workspace/releases/download/apt/`, signed-by the keyring the package installs. `postrm` removes the list on purge.

To rebuild the repository by hand, run the "Publish the APT repository" step's commands with the key imported into a temporary `GNUPGHOME`.
