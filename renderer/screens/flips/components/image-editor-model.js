// Geometry, hit tests and undo history of the flip image editor (simple-image-editor.js), free of canvas
// and DOM. Objects follow fabric's conventions, as toast-ui did: left/top is the centre, angle is in
// degrees (clockwise), width/height are unscaled and scaleX/scaleY apply on top.

export const CORNERS = ['tl', 'tr', 'br', 'bl']

const CORNER_SIGNS = {tl: [-1, -1], tr: [1, -1], br: [1, 1], bl: [-1, 1]}
const OPPOSITE = {tl: 'br', tr: 'bl', br: 'tl', bl: 'tr'}
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function rotate({x, y}, deg) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {x: x * cos - y * sin, y: x * sin + y * cos}
}

// Canvas point -> the object's own unscaled frame, origin at its centre.
export function toLocal(obj, point) {
  const p = rotate(
    {x: point.x - obj.left, y: point.y - obj.top},
    -(obj.angle || 0)
  )
  return {x: p.x / (obj.scaleX || 1), y: p.y / (obj.scaleY || 1)}
}

export function toCanvas(obj, local) {
  const p = rotate(
    {x: local.x * (obj.scaleX || 1), y: local.y * (obj.scaleY || 1)},
    obj.angle || 0
  )
  return {x: p.x + obj.left, y: p.y + obj.top}
}

export function cornerPoint(obj, corner) {
  const [sx, sy] = CORNER_SIGNS[corner]
  return toCanvas(obj, {x: (sx * obj.width) / 2, y: (sy * obj.height) / 2})
}

export function topMiddlePoint(obj) {
  return toCanvas(obj, {x: 0, y: -obj.height / 2})
}

// The rotation handle sits `offset` canvas units above the top edge, turning with the object.
export function rotationHandlePoint(obj, offset) {
  const top = topMiddlePoint(obj)
  const up = rotate({x: 0, y: -offset}, obj.angle || 0)
  return {x: top.x + up.x, y: top.y + up.y}
}

export function containsPoint(obj, point) {
  const p = toLocal(obj, point)
  return Math.abs(p.x) <= obj.width / 2 && Math.abs(p.y) <= obj.height / 2
}

// Topmost visible object under the point.
export function hitObject(objects, point) {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const obj = objects[i]
    if (obj.opacity !== 0 && containsPoint(obj, point)) return obj.id
  }
  return null
}

// 'mtr' (rotation), a corner, or null. Sizes are in canvas units.
export function hitHandle(obj, point, {cornerSize, rotatingPointOffset}) {
  const reach = cornerSize / 2 + 2
  const near = (p) =>
    Math.abs(point.x - p.x) <= reach && Math.abs(point.y - p.y) <= reach
  if (near(rotationHandlePoint(obj, rotatingPointOffset))) return 'mtr'
  return CORNERS.find((corner) => near(cornerPoint(obj, corner))) || null
}

export function resizeCursor(corner, angle = 0) {
  const [sx, sy] = CORNER_SIGNS[corner]
  const direction = (Math.atan2(sy, sx) * 180) / Math.PI + angle
  const halfTurn = ((direction % 180) + 180) % 180
  return RESIZE_CURSORS[Math.round(halfTurn / 45) % 4]
}

export function movedBy(start, startPoint, point) {
  return {
    left: start.left + point.x - startPoint.x,
    top: start.top + point.y - startPoint.y,
  }
}

// Proportional scaling from a corner, the opposite corner staying in place (fabric's default).
// The object never shrinks below minSize on its shorter side, unless it already was smaller.
export function scaleFromCorner(start, corner, point, minSize) {
  const [sx, sy] = CORNER_SIGNS[corner]
  const anchor = cornerPoint(start, OPPOSITE[corner])
  const diagonal = {
    x: sx * start.width * start.scaleX,
    y: sy * start.height * start.scaleY,
  }
  const lengthSq = diagonal.x ** 2 + diagonal.y ** 2
  if (!lengthSq) return {}

  const pointer = rotate(
    {x: point.x - anchor.x, y: point.y - anchor.y},
    -(start.angle || 0)
  )
  const shorter = Math.min(
    start.width * start.scaleX,
    start.height * start.scaleY
  )
  const minRatio = shorter > 0 ? Math.min(1, minSize / shorter) : 1
  const ratio = Math.max(
    (pointer.x * diagonal.x + pointer.y * diagonal.y) / lengthSq,
    minRatio
  )
  const half = rotate(
    {x: (diagonal.x * ratio) / 2, y: (diagonal.y * ratio) / 2},
    start.angle || 0
  )
  return {
    left: anchor.x + half.x,
    top: anchor.y + half.y,
    scaleX: start.scaleX * ratio,
    scaleY: start.scaleY * ratio,
  }
}

// Angle that points the rotation handle at the pointer; snaps to a quarter turn within snapDeg.
export function rotationAngle(obj, point, snapDeg = 4) {
  const deg =
    (Math.atan2(point.y - obj.top, point.x - obj.left) * 180) / Math.PI + 90
  const angle = ((deg % 360) + 360) % 360
  const quarter = Math.round(angle / 90) * 90
  return Math.abs(angle - quarter) <= snapDeg ? quarter % 360 : angle
}

// A pen stroke as an object: points relative to the centre of their bounding box.
export function pathObject(id, points, color, strokeWidth) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const left = (minX + maxX) / 2
  const top = (minY + maxY) / 2
  return {
    id,
    type: 'path',
    left,
    top,
    width: maxX - minX + strokeWidth,
    height: maxY - minY + strokeWidth,
    angle: 0,
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    points: points.map((p) => ({x: p.x - left, y: p.y - top})),
    color,
    strokeWidth,
  }
}

// Crop zone

export function clampPoint(point, size) {
  return {
    x: clamp(point.x, 0, size.width),
    y: clamp(point.y, 0, size.height),
  }
}

export function rectFromPoints(a, b) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

export function rectCorner(rect, corner) {
  const [sx, sy] = CORNER_SIGNS[corner]
  return {
    x: rect.left + (sx > 0 ? rect.width : 0),
    y: rect.top + (sy > 0 ? rect.height : 0),
  }
}

export function oppositeRectCorner(rect, corner) {
  return rectCorner(rect, OPPOSITE[corner])
}

// A corner of the zone, 'inside', or null.
export function hitRect(rect, point, reach) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const corner = CORNERS.find((c) => {
    const p = rectCorner(rect, c)
    return Math.abs(point.x - p.x) <= reach && Math.abs(point.y - p.y) <= reach
  })
  if (corner) return corner
  const inside =
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  return inside ? 'inside' : null
}

export function moveRect(rect, dx, dy, size) {
  return {
    ...rect,
    left: clamp(rect.left + dx, 0, size.width - rect.width),
    top: clamp(rect.top + dy, 0, size.height - rect.height),
  }
}

// Whole pixels inside the canvas; an empty area when there is no zone.
export function cropArea(rect, size) {
  if (!rect) return {left: 0, top: 0, width: 0, height: 0}
  const left = clamp(Math.round(rect.left), 0, size.width)
  const top = clamp(Math.round(rect.top), 0, size.height)
  const right = clamp(Math.round(rect.left + rect.width), 0, size.width)
  const bottom = clamp(Math.round(rect.top + rect.height), 0, size.height)
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

// Undo history: whole-scene snapshots. Objects are copied; images and stroke points are never mutated,
// so they are shared between snapshots.

export function cloneScene(scene) {
  return {...scene, objects: scene.objects.map((obj) => ({...obj}))}
}

export function createHistory(limit = 50) {
  return {limit, undo: [], redo: []}
}

export function recordUndo(history, scene) {
  history.undo.push(cloneScene(scene))
  if (history.undo.length > history.limit) history.undo.shift()
  history.redo = []
}

export function stepBack(history, scene) {
  const previous = history.undo.pop()
  if (!previous) return null
  history.redo.push(cloneScene(scene))
  return previous
}

export function stepForward(history, scene) {
  const next = history.redo.pop()
  if (!next) return null
  history.undo.push(cloneScene(scene))
  return next
}
