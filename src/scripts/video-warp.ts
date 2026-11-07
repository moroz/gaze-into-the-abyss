// Draws a playing video into a canvas through a fragment shader that bends the footage itself: a slow liquid
// displacement, a breathing swell from the centre, and red and blue pulled a little apart. The video stays in the
// page underneath, so if WebGL is missing, the context is lost or the frames cannot be read (no CORS), the canvas
// is removed and the plain video shows instead.

const VERTEX = `
attribute vec2 corner;
varying vec2 uv;
void main() {
  uv = corner * .5 + .5;
  gl_Position = vec4(corner, 0., 1.);
}`

const FRAGMENT = `
precision mediump float;
uniform sampler2D frame;
uniform float time;
uniform vec2 canvasSize;
uniform vec2 videoSize;
varying vec2 uv;

// object-fit: cover, as the plain video would sit.
vec2 cover(vec2 point) {
  float canvasAspect = canvasSize.x / canvasSize.y;
  float videoAspect = videoSize.x / videoSize.y;
  vec2 scale = canvasAspect > videoAspect ? vec2(1., videoAspect / canvasAspect) : vec2(canvasAspect / videoAspect, 1.);
  return (point - .5) * scale + .5;
}

void main() {
  float t = time * .12;
  vec2 point = uv;
  vec2 flow = vec2(
    sin(point.y * 6. + t * 1.3) + sin(point.y * 13. + point.x * 4. - t * .7),
    cos(point.x * 5. - t) + sin(point.x * 11. + point.y * 3. + t * .9));
  point += flow * .006;
  vec2 fromCentre = point - .5;
  point = .5 + fromCentre * (1. - .05 * sin(t * .8) * length(fromCentre));
  // Inset a little so the displacement never pulls the clamped edge into view.
  vec2 at = cover(.5 + (point - .5) * .97);
  float split = .0025 + .0015 * sin(t * 1.7);
  gl_FragColor = vec4(
    texture2D(frame, at + vec2(split, 0.)).r,
    texture2D(frame, at).g,
    texture2D(frame, at - vec2(split, 0.)).b,
    1.);
}`

const MAX_PIXEL_RATIO = 1.5

const compile = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader")
  return shader
}

export function warpVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  let gl: WebGLRenderingContext | undefined
  let uniforms: Record<"time" | "canvasSize" | "videoSize", WebGLUniformLocation | null>
  let frame = 0
  let fresh = true

  const giveUp = (): void => {
    cancelAnimationFrame(frame)
    canvas.remove()
  }

  const setUp = (): boolean => {
    const context = canvas.getContext("webgl", { antialias: false, alpha: false })
    if (!context) return false
    gl = context
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const corner = gl.getAttribLocation(program, "corner")
    gl.enableVertexAttribArray(corner)
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE)
    for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.LINEAR)
    uniforms = {
      time: gl.getUniformLocation(program, "time"),
      canvasSize: gl.getUniformLocation(program, "canvasSize"),
      videoSize: gl.getUniformLocation(program, "videoSize"),
    }
    return true
  }

  const draw = (now: number): void => {
    if (!gl) return
    if (video.paused) return
    frame = requestAnimationFrame(draw)
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    const ratio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO)
    const width = Math.round(canvas.clientWidth * ratio)
    const height = Math.round(canvas.clientHeight * ratio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
    } catch {
      return giveUp()
    }
    gl.uniform1f(uniforms.time, now / 1000)
    gl.uniform2f(uniforms.canvasSize, width, height)
    gl.uniform2f(uniforms.videoSize, video.videoWidth, video.videoHeight)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (fresh) {
      fresh = false
      canvas.classList.add("is-drawing")
    }
  }

  canvas.addEventListener("webglcontextlost", giveUp)
  video.addEventListener("playing", () => {
    if (!canvas.isConnected) return
    try {
      if (!gl && !setUp()) return giveUp()
    } catch {
      return giveUp()
    }
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(draw)
  })
}
