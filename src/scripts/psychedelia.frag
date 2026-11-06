precision highp float;
uniform vec2 resolution;
uniform float time;
const float TAU = 6.2831853;
const float SCENE_SECONDS = 40.0;
const float BLEND_SECONDS = 8.0;
const float SCENE_COUNT = 3.0;
const vec2 SEAHORSE_VALLEY = vec2(-0.743643887037151, 0.131825904205330);
const float MAX_ITERATIONS = 192.0;

vec3 spectrum(float t) { return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67))); }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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

vec3 twistingTunnel(vec2 uv, float t) {
  float radius = length(uv);
  float angle = atan(uv.y, uv.x);
  float depth = 0.3 / max(radius, 0.001) + t * 0.4;
  float twist = angle + depth * 0.6 + 0.8 * sin(t * 0.1);
  float tiles = sin(twist * 6.0) * sin(depth * 9.0);
  float grain = fbm(vec2(cos(angle), sin(angle)) * 2.5 + vec2(depth * 0.7, t * 0.05));
  vec3 colour = spectrum(depth * 0.09 + grain * 0.8 + t * 0.02);
  return colour * pow(abs(tiles), 0.35) * (0.6 + 0.6 * grain) * smoothstep(0.03, 0.45, radius);
}

vec3 mandelbrotDive(vec2 uv, float sceneTime) {
  float angle = sceneTime * 0.04;
  uv = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * uv;
  float zoom = exp(0.17 * sceneTime);
  vec2 c = SEAHORSE_VALLEY + uv * 3.0 / zoom;
  vec2 z = vec2(0.0);
  float escapedAt = -1.0;
  for (float n = 0.0; n < MAX_ITERATIONS; n++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) { escapedAt = n; break; }
  }
  if (escapedAt < 0.0) return vec3(0.0);
  float smoothed = escapedAt - log2(log2(dot(z, z))) + 4.0;
  float farFromSet = 2.0 + 3.0 * log2(zoom);
  float nearness = clamp((smoothed - farFromSet) / (MAX_ITERATIONS - farFromSet), 0.0, 1.0);
  return spectrum(smoothed * 0.015 - sceneTime * 0.05) * pow(nearness, 0.3);
}

float sceneTime(float scene) {
  return mod(time - scene * SCENE_SECONDS, SCENE_SECONDS * SCENE_COUNT);
}

float sceneWeight(float scene) {
  float local = sceneTime(scene);
  return smoothstep(0.0, BLEND_SECONDS, local) * (1.0 - smoothstep(SCENE_SECONDS, SCENE_SECONDS + BLEND_SECONDS, local));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution) / min(resolution.x, resolution.y);
  vec3 colour = vec3(0.0);
  float weight = sceneWeight(0.0);
  if (weight > 0.0) colour += weight * liquidKaleidoscope(uv, time);
  weight = sceneWeight(1.0);
  if (weight > 0.0) colour += weight * twistingTunnel(uv, time);
  weight = sceneWeight(2.0);
  if (weight > 0.0) colour += weight * mandelbrotDive(uv, sceneTime(2.0));
  gl_FragColor = vec4(colour, 1.0);
}
