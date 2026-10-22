import { ArrowLeft, ArrowRight, Check, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { canSetDefaults, defaultStatus, makeDefault } from '../lib/defaults'
import { isMac, isTauri, showError } from '../lib/platform'
import { PLUGINS, isBuiltIn } from '../plugins/catalog'
import { EXTRA_FONTS } from '../state/fonts'
import { enabledKinds, usePlugins } from '../state/plugins'
import { useSetup } from '../state/setup'
import { keysFor } from '../state/shortcuts'
import { PluginRow } from './PluginList'
import { Button, Checkbox, DocBadge, Kbd, LinkButton, Logo, Modal, Spinner, StepDots, Switch } from './ui'

type Step = 'welcome' | 'palette' | 'word' | 'slides' | 'pdf' | 'extras' | 'split' | 'defaults' | 'windows'

/**
 * The first-launch screen (and Settings › General › Show the tour again): a short tour of what
 * Writan does, the optional extensions, and on a Mac or Windows which file types it should open.
 * Every step can be skipped.
 */
export default function SetupScreen() {
  const steps: Step[] = ['welcome', 'palette', 'word', 'slides', 'pdf', 'extras', 'split', ...(canSetDefaults ? (['defaults'] as const) : [])]
  const [step, setStep] = useState<Step>('welcome')
  const at = steps.indexOf(step)
  const finish = () => useSetup.getState().finish()
  const next = () => (at + 1 < steps.length ? setStep(steps[at + 1]) : finish())
  const back = () => at > 0 && setStep(steps[at - 1])

  // ← and → step through the tour (not while typing or on a checkbox).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight' && step !== 'defaults' && step !== 'windows') next()
      else if (e.key === 'ArrowLeft' && step !== 'windows') back()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal dim="blur" layer="welcome">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        {step === 'welcome' ? (
          <Welcome onTour={next} onSkip={finish} />
        ) : step === 'defaults' ? (
          <DefaultsStep onBack={back} onDone={(windowsNote) => (windowsNote ? setStep('windows') : finish())} />
        ) : step === 'windows' ? (
          <div className="welcome-hero">
            <Logo size={64} />
            <h1 id="welcome-title">One more thing in Windows Settings</h1>
            <p className="muted">In the Settings window that opened, choose Writan for each file type. Everything else is ready.</p>
            <Button variant="primary" autoFocus onClick={finish}>
              Start using Writan
            </Button>
          </div>
        ) : (
          <>
            <TourStep step={step} />
            <footer className="tour-footer">
              <StepDots count={steps.length - 1} current={at - 1} onPick={(i) => setStep(steps[i + 1])} label="Tour steps" />
              <span className="tour-footer-actions">
                {at + 1 < steps.length && <LinkButton onClick={finish}>Skip tour</LinkButton>}
                <Button onClick={back} aria-label="Back">
                  <ArrowLeft size={14} />
                </Button>
                <Button variant="primary" autoFocus onClick={next}>
                  {at + 1 < steps.length ? (
                    <>
                      Next <ArrowRight size={14} />
                    </>
                  ) : (
                    'Start using Writan'
                  )}
                </Button>
              </span>
            </footer>
          </>
        )}
      </div>
    </Modal>
  )
}

function Welcome({ onTour, onSkip }: { onTour: () => void; onSkip: () => void }) {
  const builtIn = PLUGINS.filter(isBuiltIn).flatMap((p) => p.kinds)
  return (
    <div className="welcome-hero">
      <Logo size={88} label="Writan" />
      <h1 id="welcome-title">Welcome to Writan</h1>
      <p className="muted">A small, fast app for the documents most people actually open.</p>
      <div className="welcome-kinds">
        {builtIn.map((k) => (
          <span key={k.id} className="welcome-kind">
            <DocBadge kind={k.id} size={18} />
            {k.prose === 'text' || k.prose === 'image' ? k.short : k.prose}
          </span>
        ))}
      </div>
      <div className="welcome-actions">
        <Button variant="primary" autoFocus onClick={onTour}>
          Show me around <ArrowRight size={14} />
        </Button>
        <Button variant="quiet" onClick={onSkip}>
          Skip
        </Button>
      </div>
    </div>
  )
}

/** A shortcut and what it does, in a tour step's list. */
function KeyRow({ id, keys, children }: { id?: string; keys?: string; children: ReactNode }) {
  const shown = keys ?? (id ? keysFor(id) : '')
  return (
    <li>
      <span>{children}</span>
      {shown ? <Kbd keys={shown} /> : null}
    </li>
  )
}

function TourStep({ step }: { step: Step }) {
  const page = TOUR[step as keyof typeof TOUR]
  return (
    <div className="tour">
      <div className="tour-art" aria-hidden>
        {page.art}
      </div>
      <div className="tour-text">
        <span className="tour-eyebrow">{page.eyebrow}</span>
        <h1 id="welcome-title">{page.title}</h1>
        <p className="muted">{page.body}</p>
        {page.keys && <ul className="tour-keys">{page.keys}</ul>}
        {page.extra}
      </div>
    </div>
  )
}

interface TourPage {
  eyebrow: string
  title: string
  body: string
  keys: ReactNode
  art: ReactNode
  extra?: ReactNode
}

const TOUR: Record<'palette' | 'word' | 'slides' | 'pdf' | 'extras' | 'split', TourPage> = {
  palette: {
    eyebrow: 'Command palette',
    title: 'Everything is one search away',
    body: 'Type a few letters to run any command, open a recent file, jump to a tab or change a setting. Commands show their shortcuts, so you pick them up as you go.',
    keys: (
      <>
        <KeyRow id="command-palette">Command palette</KeyRow>
        <KeyRow id="new">New file</KeyRow>
        <KeyRow id="open">Open a file or folder</KeyRow>
      </>
    ),
    art: <PaletteArt />,
  },
  word: {
    eyebrow: 'Word documents',
    title: 'Pages that look like they will print',
    body: 'Edit .docx files with styles, lists, tables, pictures, links, comments, headers and footers. The outline is on the left, formatting on the right.',
    keys: (
      <>
        <KeyRow id="replace">Find and replace</KeyRow>
        <KeyRow id="docx.comment">Add a comment</KeyRow>
        <KeyRow id="focus-mode">Focus mode</KeyRow>
      </>
    ),
    art: <WordArt />,
  },
  slides: {
    eyebrow: 'Presentations',
    title: 'Slides, notes and the show',
    body: 'Edit text, shapes, tables and pictures on PowerPoint slides. Drag thumbnails to reorder, write speaker notes under the slide, add transitions and present full screen.',
    keys: (
      <>
        <KeyRow id="pptx.new-slide">New slide</KeyRow>
        <KeyRow id="pptx.duplicate">Duplicate</KeyRow>
        <KeyRow id="pptx.present">Play from this slide</KeyRow>
      </>
    ),
    art: <SlidesArt />,
  },
  pdf: {
    eyebrow: 'PDF',
    title: 'Mark up, fill in, sign',
    body: 'Highlight, add text and drawings, fill in forms and sign with a saved signature. Rotate, move, insert or extract pages from the thumbnails, and save a flattened copy to send.',
    keys: (
      <>
        <KeyRow keys="">Sign: in the inspector, under Sign</KeyRow>
        <KeyRow keys="">Pages: drag thumbnails, or right-click one</KeyRow>
        <KeyRow id="find">Find in the PDF</KeyRow>
      </>
    ),
    art: <PdfArt />,
  },
  extras: {
    eyebrow: 'Fonts and extensions',
    title: 'Add only what you need',
    body: 'Writan stays small. Extra fonts for Word and PowerPoint download when you turn them on, and extensions add file types. Both live in Settings › Plugins.',
    keys: null,
    art: <ExtrasArt />,
    extra: <ExtensionsList />,
  },
  split: {
    eyebrow: 'Split view',
    title: 'Two documents side by side',
    body: 'Put a Word document or PDF beside another one, or beside a second copy of itself: questions on one side, answers on the other. Right-click a tab and pick Open to the side… to start from there.',
    keys: (
      <>
        <KeyRow id="split-view">Split view</KeyRow>
        <KeyRow id="toggle-left">Sidebar</KeyRow>
        <KeyRow id="toggle-right">Inspector</KeyRow>
      </>
    ),
    art: <SplitArt />,
  },
}

/** The optional plugins, with switches: the setup screen's old plugin step, in the tour. */
function ExtensionsList() {
  const enabled = usePlugins((s) => s.enabled)
  const progress = usePlugins((s) => s.progress)
  const { enable, disable } = usePlugins.getState()
  return (
    <div className="tour-extensions">
      {PLUGINS.filter((p) => !isBuiltIn(p)).map((p) => (
        <PluginRow
          key={p.id}
          plugin={p}
          control={progress[p.id] ? <Spinner size={16} /> : <Switch label={`Use ${p.name}`} checked={!!enabled[p.id]} onChange={(on) => void (on ? enable(p.id) : disable(p.id))} />}
        />
      ))}
    </div>
  )
}

function DefaultsStep({ onBack, onDone }: { onBack: () => void; onDone: (windowsNote: boolean) => void }) {
  const enabled = usePlugins((s) => s.enabled)
  const kinds = enabledKinds(enabled)
  const [defaults, setDefaults] = useState<Record<string, boolean>>({})
  const [already, setAlready] = useState<Record<string, boolean | null>>({})
  const [busy, setBusy] = useState(false)
  const wanted = kinds.filter((k) => defaults[k.id] && !already[k.id])
  const allOn = kinds.every((k) => defaults[k.id] || already[k.id])

  useEffect(() => {
    void defaultStatus(kinds.map((k) => k.id)).then(setAlready, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = async () => {
    if (!wanted.length) return onDone(false)
    setBusy(true)
    try {
      onDone(await makeDefault(wanted.map((k) => k.id)))
    } catch (err) {
      await showError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="welcome-defaults">
        <span className="tour-eyebrow">Last step</span>
        <h1 id="welcome-title">Open files with Writan?</h1>
        <p className="muted">
          {isMac
            ? 'Tick the file types Writan should open when you double-click them in Finder.'
            : 'Tick the file types Writan should open when you double-click them. Windows asks you to confirm in its Settings.'}
        </p>
        <div className="setup-defaults">
          {kinds.map((k) => (
            <Checkbox
              key={k.id}
              className="setup-default"
              checked={!!already[k.id] || !!defaults[k.id]}
              disabled={!!already[k.id] || busy}
              onChange={(on) => setDefaults({ ...defaults, [k.id]: on })}
              label={
                <>
                  <DocBadge kind={k.id} size={24} />
                  <span className="setup-default-name">
                    {k.label}
                    <span className="faint"> {k.extensions.map((e) => `.${e}`).join(' ')}</span>
                  </span>
                  {already[k.id] && <span className="faint">Already opens in Writan</span>}
                </>
              }
            />
          ))}
        </div>
        <LinkButton disabled={busy} onClick={() => setDefaults(Object.fromEntries(kinds.map((k) => [k.id, !allOn])))}>
          {allOn ? 'Untick all' : 'Tick all'}
        </LinkButton>
      </div>
      <footer className="tour-footer">
        <span />
        <span className="tour-footer-actions">
          <Button disabled={busy} onClick={onBack} aria-label="Back">
            <ArrowLeft size={14} />
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void apply()}>
            {wanted.length ? 'Set as default' : 'Start using Writan'}
          </Button>
        </span>
      </footer>
    </>
  )
}

/* ───────────────────────── The tour's pictures ─────────────────────────
 * Small drawings of the app built from the theme's own colours, so they match light, dark and
 * custom themes. Lines stand in for text.
 */

function MockWindow({ tabs, children }: { tabs: { kind: string; name: string }[]; children: ReactNode }) {
  return (
    <div className="mock-window">
      <div className="mock-tabs">
        {tabs.map((t, i) => (
          <span key={t.name} className={`mock-tab ${i === 0 ? 'on' : ''}`}>
            <span className="mock-tab-dot" style={{ background: `var(--kind-${t.kind})` }} />
            {t.name}
          </span>
        ))}
      </div>
      <div className="mock-body">{children}</div>
    </div>
  )
}

function Lines({ widths, className = '' }: { widths: number[]; className?: string }) {
  return (
    <>
      {widths.map((w, i) => (
        <span key={i} className={`mock-line ${className}`} style={{ width: `${w}%` }} />
      ))}
    </>
  )
}

function PaletteArt() {
  return (
    <MockWindow tabs={[{ kind: 'docx', name: 'Report.docx' }, { kind: 'pdf', name: 'Invoice.pdf' }]}>
      <div className="mock-page dim">
        <span className="mock-title" />
        <Lines widths={[100, 92, 96, 60]} />
      </div>
      <div className="mock-palette">
        <div className="mock-palette-search">
          <Search size={12} />
          <span>spl</span>
          <span className="mock-caret" />
        </div>
        <div className="mock-palette-row on">
          Split view <Kbd keys={keysFor('split-view')} />
        </div>
        <div className="mock-palette-row">
          <span className="mock-tab-dot" style={{ background: 'var(--kind-pdf)' }} />
          Split-level floor plan.pdf <span className="faint">Recent</span>
        </div>
      </div>
    </MockWindow>
  )
}

function WordArt() {
  return (
    <MockWindow tabs={[{ kind: 'docx', name: 'Report.docx' }, { kind: 'pptx', name: 'Deck.pptx' }]}>
      <div className="mock-split">
        <div className="mock-sidebar">
          <Lines widths={[80, 60, 70, 50]} className="thin" />
        </div>
        <div className="mock-page">
          <span className="mock-title" />
          <Lines widths={[100, 94, 97]} />
          <span className="mock-line" style={{ width: '58%' }}>
            <span className="mock-comment-mark" />
          </span>
          <div className="mock-table">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <Lines widths={[90, 70]} />
          <span className="mock-comment">
            <span className="mock-line thin" style={{ width: '80%' }} />
            <span className="mock-line thin" style={{ width: '55%' }} />
          </span>
        </div>
        <div className="mock-inspector">
          <span className="mock-pill wide" />
          <span className="mock-pill-row">
            <span className="mock-pill b">B</span>
            <span className="mock-pill i">I</span>
            <span className="mock-pill u">U</span>
          </span>
          <span className="mock-pill wide" />
          <span className="mock-swatches">
            {['#1d1d1f', '#4f8cff', '#f2555a', '#3ecf8e'].map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
        </div>
      </div>
    </MockWindow>
  )
}

function SlidesArt() {
  return (
    <MockWindow tabs={[{ kind: 'pptx', name: 'Deck.pptx' }, { kind: 'docx', name: 'Report.docx' }]}>
      <div className="mock-split">
        <div className="mock-strip">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`mock-thumb ${i === 1 ? 'on' : ''}`}>
              <span className="mock-line thin" style={{ width: '60%' }} />
            </span>
          ))}
        </div>
        <div className="mock-stage">
          <div className="mock-slide">
            <span className="mock-slide-title" />
            <span className="mock-slide-shape" />
            <span className="mock-slide-chart">
              {[40, 70, 55, 90].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </span>
          </div>
          <div className="mock-notes">
            <Lines widths={[70, 45]} className="thin" />
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

function PdfArt() {
  return (
    <MockWindow tabs={[{ kind: 'pdf', name: 'Lease.pdf' }, { kind: 'docx', name: 'Report.docx' }]}>
      <div className="mock-split">
        <div className="mock-strip">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`mock-thumb portrait ${i === 0 ? 'on' : ''}`} />
          ))}
        </div>
        <div className="mock-page">
          <span className="mock-title" />
          <span className="mock-line" style={{ width: '100%' }} />
          <span className="mock-line mock-highlight" style={{ width: '88%' }} />
          <Lines widths={[95, 70]} />
          <span className="mock-field">
            <Check size={10} strokeWidth={3} />
          </span>
          <svg className="mock-signature" viewBox="0 0 120 40" fill="none">
            <path d="M4 28c10-18 16-22 18-14s-6 18 2 14 12-20 16-12-4 14 4 10 10-16 16-12 2 10 10 8 18-10 24-12 14 0 22-2" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="mock-sign-line" />
        </div>
      </div>
    </MockWindow>
  )
}

function ExtrasArt() {
  const fonts = EXTRA_FONTS.slice(0, 4)
  return (
    <div className="mock-fonts">
      {fonts.map((f, i) => (
        <div key={f.id} className="mock-font">
          <span className="mock-font-sample" style={{ fontFamily: f.fallback }}>
            Aa
          </span>
          <span className="mock-font-text">
            <strong>{f.family}</strong>
            <span className="faint">{f.maker}</span>
          </span>
          <span className={`mock-switch ${i % 2 === 0 ? 'on' : ''}`} />
        </div>
      ))}
      {!isTauri && <span className="faint mock-fonts-note">Fonts download in the app.</span>}
    </div>
  )
}

function SplitArt() {
  return (
    <MockWindow tabs={[{ kind: 'pdf', name: 'Questions.pdf' }, { kind: 'pdf', name: 'Answers.pdf' }]}>
      <div className="mock-panes">
        <div className="mock-pane on">
          <div className="mock-page">
            <span className="mock-title" />
            <Lines widths={[100, 90, 95, 40]} />
            <span className="mock-line mock-highlight" style={{ width: '75%' }} />
            <Lines widths={[85, 60]} />
          </div>
        </div>
        <div className="mock-divider" />
        <div className="mock-pane">
          <div className="mock-page">
            <span className="mock-title short" />
            <Lines widths={[96, 100, 80]} />
            <Lines widths={[92, 66, 88]} />
          </div>
        </div>
      </div>
    </MockWindow>
  )
}
