// Page-level edits (rotate, delete, reorder, insert, extract) using pdf-lib.
// pdf.js renders and annotates; pdf-lib rewrites the page tree.

import { degrees, PDFDocument } from 'pdf-lib'

async function open(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (err) {
    if (String(err).includes('encrypted')) {
      throw new Error('This PDF is encrypted, so its pages can’t be rearranged. You can still view and annotate it.')
    }
    throw err
  }
}

const finish = (doc: PDFDocument) => doc.save({ useObjectStreams: true })

export async function rotatePages(bytes: Uint8Array, indices: number[], delta: 90 | -90) {
  const doc = await open(bytes)
  for (const i of indices) {
    const page = doc.getPage(i)
    page.setRotation(degrees((((page.getRotation().angle + delta) % 360) + 360) % 360))
  }
  return finish(doc)
}

export async function deletePages(bytes: Uint8Array, indices: number[]) {
  const doc = await open(bytes)
  if (indices.length >= doc.getPageCount()) throw new Error('A PDF needs at least one page.')
  for (const i of [...indices].sort((a, b) => b - a)) doc.removePage(i)
  return finish(doc)
}

export async function movePage(bytes: Uint8Array, from: number, to: number) {
  const doc = await open(bytes)
  const [copy] = await doc.copyPages(doc, [from])
  doc.removePage(from)
  doc.insertPage(to, copy)
  return finish(doc)
}

export async function duplicatePage(bytes: Uint8Array, index: number) {
  const doc = await open(bytes)
  const [copy] = await doc.copyPages(doc, [index])
  doc.insertPage(index + 1, copy)
  return finish(doc)
}

/** Insert every page of `other` after `afterIndex` (−1 inserts at the start). */
export async function insertPdf(bytes: Uint8Array, other: Uint8Array, afterIndex: number) {
  const doc = await open(bytes)
  const src = await open(other)
  const pages = await doc.copyPages(src, src.getPageIndices())
  pages.forEach((page, i) => doc.insertPage(afterIndex + 1 + i, page))
  return finish(doc)
}

export async function insertBlankPage(bytes: Uint8Array, afterIndex: number) {
  const doc = await open(bytes)
  const ref = doc.getPage(Math.max(0, afterIndex))
  const { width, height } = ref.getSize()
  doc.insertPage(afterIndex + 1, [width, height])
  return finish(doc)
}

export async function extractPages(bytes: Uint8Array, indices: number[]) {
  const src = await open(bytes)
  const doc = await PDFDocument.create()
  const pages = await doc.copyPages(src, indices)
  pages.forEach((p) => doc.addPage(p))
  return finish(doc)
}
