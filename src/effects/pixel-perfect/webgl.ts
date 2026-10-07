import { requiredValue } from "../runtime/required-value";
import type { PixelPerfectConfig } from "../../shared/pixel-perfect-metadata";

/** Own every GL allocation, including partial compilation failures. */
export function createProgram(
  canvas: HTMLCanvasElement,
  vertex: string,
  fragment: string,
  derivatives = false,
) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) throw new Error("Pixel Perfect WebGL unavailable");
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const shaders: WebGLShader[] = [];
  const destroy = () => {
    if (buffer) gl.deleteBuffer(buffer);
    shaders.forEach((shader) => {
      gl.deleteShader(shader);
    });
    if (program) gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  try {
    if (derivatives && !gl.getExtension("OES_standard_derivatives"))
      throw new Error("WebGL derivatives unsupported");
    const nextProgram = gl.createProgram() as WebGLProgram | null;
    program = nextProgram;
    if (!nextProgram || !program) throw new Error("WebGL program unavailable");
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [
        gl.FRAGMENT_SHADER,
        derivatives
          ? `#extension GL_OES_standard_derivatives : enable\n${fragment}`
          : fragment,
      ],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("WebGL shader unavailable");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      const compiled: unknown = gl.getShaderParameter(
        shader,
        gl.COMPILE_STATUS,
      );
      if (!compiled) throw new Error("Pixel Perfect shader compile failed");
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    const linked: unknown = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linked) throw new Error("Pixel Perfect shader link failed");
    gl.useProgram(program);
    const nextBuffer = gl.createBuffer() as WebGLBuffer | null;
    buffer = nextBuffer;
    if (!nextBuffer || !buffer) throw new Error("WebGL buffer unavailable");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const uniform = (name: string) => {
      if (!uniforms.has(name))
        uniforms.set(name, gl.getUniformLocation(requiredValue(program), name));
      return requiredValue(uniforms.get(name));
    };
    return {
      gl,
      uniform,
      destroy,
      resize(width: number, height: number, dpr: number) {
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uniform("uSize"), canvas.width, canvas.height);
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
export const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const value = (config: PixelPerfectConfig, key: string) =>
  Number(config[key]);
