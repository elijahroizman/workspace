// The Word page view: pages stacked in a scrolling column, drawn from the engine's display lists
// only while they're near the screen, with the caret and selection over them and a hidden text
// field taking the keyboard (and the input method's composition, which shows at the caret).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isMac, openExternal, shortcut } from '../../lib/platform'
import { itemsHtml } from '../paint'
import type { WordEngine } from './engine'

/** Space above the first page and between pages, before zoom. */
const TOP = 24
const GAP = 16
const SIDE = 24
/** Pages this far beyond the screen stay drawn; further ones are dropped. */
const KEEP = 3

export const WORD_CLIPBOARD = 'application/x-workspace-word'

interface Props {
  engine: WordEngine
  zoom: number
  /** The scrolling element (the viewport). */
  scroller: () => HTMLElement | null
}

export function Pages({ engine, zoom, scroller }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const painted = useRef(new Map<number, number>())
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const [, setTick] = useState(0)
  const composing = useRef(false)
  const scrollAfter = useRef(false)

  const sizes = engine.sizes
  const tops: number[] = []
  let y = TOP
  let maxW = 0
  for (const [w, h] of sizes) {
    tops.push(y)
    y += h * zoom + GAP
    maxW = Math.max(maxW, w)
  }
  const height = y + 48
  const width = maxW * zoom + SIDE * 2

  // Draw the pages near the screen; drop far ones.
  const draw = () => {
    const sc = scroller()
    const mount = mountRef.current
    if (!sc || !mount) return
    const top = sc.scrollTop - mount.offsetTop
    const bottom = top + sc.clientHeight
    let first = -1
    let last = -1
    for (let i = 0; i < sizes.length; i++) {
      const pt = tops[i]
      const pb = pt + sizes[i][1] * zoom
      if (pb >= top - sc.clientHeight * 0.5 && pt <= bottom + sc.clientHeight * 0.5) {
        if (first < 0) first = i
        last = i
      }
    }
    if (first < 0) return
    for (let i = first; i <= last; i++) {
      const el = pageEls.current.get(i)?.querySelector<HTMLElement>('.docx-page-content')
      if (!el || painted.current.get(i) === engine.revision) continue
      const p = engine.paint(i)
      el.innerHTML = itemsHtml(p.items, engine.styles, engine.media.url)
      painted.current.set(i, engine.revision)
    }
    for (const [i] of painted.current) {
      if (i < first - KEEP || i > last + KEEP) {
        const el = pageEls.current.get(i)?.querySelector<HTMLElement>('.docx-page-content')
        if (el) el.innerHTML = ''
        painted.current.delete(i)
      }
    }
  }

  // Follow the engine: repaint what changed, move the caret.
  useEffect(
    () =>
      engine.subscribe(() => {
        setTick((t) => t + 1)
      }),
    [engine],
  )

  useLayoutEffect(() => {
    engine.input = inputRef.current
    engine.pagePoint = pagePoint
    engine.toClient = (page, x, y) => {
      const r = mountRef.current!.getBoundingClientRect()
      return { x: r.left + pageLeft(page) + x * zoom, y: r.top + (tops[page] ?? 0) + y * zoom }
    }
    // Pages that no longer exist drop out of the bookkeeping.
    for (const [i] of painted.current) if (i >= sizes.length) painted.current.delete(i)
    draw()
    placeInput()
    if (scrollAfter.current) {
      scrollAfter.current = false
      revealCaret()
    }
  })

  useEffect(() => {
    const sc = scroller()
    if (!sc) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(sc)
    return () => {
      cancelAnimationFrame(frame)
      sc.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  })

  // Pages drawn at another zoom are drawn again only if their content changed; the CSS scale
  // takes care of the rest.

  /** Where a client point is on a page: the page under it, or the nearest by height. */
  const pagePoint = (clientX: number, clientY: number) => {
    const mount = mountRef.current!
    const r = mount.getBoundingClientRect()
    const my = clientY - r.top
    let page = sizes.length - 1
    for (let i = 0; i < sizes.length; i++) {
      if (my < tops[i] + sizes[i][1] * zoom + GAP / 2) {
        page = i
        break
      }
    }
    const left = (r.width - sizes[page][0] * zoom) / 2
    return { page, x: (clientX - r.left - left) / zoom, y: (my - tops[page]) / zoom }
  }

  /** The text field sits at the caret, so an input method's window opens there. */
  const placeInput = () => {
    const input = inputRef.current
    const mount = mountRef.current
    if (!input || !mount) return
    const c = engine.overlay.caret
    if (!c) return
    const [page, x, cy, h] = c
    const left = (mount.clientWidth - (sizes[page]?.[0] ?? 0) * zoom) / 2
    input.style.left = `${left + x * zoom}px`
    input.style.top = `${(tops[page] ?? 0) + cy * zoom}px`
    input.style.height = `${h * zoom}px`
    input.style.fontSize = `${Math.max(10, h * zoom * 0.75)}px`
  }

  /** Scrolls the caret into view. */
  const revealCaret = () => {
    const sc = scroller()
    const mount = mountRef.current
    const c = engine.overlay.caret ?? (engine.overlay.image ? [engine.overlay.image[0], engine.overlay.image[1], engine.overlay.image[2], engine.overlay.image[4]] : null)
    if (!sc || !mount || !c) return
    const [page, , cy, h] = c
    const top = mount.offsetTop + (tops[page] ?? 0) + cy * zoom
    const bottom = top + h * zoom
    const typewriter = !!document.querySelector('.app[data-typewriter]')
    if (typewriter) {
      sc.scrollTop = top - sc.clientHeight / 2
      return
    }
    if (top < sc.scrollTop + 24) sc.scrollTop = top - 48
    else if (bottom > sc.scrollTop + sc.clientHeight - 72) sc.scrollTop = bottom - sc.clientHeight + 96
  }

  const run = (cmd: Record<string, unknown> & { cmd: string }, reveal = true) => {
    scrollAfter.current = reveal
    return engine.run(cmd)
  }

  // ── Pointer
  const drag = useRef<{ page: number } | null>(null)
  const resize = useRef<{ corner: string; startX: number; startY: number; w: number; h: number; ratio: number } | null>(null)
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    // ⌘-click (Ctrl-click on Windows) on a link opens it.
    const link = target.closest<HTMLElement>('.ln[data-link]')
    if (link && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault()
      const href = link.dataset.link!
      if (!href.startsWith('#')) void openExternal(href)
      return
    }
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
    const handle = target.closest<HTMLElement>('.wp-handle')
    if (handle && engine.state.image) {
      const img = engine.state.image
      resize.current = { corner: handle.dataset.corner!, startX: e.clientX, startY: e.clientY, w: img.widthEmu, h: img.heightEmu, ratio: img.heightEmu / Math.max(1, img.widthEmu) }
      return
    }
    const at = pagePoint(e.clientX, e.clientY)
    const area = engine.doc.headerFooterAt(at.page, at.y)
    if (engine.state.headerFooter && !area) run({ cmd: 'exitHeaderFooter' }, false)
    else if (!engine.state.headerFooter && area && e.detail === 2 && engine.doc.hasHeaderFooter(at.page, area)) {
      run({ cmd: 'editHeaderFooter', page: at.page, which: area }, false)
      return
    }
    run({ cmd: 'click', page: at.page, x: at.x, y: at.y, extend: e.shiftKey, count: e.detail }, false)
    drag.current = { page: at.page }
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (resize.current) {
        const r = resize.current
        const dx = (e.clientX - r.startX) / zoom
        const grow = r.corner.includes('w') ? -dx : dx
        const w = Math.max(9525 * 8, r.w + grow * 9525)
        // A picture keeps its proportions as a corner is dragged.
        const el = mountRef.current?.querySelector<HTMLElement>('.wp-image-frame')
        if (el) {
          el.style.width = `${(w / 9525) * zoom}px`
          el.style.height = `${((w * r.ratio) / 9525) * zoom}px`
        }
        return
      }
      if (!drag.current || !(e.buttons & 1)) return
      const at = pagePoint(e.clientX, e.clientY)
      run({ cmd: 'drag', page: at.page, x: at.x, y: at.y }, false)
      // Keep the pointer's end of the selection in view while dragging past the edge.
      const sc = scroller()
      if (sc) {
        const r = sc.getBoundingClientRect()
        if (e.clientY > r.bottom - 20) sc.scrollTop += 16
        else if (e.clientY < r.top + 20) sc.scrollTop -= 16
      }
    }
    const up = (e: MouseEvent) => {
      if (resize.current) {
        const r = resize.current
        resize.current = null
        const dx = (e.clientX - r.startX) / zoom
        const grow = r.corner.includes('w') ? -dx : dx
        const w = Math.max(9525 * 8, r.w + grow * 9525)
        if (Math.abs(w - r.w) > 100) run({ cmd: 'imageSize', widthEmu: Math.round(w), heightEmu: Math.round(w * r.ratio) }, false)
        else setTick((t) => t + 1)
      }
      drag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

  // Links show where they go, and a hand while ⌘ (Ctrl) is held.
  const onMouseOver = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>('.ln[data-link]')
    if (link && !link.title) link.title = `${link.dataset.link}\n${shortcut('⌘Click')} to open`
  }

  // ── Keyboard and text
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    const byWord = isMac ? e.altKey : e.ctrlKey
    const extend = e.shiftKey
    const move = (to: string) => run({ cmd: 'move', to, extend })
    switch (e.key) {
      case 'ArrowLeft':
        move(isMac && e.metaKey ? 'lineStart' : byWord ? 'wordLeft' : 'left')
        break
      case 'ArrowRight':
        move(isMac && e.metaKey ? 'lineEnd' : byWord ? 'wordRight' : 'right')
        break
      case 'ArrowUp':
        move(isMac && e.metaKey ? 'docStart' : 'up')
        break
      case 'ArrowDown':
        move(isMac && e.metaKey ? 'docEnd' : 'down')
        break
      case 'Home':
        move(e.ctrlKey || e.metaKey ? 'docStart' : 'lineStart')
        break
      case 'End':
        move(e.ctrlKey || e.metaKey ? 'docEnd' : 'lineEnd')
        break
      case 'PageUp':
        move('pageUp')
        break
      case 'PageDown':
        move('pageDown')
        break
      case 'Backspace':
        if (isMac && e.metaKey) {
          if (!engine.state.hasSelection) engine.run({ cmd: 'move', to: 'lineStart', extend: true })
          run({ cmd: 'backspace', word: false })
        } else run({ cmd: 'backspace', word: byWord })
        break
      case 'Delete':
        run({ cmd: 'delete', word: byWord })
        break
      case 'Enter':
        if (mod) run({ cmd: 'pageBreak' })
        else run({ cmd: e.shiftKey ? 'lineBreak' : 'enter' })
        break
      case 'Tab':
        if (mod || e.altKey) return
        run({ cmd: 'tab', shift: e.shiftKey })
        break
      case 'Escape':
        if (!engine.state.headerFooter) return
        run({ cmd: 'exitHeaderFooter' })
        break
      default: {
        if (!mod || e.altKey) return
        const k = e.key.toLowerCase()
        if (k === 'a') run({ cmd: 'selectAll' }, false)
        else if (k === 'z') run({ cmd: e.shiftKey ? 'redo' : 'undo' })
        else if (k === 'y' && !isMac) run({ cmd: 'redo' })
        else if (k === 'b' && !e.shiftKey) run({ cmd: 'toggle', what: 'bold' }, false)
        else if (k === 'i' && !e.shiftKey) run({ cmd: 'toggle', what: 'italic' }, false)
        else if (k === 'u' && !e.shiftKey) run({ cmd: 'toggle', what: 'underline' }, false)
        else return
      }
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const onBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ev = e.nativeEvent as InputEvent
    switch (ev.inputType) {
      case 'insertText':
      case 'insertReplacementText': {
        if (composing.current) return
        const text = ev.data ?? ev.dataTransfer?.getData('text/plain') ?? ''
        e.preventDefault()
        if (text) run({ cmd: 'insertText', text })
        break
      }
      case 'historyUndo':
        e.preventDefault()
        run({ cmd: 'undo' })
        break
      case 'historyRedo':
        e.preventDefault()
        run({ cmd: 'redo' })
        break
      case 'insertParagraph':
      case 'insertLineBreak':
        e.preventDefault()
        break
    }
  }

  const onCompositionStart = () => {
    composing.current = true
    inputRef.current?.classList.add('composing')
  }
  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = false
    const input = inputRef.current!
    input.classList.remove('composing')
    const text = e.data || input.value
    input.value = ''
    if (text) run({ cmd: 'insertText', text })
  }
  const onInput = () => {
    // Anything that got into the field outside a composition was typed: take it as text.
    const input = inputRef.current!
    if (composing.current || !input.value) return
    const text = input.value
    input.value = ''
    run({ cmd: 'insertText', text })
  }

  const onCopy = (e: React.ClipboardEvent, cut: boolean) => {
    if (!engine.state.hasSelection && !engine.state.image) return
    e.preventDefault()
    const out = engine.run<{ text: string; json: string }>({ cmd: cut ? 'cut' : 'copy' })
    e.clipboardData.setData('text/plain', out.text)
    e.clipboardData.setData(WORD_CLIPBOARD, out.json)
  }
  const onPaste = async (e: React.ClipboardEvent) => {
    e.preventDefault()
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      for (const f of files) await insertImageFile(engine, f)
      return
    }
    const json = e.clipboardData.getData(WORD_CLIPBOARD) || null
    run({ cmd: 'paste', text: e.clipboardData.getData('text/plain'), json })
  }

  // ── Overlay: caret, selection, picture frame
  const overlay = engine.overlay
  const pageLeft = (i: number) => Math.max(SIDE, (width - sizes[i][0] * zoom) / 2)

  return (
    <div className="docx-content-mount" ref={mountRef} style={{ height, minWidth: width }} onMouseDown={onMouseDown} onMouseOver={onMouseOver}>
      <div className="docx-pages">
        {sizes.map(([w, h], i) => (
          <div
            key={i}
            className="docx-page"
            data-page-index={i}
            ref={(el) => {
              if (el) pageEls.current.set(i, el)
              else pageEls.current.delete(i)
            }}
            style={{ top: tops[i], width: w * zoom, height: h * zoom, left: '50%', marginLeft: -(w * zoom) / 2 }}
          >
            <div className="docx-page-scale" style={{ width: w, height: h, transform: `scale(${zoom})` }}>
              <div className="docx-page-content" />
              <div className="docx-page-overlay">
                {overlay.marks
                  ?.filter((m) => m[0] === i)
                  .map((m, k) => {
                    const style = engine.markStyles[m[5]]
                    if (!style) return null
                    const active = style.activeId !== undefined && style.activeId === m[6]
                    return <div key={`m${k}`} className="wp-mark" style={{ left: m[1], top: m[2], width: m[3], height: m[4], background: active ? (style.activeColor ?? style.color) : style.color }} />
                  })}
                {overlay.rects
                  .filter((r) => r[0] === i)
                  .map((r, k) => (
                    <div key={k} className="wp-sel" style={{ left: r[1], top: r[2], width: r[3], height: r[4] }} />
                  ))}
                {overlay.caret && overlay.caret[0] === i && !engine.state.hasSelection && (
                  <div key={`c${engine.tick}`} className="wp-caret" style={{ left: overlay.caret[1], top: overlay.caret[2], height: overlay.caret[3] }} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {overlay.image && sizes[overlay.image[0]] && (
        <div
          className="wp-image-frame"
          style={{
            left: pageLeft(overlay.image[0]) + overlay.image[1] * zoom,
            top: tops[overlay.image[0]] + overlay.image[2] * zoom,
            width: overlay.image[3] * zoom,
            height: overlay.image[4] * zoom,
          }}
        >
          {['nw', 'ne', 'sw', 'se'].map((c) => (
            <div key={c} className={`wp-handle ${c}`} data-corner={c} />
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        className="wp-input"
        data-engine-input=""
        aria-label="Document"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onBeforeInput={onBeforeInput}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onCopy={(e) => onCopy(e, false)}
        onCut={(e) => onCopy(e, true)}
        onPaste={(e) => void onPaste(e)}
      />
    </div>
  )
}

/** Reads a picture file and puts it in at the caret. */
export async function insertImageFile(engine: WordEngine, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const bitmap = await createImageBitmap(file).catch(() => null)
  const width = bitmap?.width ?? 400
  const height = bitmap?.height ?? 300
  bitmap?.close()
  engine.doc.insertImage(bytes, file.type || 'image/png', width, height)
  engine.refresh()
}
