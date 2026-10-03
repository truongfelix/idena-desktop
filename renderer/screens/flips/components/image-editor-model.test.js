import {
  cornerPoint,
  createHistory,
  cropArea,
  hitHandle,
  hitObject,
  hitRect,
  moveRect,
  pathObject,
  recordUndo,
  rectFromPoints,
  resizeCursor,
  rotationAngle,
  rotationHandlePoint,
  scaleFromCorner,
  stepBack,
  stepForward,
  toCanvas,
  toLocal,
} from './image-editor-model'

const picture = (props) => ({
  id: 'a',
  left: 100,
  top: 50,
  width: 40,
  height: 20,
  angle: 0,
  opacity: 1,
  scaleX: 1,
  scaleY: 1,
  ...props,
})

const close = (p, q) => {
  expect(p.x).toBeCloseTo(q.x)
  expect(p.y).toBeCloseTo(q.y)
}

const SIZES = {cornerSize: 8, rotatingPointOffset: 20}

describe('object frame', () => {
  it('maps canvas points to the object frame and back, rotated and scaled', () => {
    const obj = picture({angle: 30, scaleX: 2, scaleY: 0.5})
    const point = {x: 112, y: 41}
    close(toCanvas(obj, toLocal(obj, point)), point)
  })

  it('puts the corners of a quarter-turned object where they turn to', () => {
    const obj = picture({angle: 90})
    // Top-left (-20, -10) turns clockwise to (10, -20) around the centre.
    close(cornerPoint(obj, 'tl'), {x: 110, y: 30})
  })

  it('keeps the rotation handle above the top edge, turning with the object', () => {
    close(rotationHandlePoint(picture(), 20), {x: 100, y: 20})
    close(rotationHandlePoint(picture({angle: 90}), 20), {x: 130, y: 50})
  })
})

describe('hit tests', () => {
  it('finds the topmost visible object under the point', () => {
    const below = picture({id: 'below'})
    const above = picture({id: 'above', left: 110})
    expect(hitObject([below, above], {x: 115, y: 50})).toBe('above')
    expect(hitObject([below, above], {x: 85, y: 50})).toBe('below')
    expect(hitObject([below, above], {x: 300, y: 50})).toBe(null)
  })

  it('skips an object hidden while it is erased', () => {
    expect(hitObject([picture({opacity: 0})], {x: 100, y: 50})).toBe(null)
  })

  it('uses the rotated outline, not the upright box', () => {
    const obj = picture({angle: 90})
    // Inside the upright 40x20 box, outside the turned 20x40 one.
    expect(hitObject([obj], {x: 118, y: 50})).toBe(null)
    expect(hitObject([obj], {x: 100, y: 68})).toBe('a')
  })

  it('finds corner and rotation handles', () => {
    const obj = picture()
    expect(hitHandle(obj, {x: 121, y: 61}, SIZES)).toBe('br')
    expect(hitHandle(obj, {x: 79, y: 39}, SIZES)).toBe('tl')
    expect(hitHandle(obj, {x: 100, y: 20}, SIZES)).toBe('mtr')
    expect(hitHandle(obj, {x: 100, y: 50}, SIZES)).toBe(null)
  })

  it('gives resize cursors that turn with the object', () => {
    expect(resizeCursor('tl')).toBe('nwse-resize')
    expect(resizeCursor('tr')).toBe('nesw-resize')
    expect(resizeCursor('tl', 90)).toBe('nesw-resize')
    expect(resizeCursor('tl', 45)).toBe('ns-resize')
  })
})

describe('scaling from a corner', () => {
  it('scales proportionally and keeps the opposite corner in place', () => {
    const obj = picture()
    const next = scaleFromCorner(obj, 'br', {x: 160, y: 80}, 8)
    expect(next.scaleX).toBeCloseTo(2)
    expect(next.scaleY).toBeCloseTo(2)
    close(cornerPoint({...obj, ...next}, 'tl'), cornerPoint(obj, 'tl'))
  })

  it('keeps the opposite corner of a rotated object in place', () => {
    const obj = picture({angle: 35, scaleX: 1.5, scaleY: 1.5})
    const pointer = {x: 70, y: 20}
    const next = scaleFromCorner(obj, 'tl', pointer, 8)
    close(cornerPoint({...obj, ...next}, 'br'), cornerPoint(obj, 'br'))
  })

  it('does not shrink below the minimum size or flip over', () => {
    const obj = picture()
    const next = scaleFromCorner(obj, 'br', {x: 0, y: 0}, 8)
    // The shorter side (20) stops at 8.
    expect(next.scaleY).toBeCloseTo(0.4)
    expect(next.scaleX).toBeCloseTo(0.4)
  })

  it('cannot shrink an object already smaller than the minimum', () => {
    const dot = picture({width: 4, height: 4})
    expect(scaleFromCorner(dot, 'br', {x: 0, y: 0}, 8).scaleX).toBeCloseTo(1)
  })
})

describe('rotation', () => {
  it('points the handle at the pointer', () => {
    const obj = picture()
    expect(rotationAngle(obj, {x: 100, y: 0})).toBeCloseTo(0)
    expect(rotationAngle(obj, {x: 200, y: 50})).toBeCloseTo(90)
    expect(rotationAngle(obj, {x: 0, y: 50})).toBeCloseTo(270)
    expect(rotationAngle(obj, {x: 200, y: 150})).toBeCloseTo(135)
  })

  it('snaps to a quarter turn when close', () => {
    const obj = picture()
    // 3 degrees off upright.
    const x = 100 + 50 * Math.tan((3 * Math.PI) / 180)
    expect(rotationAngle(obj, {x, y: 0})).toBe(0)
    expect(rotationAngle(obj, {x, y: 0}, 0)).toBeCloseTo(3)
  })
})

describe('pen strokes', () => {
  it('centres the points in a box padded by the stroke width', () => {
    const path = pathObject(
      'p',
      [
        {x: 10, y: 10},
        {x: 30, y: 20},
      ],
      '#ff6666dd',
      4
    )
    expect(path).toMatchObject({left: 20, top: 15, width: 24, height: 14})
    expect(path.points).toEqual([
      {x: -10, y: -5},
      {x: 10, y: 5},
    ])
  })

  it('makes a dot from a single click', () => {
    const dot = pathObject('p', [{x: 5, y: 5}], '#000', 12)
    expect(dot).toMatchObject({left: 5, top: 5, width: 12, height: 12})
  })
})

describe('crop zone', () => {
  const size = {width: 440, height: 330}

  it('is empty until a zone is drawn', () => {
    expect(cropArea(null, size)).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    })
  })

  it('draws a zone in any direction and rounds it to whole pixels in the canvas', () => {
    const rect = rectFromPoints({x: 300.6, y: 200.2}, {x: 100.4, y: -20})
    expect(cropArea(rect, size)).toEqual({
      left: 100,
      top: 0,
      width: 201,
      height: 200,
    })
  })

  it('moves a zone without leaving the canvas', () => {
    const rect = {left: 400, top: 10, width: 30, height: 30}
    expect(moveRect(rect, 50, -50, size)).toEqual({
      left: 410,
      top: 0,
      width: 30,
      height: 30,
    })
  })

  it('finds the corners and the inside of a zone', () => {
    const rect = {left: 100, top: 100, width: 50, height: 40}
    expect(hitRect(rect, {x: 151, y: 141}, 5)).toBe('br')
    expect(hitRect(rect, {x: 120, y: 120}, 5)).toBe('inside')
    expect(hitRect(rect, {x: 10, y: 10}, 5)).toBe(null)
    expect(hitRect(null, {x: 10, y: 10}, 5)).toBe(null)
  })
})

describe('undo history', () => {
  const scene = (objects) => ({size: {width: 440, height: 330}, objects})

  it('restores the scene as it was, not as it was changed afterwards', () => {
    const history = createHistory()
    const live = scene([picture()])
    recordUndo(history, live)
    live.objects[0].left = 300

    const previous = stepBack(history, live)
    expect(previous.objects[0].left).toBe(100)
    expect(stepForward(history, previous).objects[0].left).toBe(300)
  })

  it('forgets the redo steps after a new change', () => {
    const history = createHistory()
    recordUndo(history, scene([]))
    stepBack(history, scene([picture()]))
    expect(history.redo).toHaveLength(1)
    recordUndo(history, scene([]))
    expect(history.redo).toHaveLength(0)
  })

  it('keeps only the last steps', () => {
    const history = createHistory(3)
    for (let i = 0; i < 5; i += 1)
      recordUndo(history, scene([picture({left: i})]))
    expect(history.undo.map((s) => s.objects[0].left)).toEqual([2, 3, 4])
  })

  it('has nothing to undo or redo at first', () => {
    const history = createHistory()
    expect(stepBack(history, scene([]))).toBe(null)
    expect(stepForward(history, scene([]))).toBe(null)
  })
})
