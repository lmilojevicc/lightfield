const LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

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

/** CPU equivalent of the complete displayed Prism/Dark Veil palette modulation. */
export function modulateRgbPreservingLuminance(
  sourceInput: readonly [number, number, number],
  tintInput: readonly [number, number, number],
): [number, number, number] {
  const source = sanitizeRgb01(sourceInput);
  const tint = sanitizeRgb01(tintInput);
  const sourceLum = Math.min(
    1,
    Math.max(
      0,
      source[0] * LUMA[0] + source[1] * LUMA[1] + source[2] * LUMA[2],
    ),
  );
  if (sourceLum <= 0) return [0, 0, 0];

  const tinted: [number, number, number] = [
    source[0] * tint[0],
    source[1] * tint[1],
    source[2] * tint[2],
  ];
  const tintedLum = Math.min(
    1,
    Math.max(
      0,
      tinted[0] * LUMA[0] + tinted[1] * LUMA[1] + tinted[2] * LUMA[2],
    ),
  );
  if (tintedLum <= 0) return [sourceLum, sourceLum, sourceLum];

  const scale = sourceLum / tintedLum;
  const scaled: [number, number, number] = [
    tinted[0] * scale,
    tinted[1] * scale,
    tinted[2] * scale,
  ];

  // Retain as much chroma as the RGB gamut permits. Both endpoints have
  // sourceLum luminance, so this mapping needs no luminance-losing final clamp.
  let gamutFactor = 1;
  for (const channel of scaled) {
    const delta = channel - sourceLum;
    if (delta > 0) gamutFactor = Math.min(gamutFactor, (1 - sourceLum) / delta);
    else if (delta < 0) gamutFactor = Math.min(gamutFactor, -sourceLum / delta);
  }
  gamutFactor = Math.max(0, gamutFactor);
  return scaled.map(
    (channel) => sourceLum + (channel - sourceLum) * gamutFactor,
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
