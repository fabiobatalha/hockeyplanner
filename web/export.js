import { gettext } from './i18n.js'
import { publicUrl } from './urls.js'
import { markdownText } from './markdown.js'
import { width, rinkHeight, rinkWidth, drawRink, drawItem, drawMovementSample, movementLegend } from './drawing.js'
import { drawQr, makeQr } from './qr.js'

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

async function loadPdfLogo() {
  const logo = new Image()
  logo.src = new URL('./hockey-planner-logo.png', import.meta.url)
  await logo.decode()
  return logo
}

function shareQr(token, target) {
  return makeQr(publicUrl('share/' + token + '/' + target).href)
}

function pdfDivider(codes) {
  return codes.length ? 170 : 88
}

function drawPdfHeader(ctx, logo, pageWidth, margin, codes) {
  const logoWidth = 184
  ctx.drawImage(logo, margin, 18, logoWidth, logoWidth * logo.naturalHeight / logo.naturalWidth)
  for (const [index, { code, label }] of codes.entries()) {
    const center = pageWidth - margin - 66 - (codes.length - 1 - index) * 156
    drawQr(ctx, code, center, 10, 132)
    ctx.fillStyle = '#152741'
    ctx.font = '14px system-ui'
    ctx.save()
    ctx.textAlign = 'center'
    wrap(ctx, label, codes.length > 1 ? 140 : 200)
      .forEach((line, index) => ctx.fillText(line, center, 138 + index * 15))
    ctx.restore()
  }
  ctx.fillStyle = '#c7d5ea'
  ctx.fillRect(margin, pdfDivider(codes), pageWidth - 2 * margin, 1)
}

const freeNoticeHeight = 116
const publicDrillNotice = gettext('Free accounts include a public QR code in exported drill PDFs. Anyone with the code can view the saved drill. Upgrade to Full Access to export drill PDFs without public sharing.')
const noticeLineHeight = 24

function drawFreeNotice(ctx, code, pageWidth, margin, top, noticeHeight, noticeLines) {
  const w = pageWidth - 2 * margin
  ctx.fillStyle = '#e6efff'
  ctx.fillRect(margin, top, w, noticeHeight)
  ctx.fillStyle = '#174fc9'
  ctx.fillRect(margin, top, 6, noticeHeight)
  const left = margin + 22
  ctx.fillStyle = '#102346'
  ctx.font = 'bold 23px system-ui'
  ctx.fillText(gettext('Created with Hockey Planner Free'), left, top + 17)
  ctx.font = '18px system-ui'
  ctx.fillText(gettext('These drills and practice plans were developed with a free Hockey Planner account.'), left, top + 49)
  ctx.font = 'bold 18px system-ui'
  ctx.fillText(gettext('Create an account at %(host)s or scan the QR code.', { host: publicUrl().host }), left, top + 77)
  ctx.font = '18px system-ui'
  noticeLines.forEach((line, index) => ctx.fillText(line, left, top + 105 + index * noticeLineHeight))
  drawQr(ctx, code, pageWidth - margin - 64, top + 9, 98)
}

function signupQr() {
  return document.body.hasAttribute('data-free-pdf') ? makeQr(publicUrl('register').href) : null
}

function drawPdfFooter(ctx, pageWidth, pageHeight, margin) {
  const y = pageHeight - 45
  ctx.fillStyle = '#c7d5ea'
  ctx.fillRect(margin, y, pageWidth - 2 * margin, 1)
  ctx.fillStyle = '#536783'
  ctx.font = '16px system-ui'
  ctx.fillText('© 2026 Hockey Planner', margin, y + 12)
  ctx.textAlign = 'right'
  ctx.fillText('info@hockeyplanner.ca', pageWidth - margin, y + 12)
}

const legendRowHeight = 32
const legendHeadingHeight = 28

function drawMovementLegend(ctx, entries, left, top) {
  ctx.fillStyle = '#152741'
  ctx.font = 'bold 18px system-ui'
  ctx.fillText(gettext('Movement Legend'), left, top)
  for (const [index, { type, label }] of entries.entries()) {
    const x = left + (index % 2) * width / 2
    const y = top + legendHeadingHeight + Math.floor(index / 2) * legendRowHeight
    drawMovementSample(ctx, type, x, y + 13)
    ctx.fillStyle = '#152741'
    ctx.font = '17px system-ui'
    ctx.fillText(label, x + 135, y + 3)
  }
}

function* makePages(activity, paper, { logo, planName = '', codes = [], signup, notice = '' } = {}) {
  const margin = 32
  const pageWidth = width + 2 * margin
  const pageHeight = paper && Math.round(pageWidth * paper.height / paper.width)
  const titleFont = 'bold 28px system-ui'
  const textFont = '18px system-ui'
  const lineHeight = 25
  const { ctx: measure } = makeCanvas(1, 1)
  measure.font = titleFont
  const title = wrap(measure, activity.title.trim() || gettext('Untitled Drill'), width)
  measure.font = textFont
  const noticeLines = signup && notice ? wrap(measure, notice, width - 160) : []
  const planHeading = planName ? wrap(measure, planName, width) : []
  const lines = activity.description.trim() ? wrap(measure, markdownText(activity.description), width) : []
  const visibleHeight = rinkHeight(activity.layout)
  const legend = paper ? movementLegend(activity.items) : []
  const legendHeight = legend.length ? legendHeadingHeight + Math.ceil(legend.length / 2) * legendRowHeight + 14 : 0
  let first = true
  let index = 0
  do {
    const pageCodes = first ? codes : []
    const pageNoticeLines = first ? noticeLines : []
    const noticeHeight = freeNoticeHeight + pageNoticeLines.length * noticeLineHeight
    const noticeTop = paper ? pdfDivider(pageCodes) + 18 : margin
    const headerTop = signup ? noticeTop + noticeHeight + 20 : noticeTop
    const titleTop = headerTop + planHeading.length * lineHeight + (planHeading.length ? 8 : 0)
    const rinkTop = titleTop + title.length * 36 + 12
    const footerTop = pageHeight - 65
    const rinkScale = paper ? Math.max(.3, Math.min(1, (footerTop - rinkTop - 24 - legendHeight) / visibleHeight)) : 1
    const legendTop = rinkTop + visibleHeight * rinkScale + 24
    const top = first ? legendTop + legendHeight : headerTop
    const available = paper ? Math.max(0, Math.floor((footerTop - top - lineHeight) / lineHeight)) : lines.length
    const pageLines = lines.slice(index, index + available)
    const requestedHeight = paper ? pageHeight : top + margin + (pageLines.length ? (pageLines.length + 1) * lineHeight : 0)
    const { canvas, ctx } = makeCanvas(pageWidth, requestedHeight)
    if (paper) drawPdfHeader(ctx, logo, pageWidth, margin, pageCodes)
    if (signup) drawFreeNotice(ctx, signup, pageWidth, margin, noticeTop, noticeHeight, pageNoticeLines)
    ctx.fillStyle = '#152741'
    if (first) {
      ctx.font = 'bold 18px system-ui'
      planHeading.forEach((line, i) => ctx.fillText(line, margin, headerTop + i * lineHeight))
      ctx.font = titleFont
      title.forEach((line, i) => ctx.fillText(line, margin, titleTop + i * 36))
      ctx.save()
      const visibleWidth = rinkWidth(activity.layout)
      ctx.translate((pageWidth - visibleWidth * rinkScale) / 2, rinkTop)
      ctx.scale(rinkScale, rinkScale)
      ctx.beginPath()
      ctx.rect(0, 0, visibleWidth, visibleHeight)
      ctx.clip()
      drawRink(ctx, false)
      activity.items.forEach(item => drawItem(ctx, item))
      ctx.restore()
      if (legend.length) drawMovementLegend(ctx, legend, margin, legendTop)
    }
    if (pageLines.length) {
      ctx.font = 'bold 18px system-ui'
      ctx.fillText(first ? gettext('Description') : gettext('Description (continued)'), margin, top)
      ctx.font = textFont
      pageLines.forEach((line, i) => ctx.fillText(line, margin, top + (i + 1) * lineHeight))
    }
    if (paper) drawPdfFooter(ctx, pageWidth, pageHeight, margin)
    yield canvas
    first = false
    index += pageLines.length
  } while (index < lines.length)
}

function encodeCanvas(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error(gettext('Image encoding failed')))
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

export async function exportActivity(activity, format, token) {
  const paper = format === 'pdf' ? portraitLetter : null
  const codes = token && activity.id ? [{ code: shareQr(token, 'drill/' + activity.id), label: gettext('Scan to view drill') }] : []
  const pages = makePages(activity, paper, paper ? {
    logo: await loadPdfLogo(), codes, signup: signupQr(), notice: codes.length ? publicDrillNotice : '',
  } : undefined)
  const file = paper ? await makePdf(pages, paper) : await encodeCanvas(pages.next().value, 'image/png')
  download(file, activity.title, 'drill', format)
}

export async function exportTrainingPlan(name, activities, token) {
  const logo = await loadPdfLogo()
  const planCode = token ? { code: shareQr(token, 'present'), label: gettext('Scan to view full plan') } : null
  const signup = signupQr()
  function* pages() {
    for (const activity of activities) {
      const codes = planCode ? [planCode] : []
      if (token && activity.id) codes.push({ code: shareQr(token, 'drill/' + activity.id), label: gettext('Scan to view drill') })
      yield* makePages(activity, portraitLetter, { logo, planName: name, codes, signup })
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
