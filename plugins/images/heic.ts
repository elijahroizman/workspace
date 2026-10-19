// HEIC photos (iPhones save them) decode natively only in Safari's engine on recent macOS. Elsewhere
// this decodes them with libheif (LGPL-3.0) compiled to WebAssembly. It's a chunk of its own,
// loaded the first time a HEIC needs it.

export async function decodeHeic(bytes: Uint8Array): Promise<ImageData> {
  const { default: factory } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs')
  const libheif = factory()
  const decoder = new libheif.HeifDecoder()
  const images = decoder.decode(bytes)
  if (!images.length) throw new Error('This HEIC file has no picture in it.')
  // The others are thumbnails, depth maps and the like.
  const image = images.find((i) => i.is_primary()) ?? images[0]
  try {
    const width = image.get_width()
    const height = image.get_height()
    return await new Promise<ImageData>((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (data) => {
        if (data) resolve(new ImageData(data.data, data.width, data.height))
        else reject(new Error('Couldn’t decode this HEIC photo.'))
      })
    })
  } finally {
    for (const each of images) each.free()
  }
}
