function blocks(source) {
  const result = []
  let current
  function add(kind, text, level) {
    current = { kind, lines: [text], level }
    result.push(current)
  }

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (current?.kind === 'pre') current = null
      else {
        add('pre', '')
        current.lines.length = 0
      }
      continue
    }
    if (current?.kind === 'pre') {
      current.lines.push(line)
      continue
    }
    if (!line.trim()) {
      current = null
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      add('heading', heading[2], heading[1].length)
      continue
    }
    const bullet = /^\s*[-+*]\s+(.+)$/.exec(line)
    const ordered = /^\s*(\d+)\.\s+(.+)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)
    const kind = bullet ? 'ul' : ordered ? 'ol' : quote ? 'blockquote' : 'p'
    const content = bullet?.[1] ?? ordered?.[2] ?? quote?.[1] ?? line
    if (current?.kind === kind) current.lines.push(content)
    else add(kind, content, ordered ? Number(ordered[1]) : undefined)
  }
  return result
}

function inline(text) {
  const parts = []
  const pattern = /(\*\*\*[^*\n]+\*\*\*|___[^_\n]+___)|\\([\\`*_\[\]])|(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|(?<!\w)_[^_\n]+_(?!\w))|\[([^\]\n]+)\]\(([^\s)]+)\)/g
  let end = 0
  for (const match of text.matchAll(pattern)) {
    const [full, combined, escaped, code, bold, italic, label, url] = match
    if (match.index > end) parts.push({ text: text.slice(end, match.index) })
    if (combined) parts.push({ tag: 'strong', inner: 'em', text: combined.slice(3, -3) })
    else if (escaped) parts.push({ text: escaped })
    else if (code) parts.push({ tag: 'code', text: code.slice(1, -1) })
    else if (bold) parts.push({ tag: 'strong', text: bold.slice(2, -2) })
    else if (italic) parts.push({ tag: 'em', text: italic.slice(1, -1) })
    else parts.push({ tag: /^https?:\/\//i.test(url) ? 'a' : null, text: label, url })
    end = match.index + full.length
  }
  if (end < text.length) parts.push({ text: text.slice(end) })
  return parts
}

function appendInline(element, text) {
  for (const part of inline(text)) {
    if (!part.tag) {
      element.append(part.text)
      continue
    }
    const node = document.createElement(part.tag)
    if (part.inner) {
      const inner = document.createElement(part.inner)
      inner.textContent = part.text
      node.append(inner)
    } else {
      node.textContent = part.text
    }
    if (part.tag === 'a') {
      node.href = part.url
      node.target = '_blank'
      node.rel = 'noopener noreferrer'
    }
    element.append(node)
  }
}

export function markdownText(source) {
  return blocks(source).map(({ kind, lines, level }) => {
    if (kind === 'pre') return lines.join('\n')
    return lines.map((line, index) => {
      const text = inline(line).map(part => part.text).join('')
      if (kind === 'ul') return '• ' + text
      if (kind === 'ol') return (level + index) + '. ' + text
      if (kind === 'blockquote') return '› ' + text
      return text
    }).join('\n')
  }).join('\n\n')
}

export function renderMarkdown(source, target) {
  target.replaceChildren()
  for (const { kind, lines, level } of blocks(source)) {
    const node = document.createElement(kind === 'heading' ? 'h' + level : kind)
    if (kind === 'pre') {
      const code = document.createElement('code')
      code.textContent = lines.join('\n')
      node.append(code)
    } else if (kind === 'ul' || kind === 'ol') {
      if (kind === 'ol') node.start = level
      for (const line of lines) {
        const item = document.createElement('li')
        appendInline(item, line)
        node.append(item)
      }
    } else {
      lines.forEach((line, index) => {
        if (index) node.append(document.createElement('br'))
        appendInline(node, line)
      })
    }
    target.append(node)
  }
}

export function drillSearch(query) {
  const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  return (drill, source = '') => {
    if (!terms.length) return true
    const text = normalize([drill.title, markdownText(drill.description ?? ''), source].join(' '))
    return terms.every(term => text.includes(term))
  }
}

export function setupMarkdown(input, visual, toggle) {
  let sourceMode = false
  function render() {
    renderMarkdown(input.value, visual)
  }

  function format(kind) {
    let { selectionStart: start, selectionEnd: end, value } = input
    const markers = { bold: '**', italic: '*' }
    const marker = markers[kind]
    let replacement
    if (marker) {
      replacement = marker + (value.slice(start, end) || 'text') + marker
    } else {
      start = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
      const endOfLine = value.indexOf('\n', end)
      end = endOfLine < 0 ? value.length : endOfLine
      const prefix = kind === 'heading' ? '## ' : '- '
      replacement = (value.slice(start, end) || 'text').split('\n').map((line, i) => (
        (kind === 'ordered' ? (i + 1) + '. ' : prefix) + line
      )).join('\n')
    }
    input.focus()
    input.setRangeText(replacement, start, end, 'select')
    if (marker) input.setSelectionRange(start + marker.length, start + replacement.length - marker.length)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function storeVisual() {
    input.value = visualMarkdown(visual)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  visual.addEventListener('input', storeVisual)
  visual.addEventListener('paste', event => {
    event.preventDefault()
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
  })
  toggle.addEventListener('click', () => {
    sourceMode = !sourceMode
    input.hidden = !sourceMode
    visual.hidden = sourceMode
    toggle.textContent = sourceMode ? 'Edit Visually' : 'Edit Markdown'
    if (!sourceMode) render()
    const editor = sourceMode ? input : visual
    editor.focus()
  })
  const commands = { bold: 'bold', italic: 'italic', bullet: 'insertUnorderedList', ordered: 'insertOrderedList' }
  for (const button of document.querySelectorAll('[data-format]')) {
    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', () => {
      const kind = button.dataset.format
      if (sourceMode) {
        format(kind)
        return
      }
      visual.focus()
      if (kind === 'heading') {
        const heading = document.queryCommandValue('formatBlock').toLowerCase() === 'h2'
        document.execCommand('formatBlock', false, heading ? 'p' : 'h2')
      } else {
        document.execCommand(commands[kind])
      }
      storeVisual()
    })
  }
  render()
  return render
}

function visualMarkdown(root) {
  function children(node) {
    return Array.from(node.childNodes, serialize).join('')
  }
  function serialize(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/[\\`*_\[\]]/g, '\\$&').replace(/\u00a0/g, ' ')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    if (node.tagName === 'BR') return '\n'
    if (node.tagName === 'PRE') return '\n\n```\n' + node.textContent + '\n```\n\n'
    if (node.tagName === 'CODE') return '`' + node.textContent + '`'
    const content = children(node)
    if (/^H[1-6]$/.test(node.tagName)) return '\n\n' + '#'.repeat(Number(node.tagName[1])) + ' ' + content.trim() + '\n\n'
    if (node.matches('b, strong, i, em')) {
      const marker = node.matches('b, strong') ? '**' : '*'
      return content.replace(/^(\s*)(.*?)(\s*)$/s, (_, before, text, after) => text ? before + marker + text + marker + after : before + after)
    }
    if (node.matches('ol, ul')) {
      return '\n\n' + Array.from(node.children, (item, i) => (
        (node.tagName === 'OL' ? (node.start + i) + '. ' : '- ') + children(item).trim()
      )).join('\n') + '\n\n'
    }
    if (node.tagName === 'BLOCKQUOTE') return '\n\n' + content.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n'
    if (node.tagName === 'A' && /^https?:\/\//i.test(node.getAttribute('href'))) return '[' + content + '](' + node.getAttribute('href') + ')'
    if (node.matches('p, div')) return '\n\n' + content.trim() + '\n\n'
    return content
  }
  return children(root).replace(/\n{3,}/g, '\n\n').trim()
}
