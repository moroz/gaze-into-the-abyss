const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const RESOLUTION_SCALE = 0.75
const MAX_PIXELS = 1_000_000
const FRAME_INTERVAL_MS = 1000 / 24

export function runShader(canvas: HTMLCanvasElement, fragment: string): void {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const started = performance.now() - Math.random() * 60000
  let gl: WebGLRenderingContext
  let resolution: WebGLUniformLocation | null
  let time: WebGLUniformLocation | null
  let frame = 0
  let drawnAt: number | undefined

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
    if (elapsed < FRAME_INTERVAL_MS - 2) return false
    drawnAt = now - (elapsed % FRAME_INTERVAL_MS)
    return true
  }

  const render = (now: number): void => {
    const scale = RESOLUTION_SCALE * (window.devicePixelRatio || 1)
    const wanted = canvas.clientWidth * canvas.clientHeight * scale * scale
    const capped = scale * Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, wanted)))
    const width = Math.max(1, Math.round(canvas.clientWidth * capped))
    const height = Math.max(1, Math.round(canvas.clientHeight * capped))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.uniform2f(resolution, width, height)
    gl.uniform1f(time, (now - started) / 1000)
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
