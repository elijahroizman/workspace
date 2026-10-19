// Brings downloaded plugins up to the latest release of the engine they wrap (the `engine`
// package in plugins/<id>/plugin.json): installs it, gives the plugin a new version
// (`<engine version>-1`), rebuilds it and measures its download size. The Sync plugins workflow
// runs it every week and opens a pull request with the result; merging that publishes the new
// plugin releases (plugins.yml), and the next app release asks for them.
//
// Usage: node scripts/sync-plugins.mjs [--check]
//   --check  only report what's out of date; change nothing.
// Writes a Markdown summary to release/plugin-sync.md, and `changed=true|false` to
// $GITHUB_OUTPUT when it runs in GitHub Actions.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

/** [major, minor, patch] of a plain x.y.z version. */
const parts = (version) => version.split('-')[0].split('.').map(Number)
function newer(a, b) {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

const installedVersion = (pkg) => readJson(join(root, 'node_modules', pkg, 'package.json')).version
const latestVersion = (pkg) => execFileSync(npm, ['view', pkg, 'dist-tags.latest'], { encoding: 'utf8' }).trim()

const updates = []
for (const id of readdirSync(join(root, 'plugins'))) {
  const file = join(root, 'plugins', id, 'plugin.json')
  if (!existsSync(file)) continue
  const plugin = readJson(file)
  if (!plugin.engine) continue
  const current = installedVersion(plugin.engine)
  const latest = latestVersion(plugin.engine)
  console.log(`${id}: ${plugin.engine} ${current}, latest ${latest}`)
  if (newer(latest, current)) updates.push({ id, file, plugin, current, latest })
}

const lines = []
if (!updates.length) {
  console.log('Every plugin is on its engine’s latest release.')
} else if (check) {
  for (const u of updates) console.log(`${u.id} can update: ${u.current} → ${u.latest}`)
} else {
  const pkg = readJson(join(root, 'package.json'))
  for (const u of updates) {
    const { engine } = u.plugin
    const spec = pkg.devDependencies?.[engine] ?? pkg.dependencies?.[engine] ?? ''
    // Keep how package.json pins it: exactly (Excalidraw) or with a caret (Mermaid).
    const prefix = /^[\^~]/.test(spec) ? spec[0] : ''
    const dev = !!pkg.devDependencies?.[engine]
    execFileSync(npm, ['install', '--no-audit', '--no-fund', dev ? '--save-dev' : '--save', ...(prefix ? [] : ['--save-exact']), `${engine}@${prefix}${u.latest}`], { cwd: root, stdio: 'inherit' })

    u.plugin.version = `${u.latest}-1`
    writeJson(u.file, u.plugin)
    execFileSync(join(root, 'node_modules', '.bin', 'vite'), ['build', '--config', join('plugins', u.id, 'vite.config.ts')], { cwd: root, stdio: 'inherit' })
    // The download size Settings shows: the zipped build, as pack-plugin.mjs makes it.
    const out = join(root, 'release')
    mkdirSync(out, { recursive: true })
    const zip = join(out, `${u.id}-size.zip`)
    rmSync(zip, { force: true })
    execFileSync('zip', ['-r', '-X', '-q', '-9', zip, '.'], { cwd: join(root, 'plugins', u.id, 'dist') })
    u.plugin.size = statSync(zip).size
    rmSync(zip)
    writeJson(u.file, u.plugin)

    const major = parts(u.latest)[0] !== parts(u.current)[0]
    lines.push(`- **${u.id}**: \`${engine}\` ${u.current} → ${u.latest}, plugin version ${u.plugin.version}, ${(u.plugin.size / 1e6).toFixed(1)} MB${major ? ' — **a major version: check its release notes for breaking changes**' : ''}`)
  }
}

if (lines.length) {
  const out = join(root, 'release')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'plugin-sync.md'), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${lines.length > 0}\n`)
