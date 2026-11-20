import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

import * as testData from "./testData.js";

// Property-based tests over the pure transforms: sheet-row shaping
// (convertSheetDataToObjects), article building (buildArticleBlocks)
// and age calculation (calculateAge). The generators cover the JSON /
// Sheets value domain: scalars, Dates, arrays, plain objects — plus
// { toString: [] }, which JSON.parse can produce and String() throws
// on. Strings are generated as whole code points (fc.string() never
// emits lone surrogates), matching what Sheets and JSON text carry.

let convertSheetDataToObjects, buildArticleBlocks, calculateAge;

const mockUtilities = {
  formatDate: vi.fn((date, timeZone, format) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type).value;
    if (format === "yyyy年M月d日") {
      return `${get("year")}年${get("month")}月${get("day")}日`;
    }
    if (format === "yyyy年M月") {
      return `${get("year")}年${get("month")}月`;
    }
    throw new Error(`unsupported format in mock: ${format}`);
  }),
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("Utilities", mockUtilities);
  const module = await import("../src/Code.js");
  convertSheetDataToObjects = module.convertSheetDataToObjects;
  buildArticleBlocks = module.buildArticleBlocks;
  calculateAge = module.calculateAge;
});

const unstringifiable = () => ({ toString: [] });

const cellArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.date({ noInvalidDate: true }),
  fc.array(fc.integer(), { maxLength: 3 }),
  fc.constant(unstringifiable()),
  fc.jsonValue()
);

const rowArb = fc.oneof(
  fc.array(cellArb, { maxLength: 12 }),
  fc.constant(null),
  fc.integer(),
  fc.string()
);

const FULL_HEADERS = [
  "id",
  "category",
  "target_age",
  "title",
  "note",
  "image_url",
  "completed",
  "completed_at",
  "next_action",
  "progress",
  "status",
  "article_order",
];

describe("convertSheetDataToObjects properties", () => {
  it("never throws and preserves the row count for arbitrary sheet data", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 6 }), (rows) => {
        const result = convertSheetDataToObjects([FULL_HEADERS, ...rows]);
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(rows.length);
        for (const item of result) {
          expect(item).not.toBeNull();
          expect(typeof item).toBe("object");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("never throws for arbitrary header rows", () => {
    fc.assert(
      fc.property(
        fc.array(cellArb, { maxLength: 12 }),
        fc.array(rowArb, { maxLength: 4 }),
        (headers, rows) => {
          const result = convertSheetDataToObjects([headers, ...rows]);
          expect(result).toHaveLength(rows.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("always emits the documented field shapes", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 6 }), (rows) => {
        const before = Date.now();
        const result = convertSheetDataToObjects([FULL_HEADERS, ...rows]);
        for (const item of result) {
          expect(item.id === null || Number.isInteger(item.id)).toBe(true);
          expect(Number.isInteger(item.target_age)).toBe(true);
          expect(item.target_age % 10).toBe(0);
          expect(item.target_age).toBeGreaterThanOrEqual(0);
          expect(item.target_age).toBeLessThanOrEqual(100);
          expect(typeof item.completed).toBe("boolean");
          expect(
            item.article_order === null ||
              Number.isInteger(item.article_order)
          ).toBe(true);
          for (const field of [
            "category",
            "title",
            "note",
            "image_url",
            "next_action",
            "progress",
            "status",
          ]) {
            expect(typeof item[field]).toBe("string");
          }
          expect(
            item.image_url === "" ||
              /^(https?:\/\/|data:image\/)/.test(item.image_url)
          ).toBe(true);
          if (item.completed_at !== null) {
            // An ISO string that round-trips and is never in the future
            // (the converter clamps future stamps to "now").
            expect(typeof item.completed_at).toBe("string");
            expect(new Date(item.completed_at).toISOString()).toBe(
              item.completed_at
            );
            expect(Date.parse(item.completed_at)).toBeLessThanOrEqual(
              before + 5000
            );
          }
          if (!item.completed) {
            expect(item.completed_at).toBeNull();
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("conserves well-formed rows field by field", () => {
    const wellFormed = fc.record({
      id: fc.integer({ min: 1, max: 100000 }),
      category: fc.string(),
      // Decades safely above the current normalized target age (40 in
      // 2026) so the value must pass through untouched.
      target_age: fc.constantFrom(50, 60, 70, 80, 90, 100),
      title: fc.string(),
      note: fc.string(),
      completed: fc.boolean(),
      pastIso: fc
        .date({
          noInvalidDate: true,
          min: new Date("2000-01-01T00:00:00.000Z"),
          max: new Date("2025-12-31T00:00:00.000Z"),
        })
        .map((d) => d.toISOString()),
    });
    fc.assert(
      fc.property(fc.array(wellFormed, { maxLength: 5 }), (records) => {
        const rows = records.map((r) => [
          r.id,
          r.category,
          r.target_age,
          r.title,
          r.note,
          "",
          r.completed,
          r.completed ? r.pastIso : "",
          "",
          "",
          "",
          "",
        ]);
        const result = convertSheetDataToObjects([FULL_HEADERS, ...rows]);
        expect(result).toHaveLength(records.length);
        result.forEach((item, index) => {
          const r = records[index];
          expect(item.id).toBe(r.id);
          expect(item.category).toBe(r.category.trim());
          expect(item.target_age).toBe(r.target_age);
          expect(item.title).toBe(r.title.trim());
          expect(item.note).toBe(r.note.trim());
          expect(item.completed).toBe(r.completed);
          expect(item.completed_at).toBe(r.completed ? r.pastIso : null);
        });
      }),
      { numRuns: 100 }
    );
  });
});

describe("buildArticleBlocks properties", () => {
  // Item fields are the converter's output domain (scalars and nulls).
  // target_age is always a number there; the generator also covers the
  // scalar deformations a hand-built item could carry, but not
  // unstringifiable objects, which the converter can never emit and the
  // meta line interpolates directly.
  const itemArb = fc.record({
    id: fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.constant(null)),
    category: fc.oneof(
      fc.constantFrom("Health", "Finance", "Something else", "謎カテゴリ"),
      fc.constant(null),
      fc.integer()
    ),
    target_age: fc.oneof(
      fc.integer({ min: 0, max: 120 }),
      fc.constant(null),
      fc.boolean(),
      fc.string()
    ),
    title: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
    note: fc.oneof(fc.string(), fc.constant(null)),
    image_url: fc.oneof(
      fc.constant(""),
      fc.constant("https://example.com/x.jpg"),
      fc.constant(null)
    ),
    completed: fc.oneof(fc.boolean(), fc.constant("true"), fc.constant(null)),
    completed_at: fc.oneof(
      fc.constant(null),
      fc.constant("2024-02-29T00:00:00.000Z"),
      fc.constant("not-a-date"),
      fc.constant("2026-02-30"),
      fc.integer(),
      fc.constant(unstringifiable())
    ),
    status: fc.oneof(fc.constant(""), fc.constant("in_progress"), fc.constant(null)),
    article_order: fc.oneof(
      fc.integer({ min: 0, max: 100 }),
      fc.constant(null),
      fc.string()
    ),
  });
  const itemsArb = fc.array(
    fc.oneof(itemArb, fc.constant(null), fc.integer(), fc.string()),
    { maxLength: 8 }
  );

  it("never throws and emits one item title per real item", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const blocks = buildArticleBlocks(
          items,
          new Date("2026-11-15T00:00:00.000Z")
        );
        const realItems = items.filter(
          (item) => item && typeof item === "object"
        );
        expect(blocks[0]).toEqual({
          kind: "paragraph",
          text: "[[タグ：暮らし]]",
        });
        expect(blocks.filter((b) => b.kind === "itemTitle")).toHaveLength(
          realItems.length
        );
        for (const block of blocks) {
          expect([
            "paragraph",
            "title",
            "heading",
            "itemTitle",
            "image",
          ]).toContain(block.kind);
        }
        // Every string title of a real item appears as an item title.
        const titleTexts = blocks
          .filter((b) => b.kind === "itemTitle")
          .map((b) => b.text);
        for (const item of realItems) {
          if (typeof item.title === "string") {
            expect(titleTexts).toContain(item.title);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("places every completed item after the completed heading", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const blocks = buildArticleBlocks(
          items,
          new Date("2026-11-15T00:00:00.000Z")
        );
        const headingIndex = blocks.findIndex(
          (b) => b.kind === "heading" && b.text === "達成したもの"
        );
        expect(headingIndex).toBeGreaterThanOrEqual(0);
        const realItems = items.filter(
          (item) => item && typeof item === "object"
        );
        const completedTitles = realItems
          .filter((item) => item.completed)
          .map((item) => item.title)
          .filter((title) => typeof title === "string")
          .sort();
        // After the completed heading only completed items are emitted,
        // so the string item titles there are exactly the completed set.
        const titlesAfterHeading = blocks
          .slice(headingIndex + 1)
          .filter((b) => b.kind === "itemTitle" && typeof b.text === "string")
          .map((b) => b.text)
          .sort();
        expect(titlesAfterHeading).toEqual(completedTitles);
      }),
      { numRuns: 100 }
    );
  });
});

describe("calculateAge properties", () => {
  it("is exact on birthdays and zero on the birth date", () => {
    fc.assert(
      fc.property(
        fc.date({
          noInvalidDate: true,
          min: new Date("1900-01-01T00:00:00.000Z"),
          max: new Date("2100-12-31T00:00:00.000Z"),
        }),
        fc.integer({ min: 0, max: 80 }),
        (birth, years) => {
          // Feb 29 birthdays land on Mar 1 in non-leap years; the
          // exact-anniversary claim does not apply there.
          fc.pre(!(birth.getMonth() === 1 && birth.getDate() === 29));
          const onBirthday = new Date(birth);
          onBirthday.setFullYear(birth.getFullYear() + years);
          expect(calculateAge(birth, onBirthday)).toBe(years);
          expect(calculateAge(birth, birth)).toBe(0);
          if (years >= 1) {
            const dayBefore = new Date(onBirthday);
            dayBefore.setDate(dayBefore.getDate() - 1);
            expect(calculateAge(birth, dayBefore)).toBe(years - 1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
