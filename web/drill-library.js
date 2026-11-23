import { showActionMessage } from './action-message.js'
import { activityThumbnail } from './drawing.js'
import { deleteRecord, readLibrary } from './library.js'
import { drillSearch, renderMarkdown } from './markdown.js'
import { prepareLibrary } from './library-onboarding.js'
import { appUrl } from './urls.js'

const get = id => document.getElementById(id)
let activities = []

get('library-search').addEventListener('input', refreshLibrary)

function refreshLibrary() {
  const list = get('activity-list')
  get('activity-count').textContent = activities.length
  list.replaceChildren()
  const query = get('library-search').value.trim()
  const matches = drillSearch(query)
  const visibleDrills = activities.filter(entry => matches(entry))
  if (!visibleDrills.length) {
    list.textContent = query ? 'No drills match your search.' : 'No saved drills.'
    return
  }
  for (const entry of visibleDrills) {
    const row = document.createElement('article')
    row.className = 'card activity'
    const details = document.createElement('div')
    details.className = 'activity-details'
    const heading = document.createElement('h2')
    heading.textContent = entry.title
    details.append(heading)
    if (entry.description?.trim()) {
      const description = document.createElement('div')
      description.className = 'formatted-description'
      renderMarkdown(entry.description, description)
      details.append(description)
    }
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
      if (!confirm('Delete this drill from the library?')) return
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
      showActionMessage('Drill deleted from the library.')
    })
    actions.append(open, remove)
    row.append(activityThumbnail(entry), details, actions)
    list.append(row)
  }
}

try {
  await prepareLibrary()
  const data = await readLibrary()
  activities = data.drills
  refreshLibrary()
} catch {
  get('library-status').textContent = 'Could not load the drill library.'
}
