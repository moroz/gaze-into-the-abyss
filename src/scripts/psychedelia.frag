precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float fromScene;
uniform float toScene;
uniform float blend;
uniform float transition;
const float TAU = 6.2831853;
// Exposure for the overlay: lifts the faint filaments a lot and the already bright scenes only a little.
const float EXPOSURE = 2.4;
const float FRACTAL_ITERATIONS = 128.0;

vec3 spectrum(float t) { return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67))); }

// Whole-number arithmetic below 2^24 is exact in 32-bit float, so neighbouring noise cells always agree on a shared
// corner. A fract-of-a-large-product hash depends on rounding that mobile GPU compilers reorder, which tears the
// noise into hard-edged cells on phones. The mod-289 permutation is from Stefan Gustavson's webgl-noise.
float permute(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }

float hash(vec2 cell) {
  cell = mod(cell, 289.0);
  return permute(permute(cell.x) + cell.y) / 289.0;
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int octave = 0; octave < 5; octave++) {
    total += amplitude * noise(p);
    p = turn * p;
    amplitude *= 0.5;
  }
  return total;
}

vec3 liquidKaleidoscope(vec2 uv, float t) {
  float wedge = TAU / 6.0;
  float angle = abs(mod(atan(uv.y, uv.x) + t * 0.04, wedge) - 0.5 * wedge);
  vec2 p = vec2(cos(angle), sin(angle)) * length(uv) * 3.0;
  vec2 q = vec2(fbm(p + t * 0.08), fbm(p + vec2(5.2, 1.3) - t * 0.06));
  vec2 warp = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.1), fbm(p + 4.0 * q + vec2(8.3, 2.8)));
  float field = fbm(p + 4.0 * warp);
  return spectrum(field * 1.6 + length(q) + t * 0.025) * smoothstep(0.15, 0.85, field);
}


mat2 rotation(float angle) { return mat2(cos(angle), sin(angle), -sin(angle), cos(angle)); }

vec3 kaliNebula(vec2 uv, float t) {
  float wedge = TAU / 8.0;
  float angle = abs(mod(atan(uv.y, uv.x) - t * 0.02, wedge) - 0.5 * wedge);
  uv = vec2(cos(angle), sin(angle)) * length(uv);
  vec2 p = rotation(t * 0.025) * uv * (0.5 + 0.15 * sin(t * 0.055)) + 0.3 * vec2(sin(t * 0.035), cos(t * 0.027));
  vec2 fold = vec2(0.53 + 0.06 * sin(t * 0.07), 0.71 + 0.06 * cos(t * 0.055));
  vec3 colour = vec3(0.0);
  float previous = 0.0;
  for (int n = 0; n < 12; n++) {
    p = abs(p) / dot(p, p) - fold;
    float radius = length(p);
    float filament = exp(-abs(radius - previous) * 8.0);
    float pulse = 0.55 + 0.45 * sin(float(n) * 0.9 - t * 0.45);
    colour += spectrum(float(n) * 0.08 + radius * 0.05 + t * 0.04) * filament * filament * pulse;
    previous = radius;
  }
  return colour * 0.68;
}

// Three mirrors at 60 degrees, as in a toy kaleidoscope: the pattern tiles the screen instead of meeting in the middle.
vec3 mirrorLattice(vec2 uv, float t) {
  vec2 p = rotation(t * 0.012) * uv * (1.4 + 0.25 * sin(t * 0.031)) + vec2(t * 0.013, t * 0.007);
  for (int i = 0; i < 3; i++) {
    vec2 mirror = vec2(cos(float(i) * TAU / 3.0), sin(float(i) * TAU / 3.0));
    float across = dot(p, mirror);
    p += mirror * (abs(mod(across + 0.5, 1.0) - 0.5) - across);
  }
  p *= 2.5;
  vec2 q = vec2(fbm(p - t * 0.07), fbm(p + vec2(3.1, 7.4) + t * 0.05));
  vec2 warp = vec2(fbm(p + 3.5 * q + vec2(6.2, 1.9) - t * 0.09), fbm(p + 3.5 * q + vec2(2.4, 8.8)));
  float field = fbm(p + 3.5 * warp);
  return spectrum(field * 1.3 - length(warp) + t * 0.02 + 0.4) * smoothstep(0.2, 0.8, field);
}

vec2 complexMultiply(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// Distance from c to the Mandelbrot set's boundary by the derivative of the orbit; negative inside the set.
float mandelbrotDistance(vec2 c) {
  vec2 z = vec2(0.0);
  vec2 dz = vec2(0.0);
  for (float n = 0.0; n < FRACTAL_ITERATIONS; n++) {
    dz = 2.0 * complexMultiply(z, dz) + vec2(1.0, 0.0);
    z = complexMultiply(z, z) + c;
    if (dot(z, z) > 1024.0) return 0.5 * length(z) * log(length(z)) / length(dz);
  }
  return -1.0;
}

// The same for the Julia set of c, measured at z.
float juliaDistance(vec2 z, vec2 c) {
  vec2 dz = vec2(1.0, 0.0);
  for (float n = 0.0; n < FRACTAL_ITERATIONS; n++) {
    dz = 2.0 * complexMultiply(z, dz);
    z = complexMultiply(z, z) + c;
    if (dot(z, z) > 1024.0) return 0.5 * length(z) * log(length(z)) / length(dz);
  }
  return -1.0;
}

// A boundary drawn by its distance in screen pixels, so it stays a crisp line with a halo at any render resolution.
float boundaryGlow(float distance, float pixel) {
  if (distance < 0.0) return 0.0;
  float pixels = distance / pixel;
  return exp(-pixels * 0.9) + 0.12 * exp(-pixels * 0.1);
}

// Six mirrors over a window travelling along the Mandelbrot set's edge, with the Julia set of the point it is passing.
vec3 fractalKaleidoscope(vec2 uv, float t) {
  float wedge = TAU / 6.0;
  float angle = abs(mod(atan(uv.y, uv.x) + t * 0.025, wedge) - 0.5 * wedge);
  vec2 p = vec2(cos(angle), sin(angle)) * length(uv);
  float along = 2.0 + 0.8 * sin(t * 0.011);
  vec2 edge = 0.5 * vec2(cos(along), sin(along)) - 0.25 * vec2(cos(2.0 * along), sin(2.0 * along));
  float pixel = 1.0 / min(resolution.x, resolution.y);
  float window = 0.16 * (1.0 + 0.25 * sin(t * 0.037));
  float mandelbrot = boundaryGlow(mandelbrotDistance(edge + rotation(t * 0.02) * p * window), window * pixel);
  float juliaScale = 1.5;
  float julia = boundaryGlow(juliaDistance(rotation(-t * 0.015) * p * juliaScale, edge), juliaScale * pixel);
  return (spectrum(t * 0.02 + 0.1 * length(p)) * mandelbrot + spectrum(t * 0.02 + 0.45 - 0.1 * length(p)) * julia * 0.8) * 0.55;
}

// Two drifting sets of rings interfere, as in op art or a screen door seen through another.
vec3 moireRings(vec2 uv, float t) {
  vec2 a = 0.3 * vec2(sin(t * 0.031), cos(t * 0.023));
  vec2 b = 0.3 * vec2(cos(t * 0.027 + 1.3), sin(t * 0.035 + 0.4));
  float rings = 90.0 + 20.0 * sin(t * 0.013);
  float interference = sin(length(uv - a) * rings) * sin(length(uv - b) * rings);
  return spectrum(length(uv) * 0.8 - t * 0.02) * smoothstep(-0.1, 0.5, interference) * 0.42;
}

vec3 scene(float index, vec2 uv) {
  if (index < 0.5) return liquidKaleidoscope(uv, time);
  if (index < 1.5) return kaliNebula(uv, time);
  if (index < 2.5) return mirrorLattice(uv, time);
  if (index < 3.5) return fractalKaleidoscope(uv, time);
  return moireRings(uv, time);
}

float revealOrder(vec2 uv) {
  if (transition < 0.5) return 0.5;
  if (transition < 1.5) return clamp(length(uv) / 1.1, 0.0, 1.0);
  if (transition < 2.5) return smoothstep(0.25, 0.75, fbm(uv * 2.2 + 11.0));
  return 0.5 + 0.5 * sin(5.0 * atan(uv.y, uv.x) + 9.0 * length(uv));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution) / min(resolution.x, resolution.y);
  vec3 colour = scene(toScene, uv);
  if (blend < 1.0) {
    float softness = 0.18;
    float revealed = smoothstep(-softness, softness, blend * (1.0 + 2.0 * softness) - softness - revealOrder(uv));
    colour = mix(scene(fromScene, uv), colour, revealed);
  }
  gl_FragColor = vec4(1.0 - exp(-EXPOSURE * colour), 1.0);
}
