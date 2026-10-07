// Unchanged Pixel Perfect shader source; see docs/pixel-perfect-backgrounds.md.
export const VERTEX = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAGMENT = `
precision mediump float;
uniform vec2 uSize;
uniform float uTime;
uniform float uLevels;
uniform float uWidth;
uniform vec3 uInk;
uniform vec3 uPaper;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}

// Three octaves; the landscape morphs by sliding each octave a different way.
float landscape(vec2 p, float t) {
  float v = 0.0;
  v += 0.55 * noise(p * 1.4 + vec2(t * 0.05, -t * 0.03));
  v += 0.30 * noise(p * 3.1 + vec2(-t * 0.04, t * 0.06) + 7.0);
  v += 0.15 * noise(p * 6.5 + vec2(t * 0.08, t * 0.02) + 19.0);
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 p = vec2(uv.x * uSize.x / uSize.y, uv.y);
  float h = landscape(p, uTime) * uLevels;
  // Distance to the nearest whole level, in levels. The field's gradient
  // converts a pixel width into level units, so lines stay the same width on
  // steep slopes and on flats.
  float grad = length(vec2(dFdx(h), dFdy(h))) + 1e-5;
  float f = fract(h);
  float d = min(f, 1.0 - f);
  // ("half" is reserved in GLSL ES, hence the longer name.)
  float halfWidth = uWidth * grad;
  float aa = grad;
  float line = 1.0 - smoothstep(halfWidth, halfWidth + aa, d);
  float thick = 1.0 - smoothstep(halfWidth * 2.2, halfWidth * 2.2 + aa, d);
  // Every fifth contour is an index line: thicker and fully opaque.
  float level = floor(h + 0.5);
  float isIndex = 1.0 - step(0.2, fract(level / 5.0));
  float ink = max(line * 0.55, thick * isIndex);
  gl_FragColor = vec4(mix(uPaper, uInk, ink), 1.0);
}
`;
