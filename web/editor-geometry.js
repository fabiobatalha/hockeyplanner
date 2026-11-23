import { itemPoints } from './drawing.js'

export function itemBounds(items) {
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
  for (const item of items) {
    for (const { x, y } of itemPoints(item)) {
      bounds.left = Math.min(bounds.left, x)
      bounds.right = Math.max(bounds.right, x)
      bounds.top = Math.min(bounds.top, y)
      bounds.bottom = Math.max(bounds.bottom, y)
    }
  }
  return bounds
}

export function translateItem(original, x, y) {
  const item = { ...original, x: original.x + x, y: original.y + y }
  if (original.endX !== undefined) {
    item.endX += x
    item.endY += y
  }
  if (original.bendX !== undefined) {
    item.bendX += x
    item.bendY += y
  }
  if (original.path) item.path = original.path.map(point => ({ ...point, x: point.x + x, y: point.y + y }))
  return item
}

export function movementEnds(item) {
  return [{ x: item.x, y: item.y }, { x: item.endX, y: item.endY }]
}

export function resizeMovement(original, endpoint, position) {
  const ends = movementEnds(original)
  const anchor = ends[1 - endpoint]
  const moving = ends[endpoint]
  const dx = moving.x - anchor.x
  const dy = moving.y - anchor.y
  const length = dx * dx + dy * dy
  const newX = position.x - anchor.x
  const newY = position.y - anchor.y
  let transform
  if (length > 1) {
    const scale = (dx * newX + dy * newY) / length
    const rotation = (dx * newY - dy * newX) / length
    transform = point => {
      const x = point.x - anchor.x
      const y = point.y - anchor.y
      return { ...point, x: anchor.x + x * scale - y * rotation, y: anchor.y + x * rotation + y * scale }
    }
  } else {
    // A closed freehand path has no usable endpoint vector. Move points
    // progressively toward the moved endpoint while keeping the other fixed.
    transform = (point, progress) => {
      const weight = endpoint === 0 ? 1 - progress : progress
      return {
        ...point,
        x: point.x + (position.x - moving.x) * weight,
        y: point.y + (position.y - moving.y) * weight,
      }
    }
  }
  ends[endpoint] = position
  const [start, end] = ends
  const item = { ...original, x: start.x, y: start.y, endX: end.x, endY: end.y }
  if (original.bendX !== undefined) {
    const bend = transform({ x: original.bendX, y: original.bendY }, .5)
    item.bendX = bend.x
    item.bendY = bend.y
  }
  if (original.path) {
    item.path = original.path.map((point, i, path) => transform(point, i / (path.length - 1)))
    item.path[0] = { ...item.path[0], ...start }
    item.path[item.path.length - 1] = { ...item.path.at(-1), ...end }
  }
  return item
}
