#!/usr/bin/env node
// Run on bbb after building and serving VITE_TEST_HOOKS=1. Raw files stay outside checkout.
import { chromium, webkit } from 'playwright'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const base = process.env.CORPUS_URL || 'http://127.0.0.1:1443'
const root = resolve(import.meta.dirname)
const out = resolve(process.env.CORPUS_RESULTS || join(root, 'results'))
const rows = (await readFile(join(root, 'manifest.tsv'), 'utf8')).trim().split('\n').slice(1).map(l => l.split('\t'))
const filter = process.env.CORPUS_FILTER ? new RegExp(process.env.CORPUS_FILTER) : null
await mkdir(out, { recursive: true })
const engines = process.env.CORPUS_BROWSER ? [process.env.CORPUS_BROWSER] : ['chromium', 'webkit']
for (const kind of engines) {
  const browser = await ({ chromium, webkit })[kind].launch({ headless: true })
  const resultFile = join(out, `browser-${kind}.jsonl`)
  if (!process.env.CORPUS_APPEND) await writeFile(resultFile, '')
  for (const [name, url, hash] of rows) {
    if (filter && !filter.test(name)) continue
    const result = { name, browser: kind, source: url, sha256: hash, consoleErrors: [], pageErrors: [], timingLogs: [] }
    const dir = join(out, kind)
    await mkdir(dir, { recursive: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
    const page = await context.newPage()
    page.on('console', m => {
      if (m.type() === 'error') result.consoleErrors.push(m.text())
      if (m.text().startsWith('[engine]')) result.timingLogs.push(m.text())
    })
    page.on('pageerror', e => result.pageErrors.push(String(e)))
    await page.addInitScript(() => {
      localStorage.setItem('workspace.setupDone', '1')
      localStorage.setItem('workspace.theme', 'light')
      localStorage.setItem('workspace.themeMode', 'light')
      localStorage.setItem('workspace.engineTiming', '1')
    })
    const start = performance.now()
    let deadline
    try {
      await Promise.race([(async () => {
        await page.goto(`${base}/?open=${encodeURIComponent('/dev-samples/' + name)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForFunction(() => {
          const w = window.__workspace
          if (!w) return false
          const s = w.useWorkspace.getState()
          return s.activeId !== 'home' && !!w.getEditor(s.activeId)
        }, { timeout: 40000 })
        // DOCX registers a handle before its engine is ready. Probe until getBytes succeeds.
        await page.waitForFunction(async () => {
          try {
            const w = window.__workspace, s = w.useWorkspace.getState()
            await w.getEditor(s.activeId).getBytes()
            return true
          } catch { return false }
        }, { timeout: 40000 })
        result.openMs = Math.round(performance.now() - start)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(350)
        result.dom = await page.evaluate(() => ({
          title: document.title,
          text: document.body.innerText,
          docxPages: document.querySelectorAll('.docx-page').length,
          pdfPages: document.querySelectorAll('[data-page-index]').length,
          elements: document.querySelectorAll('*').length,
          images: [...document.images].map(i => ({ src: i.src.startsWith('blob:') ? 'blob' : i.src, complete: i.complete, width: i.naturalWidth, height: i.naturalHeight })),
          heap: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit } : null,
          // No comparable JavaScript heap API is exposed by WebKit. Null means unavailable.
        }))
        await page.screenshot({ path: join(dir, name + '.png'), timeout: 15000 })
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 })
        const saved = await page.evaluate(async name => {
          const w = window.__workspace, s = w.useWorkspace.getState()
          return s.save(s.activeId, { to: '/corpus-saved/' + name, quiet: true })
        }, name)
        if (!saved) throw new Error('workspace.save returned false')
        const download = await downloadPromise
        await download.saveAs(join(dir, name))
        result.save = 'ok'
        result.status = 'ok'
      })(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('File exceeded 90 second wall-clock limit')), 90000) })])
    } catch (e) {
      result.status = 'failed'
      result.error = String(e)
      try { result.failureText = (await page.locator('body').innerText({ timeout: 3000 })).slice(-6000) } catch {}
      try { await page.screenshot({ path: join(dir, name + '.failure.png'), timeout: 3000 }) } catch {}
    } finally {
      clearTimeout(deadline)
      result.totalMs = Math.round(performance.now() - start)
      await appendFile(resultFile, JSON.stringify(result) + '\n')
      console.log(kind, name, result.status, result.openMs ?? result.totalMs, result.error ?? '')
      await context.close().catch(() => {})
    }
  }
  await browser.close()
}
