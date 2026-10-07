import { requiredValue } from "../../../src/effects/runtime/required-value";
import { expect, test } from "bun:test";
import { ShaderFitOptions } from "@paper-design/shaders";
import { radialSizingAnimation as motion } from "../../../src/effects/paper/radial-motion";
import { normalizePaperConfig } from "../../../src/effects/paper/adapter";
import { PAPER_DEFINITIONS } from "../../../src/shared/paper-metadata";

const baseline = Object.freeze({
  u_scale: 1,
  u_offsetX: 0,
  u_offsetY: 0,
  u_fit: ShaderFitOptions.contain,
});

test("radial phase zero preserves sizing; config retains old settings and adopts speed/frame defaults", () => {
  expect(motion(0, baseline, 1440, 900)).toEqual({
    u_scale: 1,
    u_offsetX: 0,
    u_offsetY: 0,
  });
  const config = normalizePaperConfig("paper-static-radial-gradient", {
    scale: 1.4,
    offsetX: 0.3,
  });
  expect(config.scale).toBe(1.4);
  expect(config.offsetX).toBe(0.3);
  expect(config.speed).toBe(1);
  expect(config.frame).toBe(0);
  expect(
    normalizePaperConfig("paper-static-radial-gradient", { speed: 0 }).speed,
  ).toBe(0);
  expect(
    PAPER_DEFINITIONS["paper-static-radial-gradient"].sourceColors,
  ).toEqual(["#00bbff", "#00ffe1", "#ffffff"]);
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [900, 900],
]) {
  for (const fit of Object.values(ShaderFitOptions)) {
    test(`radial ±1% viewport translation and 45s/60s periods at ${String(width)}x${String(height)}, fit ${String(fit)}`, () => {
      const source = { ...baseline, u_fit: fit };
      const side =
        fit === ShaderFitOptions.cover
          ? Math.max(requiredValue(width), requiredValue(height))
          : Math.min(requiredValue(width), requiredValue(height));
      for (const [key, dimension, period] of [
        ["u_offsetX", requiredValue(width), 45000],
        ["u_offsetY", requiredValue(height), 60000],
      ] as const) {
        expect(
          motion(
            period / 4,
            source,
            requiredValue(width),
            requiredValue(height),
          )[key] * side,
        ).toBeCloseTo(0.01 * dimension, 10);
        expect(
          motion(
            (period * 3) / 4,
            source,
            requiredValue(width),
            requiredValue(height),
          )[key] * side,
        ).toBeCloseTo(-0.01 * dimension, 10);
        expect(
          motion(period, source, requiredValue(width), requiredValue(height))[
            key
          ],
        ).toBeCloseTo(0, 10);
      }
    });
  }
}

test("radial breathing multiplies baseline ±2% on 50s cycle; reverse playback is symmetric", () => {
  for (const scale of [0.1, 1, 2]) {
    const source = { ...baseline, u_scale: scale };
    expect(motion(12500, source, 1440, 900).u_scale).toBeCloseTo(
      scale * 1.02,
      12,
    );
    expect(motion(37500, source, 1440, 900).u_scale).toBeCloseTo(
      scale * 0.98,
      12,
    );
    expect(motion(-12500, source, 1440, 900).u_scale).toBeCloseTo(
      scale * 0.98,
      12,
    );
    expect(motion(50000, source, 1440, 900).u_scale).toBe(scale);
  }
});

test("radial bounds taper continuously without clipping, including extreme aspect ratios", () => {
  for (const scale of [0.01, 0.010001, 0.0101, 0.02, 3.9, 3.99, 4]) {
    for (const offset of [
      -1, -0.99999, -0.999, -0.99, 0, 0.99, 0.999, 0.99999, 1,
    ]) {
      const source = {
        ...baseline,
        u_scale: scale,
        u_offsetX: offset,
        u_offsetY: offset,
      };
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
        [1000000, 1],
        [1, 1000000],
      ]) {
        for (const time of [0, 11250, 15000, 12500, 33750, 45000, 37500]) {
          const value = motion(
            time,
            source,
            requiredValue(width),
            requiredValue(height),
          );
          expect(value.u_scale).toBeGreaterThanOrEqual(0.01);
          expect(value.u_scale).toBeLessThanOrEqual(4);
          for (const offset of [value.u_offsetX, value.u_offsetY]) {
            expect(Number.isFinite(offset)).toBe(true);
            expect(offset).toBeGreaterThanOrEqual(-1);
            expect(offset).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  }
  const near = { ...baseline, u_offsetX: 0.99999 };
  expect(motion(11250, near, 900, 900).u_offsetX - near.u_offsetX).toBeLessThan(
    0.00000001,
  );
  expect(motion(11250, { ...baseline, u_offsetX: 1 }, 900, 900).u_offsetX).toBe(
    1,
  );
});

test("radial derivation never mutates baseline or accumulates drift; phase is independent of unrelated uniforms", () => {
  const expected = motion(17300, baseline, 1440, 900);
  for (let i = 0; i < 500; i++) {
    motion(i * 1000, baseline, 390, 844);
    expect(
      motion(
        17300,
        {
          ...baseline,
          u_rotation: i,
          u_originX: 0.8,
          u_colors: [[i, 0, 0, 1]],
        },
        1440,
        900,
      ),
    ).toEqual(expected);
  }
  expect(motion(0, baseline, 1440, 900)).toEqual({
    u_scale: 1,
    u_offsetX: 0,
    u_offsetY: 0,
  });
});
