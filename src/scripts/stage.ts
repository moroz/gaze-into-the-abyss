// Everything on screen, drawn in one WebGL 2 canvas: the backgrounds with their colouring, drift and transitions, the
// trip overlay screened over them, the vignette, and the dawn that lifts at the start. Bottom to top:
//   1. at most two backgrounds, the one leaving under the one arriving, each faded, zoomed and blurred by its
//      transition and coloured by its overlay setting (the colour matrices of CSS filters, in the same order);
//   2. the trip overlay, drawn small and at 24 fps on the site, screened over them at its breathing opacity;
//   3. the vignette, then the black veil of the dawn.
// With #render (see script/render/), the clock is driven from outside, video frames come decoded ahead of time, and
// each frame is converted to YUV 4:2:0 on the GPU and posted to the renderer.

import { alternating, clamp01, cubicBezier, easeIn, easeInOut, easeOut, linear, looping, type Easing } from "./easing"
import { brightness, contrast, hueRotate, saturate, type ColourStep } from "./colour-filters"
import { build, drawInto, sized, type Program, type Target } from "./gl"
import { FrameVideo } from "./render-frames"
import { ElementVideo, runSlideshow, TRANSITION_MS, type Showing, type Slide, type SlideData, type Slideshow } from "./slideshow"
import { Trip } from "./trip"
import { buildWarpPrograms, Warp, type WarpPrograms } from "./video-warp"

const MAX_PIXEL_RATIO = 1.5
const VEIL_PATIENCE_MS = 7_000
const VEIL_DELAY_MS = 1_500
const VEIL_LIFT_MS = 8_000
const liftEasing = cubicBezier(0.45, 0, 0.25, 1)
const bloomEasing = cubicBezier(0.2, 0.7, 0.2, 1)
const BLOOM = { zoom: 1.35, blur: 18, brightness: 1.8 }
const MAX_STEPS = 4

const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D layer0;
uniform sampler2D layer1;
uniform sampler2D trip;
uniform vec2 size;
uniform float opacity[2];
uniform vec4 pose[2];
uniform float zoom[2];
uniform vec2 cover[2];
uniform float blur[2];
uniform float lift[2];
uniform mat3 colourMatrix[8];
uniform vec3 colourOffset[8];
uniform int colourSteps[2];
uniform float tripOpacity;
uniform float veil;
in vec2 uv;
out vec4 colour;

// From a point on screen (in pixels from the centre, y down, as CSS lays out) to the texel of a layer's picture:
// undo the transition's zoom and the drift's scale, translate and rotate, then fit as object-fit: cover does.
vec2 pictureAt(int i, vec2 q) {
  q /= zoom[i];
  vec4 p = pose[i];
  q = q / p.x - p.yz;
  float a = -p.w;
  q = mat2(cos(a), sin(a), -sin(a), cos(a)) * q;
  vec2 box = (q / size) * cover[i] + .5;
  return vec2(box.x, 1. - box.y);
}

vec3 picture(sampler2D layer, int i, vec2 q) {
  if (blur[i] < .5) return texture(layer, pictureAt(i, q)).rgb;
  // A Gaussian blur, roughly: five taps a blur radius apart, each from a mip level about that wide.
  float bias = log2(max(1., blur[i] * .8));
  vec3 sum = texture(layer, pictureAt(i, q), bias).rgb * .4;
  for (int k = 0; k < 4; k++) {
    vec2 offset = vec2(k < 2 ? -.7 : .7, k % 2 == 0 ? -.7 : .7) * blur[i];
    sum += texture(layer, pictureAt(i, q + offset), bias).rgb * .15;
  }
  return sum;
}

vec3 coloured(int i, vec3 c) {
  for (int k = 0; k < colourSteps[i]; k++) c = clamp(colourMatrix[4 * i + k] * c + colourOffset[4 * i + k], 0., 1.);
  return clamp(c * lift[i], 0., 1.);
}

void main() {
  vec2 q = (vec2(uv.x, 1. - uv.y) - .5) * size;
  vec3 c = vec3(0.);
  if (opacity[0] > 0.) c = mix(c, coloured(0, picture(layer0, 0, q)), opacity[0]);
  if (opacity[1] > 0.) c = mix(c, coloured(1, picture(layer1, 1, q)), opacity[1]);
  vec3 t = texture(trip, uv).rgb;
  c += tripOpacity * t * (1. - c);
  // radial-gradient(ellipse at center, transparent 55%, #000000b3 100%), its ellipse through the corners.
  float d = length((uv - .5) * 2.) / sqrt(2.);
  c *= 1. - .702 * clamp((d - .55) / .45, 0., 1.);
  c *= 1. - veil;
  colour = vec4(c, 1.);
}`

// Packs the frame into the bytes of a yuv420p picture (BT.709, limited range): Y, then U, then V, four bytes to a
// pixel of a target a quarter as wide and one and a half times as tall, so one readPixels returns the whole frame.
const YUV = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D picture;
uniform ivec2 size;
out vec4 colour;
const vec3 LUMA = vec3(.2126, .7152, .0722);

vec3 at(int x, int y) { return texelFetch(picture, ivec2(x, size.y - 1 - y), 0).rgb; }

float byteAt(int index) {
  int width = size.x;
  int height = size.y;
  if (index < width * height) return (16. + 219. * dot(at(index % width, index / width), LUMA)) / 255.;
  index -= width * height;
  int half_width = width / 2;
  int plane = half_width * (height / 2);
  bool red = index >= plane;
  if (red) index -= plane;
  int x = 2 * (index % half_width);
  int y = 2 * (index / half_width);
  vec3 c = (at(x, y) + at(x + 1, y) + at(x, y + 1) + at(x + 1, y + 1)) * .25;
  float luma = dot(c, LUMA);
  float chroma = red ? (c.r - luma) / 1.5748 : (c.b - luma) / 1.8556;
  return (128. + 224. * chroma) / 255.;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int base = (p.y * (size.x / 4) + p.x) * 4;
  colour = vec4(byteAt(base), byteAt(base + 1), byteAt(base + 2), byteAt(base + 3));
}`

interface Arrival { opacity: number; zoom: number; blur: number; lift: number }

const arrival = (showing: Showing, now: number, still: boolean): Arrival => {
  const age = now - showing.arrivedAt
  const plain = (opacity: number): Arrival => ({ opacity, zoom: 1, blur: 0, lift: 1 })
  switch (showing.transition) {
    case "crossfade": return plain(easeInOut(age / 4_000))
    case "through-black": return plain(easeOut((age - 2_500) / 3_500))
    case "dissolve": return plain(linear(age / 9_000))
    case "bloom": {
      const e = bloomEasing(age / 5_000)
      if (still) return plain(e)
      return { opacity: e, zoom: BLOOM.zoom + (1 - BLOOM.zoom) * e, blur: BLOOM.blur * (1 - e), lift: BLOOM.brightness + (1 - BLOOM.brightness) * e }
    }
  }
}

const departure = (showing: Showing, now: number): number => {
  const age = now - (showing.leftAt ?? now)
  const fade: Record<string, [number, Easing]> = { crossfade: [4_000, easeInOut], "through-black": [2_500, easeIn], bloom: [5_000, easeIn], dissolve: [9_000, linear] }
  const [ms, easing] = fade[showing.leavingBy ?? "crossfade"]
  return 1 - easing(age / ms)
}

const busy = (showing: Showing, now: number): boolean =>
  showing.leftAt !== undefined || now - showing.arrivedAt < TRANSITION_MS[showing.transition]

// The overlay setting's colouring, as the stylesheet's filter animations gave it.
const colouring = (showing: Showing, seconds: number, hueDelay: number, still: boolean): ColourStep[] => {
  const { slide: { data }, pace } = showing
  const hue = (period: number, delay: number): ColourStep => hueRotate(360 * looping(seconds + delay, period * pace))
  if (data.kind === "image") {
    const base = [brightness(0.8), saturate(1.3), contrast(1.05)]
    return still ? base : [...base, hue(180, hueDelay)]
  }
  switch (data.overlay) {
    case "calm": {
      const e = alternating(seconds + hueDelay, 40 * pace, easeInOut)
      return [saturate(1.8 + 0.8 * e), contrast(1.08 + 0.04 * e)]
    }
    case "hue-cycle": return [saturate(2.4), contrast(1.1), hue(12, 0)]
    default: return [brightness(0.85), saturate(2.2), contrast(1.08), hue(180, hueDelay)]
  }
}

interface Held { warp?: Warp; texture?: WebGLTexture }

export interface StageOptions { canvas: HTMLCanvasElement; pool: HTMLElement; slides: SlideData[]; fragment: string }

// Starts the stage; returns false when the browser has no WebGL 2, so the page can show its still instead.
export function runStage({ canvas, pool, slides: data, fragment }: StageOptions): boolean {
  const hash = new URLSearchParams(location.hash.slice(1))
  const rendering = hash.has("render")
  const framesBase = hash.get("render") || "/render-frames"
  const still = !rendering && matchMedia("(prefers-reduced-motion: reduce)").matches

  const context = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: rendering ? "high-performance" : "default" })
  if (!context) return false
  const gl: WebGL2RenderingContext = context

  // Motion-sensitive visitors get only the still images.
  const slides: Slide[] = data
    .filter((slide) => !still || slide.kind !== "video")
    .map((slide) => ({ data: slide, video: slide.kind === "video" ? (rendering ? new FrameVideo(slide, framesBase) : new ElementVideo(slide, pool)) : undefined }))

  // When rendering, loads count as instant: the renderer waits for them before the clock moves on, so a slow network
  // cannot change what the recording shows.
  const pending = new Set<Promise<unknown>>()
  const track = <T>(promise: Promise<T>): Promise<T> => {
    if (!rendering) return promise
    pending.add(promise)
    promise.finally(() => pending.delete(promise)).catch(() => {})
    return promise
  }

  let frame = 0
  let scheduled = false
  const wake = (): void => {
    if (scheduled || gl.isContextLost()) return
    scheduled = true
    frame = requestAnimationFrame(draw)
  }

  let slideshow: Slideshow
  const trip = new Trip(fragment, { still, rendering })
  let liftAt: number | undefined

  let programs: { composite: Program; yuv: Program; warp: WarpPrograms }
  let empty: WebGLTexture
  let held = new Map<Slide, Held>()
  let picture: Target | undefined
  let packed: Target | undefined

  const setUp = (): void => {
    gl.bindVertexArray(gl.createVertexArray())
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const composite = build(gl, COMPOSITE, ["layer0", "layer1", "trip", "size", "opacity", "pose", "zoom", "cover", "blur", "lift", "colourMatrix", "colourOffset", "colourSteps", "tripOpacity", "veil"])
    gl.useProgram(composite.program)
    gl.uniform1i(composite.uniforms.layer0, 0)
    gl.uniform1i(composite.uniforms.layer1, 1)
    gl.uniform1i(composite.uniforms.trip, 2)
    const yuv = build(gl, YUV, ["picture", "size"])
    programs = { composite, yuv, warp: buildWarpPrograms(gl) }
    empty = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, empty)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    held = new Map()
    picture = undefined
    packed = undefined
    trip.reset()
    trip.build(gl)
  }

  const release = (slide: Slide, resources: Held): void => {
    resources.warp?.dispose()
    if (resources.texture) gl.deleteTexture(resources.texture)
    held.delete(slide)
  }

  const imageTexture = (slide: Slide): WebGLTexture | undefined => {
    const resources = held.get(slide) ?? {}
    held.set(slide, resources)
    const image = slide.image
    if (!resources.texture && image?.complete && image.naturalWidth) {
      const texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE)
      resources.texture = texture
    }
    return resources.texture
  }

  // Draws the frame for now; returns whether anything on screen is still moving.
  const render = (now: number): boolean => {
    const ratio = rendering ? 1 : Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    const width = Math.max(4, Math.round((canvas.clientWidth || window.innerWidth) * ratio))
    const height = Math.max(2, Math.round((canvas.clientHeight || window.innerHeight) * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const showings = slideshow.onScreen().slice(-2)
    const upcoming = slideshow.upcoming()
    const kept = new Set([...showings.map(({ slide }) => slide), upcoming])
    for (const [slide, resources] of held) if (!kept.has(slide)) release(slide, resources)

    const seconds = now / 1000
    const layers = showings.map((showing) => {
      // A background leaving only fades: its arrival's zoom and blur were over long before.
      const motion: Arrival = showing.leftAt === undefined ? arrival(showing, now, still) : { opacity: departure(showing, now), zoom: 1, blur: 0, lift: 1 }
      const { slide } = showing
      let texture: WebGLTexture | undefined
      let cover: [number, number] = [1, 1]
      let pose = { scale: 1, x: 0, y: 0, rotate: 0 }
      if (slide.video) {
        const footage = slide.video.footage()
        const resources = held.get(slide) ?? {}
        held.set(slide, resources)
        let drawn = resources.warp?.latest
        try {
          if (footage) resources.warp ??= new Warp(gl, programs.warp)
          if (footage) drawn = resources.warp!.draw(now, footage, showing, width, height)
        } catch (error) {
          // One video failing (a frame the page may not read, say) costs only its own layer, not the whole stage.
          console.error(error)
        }
        if (drawn) {
          texture = drawn.texture
          gl.bindTexture(gl.TEXTURE_2D, texture)
          if (motion.blur > 0.5) {
            gl.generateMipmap(gl.TEXTURE_2D)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
          } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
          }
        }
      } else {
        texture = imageTexture(slide)
        const image = slide.image
        if (image?.naturalWidth) {
          const screenAspect = width / height
          const imageAspect = image.naturalWidth / image.naturalHeight
          cover = screenAspect > imageAspect ? [1, imageAspect / screenAspect] : [screenAspect / imageAspect, 1]
        }
        const [from, to] = showing.drift
        const e = still ? 0 : easeInOut((now - showing.arrivedAt) / showing.driftMs)
        const mix = (a: number, b: number): number => a + (b - a) * e
        pose = { scale: mix(from.scale, to.scale), x: mix(from.x, to.x), y: mix(from.y, to.y), rotate: mix(from.rotate, to.rotate) }
      }
      return { texture, motion, cover, pose, colour: colouring(showing, seconds, slideshow.hueDelay, still) }
    })
    // Bottom layer first; an absent one is fully transparent.
    while (layers.length < 2) layers.unshift({ texture: undefined, motion: { opacity: 0, zoom: 1, blur: 0, lift: 1 }, cover: [1, 1], pose: { scale: 1, x: 0, y: 0, rotate: 0 }, colour: [] })

    const tripTarget = trip.draw(gl, now, width / ratio, height / ratio, ratio)

    const { composite } = programs
    const u = composite.uniforms
    if (rendering) {
      picture = sized(gl, picture, width, height)
      drawInto(gl, picture, width, height)
    } else {
      drawInto(gl, null, width, height)
    }
    gl.useProgram(composite.program)
    gl.uniform2f(u.size, width, height)
    gl.uniform1fv(u.opacity, layers.map(({ texture, motion }) => (texture ? clamp01(motion.opacity) : 0)))
    gl.uniform4fv(u.pose, layers.flatMap(({ pose }) => [pose.scale, (pose.x / 100) * width, (pose.y / 100) * height, (pose.rotate * Math.PI) / 180]))
    gl.uniform1fv(u.zoom, layers.map(({ motion }) => motion.zoom))
    gl.uniform2fv(u.cover, layers.flatMap(({ cover }) => cover))
    gl.uniform1fv(u.blur, layers.map(({ motion }) => motion.blur * ratio))
    gl.uniform1fv(u.lift, layers.map(({ motion }) => motion.lift))
    const matrices = new Float32Array(8 * 9)
    const offsets = new Float32Array(8 * 3)
    layers.forEach(({ colour }, i) => colour.slice(0, MAX_STEPS).forEach((step, k) => {
      matrices.set(step.matrix, (4 * i + k) * 9)
      offsets.set(step.offset, (4 * i + k) * 3)
    }))
    gl.uniformMatrix3fv(u.colourMatrix, false, matrices)
    gl.uniform3fv(u.colourOffset, offsets)
    gl.uniform1iv(u.colourSteps, layers.map(({ colour }) => Math.min(MAX_STEPS, colour.length)))
    gl.uniform1f(u.tripOpacity, trip.opacity(now))
    const veil = liftAt === undefined ? 1 : 1 - liftEasing(clamp01((now - liftAt - VEIL_DELAY_MS) / VEIL_LIFT_MS))
    gl.uniform1f(u.veil, veil)
    layers.forEach(({ texture }, i) => {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, texture ?? empty)
    })
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, tripTarget.texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (const unit of [2, 1, 0]) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }

    // The next image goes up to the GPU during a hold, not on the frame it starts to arrive: uploading 4K and its
    // mipmaps takes long enough to drop frames, and a transition is where that would show.
    if (upcoming && !upcoming.video && !showings.some((showing) => busy(showing, now))) imageTexture(upcoming)

    if (rendering && capturing) {
      pack(width, height)
      packedFrames++
    } else if (rendering) {
      // Fast-forwarding reads nothing back, so without this the GPU queue grows hundreds of 4K frames deep, and the
      // NVIDIA driver loses the context over a heavy call (a bloom's mipmaps) at the bottom of it. Capturing frames
      // syncs the same way with readPixels.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel)
    }
    return !still || veil > 0 || showings.some((showing) => busy(showing, now)) || liftAt === undefined
  }

  // Render mode: the frame as yuv420p bytes, ready to read back.
  let capturing = false
  let packedFrames = 0
  const syncPixel = new Uint8Array(4)
  const pack = (width: number, height: number): void => {
    packed = sized(gl, packed, width / 4, (height * 3) / 2)
    drawInto(gl, packed, packed.width, packed.height)
    gl.useProgram(programs.yuv.program)
    gl.uniform2i(programs.yuv.uniforms.size, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, picture!.texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  const draw = (now: number): void => {
    scheduled = false
    if (gl.isContextLost()) return
    let moving = true
    try {
      moving = render(now)
    } catch (error) {
      console.error(error)
    } finally {
      if (moving) wake()
    }
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault()
    cancelAnimationFrame(frame)
    scheduled = false
  })
  canvas.addEventListener("webglcontextrestored", () => {
    try {
      setUp()
    } catch (error) {
      console.error(error)
      return
    }
    wake()
  })
  window.addEventListener("resize", wake)

  try {
    setUp()
  } catch (error) {
    console.error(error)
    return false
  }
  slideshow = runSlideshow(slides, wake, track)
  const lift = (): void => {
    liftAt ??= performance.now()
    wake()
  }
  slideshow.started.then(() => {
    document.dispatchEvent(new Event("abyss:first-image"))
    document.documentElement.dataset.firstImage = "shown"
    lift()
  })
  setTimeout(lift, VEIL_PATIENCE_MS)
  wake()

  if (rendering) {
    let bytes: Uint8Array<ArrayBuffer> | undefined
    let inFlight = Promise.resolve()
    let sentFrames = 0
    Object.assign(window, {
      __abyss: {
        // Awaited by the renderer's clock before each frame: loads in flight, then the video frames to show.
        async beforeFrame(): Promise<void> {
          // A finished load can start the next (a background that failed gives way to another), so check again.
          while (pending.size) {
            await Promise.allSettled([...pending])
            for (let i = 0; i < 20; i++) await Promise.resolve()
          }
          await Promise.all(slideshow.onScreen().map(({ slide }) => (slide.video instanceof FrameVideo ? slide.video.prepare() : undefined)))
        },
        capture(on: boolean): void {
          capturing = on
        },
        // The last frame drawn, as yuv420p, posted to the renderer. One post is in flight while the next frame
        // draws (a Blob body uploads several times faster than an ArrayBuffer); flush() waits for the last.
        async send(url: string): Promise<[number, number]> {
          if (!packed) throw new Error("no frame packed: call capture(true) before stepping")
          // A stage that stopped drawing would otherwise have its last frame encoded over and over.
          if (packedFrames === sentFrames) throw new Error("no new frame drawn since the last one sent")
          sentFrames = packedFrames
          const clock = (window as unknown as { __clock: { realNow: () => number } }).__clock
          const started = clock.realNow()
          const size = packed.width * packed.height * 4
          if (bytes?.length !== size) bytes = new Uint8Array(size)
          gl.bindFramebuffer(gl.FRAMEBUFFER, packed.framebuffer)
          gl.readPixels(0, 0, packed.width, packed.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
          const body = new Blob([bytes])
          const read = clock.realNow()
          await inFlight
          inFlight = fetch(url, { method: "POST", body }).then((response) => {
            if (!response.ok) throw new Error(`renderer refused the frame: ${response.status}`)
          })
          return [read - started, clock.realNow() - read]
        },
        flush: (): Promise<void> => inFlight,
        renderer(): string {
          const info = gl.getExtension("WEBGL_debug_renderer_info")
          return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown"
        },
      },
    })
  }
  return true
}
