/** Starter slides offered by the New slide menu. */
export const NEW_SLIDE_TEMPLATES = ['titleAndContent', 'title', 'sectionHeader', 'twoContent', 'comparison', 'titleOnly', 'quote', 'closing', 'blank'] as const
export type TemplateId = (typeof NEW_SLIDE_TEMPLATES)[number]
const LABELS: Record<TemplateId, string> = {
  titleAndContent: 'Title and Content', title: 'Title Slide', sectionHeader: 'Section Header', twoContent: 'Two Content', comparison: 'Comparison', titleOnly: 'Title Only', quote: 'Quote', closing: 'Closing', blank: 'Blank',
}
export const templateLabel = (id: TemplateId) => LABELS[id]
