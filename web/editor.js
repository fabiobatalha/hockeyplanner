import { showActionMessage } from './action-message.js'
import { showPlanLimit } from './plan-limit.js'
import { drillShareLink, saveRecord } from './library.js'
import { prepareLibrary } from './library-onboarding.js'
import { appUrl } from './urls.js'
import { newRecordId } from './record-id.js'
import { width, height, rinkWidth, rinkHeight, markers, movements, drawRink, drawItem, hitsItem, itemPoints, playerTeamColors } from './drawing.js'
import { setupMarkdown } from './markdown.js'
import { exportActivity } from './export.js'

const get = id => document.getElementById(id)
const rink = get('rink')
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
const description = get('description')
const refreshDescription = setupMarkdown(description, get('description-visual'), get('description-mode'))
const fresh = () => ({ id: null, title: '', description: '', layout: 'full', items: [] })

let savingDrill = false
let pendingDrillId
let activity = fresh()
let baseline = JSON.stringify(activity)
let tool = 'select'
let shape = 'straight'
let playerTeam = 'A'
let playerOptionsOpen = false
let selected = new Set()
let gesture = null
const undo = []
const redo = []

function status(message) {
  get('status').textContent = message
}

function addTools(container, entries) {
  for (const [id, [label, icon, color]] of Object.entries(entries)) {
    const button = document.createElement('button')
    const symbol = document.createElement('span')
    symbol.textContent = icon
    symbol.className = 'tool-icon'
    if (['player', 'coach', 'goalie', 'order', 'referee'].includes(id)) symbol.classList.add('letter-icon')
    if (id === 'referee') symbol.classList.add('referee-icon')
    symbol.setAttribute('aria-hidden', 'true')
    if (color) symbol.style.setProperty('--icon', color)
    button.type = 'button'
    button.className = 'tool'
    button.dataset.tool = id
    button.append(symbol, label)
    if (id === 'player') {
      const options = document.createElement('div')
      options.id = 'player-options'
      options.setAttribute('role', 'group')
      options.setAttribute('aria-label', 'Player team')
      options.hidden = true
      for (const [team, name] of [['A', 'blue'], ['B', 'red']]) {
        const choice = document.createElement('button')
        choice.type = 'button'
        choice.className = 'tool'
        choice.dataset.playerTeam = team
        choice.setAttribute('aria-label', 'Team ' + team + ' (' + name + ')')
        const badge = symbol.cloneNode(true)
        badge.style.setProperty('--icon', playerTeamColors[team])
        choice.append(badge, 'Team ' + team)
        options.append(choice)
      }
      button.setAttribute('aria-controls', options.id)
      button.setAttribute('aria-expanded', 'false')
      button.addEventListener('click', () => {
        if (gesture) return
        playerOptionsOpen = !playerOptionsOpen
        if (playerOptionsOpen && !selectedPlayers().length) {
          playerTeam = 'A'
          tool = 'player'
          selected.clear()
        }
        render()
      })

      const group = document.createElement('div')
      group.className = 'player-tool'
      group.append(button, options)
      get(container).append(group)
      continue
    }
    button.addEventListener('click', () => {
      if (gesture) return
      tool = id
      playerOptionsOpen = false
      selected.clear()
      render()
    })
    get(container).append(button)
  }
}
addTools('selection-tools', { select: ['Select and Move', '⌖'] })
addTools('marker-tools', markers)
addTools('movement-tools', movements)

const playerButton = document.querySelector('[data-tool=player]')
const playerOptions = get('player-options')
const teamButtons = playerOptions.querySelectorAll('button')
function selectedPlayers() {
  return [...selected].map(index => activity.items[index]).filter(item => item.type === 'player')
}

function singleSelectedItem() {
  return selected.size === 1 ? activity.items[selected.values().next().value] : null
}

function render() {
  const visibleWidth = rinkWidth(activity.layout)
  const visibleHeight = rinkHeight(activity.layout)
  if (rink.width !== visibleWidth) rink.width = visibleWidth
  if (rink.height !== visibleHeight) rink.height = visibleHeight
  rinkLayout.value = visibleWidth === width ? 'full' : activity.layout
  rinkLayout.disabled = !!gesture
  surface.style.setProperty('--rink-width', visibleWidth)
  surface.style.setProperty('--rink-height', visibleHeight)
  drawRink(ctx)
  activity.items.forEach((item, index) => drawItem(ctx, item, selected.has(index)))
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
  for (const button of document.querySelectorAll('[data-tool]')) {
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
  let hint = 'Drag from the start point to the destination to draw a movement.'
  if (shape === 'curve') hint = 'Drag to draw a curve. Move the pointer off the straight path to shape the curve.'
  if (shape === 'freehand') hint = 'Drag across the rink to draw a freehand path.'
  if (markers[tool]) hint = 'Click the rink to place the marker.'
  if (tool === 'order') hint = 'Choose a number from 1 to 9, then click the rink to mark the step.'
  if (tool === 'select') hint = 'Click to select, Shift-click to add or remove items, or drag from an empty spot to select an area.'
  if (selected.size > 1) hint = selected.size + ' items selected. Drag any selected item to move the group.'
  if (players.length) hint += ' Choose blue or red in the Player tool to change the selected players.'
  if (goalSelected) hint = 'Drag to move the goal. Use the rotation buttons to change its angle.'
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
  const start = coordinates(event)
  if (markers[tool]) {
    remember()
    const item = { type: tool, ...start }
    if (tool === 'player') item.team = playerTeam
    if (tool === 'order') item.number = Number(get('order-number').value)
    activity.items.push(item)
    render()
    return
  }
  if (tool === 'select') {
    const tolerance = Math.max(8, 7 * rinkWidth(activity.layout) / rink.getBoundingClientRect().width)
    const hit = activity.items.findLastIndex(item => hitsItem(ctx, item, start, tolerance))
    if (hit < 0 || event.shiftKey) {
      gesture = {
        kind: 'area', start, previousSelection: selected, pointer: event.pointerId,
        shift: event.shiftKey, hit,
      }
      selected = event.shiftKey ? new Set(selected) : new Set()
    } else {
      if (!selected.has(hit)) selected = new Set([hit])
      const before = structuredClone(activity.items)
      const points = [...selected].flatMap(index => itemPoints(before[index]))
      const bounds = points.reduce((box, point) => ({
        left: Math.min(box.left, point.x),
        right: Math.max(box.right, point.x),
        top: Math.min(box.top, point.y),
        bottom: Math.max(box.bottom, point.y),
      }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity })
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
  const { left, right, top, bottom } = gesture.bounds
  const visibleWidth = rinkWidth(activity.layout)
  const visibleHeight = rinkHeight(activity.layout)
  // Existing trajectories can extend outside a cropped view. Avoid snapping them on pointer-down.
  const maxX = right > visibleWidth ? Math.max(right, width) : visibleWidth
  const maxY = bottom > visibleHeight ? Math.max(bottom, height) : visibleHeight
  const x = Math.max(-Math.max(0, left), Math.min(maxX - right, p.x - start.x))
  const y = Math.max(-Math.max(0, top), Math.min(maxY - bottom, p.y - start.y))
  gesture.moved = x !== 0 || y !== 0
  const offsets = { x, y, endX: x, endY: y, bendX: x, bendY: y }
  for (const index of selected) {
    const original = gesture.before[index]
    const item = { ...original }
    if (original.path) item.path = original.path.map(point => ({ x: point.x + x, y: point.y + y }))
    for (const [key, offset] of Object.entries(offsets)) {
      if (key in original) item[key] += offset
    }
    activity.items[index] = item
  }
}

rink.addEventListener('pointermove', event => {
  if (gesture?.pointer !== event.pointerId) return
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

const rinkCard = rink.closest('.rink-card')
const fullscreen = get('fullscreen')
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === rinkCard) await document.exitFullscreen()
    else await rinkCard.requestFullscreen()
  } catch {
    showActionMessage('Could not open the rink in fullscreen.')
  }
})
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === rinkCard
  fullscreen.textContent = active ? 'Exit Fullscreen' : 'Fullscreen'
  fullscreen.setAttribute('aria-pressed', String(active))
  fitRink()
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

document.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, [contenteditable], [contenteditable] *')) return
  if (event.key === 'Delete') removeSelected()
  if (!(event.ctrlKey || event.metaKey)) return
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
description.addEventListener('input', () => { activity.description = description.value })

function canLeave() {
  return JSON.stringify(activity) === baseline || confirm('Discard unsaved changes?')
}

function load(next) {
  pendingDrillId = undefined
  activity = structuredClone(next)
  baseline = JSON.stringify(activity)
  title.value = activity.title
  description.value = activity.description
  refreshDescription()
  undo.length = redo.length = 0
  selected.clear()
  tool = 'select'
  playerOptionsOpen = false
  render()
}

get('new').addEventListener('click', () => {
  if (gesture || savingDrill || !canLeave()) return
  load(fresh())
  history.replaceState(history.state, '', appUrl('editor'))
  title.focus()
  showActionMessage('New drill.')
})

get('save').addEventListener('click', async () => {
  if (gesture || savingDrill || get('save').disabled) return
  const saved = structuredClone(activity)
  saved.id ??= (pendingDrillId ??= newRecordId())
  saved.title = saved.title.trim() || 'Untitled Drill'
  const originalTitle = activity.title
  savingDrill = true
  get('save').disabled = true
  try {
    await saveRecord('drills', saved)
    const count = get('activity-count')
    if (!activity.id) count.textContent = Number(count.textContent) + 1
    activity.id = saved.id
    history.replaceState(history.state, '', appUrl('editor/' + saved.id))
    if (activity.title === originalTitle) activity.title = title.value = saved.title
    baseline = JSON.stringify(saved)
    status('')
    showActionMessage('Drill saved to the library.')
  } catch (error) {
    if (!showPlanLimit(error)) showActionMessage(error.message || 'Could not save the drill. Try again.')
  } finally {
    savingDrill = false
    get('save').disabled = false
  }
})

for (const format of ['png', 'pdf']) {
  const button = get(format)
  button.addEventListener('click', async () => {
    if (gesture || savingDrill) return
    const snapshot = structuredClone(activity)
    const saved = Boolean(snapshot.id) && JSON.stringify(snapshot) === baseline
    button.disabled = true
    try {
      let token
      if (format === 'pdf' && saved) {
        token = (await drillShareLink(snapshot.id)).token
        if (!token && confirm('Enable a public link for this drill and add a QR code to the PDF? Cancel to export without a QR code.')) {
          token = (await drillShareLink(snapshot.id, 'PUT')).token
        }
      }
      await exportActivity(snapshot, format, token)
      showActionMessage(format === 'pdf' && !saved
        ? 'PDF ready. Save the drill before exporting to add a QR code.'
        : format.toUpperCase() + ' file ready.')
    } catch {
      showActionMessage('Could not generate the ' + format.toUpperCase() + ' file' + '.')
    } finally {
      button.disabled = false
    }
  })
}

const initialDrill = JSON.parse(get('initial-drill').textContent)
load(initialDrill ?? fresh())
fitRink()

const save = get('save')
save.disabled = true
await prepareLibrary()
save.disabled = false

window.addEventListener('beforeunload', event => {
  if (JSON.stringify(activity) !== baseline) event.preventDefault()
})
