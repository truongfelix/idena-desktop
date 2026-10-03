/* eslint-disable react/prop-types */
import React from 'react'
import {
  CORNERS,
  clampPoint,
  cornerPoint,
  createHistory,
  cropArea,
  hitHandle,
  hitObject,
  hitRect,
  movedBy,
  moveRect,
  oppositeRectCorner,
  pathObject,
  recordUndo,
  rectCorner,
  rectFromPoints,
  resizeCursor,
  rotationAngle,
  rotationHandlePoint,
  scaleFromCorner,
  stepBack,
  stepForward,
  topMiddlePoint,
} from './image-editor-model'

// The flip image editor, with the part of toast-ui's API that flip-editor.js uses: pictures and pen
// strokes are separate objects that can be selected, moved, scaled from a corner, rotated and deleted;
// a crop zone is drawn by dragging; undo/redo restore whole scenes.

const NORMAL = 'NORMAL'
const FREE_DRAWING = 'FREE_DRAWING'
const CROPPER = 'CROPPER'

const MIN_OBJECT_SIZE = 8
const CROP_CORNER_SIZE = 10
const SETTABLE_PROPS = [
  'left',
  'top',
  'width',
  'height',
  'angle',
  'opacity',
  'scaleX',
  'scaleY',
]

const DEFAULT_SELECTION_STYLE = {
  cornerSize: 8,
  rotatingPointOffset: 20,
  lineWidth: 1,
  cornerColor: '#fff',
  cornerStrokeColor: '#578fff',
  borderColor: '#578fff',
}

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })

const withHash = (color) => (color.startsWith('#') ? color : `#${color}`)

function fitSize(size, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height)
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

// Smoothed like fabric's pencil brush: quadratic curves through the midpoints.
function drawStroke(ctx, points, color, width) {
  if (!points.length) return
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const [first] = points
  if (points.every((p) => p.x === first.x && p.y === first.y)) {
    ctx.arc(first.x, first.y, width / 2, 0, 2 * Math.PI)
    ctx.fill()
    return
  }
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1]
    const q = points[i]
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2)
  }
  const last = points[points.length - 1]
  ctx.lineTo(last.x, last.y)
  ctx.stroke()
}

function drawObject(ctx, obj) {
  ctx.save()
  ctx.globalAlpha = obj.opacity == null ? 1 : obj.opacity
  ctx.translate(obj.left, obj.top)
  ctx.rotate(((obj.angle || 0) * Math.PI) / 180)
  ctx.scale(obj.scaleX || 1, obj.scaleY || 1)
  if (obj.type === 'path') {
    drawStroke(ctx, obj.points, obj.color, obj.strokeWidth)
  } else if (obj.img) {
    // As fabric: width/height frame the picture at its own size, a larger frame does not stretch it.
    const sw = Math.min(obj.width, obj.img.naturalWidth || obj.img.width)
    const sh = Math.min(obj.height, obj.img.naturalHeight || obj.img.height)
    if (sw > 0 && sh > 0) {
      ctx.drawImage(
        obj.img,
        0,
        0,
        sw,
        sh,
        -obj.width / 2,
        -obj.height / 2,
        sw,
        sh
      )
    }
  }
  ctx.restore()
}

function drawScene(ctx, scene) {
  const {width, height} = scene.size
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  if (scene.background) {
    ctx.drawImage(scene.background.img, 0, 0, width, height)
  }
  scene.objects.forEach((obj) => drawObject(ctx, obj))
}

function sceneCanvas(scene) {
  const canvas = document.createElement('canvas')
  canvas.width = scene.size.width
  canvas.height = scene.size.height
  drawScene(canvas.getContext('2d'), scene)
  return canvas
}

function drawHandle(ctx, point, size, fill, stroke, lineWidth) {
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size)
  ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size)
}

// `unit` = canvas units per screen pixel, so handles keep their screen size.
function drawSelection(ctx, obj, style, unit) {
  const corners = CORNERS.map((corner) => cornerPoint(obj, corner))
  const lineWidth = Number(style.lineWidth) * unit
  const handle = rotationHandlePoint(obj, style.rotatingPointOffset * unit)
  const top = topMiddlePoint(obj)

  ctx.save()
  ctx.strokeStyle = style.borderColor
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.moveTo(top.x, top.y)
  ctx.lineTo(handle.x, handle.y)
  ctx.stroke()
  ;[...corners, handle].forEach((p) =>
    drawHandle(
      ctx,
      p,
      style.cornerSize * unit,
      style.cornerColor,
      style.cornerStrokeColor,
      lineWidth
    )
  )
  ctx.restore()
}

function drawCropZone(ctx, size, rect, unit) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.beginPath()
  ctx.rect(0, 0, size.width, size.height)
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    ctx.fill()
    ctx.restore()
    return
  }
  ctx.rect(rect.left, rect.top, rect.width, rect.height)
  ctx.fill('evenodd')

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.lineWidth = unit
  ctx.beginPath()
  for (let i = 1; i < 3; i += 1) {
    const x = rect.left + (rect.width * i) / 3
    const y = rect.top + (rect.height * i) / 3
    ctx.moveTo(x, rect.top)
    ctx.lineTo(x, rect.top + rect.height)
    ctx.moveTo(rect.left, y)
    ctx.lineTo(rect.left + rect.width, y)
  }
  ctx.stroke()

  ctx.strokeStyle = '#fff'
  ctx.strokeRect(rect.left, rect.top, rect.width, rect.height)
  CORNERS.forEach((corner) =>
    drawHandle(
      ctx,
      rectCorner(rect, corner),
      CROP_CORNER_SIZE * unit,
      '#fff',
      'rgba(0, 0, 0, 0.4)',
      unit
    )
  )
  ctx.restore()
}

const SimpleImageEditor = React.forwardRef(
  ({cssMaxHeight, cssMaxWidth, selectionStyle}, ref) => {
    const canvasRef = React.useRef(null)

    const maxWidth = cssMaxWidth || 440
    const maxHeight = cssMaxHeight || 330

    const styleRef = React.useRef(DEFAULT_SELECTION_STYLE)
    styleRef.current = {...DEFAULT_SELECTION_STYLE, ...selectionStyle}

    const stateRef = React.useRef(null)
    if (!stateRef.current) {
      stateRef.current = {
        scene: {
          size: {width: maxWidth, height: maxHeight},
          background: null,
          objects: [],
        },
        history: createHistory(),
        activeId: null,
        mode: NORMAL,
        brush: {color: '#ff6666dd', width: 20},
        cropRect: null,
        drag: null,
        handlers: {},
        nextId: 1,
      }
    }

    const editorRef = React.useRef(null)

    if (!editorRef.current) {
      const s = stateRef.current

      const emit = (eventName, ...args) => {
        ;(s.handlers[eventName] || []).forEach((handler) => handler(...args))
      }

      const findObject = (id) => s.scene.objects.find((obj) => obj.id === id)

      // Canvas units per screen pixel of the displayed canvas.
      const unit = () => {
        const canvas = canvasRef.current
        const cssWidth = canvas && canvas.getBoundingClientRect().width
        return cssWidth ? s.scene.size.width / cssWidth : 1
      }

      const layout = () => {
        const canvas = canvasRef.current
        const css = fitSize(s.scene.size, maxWidth, maxHeight)
        const ratio = window.devicePixelRatio || 1
        const width = Math.round(css.width * ratio)
        const height = Math.round(css.height * ratio)
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height
        canvas.style.width = `${css.width}px`
        canvas.style.height = `${css.height}px`
      }

      const render = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        layout()
        const ctx = canvas.getContext('2d')
        const {size} = s.scene
        ctx.setTransform(
          canvas.width / size.width,
          0,
          0,
          canvas.height / size.height,
          0,
          0
        )
        drawScene(ctx, s.scene)

        const {drag} = s
        if (drag && drag.kind === 'draw') {
          drawStroke(ctx, drag.points, s.brush.color, s.brush.width)
        }
        if (s.mode === CROPPER) {
          drawCropZone(ctx, size, s.cropRect, unit())
        } else if (s.mode === NORMAL && findObject(s.activeId)) {
          drawSelection(ctx, findObject(s.activeId), styleRef.current, unit())
        }
      }

      const select = (id) => {
        if (s.activeId === id) return
        s.activeId = id
        emit(id ? 'selectionCreated' : 'selectionCleared')
      }

      const nextObjectId = () => {
        const id = `object-${s.nextId}`
        s.nextId += 1
        return id
      }

      const replaceScene = (scene) => {
        s.scene = scene
        if (!findObject(s.activeId)) select(null)
        render()
      }

      const removeObject = (id) => {
        if (!findObject(id)) return
        recordUndo(s.history, s.scene)
        s.scene = {
          ...s.scene,
          objects: s.scene.objects.filter((obj) => obj.id !== id),
        }
        if (s.activeId === id) select(null)
        render()
        emit('undoStackChanged')
      }

      const stopDrawingMode = () => {
        s.mode = NORMAL
        s.cropRect = null
        s.drag = null
        render()
      }

      const editor = {
        addImageObject: async (url) => {
          const img = await loadImage(url)
          recordUndo(s.history, s.scene)
          const obj = {
            id: nextObjectId(),
            type: 'image',
            url,
            img,
            left: s.scene.size.width / 2,
            top: s.scene.size.height / 2,
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            angle: 0,
            opacity: 1,
            scaleX: 1,
            scaleY: 1,
          }
          s.scene = {...s.scene, objects: [...s.scene.objects, obj]}
          select(obj.id)
          render()
          emit('undoStackChanged')
          const {img: _img, url: _url, ...props} = obj
          return props
        },
        clearRedoStack: () => {
          s.history.redo = []
        },
        clearUndoStack: () => {
          s.history.undo = []
        },
        crop: async (rect) => {
          const area = cropArea(rect, s.scene.size)
          if (!area.width || !area.height) return
          const cropped = document.createElement('canvas')
          cropped.width = area.width
          cropped.height = area.height
          cropped
            .getContext('2d')
            .drawImage(
              sceneCanvas(s.scene),
              area.left,
              area.top,
              area.width,
              area.height,
              0,
              0,
              area.width,
              area.height
            )
          recordUndo(s.history, s.scene)
          s.cropRect = null
          replaceScene({
            size: {width: area.width, height: area.height},
            background: {img: cropped},
            objects: [],
          })
          emit('undoStackChanged')
        },
        discardSelection: () => {
          select(null)
          render()
        },
        execute: async (command, id) => {
          if (command === 'removeObject') removeObject(id)
        },
        getCropzoneRect: () => cropArea(s.cropRect, s.scene.size),
        getDrawingMode: () => s.mode,
        getObjectProperties: (id, keys) => {
          const obj = findObject(id)
          if (!obj) return {}
          const names = typeof keys === 'string' ? [keys] : keys
          return names.reduce((acc, name) => {
            acc[name] = obj[name]
            return acc
          }, {})
        },
        isEmptyRedoStack: () => s.history.redo.length === 0,
        isEmptyUndoStack: () => s.history.undo.length === 0,
        loadImageFromURL: async (url) => {
          const img = await loadImage(url)
          const oldSize = s.scene.size
          const size = {
            width: img.naturalWidth || img.width || maxWidth,
            height: img.naturalHeight || img.height || maxHeight,
          }
          recordUndo(s.history, s.scene)
          s.cropRect = null
          replaceScene({size, background: {img, url}, objects: []})
          emit('undoStackChanged')
          return {
            oldWidth: oldSize.width,
            oldHeight: oldSize.height,
            newWidth: size.width,
            newHeight: size.height,
          }
        },
        on: (handlers) => {
          Object.entries(handlers).forEach(([eventName, handler]) => {
            if (!s.handlers[eventName]) s.handlers[eventName] = []
            s.handlers[eventName].push(handler)
          })
        },
        redo: async () => {
          const next = stepForward(s.history, s.scene)
          if (!next) return
          replaceScene(next)
          emit('undoStackChanged')
          emit('redoStackChanged')
        },
        removeActiveObject: () => {
          if (s.activeId) removeObject(s.activeId)
        },
        setBrush: (brush) => {
          s.brush = {
            ...s.brush,
            ...brush,
            ...(brush.color && {color: withHash(brush.color)}),
          }
        },
        setObjectPropertiesQuietly: (id, props) => {
          const obj = findObject(id)
          if (!obj || !props) return false
          SETTABLE_PROPS.forEach((name) => {
            if (Number.isFinite(props[name])) obj[name] = props[name]
          })
          render()
          return true
        },
        startDrawingMode: (mode) => {
          if (s.mode === mode) return true
          stopDrawingMode()
          s.mode = mode
          select(null)
          render()
          return true
        },
        stopDrawingMode,
        toDataURL: () => sceneCanvas(s.scene).toDataURL('image/png'),
        undo: async () => {
          const previous = stepBack(s.history, s.scene)
          if (!previous) return
          replaceScene(previous)
          emit('undoStackChanged')
          emit('redoStackChanged')
        },
      }

      // Read by flip-editor.js the way it read toast-ui's internals.
      Object.defineProperty(editor, '_graphics', {
        get() {
          return {
            _canvas: {
              _activeObject: s.activeId ? {__fe_id: s.activeId} : null,
            },
            _objects: s.scene.objects.reduce((acc, obj) => {
              acc[obj.id] = obj.url ? {...obj, _element: {src: obj.url}} : obj
              return acc
            }, {}),
            renderAll: render,
          }
        },
      })

      // Pointer handling
      const handleSizes = () => {
        const u = unit()
        return {
          cornerSize: styleRef.current.cornerSize * u,
          rotatingPointOffset: styleRef.current.rotatingPointOffset * u,
        }
      }

      const cursorAt = (point) => {
        if (s.mode === FREE_DRAWING) return 'crosshair'
        if (s.mode === CROPPER) {
          const part = hitRect(s.cropRect, point, CROP_CORNER_SIZE * unit())
          if (part === 'inside') return 'move'
          return part ? resizeCursor(part) : 'crosshair'
        }
        const active = findObject(s.activeId)
        const handle = active && hitHandle(active, point, handleSizes())
        if (handle === 'mtr') return 'crosshair'
        if (handle) return resizeCursor(handle, active.angle)
        return hitObject(s.scene.objects, point) ? 'move' : 'default'
      }

      editor.pointerDown = (point) => {
        if (s.mode === FREE_DRAWING) {
          s.drag = {kind: 'draw', points: [point]}
        } else if (s.mode === CROPPER) {
          const part = hitRect(s.cropRect, point, CROP_CORNER_SIZE * unit())
          if (part === 'inside') {
            s.drag = {kind: 'cropMove', start: point, rect: s.cropRect}
          } else if (part) {
            s.drag = {
              kind: 'cropNew',
              anchor: oppositeRectCorner(s.cropRect, part),
            }
          } else {
            s.drag = {kind: 'cropNew', anchor: point}
            s.cropRect = rectFromPoints(point, point)
          }
        } else {
          const active = findObject(s.activeId)
          const handle = active && hitHandle(active, point, handleSizes())
          const id = handle ? s.activeId : hitObject(s.scene.objects, point)
          select(id)
          if (id) {
            let kind = 'move'
            if (handle === 'mtr') kind = 'rotate'
            else if (handle) kind = 'scale'
            s.drag = {
              kind,
              corner: handle,
              start: {...findObject(id)},
              startPoint: point,
              changed: false,
            }
          }
        }
        render()
        emit('mousedown', point)
      }

      // A right click selects what is under it, so the context menu's Delete acts on that object.
      editor.secondaryDown = (point) => {
        if (s.mode !== NORMAL || s.drag) return
        select(hitObject(s.scene.objects, point))
        render()
        emit('mousedown', point)
      }

      const TRANSFORM_EVENTS = {
        move: 'objectMoved',
        scale: 'objectScaled',
        rotate: 'objectRotated',
      }

      editor.pointerMove = (point) => {
        const {drag} = s
        const canvas = canvasRef.current
        if (!drag) {
          if (canvas) canvas.style.cursor = cursorAt(point)
          return
        }
        const {size} = s.scene
        switch (drag.kind) {
          case 'draw': {
            const last = drag.points[drag.points.length - 1]
            if (Math.hypot(point.x - last.x, point.y - last.y) < 1) return
            drag.points.push(point)
            break
          }
          case 'cropNew':
            s.cropRect = rectFromPoints(drag.anchor, clampPoint(point, size))
            break
          case 'cropMove':
            s.cropRect = moveRect(
              drag.rect,
              point.x - drag.start.x,
              point.y - drag.start.y,
              size
            )
            break
          default: {
            const obj = findObject(drag.start.id)
            if (!obj) return
            let props
            if (drag.kind === 'move') {
              props = movedBy(drag.start, drag.startPoint, point)
            } else if (drag.kind === 'scale') {
              props = scaleFromCorner(
                drag.start,
                drag.corner,
                point,
                MIN_OBJECT_SIZE
              )
            } else {
              props = {angle: rotationAngle(drag.start, point)}
            }
            if (!drag.changed) {
              recordUndo(s.history, s.scene)
              drag.changed = true
            }
            Object.assign(obj, props)
            render()
            emit(TRANSFORM_EVENTS[drag.kind], {...obj})
            return
          }
        }
        render()
      }

      editor.pointerUp = () => {
        const {drag} = s
        if (!drag) return
        s.drag = null
        if (drag.kind === 'draw') {
          recordUndo(s.history, s.scene)
          const path = pathObject(
            nextObjectId(),
            drag.points,
            s.brush.color,
            s.brush.width
          )
          s.scene = {...s.scene, objects: [...s.scene.objects, path]}
          render()
          emit('undoStackChanged')
        } else if (drag.changed) {
          emit('undoStackChanged')
        }
      }

      editor.deleteKey = () => {
        if (s.mode !== NORMAL || !s.activeId) return false
        removeObject(s.activeId)
        return true
      }

      editor.render = render
      editorRef.current = editor
    }

    React.useImperativeHandle(ref, () => ({
      getInstance: () => editorRef.current,
    }))

    React.useEffect(() => {
      editorRef.current.render()
    }, [])

    // Delete/Backspace remove the selected object of the editor on screen (hidden editors have no
    // offsetParent), unless the key is typed into a field.
    React.useEffect(() => {
      const handleKeyDown = (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        const canvas = canvasRef.current
        if (!canvas || canvas.offsetParent === null) return
        const {target} = e
        if (
          target &&
          (target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        ) {
          return
        }
        if (editorRef.current.deleteKey()) e.preventDefault()
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    const canvasPoint = (event) => {
      const canvas = canvasRef.current
      const rect = canvas.getBoundingClientRect()
      const {size} = stateRef.current.scene
      return {
        x: ((event.clientX - rect.left) * size.width) / rect.width,
        y: ((event.clientY - rect.top) * size.height) / rect.height,
      }
    }

    const handlePointerDown = (event) => {
      // The right button opens flip-editor's context menu.
      if (event.button === 2) {
        editorRef.current.secondaryDown(canvasPoint(event))
        return
      }
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      editorRef.current.pointerDown(canvasPoint(event))
    }

    return (
      <div className="tui-image-editor-canvas-container">
        <canvas
          ref={canvasRef}
          className="lower-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={(event) =>
            editorRef.current.pointerMove(canvasPoint(event))
          }
          onPointerUp={() => editorRef.current.pointerUp()}
          onLostPointerCapture={() => editorRef.current.pointerUp()}
          style={{display: 'block', touchAction: 'none'}}
        />
      </div>
    )
  }
)

SimpleImageEditor.displayName = 'SimpleImageEditor'

export default SimpleImageEditor
