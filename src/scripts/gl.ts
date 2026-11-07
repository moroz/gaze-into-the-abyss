// Small WebGL 2 helpers shared by the stage, the trip overlay and the video warp.

export type Uniforms = Record<string, WebGLUniformLocation | null>
export interface Program { program: WebGLProgram; uniforms: Uniforms }
export interface Target { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }

// One triangle that covers the viewport; uv runs 0..1 across it, bottom-left first, as GL textures do.
export const VERTEX = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * .5 + .5;
  gl_Position = vec4(corner, 0., 1.);
}`

// The same for GLSL ES 1.0 fragment shaders (the trip overlay), which cannot link against a 3.00 vertex shader.
export const VERTEX_100 = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }
`

export const build = (gl: WebGL2RenderingContext, fragment: string, names: string[], vertex = VERTEX): Program => {
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
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

export const smoothTexture = (gl: WebGL2RenderingContext, target: number = gl.TEXTURE_2D): WebGLTexture => {
  const texture = gl.createTexture()
  gl.bindTexture(target, texture)
  for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(target, parameter, gl.CLAMP_TO_EDGE)
  for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(target, parameter, gl.LINEAR)
  return texture
}

export const target = (gl: WebGL2RenderingContext, width: number, height: number): Target => {
  const texture = smoothTexture(gl)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  const framebuffer = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  return { texture, framebuffer, width, height }
}

export const dispose = (gl: WebGL2RenderingContext, { texture, framebuffer }: Target): void => {
  gl.deleteTexture(texture)
  gl.deleteFramebuffer(framebuffer)
}

// Keeps a target at the wanted size, replacing it when that changes.
export const sized = (gl: WebGL2RenderingContext, current: Target | undefined, width: number, height: number): Target => {
  if (current && current.width === width && current.height === height) return current
  if (current) dispose(gl, current)
  return target(gl, width, height)
}

export const drawInto = (gl: WebGL2RenderingContext, into: Target | null, width: number, height: number): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, into?.framebuffer ?? null)
  gl.viewport(0, 0, width, height)
}
