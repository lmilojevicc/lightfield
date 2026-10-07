export const DISPLAY_PIXEL_BUDGET = 8_294_400;
/** Preserve the full source aspect, without upscaling, including extreme Cover ratios. */
export function displayDimensions(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  dpr: number,
  fit: "cover" | "contain",
) {
  const ratio = (fit === "cover" ? Math.max : Math.min)(
    (Math.max(1, viewportWidth) * Math.max(1, dpr)) / width,
    (Math.max(1, viewportHeight) * Math.max(1, dpr)) / height,
  );
  const scale = Math.min(
    1,
    ratio,
    Math.sqrt(DISPLAY_PIXEL_BUDGET / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
