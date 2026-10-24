# Updating

The **Check for updates** button at the top right shows the latest release's notes, from [CHANGELOG.md](../../CHANGELOG.md), and whether there's something newer.

## Mac and Windows

New versions download in the background, checked after launch and every four hours, and install when you quit. To install one straight away, click **Update** in the tab bar. Updates are signed, and Writan refuses one whose signature doesn't match.

## Debian and Ubuntu

Installing the .deb adds Writan's APT repository and its signing key:

```
/etc/apt/sources.list.d/workspace.list
/usr/share/keyrings/workspace-archive-keyring.gpg
```

After that, new versions come with your system's other updates (Software Updater, or `sudo apt update && sudo apt upgrade`). The **Update** button can also install one: it asks for your password, runs apt for Writan alone, and reopens the app.

Copies installed from 0.7.1 or earlier don't have the repository. Install the newest .deb once by hand and they will. The .deb only writes `workspace.list` when there's no such file, so if you made one yourself, check that its `deb` line matches the one below.

To stop updates, put a `#` in front of the `deb` line in `workspace.list`. Neither apt nor the **Update** button installs new versions after that (the button only shows the release notes), and upgrading Writan leaves the file alone. Removing Writan deletes it, along with the key.

To add the repository by hand (for example on a machine that never had the .deb), install the key from this repository's `src-tauri/linux/workspace-archive-keyring.gpg` to `/usr/share/keyrings/` and add:

```
deb [arch=amd64 signed-by=/usr/share/keyrings/workspace-archive-keyring.gpg] https://github.com/elijahroizman/writan/releases/download/apt/ ./
```

## Fedora

Installing the .rpm adds Writan's dnf repository and its signing key (the same key as the APT repository):

```
/etc/yum.repos.d/workspace.repo
/etc/pki/rpm-gpg/RPM-GPG-KEY-workspace
```

After that, new versions come with your system's other updates (GNOME Software, or `sudo dnf upgrade`). The first time, dnf asks you to accept the key. The **Update** button can also install one: it asks for your password, runs dnf for Writan alone, and reopens the app.

The repository's index is signed, and dnf refuses an index whose signature doesn't match. The packages themselves aren't signed; the signed index holds their checksums, so a changed package doesn't install either.

To stop updates, set `enabled=0` in `workspace.repo`. Upgrading Writan leaves the file alone, and removing it deletes the file.

## Builds you make yourself

A copy you build from source isn't signed and doesn't update itself. Pull the new code and build again.

The Linux package is still named `workspace` so older installations upgrade normally. The app is Writan and its terminal command is `writan`. Repository file names and signing keys keep their original names. The GitHub address is elijahroizman/writan. A `workspace.list` or `workspace.repo` written by an older package still points at the previous address. GitHub redirects it, and upgrading Writan leaves that file alone.
