// Zips a built plugin (plugins/<id>/dist) as release/<id>-<version>.zip and signs it with the
// updater key, which the app checks before installing (src-tauri/src/plugins.rs).
// Usage: TAURI_SIGNING_PRIVATE_KEY=… TAURI_SIGNING_PRIVATE_KEY_PASSWORD=… node scripts/pack-plugin.mjs latex

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const id = process.argv[2]
if (!id) throw new Error('Usage: node scripts/pack-plugin.mjs <plugin id>')
const { version } = JSON.parse(readFileSync(join(root, 'plugins', id, 'plugin.json'), 'utf8'))
const dist = join(root, 'plugins', id, 'dist')
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
if (manifest.version !== version) throw new Error(`plugins/${id}/dist is version ${manifest.version}, plugin.json says ${version}: run npm run plugins`)

const out = join(root, 'release')
mkdirSync(out, { recursive: true })
const zip = join(out, `${id}-${version}.zip`)
rmSync(zip, { force: true })
rmSync(`${zip}.sig`, { force: true })
// -X: no extra file attributes, so the archive only depends on the files.
execFileSync('zip', ['-r', '-X', '-q', '-9', zip, '.'], { cwd: dist, stdio: 'inherit' })
execFileSync(join(root, 'node_modules', '.bin', 'tauri'), ['signer', 'sign', zip], { stdio: 'inherit' })
if (!existsSync(`${zip}.sig`)) throw new Error('Signing failed')
console.log(`${zip}: ${(statSync(zip).size / 1e6).toFixed(1)} MB (set "size" in plugins/${id}/plugin.json to about ${statSync(zip).size})`)
