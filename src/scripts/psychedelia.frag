precision highp float;
uniform vec2 resolution;
uniform float time;
const float TAU = 6.2831853;
const float SCENE_SECONDS = 40.0;
const float BLEND_SECONDS = 8.0;
const float SCENE_COUNT = 3.0;
const float JULIA_ITERATIONS = 160.0;

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

vec2 complexSquare(vec2 z) { return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y); }

mat2 rotation(float angle) { return mat2(cos(angle), sin(angle), -sin(angle), cos(angle)); }

vec3 juliaBloom(vec2 uv, float t) {
  float orbit = t * 0.045;
  vec2 cardioidEdge = 0.5 * vec2(cos(orbit), sin(orbit)) - 0.25 * vec2(cos(2.0 * orbit), sin(2.0 * orbit));
  vec2 c = cardioidEdge * (1.0 + 0.035 * sin(t * 0.11));
  vec2 z = rotation(t * 0.02) * uv * 2.4;
  float ringTrap = 1e9;
  float crossTrap = 1e9;
  float escapedAt = -1.0;
  for (float n = 0.0; n < JULIA_ITERATIONS; n++) {
    z = complexSquare(z) + c;
    ringTrap = min(ringTrap, abs(length(z) - 0.6));
    crossTrap = min(crossTrap, min(abs(z.x), abs(z.y)));
    if (dot(z, z) > 64.0) { escapedAt = n; break; }
  }
  vec3 veins = spectrum(ringTrap * 1.5 + t * 0.03) * exp(-ringTrap * 9.0) + spectrum(crossTrap + 0.5 - t * 0.02) * exp(-crossTrap * 14.0) * 0.7;
  if (escapedAt < 0.0) return veins;
  float smoothed = escapedAt - log2(log2(dot(z, z))) + 4.0;
  vec3 halo = spectrum(smoothed * 0.035 + t * 0.02) * smoothstep(2.0, 40.0, smoothed);
  return halo + veins * 0.6;
}

vec3 kaliNebula(vec2 uv, float t) {
  vec2 p = rotation(t * 0.015) * uv * (0.5 + 0.12 * sin(t * 0.04)) + 0.25 * vec2(sin(t * 0.021), cos(t * 0.017));
  vec2 fold = vec2(0.53 + 0.04 * sin(t * 0.05), 0.71 + 0.04 * cos(t * 0.043));
  vec3 colour = vec3(0.0);
  float previous = 0.0;
  for (int n = 0; n < 12; n++) {
    p = abs(p) / dot(p, p) - fold;
    float radius = length(p);
    float filament = exp(-abs(radius - previous) * 8.0);
    colour += spectrum(float(n) * 0.08 + radius * 0.05 + t * 0.015) * filament * filament;
    previous = radius;
  }
  return colour * 0.35;
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
  if (weight > 0.0) colour += weight * juliaBloom(uv, time);
  weight = sceneWeight(2.0);
  if (weight > 0.0) colour += weight * kaliNebula(uv, time);
  gl_FragColor = vec4(colour, 1.0);
}
