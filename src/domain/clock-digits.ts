export interface ClockGlyphMetrics {
  advance: number;
  /** Ink extents relative to the advance origin, as returned by TextMetrics. */
  left: number;
  right: number;
}
/** Centered cells reserve the actual advance, plus only genuine ink overhang.
 * No tabular feature is assumed: Instrument Serif, for example, has no tnum. */
export function clockCellWidths(
  digits: readonly ClockGlyphMetrics[],
  separator: ClockGlyphMetrics,
) {
  const width = ({ advance, left, right }: ClockGlyphMetrics) =>
    advance + 2 * Math.max(0, left, right - advance);
  return { digit: Math.max(...digits.map(width)), separator: width(separator) };
}
