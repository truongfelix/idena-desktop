function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load image'))
    image.src = src
  })
}

function normalizeImageSource(source, type = 'image/png') {
  if (typeof source === 'string') {
    return source
  }

  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const blob = new Blob([source], {type})
    return URL.createObjectURL(blob)
  }

  if (source instanceof Blob) {
    return URL.createObjectURL(source)
  }

  throw new Error('Unsupported image source')
}

function resolveResize({sourceWidth, sourceHeight, width, height, exact}) {
  if (exact) {
    return {
      width: Math.max(1, Math.round(width || sourceWidth || 1)),
      height: Math.max(1, Math.round(height || sourceHeight || 1)),
    }
  }

  const maxWidth = Math.max(1, Math.round(width || sourceWidth || 1))
  const maxHeight = Math.max(1, Math.round(height || sourceHeight || 1))
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1)

  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  }
}

export async function resizeImageToDataUrl(
  source,
  {
    width = 240,
    height = 180,
    type = 'image/jpeg',
    quality = 0.6,
    exact = true,
  } = {}
) {
  const objectUrl = normalizeImageSource(source, type)

  try {
    const image = await loadImage(objectUrl)
    const size = resolveResize({
      sourceWidth: image.naturalWidth || image.width,
      sourceHeight: image.naturalHeight || image.height,
      width,
      height,
      exact,
    })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = size.width
    canvas.height = size.height
    ctx.drawImage(image, 0, 0, size.width, size.height)
    return canvas.toDataURL(type, quality)
  } finally {
    if (objectUrl !== source && objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

/**
 * The bytes of a data URL, decoded here: the renderer's CSP does not allow fetching data: URLs (connect-src),
 * so fetching it failed in the packaged app ("Error compressing images" when sending an ad to review).
 */
export function dataUrlToArrayBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) {
    throw new Error('Not a data URL')
  }
  const isBase64 = dataUrl.slice(0, comma).endsWith(';base64')
  const data = dataUrl.slice(comma + 1)
  const binary = isBase64 ? atob(data) : decodeURIComponent(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export async function resizeImageToArrayBuffer(source, options = {}) {
  return dataUrlToArrayBuffer(await resizeImageToDataUrl(source, options))
}
