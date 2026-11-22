import { drawItem, drawRink, rinkHeight, rinkWidth } from './drawing.js'
import { markdownText } from './markdown.js'

const viewer = document.getElementById('plan-viewer')
const presentation = document.getElementById('plan-presentation')
const viewerTitle = document.getElementById('plan-viewer-title')
const viewerActivities = document.getElementById('plan-viewer-activities')
const previous = document.getElementById('plan-viewer-prev')
const next = document.getElementById('plan-viewer-next')
const position = document.getElementById('plan-viewer-position')
let displayedActivities = []
let activityIndex = 0
let presentationWasFullscreen = false

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === presentation) presentationWasFullscreen = true
  else if (presentationWasFullscreen) {
    presentationWasFullscreen = false
    if (viewer.open) viewer.close()
  }
})
viewer.addEventListener('close', () => {
  if (document.fullscreenElement === presentation) document.exitFullscreen().catch(() => {})
  viewerActivities.replaceChildren()
  displayedActivities = []
})

function showActivity(index) {
  const activity = displayedActivities[index]
  if (!activity) return
  activityIndex = index
  const section = document.createElement('article')
  section.className = 'plan-viewer-activity'
  const title = document.createElement('h3')
  title.textContent = activity.title

  const diagram = document.createElement('canvas')
  diagram.width = rinkWidth(activity.layout)
  diagram.height = rinkHeight(activity.layout)
  diagram.style.setProperty('--diagram-ratio', diagram.width / diagram.height)
  diagram.setAttribute('aria-label', 'Rink diagram for ' + activity.title)
  const context = diagram.getContext('2d')
  drawRink(context)
  for (const item of activity.items) drawItem(context, item)
  section.append(title, diagram)

  const description = markdownText(activity.description ?? '').trim()
  if (description) {
    const text = document.createElement('p')
    text.className = 'plan-viewer-description'
    text.textContent = description
    section.append(text)
  }
  viewerActivities.replaceChildren(section)
  viewerActivities.scrollTop = 0
  position.textContent = (index + 1) + ' of ' + displayedActivities.length
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

export async function presentPlan(name, activities) {
  viewerTitle.textContent = name
  displayedActivities = activities
  showActivity(0)
  viewer.showModal()
  viewerActivities.focus({ preventScroll: true })
  if (document.fullscreenEnabled && presentation.requestFullscreen) {
    try {
      await presentation.requestFullscreen()
    } catch {
      // The open dialog still fills the browser viewport.
    }
  }
}
