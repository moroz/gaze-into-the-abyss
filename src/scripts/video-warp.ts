// Bends a video's footage through a fragment shader, into a target the stage composites. Every effect keeps the
// base warp: a slow liquid displacement, a breathing swell from the centre, and red and blue pulled a little apart.
// On top of it, the slideshow picks one effect each time a video comes on screen:
//   ripple        the base warp alone
//   kaleidoscope  the footage folded into six mirrored wedges that slowly turn
//   slit-scan     each row a slightly different moment, up to about a second and a half old
//   echo          each frame melts into the last, a little zoomed and turned, the leftovers drifting round the hues
//   thermal       brightness mapped onto a neon palette that keeps cycling
// A warp holds its textures only while its video is on screen; the stage disposes of it when the video leaves.

import { build, dispose, drawInto, sized, smoothTexture, type Program, type Target } from "./gl"

export const VIDEO_EFFECTS = ["ripple", "kaleidoscope", "slit-scan", "echo", "thermal"] as const
export type VideoEffect = (typeof VIDEO_EFFECTS)[number]

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
uniform float strength;
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
  point += flow * .006 * strength;
  vec2 fromCentre = point - .5;
  point = .5 + fromCentre * (1. - .05 * strength * sin(t * .8) * length(fromCentre));
  // Inset a little so the displacement never pulls the clamped edge into view.
  vec2 at = cover(.5 + (point - .5) * .97);
  float layer = 0.;
  if (effect == 2) {
    float delay = (1. - uv.y) * .75 + .25 * (.5 + .5 * sin(uv.x * TAU + time * .3));
    layer = mod(newest - floor(delay * (layers - 1.)), layers);
  }
  float split = (.0025 + .0015 * sin(t * 1.7)) * strength;
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

const HISTORY_LAYERS = 32
const HISTORY_SIZE = [384, 216] as const
// A history frame every 50 ms, whatever the display's refresh rate: 32 of them reach back 1.6 s.
const HISTORY_INTERVAL_MS = 50
const ECHO_MIX = 0.14

export interface WarpPrograms { warp: Program; copy: Program }

export const buildWarpPrograms = (gl: WebGL2RenderingContext): WarpPrograms => {
  const warp = build(gl, WARP, ["frame", "history", "previous", "time", "canvasSize", "videoSize", "effect", "newest", "layers", "echoMix", "strength"])
  const copy = build(gl, COPY, ["source"])
  // Each sampler gets its own unit: two sampler types sharing one is an error at draw time.
  gl.useProgram(warp.program)
  gl.uniform1i(warp.uniforms.frame, 0)
  gl.uniform1i(warp.uniforms.history, 1)
  gl.uniform1i(warp.uniforms.previous, 2)
  gl.useProgram(copy.program)
  gl.uniform1i(copy.uniforms.source, 0)
  return { warp, copy }
}

// One frame of footage, already uploaded or ready to upload: a playing <video>, or a decoded frame when rendering.
export interface Footage { source: TexImageSource; width: number; height: number; flip: boolean }

export interface WarpSettings { effect: VideoEffect; pace: number; strength: number }

export class Warp {
  private frameTexture: WebGLTexture
  private frameSize = ""
  private history: WebGLTexture | undefined
  private historyFramebuffer: WebGLFramebuffer
  private newest = 0
  private rememberedAt = 0
  private echo: [Target, Target] | undefined
  private output: Target | undefined
  private shownEffect: VideoEffect | undefined
  private fresh = true
  // The last frame drawn, shown again while the video has none to give (a loop wrapping round, a stall).
  latest: Target | undefined
  // The warp's own clock, advanced at the showing's pace.
  private phase = 0
  private tickedAt: number | undefined

  constructor(private gl: WebGL2RenderingContext, private programs: WarpPrograms) {
    this.frameTexture = smoothTexture(gl)
    this.historyFramebuffer = gl.createFramebuffer()
  }

  dispose(): void {
    const { gl } = this
    gl.deleteTexture(this.frameTexture)
    gl.deleteFramebuffer(this.historyFramebuffer)
    if (this.history) gl.deleteTexture(this.history)
    if (this.echo) for (const old of this.echo) dispose(gl, old)
    if (this.output) dispose(gl, this.output)
  }

  // Draws the warped footage at width × height and returns the target holding it.
  draw(now: number, footage: Footage, settings: WarpSettings, width: number, height: number): Target {
    const { gl, programs: { warp } } = this
    const effect = Math.max(0, VIDEO_EFFECTS.indexOf(settings.effect))
    if (settings.effect !== this.shownEffect) {
      this.shownEffect = settings.effect
      this.fresh = true
    }
    // Before the frame upload: creating textures rebinds unit 0, and the draw must not read what it writes.
    const echoing = settings.effect === "echo"
    if (echoing && (!this.echo || this.echo[0].width !== width || this.echo[0].height !== height)) {
      if (this.echo) for (const old of this.echo) dispose(gl, old)
      this.echo = [sized(gl, undefined, width, height), sized(gl, undefined, width, height)]
      this.fresh = true
    }
    if (!echoing) this.output = sized(gl, this.output, width, height)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, footage.flip)
    const size = `${footage.width}x${footage.height}`
    if (size !== this.frameSize) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, footage.source)
      this.frameSize = size
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, footage.source)
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    if (settings.effect === "slit-scan") this.keepHistory(now)

    gl.useProgram(warp.program)
    this.phase += (Math.min(now - (this.tickedAt ?? now), 100) / 1000) * settings.pace
    this.tickedAt = now
    gl.uniform1f(warp.uniforms.time, this.phase)
    gl.uniform1f(warp.uniforms.strength, settings.strength)
    gl.uniform2f(warp.uniforms.canvasSize, width, height)
    gl.uniform2f(warp.uniforms.videoSize, footage.width, footage.height)
    gl.uniform1i(warp.uniforms.effect, effect)
    gl.uniform1f(warp.uniforms.newest, this.newest)
    gl.uniform1f(warp.uniforms.layers, HISTORY_LAYERS)
    gl.uniform1f(warp.uniforms.echoMix, this.fresh ? 1 : ECHO_MIX)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.history ?? null)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.echo ? this.echo[0].texture : null)

    let drawn: Target
    if (echoing && this.echo) {
      // Draw into the spare buffer reading the last one, then keep it as the next frame's last.
      drawInto(gl, this.echo[1], width, height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.echo.reverse()
      drawn = this.echo[0]
    } else {
      drawn = this.output!
      drawInto(gl, drawn, width, height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    this.fresh = false
    this.latest = drawn
    return drawn
  }

  // Copies the current frame, scaled down on the GPU, into one layer of the slit-scan history.
  private remember(layer: number): void {
    const { gl, programs: { copy } } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.historyFramebuffer)
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.history!, 0, layer)
    gl.viewport(0, 0, ...HISTORY_SIZE)
    gl.useProgram(copy.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private keepHistory(now: number): void {
    const { gl } = this
    if (!this.history) {
      this.history = smoothTexture(gl, gl.TEXTURE_2D_ARRAY)
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, ...HISTORY_SIZE, HISTORY_LAYERS)
      this.fresh = true
    }
    if (this.fresh) {
      for (let layer = 0; layer < HISTORY_LAYERS; layer++) this.remember(layer)
      this.rememberedAt = now
    } else if (now - this.rememberedAt >= HISTORY_INTERVAL_MS) {
      this.rememberedAt = now
      this.newest = (this.newest + 1) % HISTORY_LAYERS
      this.remember(this.newest)
    }
  }
}
