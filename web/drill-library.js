import { confirmAction, showActionMessage } from './action-message.js'
import { activityThumbnail } from './drawing.js'
import { deleteRecord, drillShareLink, readLibrary } from './library.js'
import { exportActivity } from './export.js'
import { drillSearch, markdownText, renderMarkdown } from './markdown.js'
import { prepareLibrary } from './library-onboarding.js'
import { appUrl } from './urls.js'

const get = id => document.getElementById(id)
const search = get('library-search')
const clear = get('clear-library-search')
const list = get('activity-list')
const status = get('library-status')
const layoutNames = { half: 'Half rink', quarter: 'Quarter rink' }
const freePdf = document.body.hasAttribute('data-free-pdf')
let activities = []

search.addEventListener('input', refreshLibrary)
clear.addEventListener('click', () => {
  search.value = ''
  search.focus()
  refreshLibrary()
})

function drillDescription(source) {
  const description = document.createElement('div')
  description.className = 'formatted-description'
  renderMarkdown(source, description)
  const excerpt = markdownText(source).replace(/\s+/g, ' ').trim()
  if (excerpt.length <= 140 && description.children.length <= 2) return description

  const preview = document.createElement('details')
  preview.className = 'library-description'
  const toggle = document.createElement('summary')
  const snippet = document.createElement('span')
  snippet.className = 'library-description-snippet'
  snippet.textContent = excerpt.length > 140 ? excerpt.slice(0, 140).replace(/\s+\S*$/, '') + '…' : excerpt
  const show = document.createElement('span')
  show.className = 'library-description-show'
  show.textContent = 'Show description'
  const hide = document.createElement('span')
  hide.className = 'library-description-hide'
  hide.textContent = 'Hide description'
  toggle.append(snippet, show, hide)
  preview.append(toggle, description)
  return preview
}

function downloadButton(entry, format, feedback) {
  const label = format.toUpperCase()
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '↓ ' + label
  button.setAttribute('aria-label', 'Download ' + label + ' for ' + entry.title)
  button.addEventListener('click', async () => {
    button.disabled = true
    feedback.textContent = ''
    try {
      const token = format === 'pdf' && freePdf ? (await drillShareLink(entry.id, 'PUT')).token : null
      await exportActivity(entry, format, token)
    } catch {
      if (format === 'pdf') showActionMessage('Could not generate the PDF.')
      else feedback.textContent = 'Could not download the PNG. Try again.'
    } finally {
      button.disabled = false
    }
  })
  return button
}

function refreshLibrary() {
  get('activity-count').textContent = activities.length
  const query = search.value.trim()
  clear.hidden = !search.value
  const matches = drillSearch(query)
  const visibleDrills = activities.filter(entry => matches(entry))
  status.textContent = query
    ? visibleDrills.length + ' of ' + activities.length + ' drills'
    : activities.length + (activities.length === 1 ? ' drill' : ' drills')
  if (!visibleDrills.length) {
    const empty = document.createElement('p')
    empty.className = 'card library-empty'
    empty.textContent = query ? 'No drills match your search.' : 'Drills you save will appear here.'
    list.replaceChildren(empty)
    return
  }
  const cards = document.createDocumentFragment()
  for (const entry of visibleDrills) {
    const row = document.createElement('article')
    row.className = 'card activity'
    const details = document.createElement('div')
    details.className = 'activity-details'
    const heading = document.createElement('h2')
    heading.textContent = entry.title
    const layout = document.createElement('p')
    layout.className = 'library-rink-layout'
    layout.textContent = layoutNames[entry.layout] ?? 'Full rink'
    details.append(heading, layout)
    if (entry.description?.trim()) details.append(drillDescription(entry.description))
    const actions = document.createElement('div')
    actions.className = 'actions'
    const open = document.createElement('a')
    open.className = 'button-link primary'
    open.textContent = 'Open in Editor'
    open.setAttribute('aria-label', 'Open ' + entry.title + ' in the editor')
    open.href = appUrl('editor/' + entry.id)
    const remove = document.createElement('button')
    remove.className = 'danger-outline'
    remove.textContent = 'Delete'
    remove.setAttribute('aria-label', 'Delete ' + entry.title)
    remove.addEventListener('click', async () => {
      if (!await confirmAction('Delete “' + entry.title + '” from the library?', 'Delete drill', true)) return
      remove.disabled = true
      try {
        await deleteRecord('drills', entry.id)
      } catch {
        showActionMessage('Could not delete the drill.')
        remove.disabled = false
        return
      }
      activities = activities.filter(record => record.id !== entry.id)
      refreshLibrary()
      search.focus()
    })
    const feedback = document.createElement('p')
    feedback.className = 'status library-download-status'
    feedback.setAttribute('role', 'status')
    actions.append(open, downloadButton(entry, 'png', feedback), downloadButton(entry, 'pdf', feedback), remove, feedback)
    row.append(activityThumbnail(entry), details, actions)
    cards.append(row)
  }
  list.replaceChildren(cards)
}

try {
  await prepareLibrary()
  const data = await readLibrary()
  activities = data.drills
  search.disabled = false
  refreshLibrary()
} catch {
  status.textContent = 'Could not load the drill library. Reload the page to try again.'
} finally {
  list.setAttribute('aria-busy', 'false')
}
