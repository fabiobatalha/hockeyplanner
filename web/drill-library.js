import { gettext, ngettext } from './i18n.js'
import { confirmAction, showActionMessage } from './action-message.js'
import { activityThumbnail } from './drawing.js'
import { copyPlatformDrill, deleteRecord, drillShareLink, platformDrillLink, readLibrary } from './library.js'
import { exportActivity } from './export.js'
import { newRecordId } from './record-id.js'
import { showPlanLimit } from './plan-limit.js'
import { drillSearch, markdownText, renderMarkdown } from './markdown.js'
import { prepareLibrary } from './library-onboarding.js'
import { appUrl } from './urls.js'

const get = id => document.getElementById(id)
const search = get('library-search')
const typeFilter = get('library-type')
const clear = get('clear-library-search')
const list = get('activity-list')
const status = get('library-status')
const layoutNames = { half: gettext('Half rink'), quarter: gettext('Quarter rink') }
const drillType = entry => entry.platformSource ? 'platform' : 'personal'
const typeLabels = { personal: gettext('Personal Drill'), platform: gettext('Platform Drill') }
const freePdf = document.body.hasAttribute('data-free-pdf')
const { accountId, accountRole } = get('library-page').dataset
let activities = []
let platforms = []

search.addEventListener('input', refreshLibrary)
typeFilter.addEventListener('change', refreshLibrary)
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
  show.textContent = gettext('Show description')
  const hide = document.createElement('span')
  hide.className = 'library-description-hide'
  hide.textContent = gettext('Hide description')
  toggle.append(snippet, show, hide)
  preview.append(toggle, description)
  return preview
}

function downloadButton(entry, format, feedback) {
  const label = format.toUpperCase()
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '↓ ' + label
  button.setAttribute('aria-label', gettext('Download %(format)s for %(title)s', { format: label, title: entry.title }))
  button.addEventListener('click', async () => {
    button.disabled = true
    feedback.textContent = ''
    try {
      let token
      if (format === 'pdf' && entry.platformSource) token = (await platformDrillLink(entry.platformSource)).token
      else if (format === 'pdf' && freePdf) token = (await drillShareLink(entry.id, 'PUT')).token
      await exportActivity(entry, format, token)
    } catch {
      if (format === 'pdf') showActionMessage(gettext('Could not generate the PDF.'))
      else feedback.textContent = gettext('Could not download the PNG. Try again.')
    } finally {
      button.disabled = false
    }
  })
  return button
}

function platformAction(label, handler) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      await handler()
    } catch (error) {
      if (!showPlanLimit(error)) showActionMessage(error.message)
    } finally {
      button.disabled = false
    }
  })
  return button
}

async function refreshRecords() {
  const data = await readLibrary()
  activities = data.drills
  platforms = data.platform_drills ?? []
  refreshLibrary()
}

function refreshLibrary() {
  get('activity-count').textContent = activities.length
  const query = search.value.trim()
  clear.hidden = !search.value
  const matches = drillSearch(query)
  const ownedPlatforms = new Map(platforms.filter(drill => String(drill.platformSource.ownerId) === accountId).map(drill => [drill.id, drill]))
  const allDrills = [...activities.map(drill => ownedPlatforms.get(drill.id) ?? drill),
    ...platforms.filter(drill => String(drill.platformSource.ownerId) !== accountId)]
  const type = typeFilter.value
  const filtering = query || type !== 'all'
  const visibleDrills = allDrills.filter(entry => {
    const entryType = drillType(entry)
    return (type === 'all' || type === entryType) && matches(entry, typeLabels[entryType])
  })
  status.textContent = filtering
    ? gettext('%(visible)d of %(total)d drills', { visible: visibleDrills.length, total: allDrills.length })
    : ngettext('%(count)d drill', '%(count)d drills', allDrills.length)
  if (!visibleDrills.length) {
    const empty = document.createElement('p')
    empty.className = 'card library-empty'
    empty.textContent = filtering ? gettext('No drills match your filters.') : gettext('Drills you save will appear here.')
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
    layout.textContent = layoutNames[entry.layout] ?? gettext('Full rink')
    details.append(heading, layout)
    const platform = entry.platformSource
    const own = !platform || String(platform.ownerId) === accountId
    const badge = document.createElement('span')
    badge.classList.add('drill-type-label', drillType(entry))
    badge.textContent = typeLabels[drillType(entry)]
    details.prepend(badge)
    if (entry.description?.trim()) details.append(drillDescription(entry.description))
    const actions = document.createElement('div')
    actions.className = 'actions'
    const open = document.createElement('a')
    open.className = 'button-link primary'
    open.textContent = gettext('Open in Editor')
    open.setAttribute('aria-label', gettext('Open %(title)s in the editor', { title: entry.title }))
    open.href = appUrl('editor/' + entry.id)
    const remove = document.createElement('button')
    remove.className = 'danger-outline'
    remove.textContent = gettext('Delete')
    remove.setAttribute('aria-label', gettext('Delete %(title)s', { title: entry.title }))
    remove.addEventListener('click', async () => {
      if (!await confirmAction(gettext('Delete “%(title)s” from the library?', { title: entry.title }), gettext('Delete drill'), true)) return
      remove.disabled = true
      try {
        await deleteRecord('drills', entry.id)
      } catch {
        showActionMessage(gettext('Could not delete the drill.'))
        remove.disabled = false
        return
      }
      activities = activities.filter(record => record.id !== entry.id)
      if (platform) platforms = platforms.filter(drill => drill.platformSource.ownerId !== platform.ownerId || drill.id !== platform.drillId)
      refreshLibrary()
      search.focus()
    })
    const feedback = document.createElement('p')
    feedback.className = 'status library-download-status'
    feedback.setAttribute('role', 'status')
    if (own) actions.append(open)
    else {
      const copyId = newRecordId()
      const copy = platformAction(gettext('Copy'), async () => {
        await copyPlatformDrill(platform, copyId)
        await refreshRecords()
        search.focus()
        showActionMessage(gettext('Drill copied to your library.'))
      })
      copy.className = 'primary'
      copy.setAttribute('aria-label', gettext('Copy %(title)s', { title: entry.title }))
      actions.append(copy)
      if (accountRole !== 'poweruser') {
        const preview = platformAction(gettext('Preview'), async () => {
          const { token } = await platformDrillLink(platform)
          location.assign(appUrl('share/' + token + '/drill/' + platform.drillId))
        })
        preview.setAttribute('aria-label', gettext('Preview %(title)s', { title: entry.title }))
        actions.append(preview)
      }
    }
    actions.append(downloadButton(entry, 'png', feedback), downloadButton(entry, 'pdf', feedback))
    if (own) actions.append(remove)
    actions.append(feedback)
    row.append(activityThumbnail(entry), details, actions)
    cards.append(row)
  }
  list.replaceChildren(cards)
}

try {
  await prepareLibrary()
  await refreshRecords()
  search.disabled = typeFilter.disabled = false
} catch {
  status.textContent = gettext('Could not load the drill library. Reload the page to try again.')
} finally {
  list.setAttribute('aria-busy', 'false')
}
