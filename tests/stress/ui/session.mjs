// Bounded crash-equivalent observation, not a claim of recovery support.
// Reload discards renderer memory but retains localStorage and real fixture bytes.
import { resolve } from 'node:path'
import { launch, start, open, tabs, check, done } from './harness.mjs'
const path = resolve(import.meta.dirname, '../samples/S1-text-utf16le-bom.txt')
const { browser, page, logs } = await launch({ init: () => {
  localStorage.setItem('workspace.settings', JSON.stringify({ version: 2, autosave: { enabled: false, delay: 3, kinds: {} } }))
} })
const ws = (fn, arg) => page.evaluate(([f, a]) => new Function('ws', 'a', `return (${f})(ws, a)`)(window.__workspace.useWorkspace.getState(), a), [fn.toString(), arg])
try {
  await start(page)
  await open(page, path)
  const editor = page.locator('.view[data-active=true] .cm-content')
  await editor.waitFor()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('UNSAVED FILE MARKER')
  await ws((w) => w.newDocument('txt'))
  await editor.waitFor()
  await editor.click()
  await page.keyboard.insertText('UNTITLED RECOVERY MARKER')
  check('setup: both tabs have unsaved content', (await tabs(page)).filter((t) => t.dirty).length === 2)
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('workspace.session')))
  check('session stores the saved path', snapshot.paths.includes(path), JSON.stringify(snapshot))
  check('no autosave wrote either marker', await page.evaluate(() => window.__fake.writes.length === 0))
  await page.reload()
  await page.waitForFunction((p) => window.__workspace?.useWorkspace.getState().tabs.some((t) => t.path === p), path, { timeout: 15000 })
  const restored = await tabs(page)
  check('reload reopens the file path', restored.some((t) => t.path === path))
  await ws((w, p) => w.activate(w.tabs.find((t) => t.path === p).id), path)
  await editor.waitFor()
  const text = await editor.textContent()
  check('reopened UTF-16 text still decodes correctly', text.includes('Grüße') && text.includes('日本語') && !text.includes('�'))
  const fileLost = !text.includes('UNSAVED FILE MARKER')
  const untitledLost = restored.every((t) => t.path !== null)
  console.log(`${fileLost && untitledLost ? 'OPEN' : 'CHANGED'} UI-001: reload lost file edits=${fileLost}, untitled tab=${untitledLost}; session=${JSON.stringify(snapshot)}`)
  await page.screenshot({ path: `/tmp/writan-stress/session-${process.env.ENGINE ?? 'chromium'}.png` })
} finally {
  await done(browser, logs)
}
