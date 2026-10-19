import { customFonts } from '@docx-editor.dev/core/editor'
import { isTauri } from '../../lib/platform'
import { EXTRA_FONTS, FONT_CACHE, FONT_HOST, faceBytes, useExtraFonts } from '../../state/fonts'

/**
 * For the Word engine: every downloaded extra font, read through the app instead of the network.
 * Fonts that aren't downloaded fail quietly and don't show in its font menu.
 */
export const extraWordFonts = customFonts({
  sources: EXTRA_FONTS.flatMap((font) =>
    font.faces.map((face) => ({ url: `${FONT_HOST}${font.id}/${face.file}`, family: font.family, weight: face.weight, style: face.style, hash: `sha256:${face.hash}` })),
  ),
  cacheName: FONT_CACHE,
  fetcher: async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const [id, file] = url.slice(FONT_HOST.length).split('/')
    if (!url.startsWith(FONT_HOST) || !isTauri || !useExtraFonts.getState().installed[id]) return new Response(null, { status: 404 })
    return new Response(await faceBytes(id, file), { headers: { 'Content-Type': 'font/ttf' } })
  },
  onFailure: () => {},
})
