# Writan website

A static page about Writan with links to its downloads. Plain HTML and CSS, plus one small script. Nothing to install or build. It isn't deployed anywhere yet.

| File | What it is |
| --- | --- |
| `index.html` | The whole page |
| `styles.css` | Light and dark styles, following the system setting |
| `releases.js` | Asks the GitHub API for the latest release and points each download button at its file |
| `app-icon.svg` | A copy of [`assets/app-icon.svg`](../assets/app-icon.svg) |
| `favicon.svg` | A copy of [`public/favicon.svg`](../public/favicon.svg), the full-bleed mark for small sizes |
| `previews/` | Full-page screenshots for review: 1440 px light and dark, 390 px light. Not linked from the page |

## Preview it

Serve this folder and open the address it prints:

```sh
python3 -m http.server 8000 --directory website   # then open http://localhost:8000
# or
npx serve website
```

Opening `index.html` straight from disk also works.

## Downloads

Each download button links to <https://github.com/elijahroizman/writan/releases/latest>. When the page loads, `releases.js` fetches the latest release from `api.github.com` and swaps in the direct link to each file, the file names in the install commands, and the version number. If that request fails, the page keeps the `/releases/latest` links. Failures include GitHub's limit of 60 unauthenticated requests an hour per address, and JavaScript being off.

The script finds each file by how its name ends, so these patterns in `releases.js` must keep matching what the release workflow uploads:

| Button | Pattern | Example |
| --- | --- | --- |
| Mac | `_aarch64.dmg` | `Writan_0.10.5_aarch64.dmg` |
| Windows | `_x64-setup.exe` | `Writan_0.10.5_x64-setup.exe` |
| Debian, Ubuntu | `_amd64.deb` | `Writan_0.10.5_amd64.deb` |
| Fedora | `.x86_64.rpm` | `Writan-0.10.5-1.x86_64.rpm` |

## When the icon changes

Copy it again:

```sh
cp assets/app-icon.svg website/app-icon.svg
cp public/favicon.svg website/favicon.svg
```

The site keeps its own copies so the folder can be served as it is, with no paths outside it.
