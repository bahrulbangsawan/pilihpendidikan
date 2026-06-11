// Browser-side image preprocessor for the client-rendered PDF apps.
//
// Every image upload here used to store the raw `FileReader.readAsDataURL`
// output in state, which `@react-pdf/renderer` then embeds byte-for-byte with
// no resampling — a single phone photo or logo could add several megabytes to
// the generated PDF. `preprocessImage` decodes the file, downscales it so its
// longest edge is at most `maxEdge` (never upscaling), strips EXIF/metadata via
// a canvas re-encode, and returns a fresh data URL that drops straight into the
// existing string state fields, so no PDF template, style, or font changes are
// needed.
//
// Shared-location note: this file is intentionally duplicated verbatim into each
// app's `src/lib/` (cv-bahrul, invoice-bahrul, portfolio-bahrul) instead of
// living in `@rulisme/ui`. Those three apps lint with ESLint/Prettier and are
// excluded from the repo's Biome/Ultracite chain, and they consume `@rulisme/ui`
// only as a prebuilt `dist/`; hoisting a browser-only canvas helper into the
// package would put a `dist` rebuild on the critical path for no runtime gain.
// Keep the copies identical.
//
// Pure client-side: no network, no Worker, no secrets. Output is always PNG or
// JPEG — react-pdf 4.x cannot embed WebP reliably.

export type PreprocessImageOptions = {
  /** Longest output edge in px. The image is scaled down to fit; never up. */
  maxEdge?: number
  /** JPEG quality for opaque images (0..1). Ignored for transparent PNG output. */
  quality?: number
}

const DEFAULT_MAX_EDGE = 1024
const DEFAULT_QUALITY = 0.82
// Alpha byte value of a fully-opaque pixel; anything lower means the source
// carries real transparency and must stay PNG.
const OPAQUE_ALPHA = 255

export async function preprocessImage(
  file: File,
  options: PreprocessImageOptions = {}
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("preprocessImage: not an image file")
  }

  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE
  const quality = options.quality ?? DEFAULT_QUALITY
  const bitmap = await decodeOriented(file)

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      throw new Error("preprocessImage: 2D canvas context unavailable")
    }
    ctx.drawImage(bitmap, 0, 0, width, height)

    if (sourceHasAlpha(file.type, ctx, width, height)) {
      // Keep transparency: downscaled PNG (lossless, alpha preserved).
      return canvas.toDataURL("image/png")
    }

    // Opaque source: paint white *behind* the image so any incidental
    // transparency flattens to white (not JPEG's default black), then emit JPEG.
    ctx.globalCompositeOperation = "destination-over"
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    return canvas.toDataURL("image/jpeg", quality)
  } finally {
    bitmap.close()
  }
}

async function decodeOriented(file: File): Promise<ImageBitmap> {
  try {
    // `imageOrientation: "from-image"` bakes EXIF rotation into the pixels, so a
    // portrait phone photo decodes upright; the canvas re-encode then drops EXIF.
    return await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    throw new Error("preprocessImage: could not decode image")
  }
}

function fitWithin(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    // Already within budget — never upscale, so re-processing stays idempotent.
    return { width, height }
  }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function sourceHasAlpha(
  type: string,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  // JPEG and BMP have no alpha channel, so skip the pixel scan entirely.
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/bmp") {
    return false
  }
  let pixels: Uint8ClampedArray
  try {
    pixels = ctx.getImageData(0, 0, width, height).data
  } catch {
    // getImageData throws on a tainted canvas; assume alpha rather than
    // silently flatten a transparent logo onto white.
    return true
  }
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < OPAQUE_ALPHA) {
      return true
    }
  }
  return false
}
