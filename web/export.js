import { markdownText } from './markdown.js'
import { width, rinkHeight, rinkWidth, drawRink, drawItem } from './drawing.js'

const landscapeA4 = { width: 841.89, height: 595.28 }
const portraitLetter = { width: 612, height: 792 }

function wrap(ctx, text, maxWidth) {
  const lines = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? line + ' ' + word : word
      if (ctx.measureText(next).width <= maxWidth) {
        line = next
        continue
      }
      if (line) lines.push(line)
      line = ''
      for (const character of word) {
        if (ctx.measureText(line + character).width > maxWidth) {
          lines.push(line)
          line = ''
        }
        line += character
      }
    }
    lines.push(line)
  }
  return lines
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w * 2
  canvas.height = h * 2
  const ctx = canvas.getContext('2d')
  ctx.scale(2, 2)
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#152741'
  ctx.textBaseline = 'top'
  return { canvas, ctx }
}

function* makePages(activity, paper, planName = '') {
  const margin = 32
  const pageWidth = width + 2 * margin
  const pageHeight = paper && Math.round(pageWidth * paper.height / paper.width)
  const titleFont = 'bold 28px system-ui'
  const textFont = '18px system-ui'
  const lineHeight = 25
  const { ctx: measure } = makeCanvas(1, 1)
  measure.font = titleFont
  const title = wrap(measure, activity.title.trim() || 'Untitled Drill', width)
  measure.font = textFont
  const planHeading = planName ? wrap(measure, planName, width) : []
  const titleTop = margin + planHeading.length * lineHeight + (planHeading.length ? 8 : 0)
  const lines = activity.description.trim() ? wrap(measure, markdownText(activity.description), width) : []
  const rinkTop = titleTop + title.length * 36 + 12
  const visibleHeight = rinkHeight(activity.layout)
  const descriptionTop = rinkTop + visibleHeight + 24
  let first = true
  let index = 0
  do {
    const top = first ? descriptionTop : margin
    const available = paper ? Math.max(0, Math.floor((pageHeight - margin - top - lineHeight) / lineHeight)) : lines.length
    const pageLines = lines.slice(index, index + available)
    const requestedHeight = paper ? pageHeight : top + margin + (pageLines.length ? (pageLines.length + 1) * lineHeight : 0)
    const { canvas, ctx } = makeCanvas(pageWidth, requestedHeight)
    if (first) {
      ctx.font = 'bold 18px system-ui'
      planHeading.forEach((line, i) => ctx.fillText(line, margin, margin + i * lineHeight))
      ctx.font = titleFont
      title.forEach((line, i) => ctx.fillText(line, margin, titleTop + i * 36))
      ctx.save()
      const visibleWidth = rinkWidth(activity.layout)
      ctx.translate((pageWidth - visibleWidth) / 2, rinkTop)
      ctx.beginPath()
      ctx.rect(0, 0, visibleWidth, visibleHeight)
      ctx.clip()
      drawRink(ctx, false)
      activity.items.forEach(item => drawItem(ctx, item))
      ctx.restore()
    }
    if (pageLines.length) {
      ctx.font = 'bold 18px system-ui'
      ctx.fillText(first ? 'Description' : 'Description (continued)', margin, top)
      ctx.font = textFont
      pageLines.forEach((line, i) => ctx.fillText(line, margin, top + (i + 1) * lineHeight))
    }
    yield canvas
    first = false
    index += pageLines.length
  } while (index < lines.length)
}

function encodeCanvas(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Image encoding failed'))
    }, mime, quality)
  })
}

async function makePdf(pages, paper) {
  const encoder = new TextEncoder()
  const parts = []
  const offsets = [0]
  let size = 0
  function append(value) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value
    size += bytes.byteLength
    parts.push(bytes)
  }
  function object(id, content, stream) {
    offsets[id] = size
    append(id + ' 0 obj\n' + content + '\n')
    if (stream) {
      append('stream\n')
      append(stream)
      append('\nendstream\n')
    }
    append('endobj\n')
  }

  append('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  const refs = []
  for (const canvas of pages) {
    const id = 3 + refs.length * 3
    refs.push(id + ' 0 R')
    const jpeg = await encodeCanvas(canvas, 'image/jpeg', .95)
    const image = new Uint8Array(await jpeg.arrayBuffer())
    const scale = encoder.encode(`q\n${paper.width} 0 0 ${paper.height} 0 0 cm\n/Diagram Do\nQ\n`)
    object(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + paper.width + ' ' + paper.height + '] /Resources << /XObject << /Diagram ' + (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>')
    object(id + 1, '<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + image.byteLength + ' >>', image)
    object(id + 2, '<< /Length ' + scale.byteLength + ' >>', scale)
  }
  object(2, '<< /Type /Pages /Count ' + refs.length + ' /Kids [' + refs.join(' ') + '] >>')
  const xref = size
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n')
  for (const offset of offsets.slice(1)) append(String(offset).padStart(10, '0') + ' 00000 n \n')
  append('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n')
  return new Blob(parts, { type: 'application/pdf' })
}

export async function exportActivity(activity, format) {
  const paper = format === 'pdf' ? landscapeA4 : null
  const pages = makePages(activity, paper)
  const file = paper ? await makePdf(pages, paper) : await encodeCanvas(pages.next().value, 'image/png')
  download(file, activity.title, 'drill', format)
}

export async function exportTrainingPlan(name, activities) {
  function* pages() {
    for (const activity of activities) {
      yield* makePages(activity, portraitLetter, name)
    }
  }

  download(await makePdf(pages(), portraitLetter), name, 'practice-plan', 'pdf')
}

function download(file, title, fallback, format) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  const name = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
  link.download = (name || fallback) + '.' + format
  link.href = url
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
