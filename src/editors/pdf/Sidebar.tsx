import { ChevronDown, ChevronRight } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { memo, useEffect, useRef, useState } from 'react'

const THUMB_WIDTH = 150

/** Page thumbnails, rendered lazily as they scroll into view. Drag to reorder. */
export function Thumbnails({
  doc,
  current,
  onSelect,
  onMenu,
  onMove,
  active,
}: {
  doc: PDFDocumentProxy
  current: number
  onSelect: (page: number) => void
  onMenu: (index: number, x: number, y: number) => void
  onMove: (from: number, to: number) => void
  active: boolean
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  // Keep the current page's thumbnail in view while reading.
  useEffect(() => {
    if (!active) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-page="${current}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [current, active])

  return (
    <div className="thumbs" ref={listRef}>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <div
          key={i}
          className={`thumb ${current === i + 1 ? 'active' : ''} ${dropAt === i && dragFrom !== null ? 'drop-before' : ''} ${
            dropAt === i + 1 && i === doc.numPages - 1 && dragFrom !== null ? 'drop-after' : ''
          }`}
          data-page={i + 1}
          role="button"
          tabIndex={0}
          aria-label={`Page ${i + 1}`}
          onClick={() => onSelect(i + 1)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelect(i + 1)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelect(i + 1)
            onMenu(i, e.clientX, e.clientY)
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            const startY = e.clientY
            const el = e.currentTarget
            let dragging = false
            el.setPointerCapture(e.pointerId)
            let target: number | null = null
            const move = (ev: PointerEvent) => {
              if (!dragging && Math.abs(ev.clientY - startY) < 6) return
              dragging = true
              setDragFrom(i)
              const items = Array.from(listRef.current!.querySelectorAll<HTMLElement>('.thumb'))
              target = items.length
              for (let j = 0; j < items.length; j++) {
                const r = items[j].getBoundingClientRect()
                if (ev.clientY < r.top + r.height / 2) {
                  target = j
                  break
                }
              }
              setDropAt(target)
              const list = listRef.current!
              const lr = list.getBoundingClientRect()
              if (ev.clientY < lr.top + 30) list.scrollTop -= 12
              else if (ev.clientY > lr.bottom - 30) list.scrollTop += 12
            }
            const up = () => {
              el.removeEventListener('pointermove', move)
              el.removeEventListener('pointerup', up)
              el.removeEventListener('pointercancel', up)
              if (dragging && target !== null) {
                const to = target > i ? target - 1 : target
                if (to !== i) onMove(i, to)
              }
              setDragFrom(null)
              setDropAt(null)
            }
            el.addEventListener('pointermove', move)
            el.addEventListener('pointerup', up)
            el.addEventListener('pointercancel', up)
          }}
        >
          <Thumb doc={doc} pageNumber={i + 1} />
          <span className="thumb-label">{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

const Thumb = memo(function Thumb({ doc, pageNumber }: { doc: PDFDocumentProxy; pageNumber: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [ratio, setRatio] = useState(1.294)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    const el = ref.current!
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        try {
          const page = await doc.getPage(pageNumber)
          const base = page.getViewport({ scale: 1 })
          const scale = (THUMB_WIDTH * 2) / base.width
          const viewport = page.getViewport({ scale })
          if (cancelled) return
          setRatio(viewport.height / viewport.width)
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvas, viewport }).promise
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r))
          if (cancelled || !blob) return
          url = URL.createObjectURL(blob)
          setSrc(url)
        } catch {
          /* document was replaced mid-render */
        }
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
      if (url) URL.revokeObjectURL(url)
    }
  }, [doc, pageNumber])

  return (
    <div className="thumb-page" ref={ref} style={{ aspectRatio: `1 / ${ratio}` }}>
      {src && <img src={src} alt="" draggable={false} />}
    </div>
  )
})

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

export function Outline({ doc, onNavigate }: { doc: PDFDocumentProxy; onNavigate: (dest: string | unknown[]) => void }) {
  const [items, setItems] = useState<OutlineNode[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void doc.getOutline().then((o) => !cancelled && setItems(o ?? []))
    return () => {
      cancelled = true
    }
  }, [doc])

  if (items === null) return null
  if (items.length === 0) return <div className="empty-hint">This PDF doesn’t have an outline.</div>
  return (
    <nav className="list" aria-label="Outline">
      {items.map((item, i) => (
        <OutlineRow key={i} item={item} depth={0} onNavigate={onNavigate} />
      ))}
    </nav>
  )
}

function OutlineRow({ item, depth, onNavigate }: { item: OutlineNode; depth: number; onNavigate: (dest: string | unknown[]) => void }) {
  const [open, setOpen] = useState(depth === 0 && item.items.length < 12)
  const hasChildren = item.items.length > 0
  return (
    <>
      <div className="list-item outline-item" style={{ paddingLeft: 4 + depth * 14 }} onClick={() => item.dest && onNavigate(item.dest)}>
        <span
          className="outline-twisty"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="label" style={{ fontWeight: item.bold ? 600 : undefined, fontStyle: item.italic ? 'italic' : undefined }}>
          {item.title}
        </span>
      </div>
      {open && item.items.map((child, i) => <OutlineRow key={i} item={child} depth={depth + 1} onNavigate={onNavigate} />)}
    </>
  )
}
