export const width = 1000
export const height = 460
export function rinkWidth(layout) {
  return layout === 'half' || layout === 'quarter' ? width / 2 : width
}

export function rinkHeight(layout) {
  // Leave room below the centerline for the entire 30-unit goal crease.
  return layout === 'quarter' ? height / 2 + 38 : height
}

export const playerTeamColors = { A: '#174fc9', B: '#bb3345' }

export const markers = {
  player: ['Player', 'P', playerTeamColors.A],
  cone: ['Cone', '▲', '#db561b'],
  coach: ['Coach', 'C', '#7947ad'],
  goal: ['Goal', '∩', '#bb3345'],
  goalie: ['Goalie', 'G', '#157869'],
  puck: ['Puck', '●', '#142742'],
  pucks: ['Puck pile', '⠿', '#142742'],
  shot: ['Shot on goal', '◎', '#bb3345'],
  order: ['Step number', '1', '#223955'],
  referee: ['Referee', 'R', '#111111'],
  start: ['Start', '▶', '#157869'],
  end: ['End', '■', '#bb3345'],
  pivot: ['Pivot', '', '#b45309'],
}

export const movements = {
  forward: ['Skate forward', '⟶', '#174fc9'],
  carry: ['Forward with puck', '∿', '#174fc9'],
  stop: ['Forward and stop', '⇥', '#174fc9'],
  carryStop: ['Forward with puck and stop', '∿', '#174fc9'],
  backward: ['Skate backward', '◠◡', '#7947ad'],
  backwardPuck: ['Backward with puck', '◠◡', '#7947ad'],
  backwardStop: ['Backward and stop', '◠◡', '#7947ad'],
  backwardPuckStop: ['Backward with puck and stop', '◠◡', '#7947ad'],
  pass: ['Pass', '⇢', '#157869'],
}

export function movementLegend(items) {
  const used = new Set(items.map(item => item.type))
  const types = [...Object.keys(movements), 'pivot', 'shot', 'start', 'end']
  return types.filter(type => used.has(type)).map(type => ({
    type,
    label: (movements[type] ?? markers[type])[0],
  }))
}

export function drawMovementSample(ctx, type, x, y) {
  if (movements[type]) drawItem(ctx, { type, x: x + 16, y, endX: x + 112, endY: y })
  else drawItem(ctx, { type, x: x + 60, y })
}

export function drawRink(ctx, clear = true) {
  if (clear) ctx.clearRect(0, 0, width, height)
  ctx.beginPath()
  ctx.roundRect(3, 3, width - 6, height - 6, 90)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#f9fcff'
  ctx.fillRect(0, 0, width, height)

  for (const [x, color, weight] of [
    [93, '#e17c8b', 2], [350, '#78a1eb', 8], [500, '#e17c8b', 6],
    [650, '#78a1eb', 8], [907, '#e17c8b', 2],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.strokeStyle = color
    ctx.lineWidth = weight
    ctx.stroke()
  }
  for (const [x, y, radius] of [
    [500, 230, 68], [211, 117, 62], [211, 343, 62], [789, 117, 62], [789, 343, 62],
    [384, 117, 0], [384, 343, 0], [616, 117, 0], [616, 343, 0],
  ]) {
    const color = x === 500 ? '#78a1eb' : '#e17c8b'
    if (radius) {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
    }
    dot(ctx, x, y, 5, color)
  }
  for (const x of [93, 907]) {
    ctx.beginPath()
    const angle = x === 93 ? -Math.PI / 2 : Math.PI / 2
    ctx.arc(x, 230, 30, angle, angle + Math.PI)
    ctx.fillStyle = '#dceaff'
    ctx.fill()
    ctx.strokeStyle = '#e17c8b'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(3, 3, width - 6, height - 6, 90)
  ctx.strokeStyle = '#263f61'
  ctx.lineWidth = 6
  ctx.stroke()
}

function dot(ctx, x, y, radius, color) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, 2 * Math.PI)
  ctx.fillStyle = color
  ctx.fill()
}

function drawMarker(ctx, item) {
  const [, icon, markerColor] = markers[item.type]
  const color = item.type === 'player' && item.team === 'B' ? playerTeamColors.B : markerColor
  ctx.translate(item.x, item.y)
  ctx.rotate((item.rotation ?? 0) * Math.PI / 180)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  switch (item.type) {
    case 'cone':
      ctx.beginPath()
      ctx.moveTo(0, -15)
      ctx.lineTo(12, 11)
      ctx.lineTo(-12, 11)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.fillRect(-5, 2, 10, 2)
      break
    case 'goal':
      ctx.fillRect(-15, 9, 30, 3)
      ctx.beginPath()
      ctx.roundRect(-15, -10, 30, 20, [8, 8, 2, 2])
      ctx.fillStyle = '#fff0f1'
      ctx.fill()
      for (const x of [-8, 0, 8]) {
        ctx.moveTo(x, -9)
        ctx.lineTo(x, 9)
      }
      ctx.moveTo(-14, 0)
      ctx.lineTo(14, 0)
      ctx.stroke()
      break
    case 'pucks':
      for (const [x, y] of [[-8, -6], [7, -8], [0, 1], [-10, 8], [10, 8]]) {
        dot(ctx, x, y, 5, color)
      }
      break
    case 'referee':
      dot(ctx, 0, 0, 14, color)
      dot(ctx, 0, 0, 11.5, 'white')
      ctx.clip()
      ctx.fillStyle = color
      ctx.fillRect(-9, -12, 3, 24)
      ctx.fillRect(6, -12, 3, 24)
      ctx.font = 'bold 13px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(icon, 0, 0)
      break
    case 'shot':
      dot(ctx, 0, 0, 14, color)
      dot(ctx, 0, 0, 10, 'white')
      dot(ctx, 0, 0, 5, color)
      break
    case 'puck':
      dot(ctx, 0, 0, 7, color)
      break
    case 'pivot':
      ctx.lineCap = ctx.lineJoin = 'round'
      for (const start of [-Math.PI / 2, Math.PI / 2]) {
        const end = start + Math.PI * .8
        ctx.beginPath()
        ctx.arc(0, 0, 12, start, end)
        ctx.stroke()
        ctx.save()
        ctx.translate(12 * Math.cos(end), 12 * Math.sin(end))
        ctx.rotate(end + Math.PI / 2)
        ctx.beginPath()
        ctx.moveTo(-5, -5)
        ctx.lineTo(0, 0)
        ctx.lineTo(-5, 5)
        ctx.stroke()
        ctx.restore()
      }
      break
    default:
      const numbered = item.type === 'order'
      dot(ctx, 0, 0, numbered ? 10 : 14, color)
      ctx.font = numbered ? 'bold 12px system-ui' : 'bold 15px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'white'
      ctx.fillText(numbered ? String(item.number) : icon, 0, 0)
  }
}

function pointAt(item, t) {
  const { x, y, endX, endY, bendX, bendY } = item
  if (bendX === undefined) return { x: x + (endX - x) * t, y: y + (endY - y) * t }
  const u = 1 - t
  return {
    x: u * u * x + 2 * u * t * bendX + t * t * endX,
    y: u * u * y + 2 * u * t * bendY + t * t * endY,
  }
}

export function itemPoints(item) {
  if (item.path) return item.path
  if (item.bendX !== undefined) {
    const points = [pointAt(item, 0), pointAt(item, 1)]
    for (const [start, bend, end] of [[item.x, item.bendX, item.endX], [item.y, item.bendY, item.endY]]) {
      const t = (start - bend) / (start - 2 * bend + end)
      if (t > 0 && t < 1) points.push(pointAt(item, t))
    }
    return points
  }
  return movements[item.type] ? [item, { x: item.endX, y: item.endY }] : [item]
}

function carriesPuck(item) {
  return ['carry', 'carryStop', 'backwardPuck', 'backwardPuckStop'].includes(item.type)
}

function movesBackward(item) {
  return ['backward', 'backwardPuck', 'backwardStop', 'backwardPuckStop'].includes(item.type)
}

function traceMovement(ctx, item, puckPositions) {
  const backward = movesBackward(item)
  if (backward || carriesPuck(item)) {
    tracePatternedMovement(ctx, item, backward, carriesPuck(item) ? puckPositions : undefined)
    return
  }
  ctx.beginPath()
  ctx.moveTo(item.x, item.y)
  if (item.path) {
    for (const point of item.path.slice(1)) ctx.lineTo(point.x, point.y)
  } else if (item.bendX === undefined) ctx.lineTo(item.endX, item.endY)
  else ctx.quadraticCurveTo(item.bendX, item.bendY, item.endX, item.endY)
}

function tracePatternedMovement(ctx, item, separated, puckPositions) {
  const points = item.path ?? Array.from(
    { length: item.bendX === undefined ? 2 : 33 },
    (_, index) => pointAt(item, index / (item.bendX === undefined ? 1 : 32)),
  )
  const segments = []
  let totalLength = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]
    const b = points[index]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (!length) continue
    segments.push({ a, dx: dx / length, dy: dy / length, start: totalLength })
    totalLength += length
  }

  ctx.beginPath()
  if (!segments.length) return

  // Sample by distance to keep the pattern evenly spaced on curves and freehand tracks.
  const patternStart = separated ? Math.min(3, totalLength / 3) : 0
  const end = totalLength - (separated ? 0 : Math.min(9, totalLength / 3))
  let segmentIndex = 0
  function sample(distance, offset = 0) {
    while (segments[segmentIndex + 1]?.start <= distance) segmentIndex++
    const { a, dx, dy, start } = segments[segmentIndex]
    return {
      x: a.x + dx * (distance - start) - dy * offset,
      y: a.y + dy * (distance - start) + dx * offset,
    }
  }
  if (puckPositions) {
    for (let distance = Math.min(patternStart + 24, (patternStart + end) / 2); distance < end; distance += 48) {
      puckPositions.push(sample(distance))
    }
    segmentIndex = 0
  }
  function plot(distance, offset, startStroke = false) {
    const { x, y } = sample(distance, offset)
    if (startStroke) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }

  if (separated) {
    const patternedLength = end - patternStart
    const count = Math.max(1, Math.round(patternedLength / 14))
    const radius = patternedLength / count / 2
    for (let arc = 0; arc < count; arc++) {
      const direction = arc % 2 === 0 ? 1 : -1
      for (let step = 0; step <= 10; step++) {
        const angle = .7 + (Math.PI - 1.4) * step / 10
        const distance = patternStart + radius * (2 * arc + 1 - Math.cos(angle))
        plot(distance, direction * radius * Math.sin(angle), step === 0)
      }
    }
    return
  }

  const amplitude = Math.min(6, end / 3)
  const steps = Math.ceil(end / 1.5)
  plot(0, 0, true)
  for (let step = 1; step <= steps; step++) {
    const distance = end * step / steps
    const offset = amplitude * Math.sin(distance * 2 * Math.PI / 21) * Math.min(1, (end - distance) / 6)
    plot(distance, offset)
  }
}

function drawMovement(ctx, item) {
  const [, , color] = movements[item.type]
  ctx.strokeStyle = ctx.fillStyle = color
  ctx.lineWidth = 3.5
  ctx.lineCap = ctx.lineJoin = 'round'
  if (item.type === 'pass') ctx.setLineDash([6, 6])
  const puckPositions = []
  traceMovement(ctx, item, puckPositions)
  ctx.stroke()
  ctx.setLineDash([])
  for (const { x, y } of puckPositions) {
    dot(ctx, x, y, 5.4, 'white')
    dot(ctx, x, y, 4, color)
  }

  const end = { x: item.endX, y: item.endY }
  const beforeEnd = item.path?.at(-2) ?? pointAt(item, .98)
  const endAngle = Math.atan2(end.y - beforeEnd.y, end.x - beforeEnd.x)
  const backward = movesBackward(item)
  const tip = backward ? item : end
  const afterStart = backward ? item.path?.[1] ?? pointAt(item, .02) : null
  const angle = backward ? Math.atan2(afterStart.y - item.y, afterStart.x - item.x) : endAngle

  ctx.save()
  ctx.translate(tip.x, tip.y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(-13, -7)
  ctx.lineTo(0, 0)
  ctx.lineTo(-13, 7)
  ctx.stroke()
  ctx.restore()

  if (['stop', 'carryStop', 'backwardStop', 'backwardPuckStop'].includes(item.type)) {
    ctx.translate(end.x, end.y)
    ctx.rotate(endAngle)
    ctx.beginPath()
    ctx.moveTo(4, -10)
    ctx.lineTo(4, 10)
    ctx.stroke()
  }
}

export function drawItem(ctx, item, selected = false) {
  ctx.save()
  if (selected) {
    ctx.strokeStyle = '#4582ed'
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 2
    if (movements[item.type]) {
      traceMovement(ctx, item)
      ctx.lineWidth = 11
      ctx.globalAlpha = .35
    } else {
      ctx.beginPath()
      ctx.arc(item.x, item.y, item.type === 'order' ? 16 : 20, 0, 2 * Math.PI)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.setLineDash([])
  }
  if (movements[item.type]) drawMovement(ctx, item)
  else drawMarker(ctx, item)
  ctx.restore()
}

export function hitsItem(ctx, item, point, tolerance) {
  if (markers[item.type]) return Math.hypot(item.x - point.x, item.y - point.y) <= 16 + tolerance / 2
  if (movesBackward(item) && Math.hypot(item.x - point.x, item.y - point.y) <= tolerance) return true
  ctx.save()
  ctx.lineWidth = tolerance * 2
  ctx.lineCap = ctx.lineJoin = 'round'
  traceMovement(ctx, item)
  const hit = ctx.isPointInStroke(point.x, point.y)
  ctx.restore()
  return hit
}

export function activityThumbnail(entry) {
  const thumbnail = document.createElement('canvas')
  thumbnail.className = 'activity-thumbnail'
  thumbnail.width = 360
  thumbnail.height = 180
  thumbnail.setAttribute('aria-label', 'Rink thumbnail for ' + entry.title)

  const thumbnailContext = thumbnail.getContext('2d')
  const visibleWidth = rinkWidth(entry.layout)
  const visibleHeight = rinkHeight(entry.layout)
  const scale = Math.min((thumbnail.width - 16) / visibleWidth, (thumbnail.height - 16) / visibleHeight)
  thumbnailContext.translate((thumbnail.width - visibleWidth * scale) / 2, (thumbnail.height - visibleHeight * scale) / 2)
  thumbnailContext.scale(scale, scale)
  thumbnailContext.beginPath()
  thumbnailContext.rect(0, 0, visibleWidth, visibleHeight)
  thumbnailContext.clip()
  drawRink(thumbnailContext, false)
  for (const item of entry.items) drawItem(thumbnailContext, item)
  return thumbnail
}
