import * as THREE from "three";

export function assertThreeWebGL2(
  renderer: THREE.WebGLRenderer,
  label: string,
): void {
  if (renderer.capabilities.isWebGL2) return;
  renderer.dispose();
  renderer.forceContextLoss();
  throw new Error(`${label} requires WebGL 2`);
}

export function threeProgramSnapshot(
  renderer: THREE.WebGLRenderer,
): Set<WebGLProgram> {
  return new Set(
    (renderer.info.programs ?? []).map(
      (program) => program.program as WebGLProgram,
    ),
  );
}

export function threeProgramsSince(
  renderer: THREE.WebGLRenderer,
  snapshot: ReadonlySet<WebGLProgram>,
): WebGLProgram[] {
  return (renderer.info.programs ?? [])
    .map((program) => program.program as WebGLProgram)
    .filter((program) => !snapshot.has(program));
}

export function assertThreePrograms(
  renderer: THREE.WebGLRenderer,
  label: string,
  programs?: Iterable<WebGLProgram>,
): void {
  const gl = renderer.getContext();
  const candidates =
    programs ??
    (renderer.info.programs ?? []).map(
      (program) => program.program as WebGLProgram,
    );
  for (const program of candidates) {
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) continue;
    const detail = gl.getProgramInfoLog(program) || "unknown shader link error";
    throw new Error(`${label} shader failed: ${detail}`);
  }
}
