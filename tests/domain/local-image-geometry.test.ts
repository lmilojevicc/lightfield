import { requiredValue } from "../../src/domain/required-value";
import { test, expect } from "bun:test";
import {
  displayDimensions,
  DISPLAY_PIXEL_BUDGET,
} from "../../src/domain/images/local-image-geometry";
test("local-image-geometry bounds source, DPR, fit and extreme aspect without upscaling", () => {
  for (const [width, height] of [
    [6000, 4000],
    [16384, 1000],
    [1000, 16384],
    [20, 10],
  ])
    for (const fit of ["cover", "contain"] as const)
      for (const dpr of [1, 2, 4]) {
        const result = displayDimensions(
          requiredValue(width),
          requiredValue(height),
          1440,
          900,
          dpr,
          fit,
        );
        expect(result.width * result.height).toBeLessThanOrEqual(
          DISPLAY_PIXEL_BUDGET,
        );
        expect(result.width).toBeLessThanOrEqual(requiredValue(width));
        expect(result.height).toBeLessThanOrEqual(requiredValue(height));
      }
  expect(displayDimensions(320, 200, 1440, 900, 2, "cover")).toEqual({
    width: 320,
    height: 200,
  });
});
