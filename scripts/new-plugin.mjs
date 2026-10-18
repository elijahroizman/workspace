// Scaffolds a new plugin from the template. Usage: npm run plugin:new -- <id> "<Name>" <ext>
// Copies plugins/template to plugins/<id>, rewrites id/ext, and prints catalog and config snippets.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const id = process.argv[2]
const name = process.argv[3]
const ext = process.argv[4]

if (!id || !name || !ext) {
  console.error('Usage: npm run plugin:new -- <id> "<Name>" <ext>')
  console.error('Example: npm run plugin:new -- myplugin "My Plugin" myext')
  process.exit(1)
}

if (!/^[a-z0-9-]+$/.test(id)) {
  console.error('Plugin id must be lowercase letters, digits, and dashes only')
  process.exit(1)
}

if (existsSync(join(root, 'plugins', id))) {
  console.error(`plugins/${id} already exists`)
  process.exit(1)
}

const templateDir = join(root, 'plugins', 'template')
const targetDir = join(root, 'plugins', id)

// Copy template, skipping dist
mkdirSync(targetDir, { recursive: true })
for (const entry of readdirSync(templateDir)) {
  if (entry === 'dist') continue
  cpSync(join(templateDir, entry), join(targetDir, entry), { recursive: true })
}

// Rewrite plugin.json
const pluginJson = JSON.parse(readFileSync(join(targetDir, 'plugin.json'), 'utf8'))
pluginJson.id = id
writeFileSync(join(targetDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2) + '\n')

// index.ts: the file extension (written `.template` in backticks), then every other mention of
// the template's id (its style tag, class names).
let indexTs = readFileSync(join(targetDir, 'index.ts'), 'utf8')
indexTs = indexTs.replaceAll('`.template`', `\`.${ext}\``).replace(/template/g, id)
writeFileSync(join(targetDir, 'index.ts'), indexTs)

// Rewrite README.md
let readme = readFileSync(join(targetDir, 'README.md'), 'utf8')
readme = readme.replace(/template/g, id)
writeFileSync(join(targetDir, 'README.md'), readme)

// Print snippets
const varName = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
console.log(`\nCreated plugins/${id} from template. Add these snippets:\n`)

console.log('// src/plugins/catalog.ts - add this import at the top:')
console.log(`import ${varName} from '../../plugins/${id}/plugin.json'`)
console.log('\n// Then add this to the PLUGINS array:')
console.log(`{
  id: '${id}',
  name: '${name}',
  description: 'TODO: one-line description',
  homepage: 'TODO: plugin homepage URL',
  license: 'MIT',
  source: { type: 'download', version: ${varName}.version, size: ${varName}.size },
  kinds: [
    {
      id: '${id}',
      prose: '${name}',
      label: '${name} File',
      short: '${name}',
      extensions: ['${ext}'],
      color: 'var(--kind-${id})',
      icon: TODO, // import an icon from lucide-react
      untitled: 'Untitled ${name}',
      create: { title: 'New ${name}', hint: '${name} (.${ext})' },
      panels: { left: true, right: false },
    },
  ],
},`)

console.log('\n// src/styles/app.css - add this to the :root --kind-* list:')
console.log(`  --kind-${id}: #TODO;`)

console.log('\n// src-tauri/tauri.conf.json - add this to bundle.fileAssociations:')
console.log(`{
  "ext": ["${ext}"],
  "name": "${name} File",
  "role": "Editor",
  "rank": "Alternate",
  "mimeType": "application/x-${id}"
},`)

console.log('\n// scripts/licenses.mjs - add this to PLUGIN_PACKAGES:')
console.log(`  ${name}: ['TODO', 'list', 'npm', 'packages'],`)

console.log('\n// package.json - add this build to the "plugins" script:')
console.log(`vite build --config plugins/${id}/vite.config.ts`)

console.log('\nAfter building with scripts/pack-plugin.mjs, update plugin.json size to the zip size.')
