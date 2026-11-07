// Draws a playing video into a canvas through a fragment shader that bends the footage itself. Every effect keeps the
// base warp: a slow liquid displacement, a breathing swell from the centre, and red and blue pulled a little apart.
// On top of it, the slideshow picks one effect each time a video comes on screen (video.dataset.effect):
//   ripple        the base warp alone
//   kaleidoscope  the footage folded into six mirrored wedges that slowly turn
//   slit-scan     each row a slightly different moment, up to about a second and a half old
//   echo          each frame melts into the last, a little zoomed and turned, the leftovers drifting round the hues
//   thermal       brightness mapped onto a neon palette that keeps cycling
// The video stays in the page underneath, so if WebGL 2 is missing, the context is lost or the frames cannot be read
// (no CORS), the canvas is removed and the plain video shows instead.

export const VIDEO_EFFECTS = ["ripple", "kaleidoscope", "slit-scan", "echo", "thermal"] as const
export type VideoEffect = (typeof VIDEO_EFFECTS)[number]

const VERTEX = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * .5 + .5;
  gl_Position = vec4(corner, 0., 1.);
}`

const WARP = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D frame;
uniform sampler2DArray history;
uniform sampler2D previous;
uniform float time;
uniform vec2 canvasSize;
uniform vec2 videoSize;
uniform int effect;
uniform float newest;
uniform float layers;
uniform float echoMix;
in vec2 uv;
out vec4 colour;
const float TAU = 6.2831853;

// object-fit: cover, as the plain video would sit.
vec2 cover(vec2 point) {
  float canvasAspect = canvasSize.x / canvasSize.y;
  float videoAspect = videoSize.x / videoSize.y;
  vec2 scale = canvasAspect > videoAspect ? vec2(1., videoAspect / canvasAspect) : vec2(canvasAspect / videoAspect, 1.);
  return (point - .5) * scale + .5;
}

vec3 hueShift(vec3 c, float angle) {
  const vec3 axis = vec3(.57735);
  float cosine = cos(angle);
  return c * cosine + cross(axis, c) * sin(angle) + axis * dot(axis, c) * (1. - cosine);
}

vec3 palette(float t) { return .5 + .5 * cos(TAU * (t + vec3(0., .33, .67))); }

vec3 sampleAt(vec2 at, float layer) {
  return effect == 2 ? texture(history, vec3(at, layer)).rgb : texture(frame, at).rgb;
}

void main() {
  float t = time * .12;
  vec2 point = uv;
  if (effect == 1) {
    vec2 aspect = vec2(canvasSize.x / canvasSize.y, 1.);
    vec2 p = (point - .5) * aspect;
    float wedge = TAU / 6.;
    float angle = abs(mod(atan(p.y, p.x) + time * .03, wedge) - .5 * wedge);
    point = vec2(cos(angle), sin(angle)) * length(p) * 1.1 / aspect + .5 + .15 * vec2(sin(time * .05), cos(time * .043));
    point = 1. - abs(1. - mod(point, 2.));
  }
  vec2 flow = vec2(
    sin(point.y * 6. + t * 1.3) + sin(point.y * 13. + point.x * 4. - t * .7),
    cos(point.x * 5. - t) + sin(point.x * 11. + point.y * 3. + t * .9));
  point += flow * .006;
  vec2 fromCentre = point - .5;
  point = .5 + fromCentre * (1. - .05 * sin(t * .8) * length(fromCentre));
  // Inset a little so the displacement never pulls the clamped edge into view.
  vec2 at = cover(.5 + (point - .5) * .97);
  float layer = 0.;
  if (effect == 2) {
    float delay = (1. - uv.y) * .75 + .25 * (.5 + .5 * sin(uv.x * TAU + time * .3));
    layer = mod(newest - floor(delay * (layers - 1.)), layers);
  }
  float split = .0025 + .0015 * sin(t * 1.7);
  vec3 c = vec3(sampleAt(at + vec2(split, 0.), layer).r, sampleAt(at, layer).g, sampleAt(at - vec2(split, 0.), layer).b);
  if (effect == 4) {
    float brightness = dot(c, vec3(.299, .587, .114));
    c = palette(brightness * 1.4 - time * .04 + .6) * (.15 + .95 * smoothstep(.02, .9, brightness));
  }
  if (effect == 3) {
    float turn = .006;
    vec2 q = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * ((uv - .5) * .985) + .5;
    c = mix(hueShift(texture(previous, q).rgb, .09) * .985, c, echoMix);
  }
  colour = vec4(c, 1.);
}`

const COPY = `#version 300 es
precision highp float;
uniform sampler2D source;
in vec2 uv;
out vec4 colour;
void main() { colour = texture(source, uv); }`

const MAX_PIXEL_RATIO = 1.5
const HISTORY_LAYERS = 32
const HISTORY_SIZE = [384, 216] as const
// A history frame every third animation frame: 32 of them reach back about a second and a half.
const HISTORY_EVERY = 3
const ECHO_MIX = 0.14

type Uniforms = Record<string, WebGLUniformLocation | null>
interface Program { program: WebGLProgram; uniforms: Uniforms }
interface Target { texture: WebGLTexture; framebuffer: WebGLFramebuffer }

const build = (gl: WebGL2RenderingContext, fragment: string, names: string[]): Program => {
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader")
    gl.attachShader(program, shader)
  }
  gl.bindAttribLocation(program, 0, "corner")
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program")
  return { program, uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) }
}

const smoothTexture = (gl: WebGL2RenderingContext, target: number): WebGLTexture => {
  const texture = gl.createTexture()
  gl.bindTexture(target, texture)
  for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(target, parameter, gl.CLAMP_TO_EDGE)
  for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(target, parameter, gl.LINEAR)
  return texture
}

export function warpVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  let gl: WebGL2RenderingContext | undefined
  let warp: Program
  let copy: Program
  let frameTexture: WebGLTexture
  let history: WebGLTexture | undefined
  let historyFramebuffer: WebGLFramebuffer
  let newest = 0
  let historyTick = 0
  let echo: [Target, Target] | undefined
  let echoSize = ""
  let shownEffect: string | undefined
  let fresh = true
  let frame = 0

  const giveUp = (): void => {
    cancelAnimationFrame(frame)
    canvas.remove()
  }

  const setUp = (): boolean => {
    const context = canvas.getContext("webgl2", { antialias: false, alpha: false })
    if (!context) return false
    gl = context
    warp = build(gl, WARP, ["frame", "history", "previous", "time", "canvasSize", "videoSize", "effect", "newest", "layers", "echoMix"])
    copy = build(gl, COPY, ["source"])
    gl.bindVertexArray(gl.createVertexArray())
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    frameTexture = smoothTexture(gl, gl.TEXTURE_2D)
    historyFramebuffer = gl.createFramebuffer()
    // Each sampler gets its own unit: two sampler types sharing one is an error at draw time.
    gl.useProgram(warp.program)
    gl.uniform1i(warp.uniforms.frame, 0)
    gl.uniform1i(warp.uniforms.history, 1)
    gl.uniform1i(warp.uniforms.previous, 2)
    gl.useProgram(copy.program)
    gl.uniform1i(copy.uniforms.source, 0)
    return true
  }

  const target = (width: number, height: number): Target => {
    const texture = smoothTexture(gl!, gl!.TEXTURE_2D)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
    const framebuffer = gl!.createFramebuffer()
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer)
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, texture, 0)
    return { texture, framebuffer }
  }

  // Copies the current frame, scaled down on the GPU, into one layer of the slit-scan history.
  const remember = (layer: number): void => {
    const g = gl!
    g.bindFramebuffer(g.FRAMEBUFFER, historyFramebuffer)
    g.framebufferTextureLayer(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, history!, 0, layer)
    g.viewport(0, 0, ...HISTORY_SIZE)
    g.useProgram(copy.program)
    g.activeTexture(g.TEXTURE0)
    g.bindTexture(g.TEXTURE_2D, frameTexture)
    g.drawArrays(g.TRIANGLES, 0, 3)
  }

  const keepHistory = (): void => {
    const g = gl!
    if (!history) {
      history = smoothTexture(g, g.TEXTURE_2D_ARRAY)
      g.texStorage3D(g.TEXTURE_2D_ARRAY, 1, g.RGBA8, ...HISTORY_SIZE, HISTORY_LAYERS)
    }
    if (fresh) {
      for (let layer = 0; layer < HISTORY_LAYERS; layer++) remember(layer)
    } else if (++historyTick % HISTORY_EVERY === 0) {
      newest = (newest + 1) % HISTORY_LAYERS
      remember(newest)
    }
  }

  const draw = (now: number): void => {
    if (!gl || video.paused) return
    frame = requestAnimationFrame(draw)
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    const ratio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO)
    const width = Math.round(canvas.clientWidth * ratio)
    const height = Math.round(canvas.clientHeight * ratio)
    if (!width || !height) return
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const effect = Math.max(0, VIDEO_EFFECTS.indexOf((video.dataset.effect ?? "ripple") as VideoEffect))
    if (video.dataset.effect !== shownEffect) {
      shownEffect = video.dataset.effect
      fresh = true
    }

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, frameTexture)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
    } catch {
      return giveUp()
    }
    if (VIDEO_EFFECTS[effect] === "slit-scan") keepHistory()
    if (VIDEO_EFFECTS[effect] === "echo" && echoSize !== `${width}x${height}`) {
      echoSize = `${width}x${height}`
      echo = [target(width, height), target(width, height)]
      fresh = true
    }

    gl.useProgram(warp.program)
    gl.uniform1f(warp.uniforms.time, now / 1000)
    gl.uniform2f(warp.uniforms.canvasSize, width, height)
    gl.uniform2f(warp.uniforms.videoSize, video.videoWidth, video.videoHeight)
    gl.uniform1i(warp.uniforms.effect, effect)
    gl.uniform1f(warp.uniforms.newest, newest)
    gl.uniform1f(warp.uniforms.layers, HISTORY_LAYERS)
    gl.uniform1f(warp.uniforms.echoMix, fresh ? 1 : ECHO_MIX)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, history ?? null)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, echo ? echo[0].texture : null)

    if (VIDEO_EFFECTS[effect] === "echo" && echo) {
      // Draw into the spare buffer reading the last one, then show it and keep it as the next frame's last.
      gl.bindFramebuffer(gl.FRAMEBUFFER, echo[1].framebuffer)
      gl.viewport(0, 0, width, height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      echo.reverse()
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.useProgram(copy.program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, echo[0].texture)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    fresh = false
    canvas.classList.add("is-drawing")
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
