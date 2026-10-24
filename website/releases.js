// Points each download button straight at its file in the latest GitHub release and fills in the
// version. The page works without this: every button already links to /releases/latest, and if
// the API call fails or is rate-limited (60 requests an hour per address) nothing changes.
(function () {
  'use strict'

  var API = 'https://api.github.com/repos/elijahroizman/writan/releases/latest'

  // Matches the names the release workflow uploads, e.g. Writan_0.10.5_aarch64.dmg.
  var PATTERNS = {
    mac: /_aarch64\.dmg$/,
    windows: /_x64-setup\.exe$/,
    deb: /_amd64\.deb$/,
    rpm: /\.x86_64\.rpm$/,
  }

  /** The first asset whose name matches `pattern` and whose download link is on github.com, or null. */
  function findAsset(assets, pattern) {
    for (var i = 0; i < assets.length; i++) {
      if (pattern.test(assets[i].name) && /^https:\/\/github\.com\//.test(assets[i].browser_download_url)) return assets[i]
    }
    return null
  }

  /** A byte count as whole megabytes, for the button's tooltip. */
  function megabytes(bytes) {
    return Math.round(bytes / 1048576) + ' MB'
  }

  /** Points the buttons at `release`'s files and shows its version. Leaves a button alone if its file is missing. */
  function apply(release) {
    var assets = Array.isArray(release.assets) ? release.assets : []
    var version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : ''

    Object.keys(PATTERNS).forEach(function (key) {
      var asset = findAsset(assets, PATTERNS[key])
      if (!asset) return

      document.querySelectorAll('[data-asset="' + key + '"]').forEach(function (link) {
        link.href = asset.browser_download_url
        if (asset.size) link.title = asset.name + ', ' + megabytes(asset.size)
      })
      document.querySelectorAll('[data-asset-name="' + key + '"]').forEach(function (node) {
        node.textContent = asset.name
      })
    })

    if (!version) return
    var line = document.querySelector('[data-release-version]')
    if (line) {
      line.textContent = 'Version ' + version + ', the latest release. '
      if (typeof release.html_url === 'string' && /^https:\/\/github\.com\//.test(release.html_url)) {
        var notes = document.createElement('a')
        notes.href = release.html_url
        notes.textContent = 'What changed'
        line.appendChild(notes)
      }
    }
    var hero = document.querySelector('[data-release-line]')
    if (hero) hero.textContent = 'Version ' + version + ' for Mac (Apple silicon), Windows, Debian, Ubuntu and Fedora.'
  }

  if (!window.fetch) return
  fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('GitHub answered ' + response.status)
      return response.json()
    })
    .then(apply)
    .catch(function () {
      // Keep the /releases/latest links already in the page.
    })
})()
