// Runtime icon variants. Requires npm ci.
// Render Logo itself so its geometry, colors and tile edges remain the source of truth, placed on
// the same grid as assets/app-icon.svg (an 824 px tile with a shadow on a 1024 px canvas), so the
// Dock and taskbar show a chosen icon at the size of the bundled one.
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'

const source = await readFile(new URL('../src/components/ui.tsx', import.meta.url), 'utf8')
// Load only the brand block, without the rest of the UI's browser dependencies.
const brand = source.match(/export type LogoVariant\b[\s\S]*?(?=export function Wordmark\b)/)?.[0]
if (!brand) throw new Error('Could not find Logo in src/components/ui.tsx')
const { code } = await transformWithOxc(brand, 'logo.tsx', { jsx: { runtime: 'classic' } })
const { Logo } = await import(`data:text/javascript;base64,${Buffer.from(`import React from ${JSON.stringify(import.meta.resolve('react'))};\n${code}`).toString('base64')}`)
const output = new URL('../src-tauri/icons/variants/', import.meta.url)
await mkdir(output, { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'writan-icons-'))

try {
  for (const variant of ['dark', 'blue', 'light']) {
    const logo = renderToStaticMarkup(React.createElement(Logo, { variant, size: 200 }))
    // Logo's contents, with the shadow on its tile (the first rect), as in assets/app-icon.svg.
    const inner = logo.replace(/^<svg[^>]*>|<\/svg>$/g, '').replace('<rect ', '<rect filter="url(#iconShadow)" ')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <filter id="iconShadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <g transform="translate(100 100) scale(4.12)">${inner}</g>
</svg>`
    const file = join(work, `${variant}.svg`)
    await writeFile(file, svg)
    // The Tauri CLI renders with resvg, as it does for the bundled icons; its icon.png is 512 px.
    const result = spawnSync('npx', ['tauri', 'icon', file, '-o', join(work, variant)], { encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(result.stderr || `tauri icon exited with ${result.status}`)
    const png = fileURLToPath(new URL(`${variant}.png`, output))
    await copyFile(join(work, variant, 'icon.png'), png)
    console.log(png)
  }
} finally {
  await rm(work, { recursive: true, force: true })
}
