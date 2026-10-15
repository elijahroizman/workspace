// One-time setup for the PowerPoint engine (pptx-react-viewer).
import i18n from 'i18next'
import css from 'pptx-react-viewer/styles.css?inline'
import { translationsEn } from 'pptx-react-viewer/i18n'
import { initReactI18next } from 'react-i18next'

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: translationsEn } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })
}

/** Remove one `@layer name{…}` block from a stylesheet. */
function stripLayer(source: string, name: string) {
  const start = source.indexOf(`@layer ${name}{`)
  if (start === -1) return source
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(0, start) + source.slice(i + 1)
  }
  return source
}

// The engine ships Tailwind's global reset ("preflight") in @layer base, which would restyle
// every list, heading and button elsewhere in the app. Load its stylesheet without that layer.
const style = document.createElement('style')
style.dataset.source = 'pptx-react-viewer'
style.textContent = stripLayer(css, 'base')
document.head.appendChild(style)
