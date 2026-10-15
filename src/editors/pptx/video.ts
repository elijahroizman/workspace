import { fetchBytes } from '../../lib/platform'

export interface VideoLink {
  url: string
  embedUrl: string
  thumbnailUrl: string | null
  provider: 'youtube' | 'vimeo' | 'other'
}

/** Recognise YouTube and Vimeo links in any of their usual shapes. */
export function parseVideoLink(raw: string): VideoLink | null {
  let url: URL
  try {
    url = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase()
  let id: string | undefined
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? /^\/(?:embed|shorts|live)\/([^/?]+)/.exec(url.pathname)?.[1]
  }
  if (id) {
    const start = url.searchParams.get('t')?.replace(/s$/, '')
    return {
      url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ''}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${parseInt(start)}` : ''}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      provider: 'youtube',
    }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const vid = /(\d{5,})/.exec(url.pathname)?.[1]
    if (vid) return { url: `https://vimeo.com/${vid}`, embedUrl: `https://player.vimeo.com/video/${vid}?autoplay=1`, thumbnailUrl: null, provider: 'vimeo' }
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') return { url: url.toString(), embedUrl: url.toString(), thumbnailUrl: null, provider: 'other' }
  return null
}

/**
 * A 16:9 poster for the slide: the video's thumbnail (when we can fetch it) with a play
 * button, so the link reads as a video in PowerPoint and Keynote too.
 */
export async function videoPoster(link: VideoLink): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (link.thumbnailUrl) {
    try {
      const bytes = await fetchBytes(link.thumbnailUrl)
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
      // hqdefault is 4:3 with letterbox bars; crop to the 16:9 picture.
      const srcH = bitmap.width * (9 / 16)
      ctx.drawImage(bitmap, 0, (bitmap.height - srcH) / 2, bitmap.width, srcH, 0, 0, canvas.width, canvas.height)
    } catch {
      /* offline: keep the plain poster */
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.beginPath()
  ctx.arc(640, 360, 78, 0, Math.PI * 2)
  ctx.fillStyle = link.provider === 'youtube' ? 'rgba(255,0,0,0.92)' : 'rgba(0,0,0,0.7)'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(612, 318)
  ctx.lineTo(612, 402)
  ctx.lineTo(684, 360)
  ctx.closePath()
  ctx.fillStyle = '#fff'
  ctx.fill()
  return canvas.toDataURL('image/jpeg', 0.86)
}
