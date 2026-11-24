import './vendor/markdown-it-14.3.3.js'

const markdown = globalThis.markdownit({ html: false, breaks: true })
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content)

export function renderMarkdown(source, target) {
  const template = document.createElement('template')
  template.innerHTML = markdown.render(source)
  for (const link of template.content.querySelectorAll('a')) {
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  }
  target.replaceChildren(template.content)
}

export function markdownText(source) {
  const template = document.createElement('template')
  template.innerHTML = markdown.render(source)

  function text(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.previousSibling?.nodeName === 'BR' ? node.textContent.replace(/^\n/, '') : node.textContent
    }
    if (node.nodeName === 'BR') return '\n'
    if (node.nodeName === 'PRE') return node.textContent + '\n'
    if (node.nodeName === 'UL' || node.nodeName === 'OL') {
      return Array.from(node.children, (item, index) => {
        const marker = node.nodeName === 'OL' ? (node.start + index) + '.' : '•'
        return marker + ' ' + text(item).trim()
      }).join('\n') + '\n'
    }
    const content = Array.from(node.childNodes, text).join('')
    return /^(P|H[1-6]|TR|BLOCKQUOTE)$/.test(node.nodeName) ? content + '\n' : content
  }

  for (const cell of template.content.querySelectorAll('td, th')) {
    if (cell.nextElementSibling) cell.append(' | ')
  }
  return text(template.content).replace(/\n{3,}/g, '\n\n').trim()
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
