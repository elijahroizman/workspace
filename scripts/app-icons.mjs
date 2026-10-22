// Runtime icon variants. Requires ImageMagick (`magick`) and npm ci.
// Render Logo itself so its geometry, colors and tile edges remain the source of truth.
import { spawnSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
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

for (const variant of ['dark', 'blue', 'light']) {
  const svg = renderToStaticMarkup(React.createElement(Logo, { variant, size: 512 }))
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  const file = fileURLToPath(new URL(`${variant}.png`, output))
  const result = spawnSync('magick', ['-background', 'none', 'svg:-', '-strip', `PNG32:${file}`], { input: svg, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `ImageMagick exited with ${result.status}`)
  console.log(file)
}
