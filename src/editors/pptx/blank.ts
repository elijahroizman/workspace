/** A clean 16:9 starter deck: a title slide and a content slide to duplicate. */
export async function blankPresentation(): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = 'Untitled Presentation'

  const font = 'Helvetica Neue'
  const title = pptx.addSlide()
  title.background = { color: 'FFFFFF' }
  title.addText('Presentation title', { x: 0.9, y: 2.6, w: 11.5, h: 1.2, fontFace: font, fontSize: 48, bold: true, color: '111111' })
  title.addText('Subtitle or presenter', { x: 0.9, y: 3.8, w: 11.5, h: 0.7, fontFace: font, fontSize: 22, color: '6B6B70' })

  const content = pptx.addSlide()
  content.background = { color: 'FFFFFF' }
  content.addText('Slide title', { x: 0.9, y: 0.6, w: 11.5, h: 1, fontFace: font, fontSize: 34, bold: true, color: '111111' })
  content.addText(
    [
      { text: 'First point', options: { bullet: true, breakLine: true } },
      { text: 'Second point', options: { bullet: true, breakLine: true } },
      { text: 'Third point', options: { bullet: true } },
    ],
    { x: 0.9, y: 1.9, w: 11.5, h: 4.2, fontFace: font, fontSize: 24, color: '333333', valign: 'top', paraSpaceAfter: 10 },
  )

  const out = await pptx.write({ outputType: 'uint8array' })
  return out as Uint8Array
}
