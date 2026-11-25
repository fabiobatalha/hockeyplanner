import { gettext, ngettext } from './i18n.js'
import { confirmAction, showActionMessage } from './action-message.js'
import { showPlanLimit } from './plan-limit.js'
import { drillShareLink, flagPlatformDrill, saveRecord } from './library.js'
import { prepareLibrary } from './library-onboarding.js'
import { appUrl } from './urls.js'
import { newRecordId } from './record-id.js'
import { width, height, rinkWidth, rinkHeight, markers, movements, drawRink, drawItem, hitsItem, itemPoints, playerTeamColors } from './drawing.js'
import { setupDescriptionEditor } from './description-editor.js'
import { exportActivity } from './export.js'
import { itemBounds, movementEnds, resizeMovement, translateItem } from './editor-geometry.js'

const get = id => document.getElementById(id)
const rink = get('rink')
const editorPage = get('editor-page')
const demo = editorPage.hasAttribute('data-demo')
const restoreDemo = editorPage.hasAttribute('data-restore-demo')
const demoDraftKey = 'hockeyplanner.sample-drill'
const initialDrill = JSON.parse(get('initial-drill').textContent)
const ctx = rink.getContext('2d')
const surface = rink.parentElement

function fitRink() {
  if (!surface.getClientRects().length) return
  const pageTop = surface.getBoundingClientRect().top + window.scrollY
  surface.style.setProperty('--rink-top', pageTop + 'px')
}

const layoutObserver = new ResizeObserver(fitRink)
for (const element of document.querySelectorAll('.topbar, .page-heading, .rink-card .card-heading')) {
  layoutObserver.observe(element)
}
window.addEventListener('resize', fitRink)
const title = get('title')
const rinkLayout = get('rink-layout')
const description = await setupDescriptionEditor(get('description-editor'), get('description'), get('description-mode'))
const save = get('save')
const publicPdfLink = get('pdf-public-link')
const publishPlatform = get('publish-platform')
const freePdf = document.body.hasAttribute('data-free-pdf')
const saveCopy = get('save-copy')
const copyDialog = get('copy-drill-dialog')
const copyName = get('copy-drill-name')
const copySubmit = get('confirm-copy-drill')
const copyCancel = get('cancel-copy-drill')
const fresh = () => ({ id: null, title: '', description: '', layout: 'full', items: [] })

let savingDrill = false
let publishingDrill = false
let published = false
let libraryReady = false
let pendingDrillId
let pendingCopyId
let activity = fresh()
let baseline = JSON.stringify(activity)
let tool = 'select'
let shape = 'straight'
let playerTeam = 'A'
let playerOptionsOpen = false
let selected = new Set()
let gesture = null
let clipboard = []
let pasteCount = 0
const clipboardKey = 'hockeyplanner.rink-objects.' + editorPage.dataset.accountId
const undo = []
const redo = []

function status(message) {
  get('status').textContent = message
}

const toolButtons = document.querySelectorAll('[data-tool]')
const playerButton = document.querySelector('[data-tool=player]')
const playerOptions = get('player-options')
const teamButtons = playerOptions.querySelectorAll('button')

for (const button of toolButtons) {
  const id = button.dataset.tool
  const icon = button.querySelector('.tool-icon')
  const color = (markers[id] ?? movements[id])?.[2]
  if (color) icon.style.setProperty('--icon', color)
  if (id === 'pivot') drawItem(icon.getContext('2d'), { type: 'pivot', x: 16, y: 16 })
  button.addEventListener('click', () => {
    if (gesture) return
    if (id === 'player') {
      playerOptionsOpen = !playerOptionsOpen
      if (playerOptionsOpen && !selectedPlayers().length) {
        playerTeam = 'A'
        tool = 'player'
        selected.clear()
      }
    } else {
      tool = id
      playerOptionsOpen = false
      selected.clear()
    }
    render()
  })
}

for (const button of teamButtons) {
  button.querySelector('.tool-icon').style.setProperty('--icon', playerTeamColors[button.dataset.playerTeam])
}

function selectedPlayers() {
  return [...selected].map(index => activity.items[index]).filter(item => item.type === 'player')
}

function singleSelectedItem() {
  return selected.size === 1 ? activity.items[selected.values().next().value] : null
}

function selectedMovement() {
  const item = singleSelectedItem()
  return tool === 'select' && item && movements[item.type] ? item : null
}

function endpointRadius(pixels) {
  return pixels * rink.width / rink.getBoundingClientRect().width
}

function hitEndpoint(item, point) {
  const [start, end] = movementEnds(item)
  const fromStart = distance(start, point)
  const fromEnd = distance(end, point)
  if (Math.min(fromStart, fromEnd) > endpointRadius(13)) return -1
  return fromStart < fromEnd ? 0 : 1
}

function render() {
  const visibleWidth = rinkWidth(activity.layout)
  const visibleHeight = rinkHeight(activity.layout)
  if (rink.width !== visibleWidth || rink.height !== visibleHeight) {
    if (rink.width !== visibleWidth) rink.width = visibleWidth
    if (rink.height !== visibleHeight) rink.height = visibleHeight
    surface.style.setProperty('--rink-width', visibleWidth)
    surface.style.setProperty('--rink-height', visibleHeight)
  }
  rinkLayout.value = visibleWidth === width ? 'full' : activity.layout
  rinkLayout.disabled = !!gesture
  drawRink(ctx)
  activity.items.forEach((item, index) => drawItem(ctx, item, selected.has(index)))
  const resizable = selectedMovement()
  if (resizable) {
    ctx.save()
    ctx.fillStyle = 'white'
    ctx.strokeStyle = '#174fc9'
    ctx.lineWidth = endpointRadius(2)
    for (const end of movementEnds(resizable)) {
      ctx.beginPath()
      ctx.arc(end.x, end.y, endpointRadius(6), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }
  if (gesture?.preview) drawItem(ctx, gesture.preview)
  if (gesture?.area) {
    const { left, top, right, bottom } = gesture.area
    ctx.save()
    ctx.fillStyle = '#4582ed22'
    ctx.strokeStyle = '#174fc9'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.fillRect(left, top, right - left, bottom - top)
    ctx.strokeRect(left, top, right - left, bottom - top)
    ctx.restore()
  }
  rink.classList.toggle('select', tool === 'select')
  rink.classList.toggle('dragging', gesture?.kind === 'move')
  if (!resizable) rink.classList.remove('resize-endpoint')
  for (const button of toolButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool))
  }
  get('order-options').hidden = tool !== 'order'
  get('undo').disabled = !undo.length || !!gesture
  get('redo').disabled = !redo.length || !!gesture
  get('remove').disabled = !selected.size || !!gesture
  const item = singleSelectedItem()
  const players = selectedPlayers()
  playerOptions.hidden = !playerOptionsOpen
  playerButton.setAttribute('aria-expanded', String(playerOptionsOpen))
  playerButton.querySelector('.tool-icon').style.setProperty('--icon', playerTeamColors[tool === 'player' ? playerTeam : 'A'])
  for (const button of teamButtons) {
    const team = button.dataset.playerTeam
    const active = tool === 'player' ? playerTeam === team : players.length > 0 && players.every(player => (player.team ?? 'A') === team)
    button.setAttribute('aria-pressed', String(active))
    button.disabled = !!gesture
  }
  const goalSelected = item?.type === 'goal'
  const rotation = get('goal-rotation')
  rotation.hidden = !goalSelected
  if (goalSelected) {
    rotation.style.setProperty('--goal-x', (item.x / visibleWidth * 100) + '%')
    rotation.style.setProperty('--goal-y', (item.y / visibleHeight * 100) + '%')
    rotation.classList.toggle('left-of-goal', item.x > visibleWidth * .65)
    for (const button of rotation.querySelectorAll('button')) button.disabled = !!gesture
  }
  let hint = gettext('Drag from the start point to the destination to draw a movement.')
  if (shape === 'curve') hint = gettext('Drag to draw a curve. Move the pointer off the straight path to shape the curve.')
  if (shape === 'freehand') hint = gettext('Drag across the rink to draw a freehand path.')
  if (markers[tool]) hint = gettext('Click the rink to place the marker.')
  if (tool === 'order') hint = gettext('Choose a number from 1 to 9, then click the rink to mark the step.')
  if (tool === 'select') hint = gettext('Click to select, Shift-click to add or remove items, or drag from an empty spot to select an area.')
  if (selected.size > 1) hint = gettext('%(count)d items selected. Drag any selected item to move the group.', { count: selected.size })
  if (resizable) hint = gettext('Drag a circular handle to change the movement length, or drag the line to move it.')
  if (players.length) hint += ' ' + gettext('Choose blue or red in the Player tool to change the selected players.')
  if (goalSelected) hint = gettext('Drag to move the goal. Use the rotation buttons to change its angle.')
  if (tool === 'pivot') hint = gettext('Click the rink where the player should pivot.')
  if (selected.size) hint += ' ' + gettext('Copy and paste with Ctrl+C / Ctrl+V (⌘ on Mac).')
  get('hint').textContent = hint
}

function remember(previous = structuredClone(activity.items)) {
  undo.push(previous)
  redo.length = 0
}

function restore(from, to) {
  if (!from.length || gesture) return
  to.push(activity.items)
  activity.items = from.pop()
  selected.clear()
  render()
}

function removeSelected() {
  if (!selected.size || gesture) return
  remember()
  activity.items = activity.items.filter((_, index) => !selected.has(index))
  selected.clear()
  render()
}

function coordinates(event) {
  const box = rink.getBoundingClientRect()
  const visibleWidth = rinkWidth(activity.layout)
  const visibleHeight = rinkHeight(activity.layout)
  return {
    x: Math.max(0, Math.min(visibleWidth, (event.clientX - box.left) * visibleWidth / box.width)),
    y: Math.max(0, Math.min(visibleHeight, (event.clientY - box.top) * visibleHeight / box.height)),
  }
}

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

function smoothPath(points) {
  if (points.length < 3) return points
  // Round each corner twice while preserving the exact start and end.
  for (let pass = 0; pass < 2; pass++) {
    const rounded = [points[0]]
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      rounded.push(
        { x: .75 * a.x + .25 * b.x, y: .75 * a.y + .25 * b.y },
        { x: .25 * a.x + .75 * b.x, y: .25 * a.y + .75 * b.y },
      )
    }
    rounded.push(points.at(-1))
    points = rounded
  }
  return points
}

function movement(start, end, samples) {
  const item = { type: tool, ...start, endX: end.x, endY: end.y }
  if (shape === 'freehand') {
    const points = [...samples]
    if (distance(points.at(-1), end) > 0) points.push(end)
    item.path = smoothPath(points)
    return item
  }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (shape === 'straight' || length < 4) return item
  const normal = { x: -dy / length, y: dx / length }
  let deviation = 0
  for (const p of samples) {
    const offset = (p.x - start.x) * normal.x + (p.y - start.y) * normal.y
    if (Math.abs(offset) > Math.abs(deviation)) deviation = offset
  }
  const bend = Math.abs(deviation) > 4 ? deviation * 2 : Math.min(75, length * .35)
  item.bendX = (start.x + end.x) / 2 + normal.x * bend
  item.bendY = (start.y + end.y) / 2 + normal.y * bend
  return item
}

rink.addEventListener('pointerdown', event => {
  if (event.button !== 0 || gesture) return
  event.preventDefault()
  rink.focus({ preventScroll: true })
  const start = coordinates(event)
  if (markers[tool]) {
    remember()
    const item = { type: tool, ...start }
    if (tool === 'player') item.team = playerTeam
    if (tool === 'order') item.number = Number(get('order-number').value)
    activity.items.push(item)
    if (item.type === 'goal') {
      tool = 'select'
      selected.clear()
      selected.add(activity.items.length - 1)
    }
    render()
    return
  }
  if (tool === 'select') {
    const tolerance = Math.max(8, 7 * rinkWidth(activity.layout) / rink.getBoundingClientRect().width)
    const resizable = selectedMovement()
    const endpoint = resizable && !event.shiftKey ? hitEndpoint(resizable, start) : -1
    const hit = endpoint < 0 ? activity.items.findLastIndex(item => hitsItem(ctx, item, start, tolerance)) : -1
    if (endpoint >= 0) {
      gesture = {
        kind: 'resize', start, endpoint, before: structuredClone(activity.items),
        index: selected.values().next().value, pointer: event.pointerId,
      }
    } else if (hit < 0 || event.shiftKey) {
      gesture = {
        kind: 'area', start, previousSelection: selected, pointer: event.pointerId,
        shift: event.shiftKey, hit,
      }
      selected = event.shiftKey ? new Set(selected) : new Set()
    } else {
      if (!selected.has(hit)) selected = new Set([hit])
      const before = structuredClone(activity.items)
      const bounds = itemBounds([...selected].map(index => before[index]))
      gesture = { kind: 'move', start, before, bounds, pointer: event.pointerId }
    }
  } else {
    gesture = { kind: 'draw', start, samples: [start], pointer: event.pointerId }
  }
  if (gesture) rink.setPointerCapture(event.pointerId)
  render()
})

function updateGesture(event) {
  const p = coordinates(event)
  const { start } = gesture
  if (gesture.kind === 'draw') {
    if (shape !== 'freehand' || distance(gesture.samples.at(-1), p) >= 6) gesture.samples.push(p)
    gesture.preview = movement(start, p, gesture.samples)
    return
  }
  if (gesture.kind === 'area') {
    if (!gesture.area && distance(start, p) < 6) return
    const left = Math.min(start.x, p.x)
    const top = Math.min(start.y, p.y)
    const right = Math.max(start.x, p.x)
    const bottom = Math.max(start.y, p.y)
    gesture.area = { left, top, right, bottom }
    selected.clear()
    activity.items.forEach((item, index) => {
      const visiblePoints = itemPoints(item)
      if (visiblePoints.every(point => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom)) {
        selected.add(index)
      }
    })
    return
  }
  if (gesture.kind === 'resize') {
    const { before, index, endpoint } = gesture
    const original = before[index]
    const ends = movementEnds(original)
    const moving = ends[endpoint]
    const position = {
      x: Math.max(0, Math.min(rink.width, moving.x + p.x - start.x)),
      y: Math.max(0, Math.min(rink.height, moving.y + p.y - start.y)),
    }
    gesture.moved = distance(moving, position) > .5 && distance(ends[1 - endpoint], position) >= 8
    activity.items[index] = gesture.moved ? resizeMovement(original, endpoint, position) : original
    return
  }
  const { left, right, top, bottom } = gesture.bounds
  const visibleWidth = rinkWidth(activity.layout)
  const visibleHeight = rinkHeight(activity.layout)
  // Existing trajectories can extend outside a cropped view. Avoid snapping them on pointer-down.
  const maxX = right > visibleWidth ? Math.max(right, width) : visibleWidth
  const maxY = bottom > visibleHeight ? Math.max(bottom, height) : visibleHeight
  const x = Math.max(-Math.max(0, left), Math.min(maxX - right, p.x - start.x))
  const y = Math.max(-Math.max(0, top), Math.min(maxY - bottom, p.y - start.y))
  gesture.moved = x !== 0 || y !== 0
  for (const index of selected) {
    activity.items[index] = translateItem(gesture.before[index], x, y)
  }
}

rink.addEventListener('pointermove', event => {
  if (!gesture) {
    const resizable = selectedMovement()
    rink.classList.toggle('resize-endpoint', Boolean(resizable && hitEndpoint(resizable, coordinates(event)) >= 0))
    return
  }
  if (gesture.pointer !== event.pointerId) return
  updateGesture(event)
  render()
})

rink.addEventListener('pointerup', event => {
  if (gesture?.pointer !== event.pointerId) return
  updateGesture(event)
  const { before, preview } = gesture
  const length = preview?.path
    ? preview.path.reduce((sum, point, i, path) => i ? sum + distance(path[i - 1], point) : sum, 0)
    : preview && Math.hypot(preview.endX - preview.x, preview.endY - preview.y)
  if (length >= 8) {
    remember()
    activity.items.push(preview)
  }
  if (gesture.moved) remember(before)
  if (gesture.shift && !gesture.area && gesture.hit >= 0) {
    if (selected.has(gesture.hit)) selected.delete(gesture.hit)
    else selected.add(gesture.hit)
  }
  gesture = null
  render()
})

function cancelGesture(event) {
  if (gesture?.pointer !== event.pointerId) return
  if (gesture.before) activity.items = gesture.before
  if (gesture.previousSelection) selected = gesture.previousSelection
  gesture = null
  render()
}
rink.addEventListener('pointercancel', cancelGesture)
rink.addEventListener('lostpointercapture', cancelGesture)

for (const input of document.querySelectorAll('[name=shape]')) {
  input.addEventListener('change', () => {
    shape = input.value
    render()
  })
}
rinkLayout.addEventListener('change', () => {
  activity.layout = rinkLayout.value
  selected.clear()
  render()
  fitRink()
})

const fullscreen = get('fullscreen')
const fullscreenLabel = get('fullscreen-label')
let expandedEditor = false
// Keep editor messages and plan-limit actions visible inside native fullscreen.
editorPage.append(get('action-message'), get('action-confirmation'), get('plan-limit-dialog'))

function updateFullscreen() {
  const active = expandedEditor || document.fullscreenElement === editorPage
  editorPage.classList.toggle('editor-fullscreen', active)
  fullscreenLabel.textContent = active ? gettext('Exit Fullscreen') : gettext('Edit in fullscreen mode')
  fullscreen.setAttribute('aria-pressed', String(active))
  for (const control of document.querySelectorAll('.topbar, .site-footer, #upgrade-plan')) {
    control.inert = expandedEditor
  }
  fitRink()
}

fullscreen.addEventListener('click', async () => {
  if (expandedEditor) {
    expandedEditor = false
    updateFullscreen()
    return
  }
  if (document.fullscreenElement === editorPage) {
    await document.exitFullscreen()
    return
  }
  try {
    await editorPage.requestFullscreen()
  } catch {
    expandedEditor = true
    updateFullscreen()
  }
})
document.addEventListener('fullscreenchange', updateFullscreen)
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && expandedEditor && !editorPage.querySelector('dialog[open]')) {
    expandedEditor = false
    updateFullscreen()
    fullscreen.focus()
  }
})

for (const button of teamButtons) {
  const team = button.dataset.playerTeam
  button.addEventListener('click', () => {
    if (gesture) return
    const players = selectedPlayers()
    if (players.length) {
      if (players.some(player => (player.team ?? 'A') !== team)) {
        remember()
        for (const player of players) player.team = team
      }
    } else {
      playerTeam = team
      tool = 'player'
      selected.clear()
    }
    playerOptionsOpen = false
    render()
    playerButton.focus()
  })
}

get('undo').addEventListener('click', () => restore(undo, redo))
get('redo').addEventListener('click', () => restore(redo, undo))
get('remove').addEventListener('click', removeSelected)
for (const button of document.querySelectorAll('[data-rotation]')) {
  button.addEventListener('click', () => {
    const item = singleSelectedItem()
    if (gesture || item?.type !== 'goal') return
    remember()
    item.rotation = ((item.rotation ?? 0) + Number(button.dataset.rotation) + 360) % 360
    render()
  })
}

function copySelection() {
  if (gesture || !selected.size) return false
  clipboard = structuredClone(activity.items.filter((_, index) => selected.has(index)))
  pasteCount = 0
  try {
    sessionStorage.setItem(clipboardKey, JSON.stringify(clipboard))
  } catch {
    // The in-memory clipboard still works on this page.
  }
  status(ngettext('Object copied.', '%(count)d objects copied.', clipboard.length))
  return true
}

function pasteSelection() {
  if (gesture || savingDrill) return false
  if (!clipboard.length) {
    try {
      clipboard = JSON.parse(sessionStorage.getItem(clipboardKey)) ?? []
    } catch {
      return false
    }
  }
  if (!Array.isArray(clipboard) || !clipboard.length) return false
  const { left, right, top, bottom } = itemBounds(clipboard)
  const shift = ++pasteCount * 18
  const offset = (start, end, limit) => end + shift <= limit ? shift : -Math.min(shift, Math.max(0, start))
  const x = offset(left, right, rink.width)
  const y = offset(top, bottom, rink.height)
  remember()
  selected.clear()
  for (const item of clipboard) {
    selected.add(activity.items.length)
    activity.items.push(translateItem(item, x, y))
  }
  tool = 'select'
  playerOptionsOpen = false
  status(ngettext('Object pasted.', '%(count)d objects pasted.', clipboard.length))
  render()
  return true
}

document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable], #description-editor, dialog[open]')) return
  if (event.key === 'Delete') removeSelected()
  if (!(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (key === 'c' && !window.getSelection()?.toString() && copySelection()) event.preventDefault()
  if (key === 'v' && pasteSelection()) event.preventDefault()
  if (event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) restore(redo, undo)
    else restore(undo, redo)
  }
  if (event.key.toLowerCase() === 'y') {
    event.preventDefault()
    restore(redo, undo)
  }
})

title.addEventListener('input', () => { activity.title = title.value })

function hasUnsavedChanges() {
  activity.description = description.getValue()
  return JSON.stringify(activity) !== baseline
}

function confirmDiscard() {
  return confirmAction(gettext('Discard unsaved changes?'), gettext('Discard changes'), true)
}

function load(next, isPublished = false) {
  pendingDrillId = undefined
  pendingCopyId = undefined
  if (publicPdfLink) publicPdfLink.checked = false
  published = isPublished
  activity = structuredClone(next)
  baseline = JSON.stringify(activity)
  title.value = activity.title
  description.setValue(activity.description)
  undo.length = redo.length = 0
  selected.clear()
  tool = 'select'
  playerOptionsOpen = false
  updateSaveControls()
  render()
}

get('new').addEventListener('click', async () => {
  if (gesture || savingDrill || publishingDrill || (hasUnsavedChanges() && !await confirmDiscard())) return
  if (demo) {
    load(initialDrill)
    return
  }
  if (restoreDemo) clearDemoDraft()
  load(fresh())
  history.replaceState(history.state, '', appUrl('editor'))
  title.focus()
  showActionMessage(gettext('New drill.'))
})

function updateSaveControls() {
  if (!demo) save.textContent = activity.id ? gettext('Update Drill') : gettext('Save Drill')
  save.disabled = saveCopy.disabled = !libraryReady || savingDrill || publishingDrill
  saveCopy.hidden = !activity.id
  if (publicPdfLink) publicPdfLink.disabled = !activity.id || savingDrill
  if (publishPlatform) {
    publishPlatform.checked = published
    publishPlatform.disabled = !libraryReady || !activity.id || savingDrill || publishingDrill
    publishPlatform.parentElement.title = activity.id ? gettext('Make this drill available to all users') : gettext('Save the drill first')
  }
}

publishPlatform?.addEventListener('change', async () => {
  const enabled = publishPlatform.checked
  publishingDrill = true
  updateSaveControls()
  try {
    if (!await confirmAction(
      enabled ? gettext('Make the saved drill available to all Hockey Planner users? They can copy, use, and share it.')
        : gettext('Remove this drill from the platform library and disable its platform share link?'),
      enabled ? gettext('Publish drill') : gettext('Unpublish drill'),
    )) return
    await flagPlatformDrill(activity.id, enabled)
    published = enabled
    showActionMessage(enabled ? gettext('Drill published to the platform.') : gettext('Drill unpublished.'))
  } catch (error) {
    showActionMessage(error.message || gettext('Could not update platform visibility.'))
  } finally {
    publishingDrill = false
    updateSaveControls()
  }
})

async function persistDrill(nameForCopy) {
  if (gesture || savingDrill || publishingDrill || !libraryReady) return
  const makingCopy = nameForCopy !== undefined
  const newRecord = makingCopy || !activity.id
  activity.description = description.getValue()
  const saved = structuredClone(activity)
  if (makingCopy) {
    saved.id = pendingCopyId ??= newRecordId()
    saved.title = nameForCopy
  } else {
    saved.id ??= (pendingDrillId ??= newRecordId())
    saved.title = saved.title.trim() || gettext('Untitled Drill')
  }
  const originalTitle = activity.title
  savingDrill = true
  updateSaveControls()
  copySubmit.disabled = copyCancel.disabled = copyName.disabled = true
  try {
    await saveRecord('drills', saved)
    if (restoreDemo) clearDemoDraft()
    const count = get('activity-count')
    if (newRecord) count.textContent = Number(count.textContent) + 1
    if (makingCopy) {
      load(saved)
      copyDialog.close()
    } else {
      activity.id = saved.id
      if (activity.title === originalTitle) activity.title = title.value = saved.title
      baseline = JSON.stringify(saved)
    }
    history.replaceState(history.state, '', appUrl('editor/' + saved.id))
    status('')
    showActionMessage(makingCopy ? gettext('Saved a copy as “%(title)s”.', { title: saved.title }) : newRecord ? gettext('Drill saved to the library.') : gettext('Drill updated.'))
  } catch (error) {
    if (!showPlanLimit(error)) showActionMessage(error.message || gettext('Could not save the drill. Try again.'))
  } finally {
    savingDrill = false
    copySubmit.disabled = copyCancel.disabled = copyName.disabled = false
    updateSaveControls()
  }
}

function clearDemoDraft() {
  try {
    localStorage.removeItem(demoDraftKey)
  } catch {
    // The drill can still be saved to the account if browser storage is unavailable.
  }
}

function readDemoDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(demoDraftKey))
    if (draft && typeof draft.title === 'string' && typeof draft.description === 'string'
        && ['full', 'half', 'quarter'].includes(draft.layout) && Array.isArray(draft.items)) {
      return { ...fresh(), title: draft.title, description: draft.description, layout: draft.layout, items: draft.items }
    }
  } catch {
    // Fall back to the original sample if the draft is unavailable.
  }
  return initialDrill
}

save.addEventListener('click', () => {
  if (!demo) {
    persistDrill()
    return
  }
  if (gesture) return
  activity.description = description.getValue()
  try {
    localStorage.setItem(demoDraftKey, JSON.stringify(activity))
  } catch {
    showActionMessage(gettext('This browser could not keep your sample drill. Enable browser storage and try again.'))
    return
  }
  location.assign(editorPage.dataset.saveUrl)
})

const demoPreview = get('preview-demo')
if (demoPreview) {
  demoPreview.addEventListener('click', async () => {
    if (gesture) return
    if (document.fullscreenElement === editorPage) await document.exitFullscreen()
    if (expandedEditor) {
      expandedEditor = false
      updateFullscreen()
    }
    const { presentPlan } = await import('./plan-viewer.js')
    activity.description = description.getValue()
    const drill = { ...structuredClone(activity), title: activity.title.trim() || gettext('Untitled Drill') }
    presentPlan(drill.title, [drill], { auto: true })
  })
}
saveCopy.addEventListener('click', () => {
  if (gesture || savingDrill || !activity.id) return
  const currentName = activity.title.trim()
  const savedName = JSON.parse(baseline).title.trim()
  copyName.value = currentName && currentName.toLowerCase() !== savedName.toLowerCase()
    ? currentName : gettext('%(title)s (copy)', { title: (savedName || gettext('Untitled Drill')).slice(0, 110).trimEnd() })
  copyName.setCustomValidity('')
  copyDialog.showModal()
  copyName.select()
})
copyName.addEventListener('input', () => copyName.setCustomValidity(''))
copyCancel.addEventListener('click', () => copyDialog.close())
copyDialog.addEventListener('cancel', event => {
  if (savingDrill) event.preventDefault()
})
get('copy-drill-form').addEventListener('submit', event => {
  event.preventDefault()
  const name = copyName.value.trim()
  const savedName = JSON.parse(baseline).title.trim().toLowerCase()
  copyName.setCustomValidity(!name || name.toLowerCase() === savedName ? gettext('Enter a name different from the original drill.') : '')
  if (copyName.reportValidity()) persistDrill(name)
})

for (const format of ['png', 'pdf']) {
  const button = get(format)
  button.addEventListener('click', async () => {
    if (gesture || savingDrill) return
    activity.description = description.getValue()
    const snapshot = structuredClone(activity)
    const saved = Boolean(snapshot.id) && JSON.stringify(snapshot) === baseline
    const createLink = format === 'pdf' && (freePdf || publicPdfLink?.checked)
    if (createLink && !saved) {
      showActionMessage(gettext('Save your changes before exporting with a public QR code.'))
      return
    }
    button.disabled = true
    try {
      const token = createLink ? (await drillShareLink(snapshot.id, 'PUT')).token : null
      await exportActivity(snapshot, format, token)
      if (format === 'png') showActionMessage(gettext('PNG file ready.'))
    } catch {
      if (format === 'pdf') showActionMessage(gettext('Could not generate the PDF.'))
      else showActionMessage(gettext('Could not generate the PNG file.'))
    } finally {
      button.disabled = false
    }
  })
}

load((restoreDemo ? readDemoDraft() : initialDrill) ?? fresh(), publishPlatform?.defaultChecked)
fitRink()

if (!demo) await prepareLibrary()
if (get('status').textContent === gettext('Loading the editor…')) status('')
libraryReady = true
updateSaveControls()
if (demoPreview) demoPreview.disabled = false

document.addEventListener('click', async event => {
  const link = event.target.closest('a[href]')
  if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey ||
      event.altKey || link.target || link.hasAttribute('download') || link.origin !== location.origin ||
      (link.hash && link.pathname === location.pathname && link.search === location.search) ||
      !hasUnsavedChanges()) return
  event.preventDefault()
  if (await confirmDiscard()) location.assign(link.href)
})

document.querySelector('.language-picker')?.addEventListener('submit', async event => {
  if (!hasUnsavedChanges()) return
  event.preventDefault()
  if (await confirmDiscard()) event.target.submit()
})
