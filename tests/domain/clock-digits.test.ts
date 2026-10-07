/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clockCellWidths } from "../../src/domain/clock-digits";
import {
  observeClockFont,
  updateClockDigits,
} from "../../src/platform/clock-digits";

const glyph = (advance: number, left = 0, right = advance) => ({
  advance,
  left,
  right,
});
describe("clockCellWidths", () => {
  test("preserves a monospaced colon's full advance, without arbitrary tracking", () => {
    expect(clockCellWidths(Array(10).fill(glyph(19.2)), glyph(19.2))).toEqual({
      digit: 19.2,
      separator: 19.2,
    });
  });
  test("reserves maximum proportional digit independently of the separator", () => {
    expect(clockCellWidths([glyph(8), glyph(14), glyph(11)], glyph(5))).toEqual(
      { digit: 14, separator: 5 },
    );
  });
  test("only actual ink overhang adds symmetric safety space", () => {
    expect(
      clockCellWidths([glyph(12, 1, 12), glyph(11, -1, 14)], glyph(5, -1, 4)),
    ).toEqual({ digit: 17, separator: 5 });
  });
});

// Minimal DOM models layout advances and FontFaceSet events, not font identities.
class Cell {
  children: Cell[] = [];
  textContent = "";
  className = "";
  attributes = new Map<string, string>();
  classList = { add: () => {} };
  style = {
    cssText: "",
    setProperty: (key: string, value: string) =>
      this.attributes.set(key, value),
  };
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  append(cell: Cell) {
    this.children.push(cell);
  }
  replaceChildren(...cells: Cell[]) {
    this.children = cells;
  }
  remove() {}
  getBoundingClientRect() {
    reads++;
    return {
      width: this.textContent === ":" ? separatorAdvance : digitAdvance,
    };
  }
}
let reads = 0,
  digitAdvance = 12,
  separatorAdvance = 12;
let css: Record<string, string>, fonts: EventTarget, windowEvents: EventTarget;
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  reads = 0;
  digitAdvance = 12;
  separatorAdvance = 12;
  css = {
    fontFamily: '"Selected", serif',
    fontWeight: "400",
    fontSize: "20px",
    fontStyle: "normal",
  };
  fonts = new EventTarget();
  windowEvents = new EventTarget();
  for (const [name, value] of Object.entries({
    document: {
      fonts,
      body: new Cell(),
      createElement: (tag: string) =>
        tag === "canvas" ? { getContext: () => null } : new Cell(),
    },
    window: windowEvents,
    getComputedStyle: () => css,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
});
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});
const element = (cell: Cell) => cell as unknown as HTMLElement;
test("clock rollover updates fixed nodes without measuring on tick", () => {
  const cell = new Cell();
  updateClockDigits(element(cell), "09:59:58");
  const nodes = [...cell.children];
  for (const value of ["09:59:59", "10:00:00", "11:11:58", "12:00:00"]) {
    updateClockDigits(element(cell), value);
    expect(cell.children.every((node, i) => node === nodes[i])).toBe(true);
    expect(cell.children.map((node) => node.textContent).join("")).toBe(value);
  }
  expect(reads).toBe(0);
  expect(cell.attributes.get("aria-hidden")).toBe("true");
});
test("clock font cache keys family, weight and size; late ready invalidates fallback metrics", () => {
  const cell = new Cell(),
    controller = observeClockFont(element(cell));
  expect(reads).toBe(11);
  expect(cell.attributes.get("--clock-separator-width")).toBe("0.6em");
  controller.refresh();
  expect(reads).toBe(11);
  css.fontWeight = "500";
  digitAdvance = 14;
  controller.refresh();
  expect(reads).toBe(22);
  css.fontFamily = '"NewAlias", serif';
  controller.refresh();
  expect(reads).toBe(33);
  digitAdvance = 16;
  separatorAdvance = 7;
  fonts.dispatchEvent(new Event("loadingdone"));
  expect(cell.attributes.get("--clock-digit-width")).toBe("0.8em");
  expect(cell.attributes.get("--clock-separator-width")).toBe("0.35em");
  expect(reads).toBe(44);
  css.fontSize = "28px";
  windowEvents.dispatchEvent(new Event("resize"));
  expect(reads).toBe(55);
  controller.dispose();
  fonts.dispatchEvent(new Event("loadingdone"));
  expect(reads).toBe(55);
});
test("old font completion measures current preset, never resurrects a prior alias", () => {
  const cell = new Cell(),
    controller = observeClockFont(element(cell));
  css.fontFamily = "system-ui";
  digitAdvance = 10;
  controller.refresh();
  fonts.dispatchEvent(new Event("loadingdone"));
  expect(cell.attributes.get("--clock-digit-width")).toBe("0.5em");
  controller.refresh();
  expect(reads).toBe(33);
  controller.dispose();
});
