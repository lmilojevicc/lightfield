// Unchanged Pixel Perfect shader source; see docs/pixel-perfect-backgrounds.md.
export const VERTEX = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
export const FRAGMENT = `
precision mediump float;
uniform vec2 uSize;      
uniform float uCell;     
uniform float uTime;     
uniform vec3 uInkA;      
uniform vec3 uInkB;      
uniform vec4 uCalm;      
uniform vec3 uMouse;     
uniform float uBias;     

float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 cellCoord = floor(gl_FragCoord.xy / uCell);
  vec2 uv = (cellCoord * uCell) / uSize;
  float aspect = uSize.x / uSize.y;

  
  vec2 p = vec2(uv.x * aspect, uv.y);

  
  
  if (uMouse.z > 0.001) {
    vec2 dm = p - vec2(uMouse.x * aspect, uMouse.y);
    p += dm * exp(-dot(dm, dm) * 10.0) * 0.22 * uMouse.z;
  }
  
  
  
  float v = uBias
    + 0.20 * sin(dot(p, normalize(vec2(0.55, 1.0))) * 5.2 - uTime * 0.11)
    + 0.12 * sin(dot(p, normalize(vec2(1.0, 0.28))) * 8.4 + uTime * 0.07);

  
  
  
  
  
  
  
  
  if (uCalm.z > 0.0) {
    vec2 d = vec2((uv.x - uCalm.x) / uCalm.z, (uv.y - uCalm.y) / uCalm.w);
    v += 2.0 * (1.0 - smoothstep(0.75, 1.0, length(d)));
  }

  float threshold = bayer8(cellCoord);
  vec3 ink = v > threshold ? uInkA : uInkB;
  gl_FragColor = vec4(ink, 1.0);
}
`;
