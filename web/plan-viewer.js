import { gettext, locale } from './i18n.js'
import { drawItem, drawRink, drawMovementSample, movementLegend, rinkHeight, rinkWidth } from './drawing.js'
import { renderMarkdown } from './markdown.js'

const viewer = document.getElementById('plan-viewer')
const presentation = document.getElementById('plan-presentation')
const viewerTitle = document.getElementById('plan-viewer-title')
const viewerActivities = document.getElementById('plan-viewer-activities')
const previous = document.getElementById('plan-viewer-prev')
const next = document.getElementById('plan-viewer-next')
const position = document.getElementById('plan-viewer-position')
const fullscreen = document.getElementById('plan-viewer-fullscreen')
const canEnterFullscreen = Boolean(document.fullscreenEnabled && presentation.requestFullscreen)
let displayedActivities = []
let activityIndex = 0
let presentationWasFullscreen = false

export function currentPresentedDrill() {
  return displayedActivities[activityIndex]
}

document.addEventListener('fullscreenchange', () => {
  fullscreen.hidden = !canEnterFullscreen || document.fullscreenElement === presentation
  if (document.fullscreenElement === presentation) presentationWasFullscreen = true
  else if (presentationWasFullscreen) {
    presentationWasFullscreen = false
    if (viewer.open) viewer.close()
  }
})
viewer.addEventListener('close', () => {
  if (viewer.open) return
  if (document.fullscreenElement === presentation) document.exitFullscreen().catch(() => {})
  viewerActivities.replaceChildren()
  displayedActivities = []
})

function renderMovementLegend(entries) {
  const legend = document.createElement('section')
  legend.className = 'plan-viewer-legend'
  const heading = document.createElement('h4')
  heading.textContent = gettext('Movement Legend')
  const list = document.createElement('ul')
  list.setAttribute('role', 'list')
  for (const { type, label } of entries) {
    const row = document.createElement('li')
    const sample = document.createElement('canvas')
    sample.width = 256
    sample.height = 64
    sample.setAttribute('aria-hidden', 'true')
    const ctx = sample.getContext('2d')
    ctx.scale(2, 2)
    drawMovementSample(ctx, type, 0, 16)
    row.append(sample, label)
    list.append(row)
  }
  legend.append(heading, list)
  return legend
}

function showActivity(index) {
  const activity = displayedActivities[index]
  if (!activity) return
  activityIndex = index
  const section = document.createElement('article')
  section.className = 'plan-viewer-activity'
  const heading = document.createElement('header')
  heading.className = 'plan-viewer-drill-heading'
  const title = document.createElement('h3')
  title.textContent = activity.title
  heading.append(title)
  if (Number.isSafeInteger(activity.duration_minutes) && activity.duration_minutes > 0) {
    const duration = document.createElement('span')
    duration.className = 'plan-viewer-duration'
    duration.textContent = gettext('%(time)s min', { time: new Intl.NumberFormat(locale).format(activity.duration_minutes) })
    heading.append(duration)
  }

  const body = document.createElement('div')
  body.className = 'plan-viewer-main'
  const rinkColumn = document.createElement('div')
  rinkColumn.className = 'plan-viewer-rink-column'

  const diagram = document.createElement('canvas')
  diagram.width = rinkWidth(activity.layout)
  diagram.height = rinkHeight(activity.layout)
  diagram.className = 'plan-viewer-rink'
  diagram.style.setProperty('--diagram-ratio', diagram.width / diagram.height)
  diagram.setAttribute('aria-label', gettext('Rink diagram for %(title)s', { title: activity.title }))
  const context = diagram.getContext('2d')
  drawRink(context)
  for (const item of activity.items) drawItem(context, item)
  rinkColumn.append(diagram)
  const entries = movementLegend(activity.items)
  if (entries.length) rinkColumn.append(renderMovementLegend(entries))
  body.append(rinkColumn)

  const description = activity.description?.trim()
  if (description) {
    const notes = document.createElement('section')
    notes.className = 'plan-viewer-notes'
    const noteTitle = document.createElement('h4')
    noteTitle.textContent = gettext('Coaching notes')
    const text = document.createElement('div')
    text.className = 'formatted-description'
    renderMarkdown(description, text)
    notes.append(noteTitle, text)
    body.classList.add('has-notes')
    body.append(notes)
  }
  section.append(heading, body)
  viewerActivities.replaceChildren(section)
  viewerActivities.scrollTop = 0
  position.textContent = gettext('%(position)d of %(total)d', { position: index + 1, total: displayedActivities.length })
  const focusedControl = document.activeElement
  previous.disabled = index === 0
  next.disabled = index === displayedActivities.length - 1
  if ((focusedControl === previous && previous.disabled) || (focusedControl === next && next.disabled)) {
    viewerActivities.focus({ preventScroll: true })
  }
}

previous.addEventListener('click', () => showActivity(activityIndex - 1))
next.addEventListener('click', () => showActivity(activityIndex + 1))
presentation.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  showActivity(activityIndex + (event.key === 'ArrowRight' ? 1 : -1))
})

async function enterFullscreen() {
  try {
    await presentation.requestFullscreen()
  } catch {
    // The open dialog still fills the browser viewport.
  }
}

fullscreen.addEventListener('click', enterFullscreen)

export function presentPlan(name, activities, { startIndex = 0, auto = false } = {}) {
  viewerTitle.textContent = name
  displayedActivities = activities
  showActivity(startIndex)
  if (!viewer.open) viewer.showModal()
  viewerActivities.focus({ preventScroll: true })
  fullscreen.hidden = !canEnterFullscreen || document.fullscreenElement === presentation
  if (canEnterFullscreen && !auto && !fullscreen.hidden) enterFullscreen()
}
