export type OglBackingSize = Readonly<{
  cssWidth: number;
  cssHeight: number;
  effectiveDpr: number;
  renderScale: number;
}>;

export function shouldResizeOglBacking(
  previous: OglBackingSize | null,
  next: OglBackingSize,
): boolean {
  return (
    previous === null ||
    previous.cssWidth !== next.cssWidth ||
    previous.cssHeight !== next.cssHeight ||
    previous.effectiveDpr !== next.effectiveDpr ||
    previous.renderScale !== next.renderScale
  );
}

export function shouldContinueOglAnimation(
  speed: number,
  reducedMotion: boolean,
): boolean {
  return !reducedMotion && speed !== 0;
}

export function sanitizeRgb01(
  color: readonly [number, number, number],
): [number, number, number] {
  return color.map((channel) =>
    Math.min(1, Math.max(0, Number.isFinite(channel) ? channel : 0)),
  ) as [number, number, number];
}

export function plasmaPingPongTime(time: number): number {
  const duration = 10;
  const segmentTime = time % duration;
  const forward = Math.floor(time / duration) % 2 === 0;
  const u = segmentTime / duration;
  const smooth = u * u * (3 - 2 * u);
  return (forward ? smooth : 1 - smooth) * duration;
}
