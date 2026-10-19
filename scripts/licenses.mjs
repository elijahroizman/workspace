// Collects the license of every open-source package that ships in Workspace: the npm packages in
// the app and in each plugin, and the Rust crates in the native app. Writes public/licenses.json,
// which Settings › General › Open-source licenses shows. Runs as part of `npm run build`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** npm packages each plugin bundles (plugins/<id>/vite.config.ts builds them). */
const PLUGIN_PACKAGES = {
  Excalidraw: ['@excalidraw/excalidraw', 'react', 'react-dom'],
  EPUB: ['jszip', 'dompurify'],
  Images: ['libheif-js'],
  Mermaid: ['mermaid', '@codemirror/commands', '@codemirror/language', '@codemirror/search', '@codemirror/view'],
  LaTeX: ['@codemirror/commands', '@codemirror/legacy-modes', '@codemirror/language', '@codemirror/search', '@codemirror/view'],
}

/** Copyright holders for packages that name none (no author field, no license file). */
const HOLDERS = {
  '@excalidraw/excalidraw': 'Excalidraw',
  '@excalidraw/laser-pointer': 'Excalidraw',
  '@excalidraw/mermaid-to-excalidraw': 'Excalidraw',
  '@excalidraw/random-username': 'Excalidraw',
}

const TEMPLATES = {
  MIT: (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
}

function holderOf(meta) {
  if (HOLDERS[meta.name]) return HOLDERS[meta.name]
  const author = typeof meta.author === 'string' ? meta.author.replace(/\s*[<(].*$/, '') : meta.author?.name
  return author || `the ${meta.name} authors`
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|third[-_]party[-_]notices)([.-].*)?$/i
const texts = new Map()

/** Store each distinct text once; packages point at it by id. */
function textId(text) {
  const id = createHash('sha1').update(text).digest('hex').slice(0, 12)
  texts.set(id, text)
  return id
}

function licenseFiles(dir) {
  const files = []
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return files
  }
  for (const name of names.sort()) {
    const path = join(dir, name)
    if (LICENSE_FILE.test(name) && statSync(path).isFile()) files.push({ file: name, text: textId(readFileSync(path, 'utf8').trim()) })
    // Bundled fonts and the like keep their licenses in a folder (docx-editor's licenses/).
    else if (/^licen[cs]es$/i.test(name) && statSync(path).isDirectory()) {
      for (const inner of readdirSync(path).sort()) {
        const innerPath = join(path, inner)
        if (statSync(innerPath).isFile()) files.push({ file: `${name}/${inner}`, text: textId(readFileSync(innerPath, 'utf8').trim()) })
      }
    }
  }
  return files
}

/** Where Node would find `name` from `fromDir`. */
function resolvePackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return dirname(candidate)
    if (dirname(dir) === dir) return null
  }
}

function npmPackages(names, group) {
  const seen = new Map()
  const walk = (name, fromDir) => {
    const dir = resolvePackage(name, fromDir)
    if (!dir || seen.has(dir)) return
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const license = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? (meta.licenses ?? []).map((l) => l.type).join(' OR ')) || 'See files'
    let files = licenseFiles(dir)
    // Some packages publish no license file; the license still asks for its notice.
    if (!files.length && TEMPLATES[license]) files = [{ file: `${license} (from package.json)`, text: textId(TEMPLATES[license](holderOf(meta))) }]
    seen.set(dir, {
      group,
      name: meta.name,
      version: meta.version,
      license,
      homepage: typeof meta.homepage === 'string' ? meta.homepage : typeof meta.repository === 'string' ? meta.repository : meta.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, ''),
      files,
    })
    for (const dep of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies })) walk(dep, dir)
  }
  for (const name of names) walk(name, root)
  return [...seen.values()]
}

function cratePackages() {
  let metadata
  try {
    metadata = JSON.parse(
      execFileSync('cargo', ['metadata', '--format-version', '1', '--manifest-path', join(root, 'src-tauri', 'Cargo.toml')], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
      }),
    )
  } catch (err) {
    // A list without the native app's crates would claim to be complete; don't write one.
    throw new Error(`licenses: cargo metadata failed, so the Rust crates can't be listed: ${err.message}`)
  }
  const ours = new Set(metadata.workspace_members)
  const inGraph = new Set(metadata.resolve.nodes.map((n) => n.id))
  return metadata.packages
    .filter((p) => inGraph.has(p.id) && !ours.has(p.id))
    .map((p) => {
      const license = p.license ?? (p.license_file ? 'See files' : 'Unknown')
      let files = licenseFiles(dirname(p.manifest_path))
      // A crate can name its license file anything (license-file in Cargo.toml).
      if (p.license_file) {
        const declared = join(dirname(p.manifest_path), p.license_file)
        if (existsSync(declared) && !files.some((f) => join(dirname(p.manifest_path), f.file) === declared)) {
          files.push({ file: p.license_file, text: textId(readFileSync(declared, 'utf8').trim()) })
        }
      }
      // Dual-licensed crates that publish no file: take the MIT option, with its notice.
      if (!files.length && /\bMIT\b/.test(license)) {
        const holder = p.authors?.length ? p.authors.map((a) => a.replace(/\s*<.*$/, '')).join(', ') : `the ${p.name} authors`
        files = [{ file: 'MIT (from Cargo.toml)', text: textId(TEMPLATES.MIT(holder)) }]
      }
      return { group: 'Native app (Rust)', name: p.name, version: p.version, license, homepage: p.homepage ?? p.repository ?? `https://crates.io/crates/${p.name}`, files }
    })
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
const packages = [
  ...npmPackages(Object.keys(pkg.dependencies), 'App').sort(byName),
  ...Object.entries(PLUGIN_PACKAGES).flatMap(([plugin, names]) => npmPackages(names, `${plugin} plugin`).sort(byName)),
  ...cratePackages().sort(byName),
]
writeFileSync(join(root, 'public', 'licenses.json'), JSON.stringify({ packages, texts: Object.fromEntries(texts) }))
console.log(`licenses: ${packages.length} packages, ${texts.size} license texts`)
