import { randomStream } from "./random"
import type { SceneMoment } from "./scene-schedule"

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const RESOLUTION_SCALE = 0.75
const MAX_PIXELS = 1_000_000
const FRAME_INTERVAL_MS = 1000 / 24
const RANDOM_START_MS = 600_000
const TAU = 2 * Math.PI

export function runShader(canvas: HTMLCanvasElement, fragment: string, sceneAt: (seconds: number) => SceneMoment): void {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const options = new URLSearchParams(location.hash.slice(1))
  const chosen = Number(options.get("t"))
  // #render, for recording a video: every frame at full resolution.
  const rendering = options.has("render")
  const loaded = performance.now()
  const started = loaded - (chosen > 0 ? chosen * 1000 : randomStream("shader time").next() * RANDOM_START_MS)
  let gl: WebGLRenderingContext
  let resolution: WebGLUniformLocation | null
  let time: WebGLUniformLocation | null
  let fromScene: WebGLUniformLocation | null
  let toScene: WebGLUniformLocation | null
  let blend: WebGLUniformLocation | null
  let transition: WebGLUniformLocation | null
  let frame = 0
  let drawnAt: number | undefined
  // The scenes' clock runs at a pace that wanders between about half and one and a half times over minutes, so
  // the trip does not keep one tempo. It is seeded like everything else.
  const { next: paceRandom } = randomStream("overlay pace")
  const paceOffsets = [paceRandom() * TAU, paceRandom() * TAU]
  const pace = (seconds: number): number =>
    1 + 0.3 * Math.sin((seconds * TAU) / 170 + paceOffsets[0]) + 0.2 * Math.sin((seconds * TAU) / 61 + paceOffsets[1])
  let phase = (loaded - started) / 1000
  let tickedAt = loaded

  const start = (): boolean => {
    const context = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false })
    if (!context || context.isContextLost()) return false
    gl = context
    if (!compile()) return false
    drawnAt = undefined
    frame = requestAnimationFrame(draw)
    return true
  }

  const compile = (): boolean => {
    const program = gl.createProgram()
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type)
      if (!shader) return false
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return false
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
    gl.useProgram(program)

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, "position")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    resolution = gl.getUniformLocation(program, "resolution")
    time = gl.getUniformLocation(program, "time")
    fromScene = gl.getUniformLocation(program, "fromScene")
    toScene = gl.getUniformLocation(program, "toScene")
    blend = gl.getUniformLocation(program, "blend")
    transition = gl.getUniformLocation(program, "transition")
    return true
  }

  const draw = (now: number): void => {
    if (!still) frame = requestAnimationFrame(draw)
    if (frameIsDue(now)) render(now)
  }

  const frameIsDue = (now: number): boolean => {
    if (drawnAt === undefined) {
      drawnAt = now
      return true
    }
    const elapsed = now - drawnAt
    if (rendering) return true
    if (elapsed < FRAME_INTERVAL_MS - 2) return false
    drawnAt = now - (elapsed % FRAME_INTERVAL_MS)
    return true
  }

  const render = (now: number): void => {
    const scale = (rendering ? 1 : RESOLUTION_SCALE) * (window.devicePixelRatio || 1)
    const wanted = canvas.clientWidth * canvas.clientHeight * scale * scale
    const capped = rendering ? scale : scale * Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, wanted)))
    const width = Math.max(1, Math.round(canvas.clientWidth * capped))
    const height = Math.max(1, Math.round(canvas.clientHeight * capped))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.uniform2f(resolution, width, height)
    phase += (Math.min(now - tickedAt, 250) / 1000) * pace((now - loaded) / 1000)
    tickedAt = now
    gl.uniform1f(time, phase)
    const moment = sceneAt((now - loaded) / 1000)
    gl.uniform1f(fromScene, moment.from)
    gl.uniform1f(toScene, moment.to)
    gl.uniform1f(blend, moment.blend)
    gl.uniform1f(transition, moment.transition)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault()
    cancelAnimationFrame(frame)
  })
  canvas.addEventListener("webglcontextrestored", () => {
    if (!start()) canvas.remove()
  })
  if (still) {
    window.addEventListener("resize", () => {
      drawnAt = undefined
      frame = requestAnimationFrame(draw)
    })
  }
  if (!start()) canvas.remove()
}
