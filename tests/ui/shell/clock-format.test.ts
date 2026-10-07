import { expect, test } from "bun:test";
import {
  formatRailDate,
  formatRailTime,
  formatRailAccessibleName,
} from "../../../src/ui/shell/clock-format";
import { categoryForKey } from "../../../src/ui/shell/settings-presentation";
test("clock accessible name follows selected date parts, seconds and 12/24-hour format", () => {
  const now = new Date(2026, 8, 1, 10, 8, 9);
  const parts = { weekday: true, month: true, day: true, year: false };
  expect(formatRailDate(now, parts, "en-US")).toBe("Tue, Sep 1");
  expect(
    formatRailDate(
      now,
      { weekday: false, month: false, day: false, year: false },
      "en-US",
    ),
  ).toBe("");
  expect(
    formatRailTime(now, { seconds: true, twentyFourHour: true }, "en-US"),
  ).toBe("10:08:09");
  expect(
    formatRailAccessibleName(
      now,
      { seconds: false, twentyFourHour: false },
      parts,
      "en-US",
    ),
  ).toBe("10:08 AM, Tue, Sep 1");
  expect(
    formatRailAccessibleName(
      now,
      { seconds: false, twentyFourHour: false },
      null,
      "en-US",
    ),
  ).toBe("10:08 AM");
});
test("settings category keyboard navigation wraps and Home/End address real categories", () => {
  expect(categoryForKey("search", "ArrowUp")).toBe("time-date");
  expect(categoryForKey("time-date", "ArrowRight")).toBe("search");
  expect(categoryForKey("background", "Home")).toBe("search");
  expect(categoryForKey("appearance", "End")).toBe("time-date");
  expect(categoryForKey("fonts", "Escape")).toBeUndefined();
});
