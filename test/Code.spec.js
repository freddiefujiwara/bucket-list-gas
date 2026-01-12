import { describe, it, expect, vi, beforeEach } from "vitest";

import * as testData from "./testData.js";

let doGet, convertSheetDataToObjects, calculateAge;

// Mock implementation for Google Apps Script APIs
const mockTextOutput = {
  content: "",
  mimeType: "",
  setContent: function (text) {
    this.content = text;
    return this;
  },
  setMimeType: function (type) {
    this.mimeType = type;
    return this;
  },
};

const mockContentService = {
  createTextOutput: vi.fn(() => {
    // Reset content for each call to simulate a new TextOutput object
    mockTextOutput.content = "";
    mockTextOutput.mimeType = "";
    return mockTextOutput;
  }),
  MimeType: {
    JAVASCRIPT: "application/javascript",
  },
};

const mockSheet = {
  getDataRange: vi.fn(() => ({
    getValues: vi.fn(() => JSON.parse(JSON.stringify(testData.normalSheetData))), // Return a deep copy
  })),
};

const mockSpreadsheetApp = {
  openById: vi.fn(() => ({
    getSheetByName: vi.fn(() => mockSheet),
  })),
};

// Stub the global objects before each test
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("SpreadsheetApp", mockSpreadsheetApp);
  vi.stubGlobal("ContentService", mockContentService);

  const module = await import("../src/Code.js");
  doGet = module.doGet;
  convertSheetDataToObjects = module.convertSheetDataToObjects;
  calculateAge = module.calculateAge;
});

describe("doGet", () => {
  it("should return JSON when no callback is provided", () => {
    const e = { parameter: {} };
    // Dynamically generate the expected result based on the imported test data
    const expectedResult = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.normalSheetData))
    );
    const expectedJson = JSON.stringify(expectedResult);

    const result = doGet(e);

    expect(result.content).toBe(expectedJson);
    expect(result.mimeType).toBe("application/javascript");
  });

  it("should return JSONP when a callback is provided", () => {
    const callbackName = "myCallback";
    const e = { parameter: { callback: callbackName } };
    const expectedResult = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.normalSheetData))
    );
    const expectedJsonp = `${callbackName}&&${callbackName}(${JSON.stringify(
      expectedResult
    )});`;

    const result = doGet(e);

    expect(result.content).toBe(expectedJsonp);
    expect(result.mimeType).toBe("application/javascript");
  });
});

describe("convertSheetDataToObjects", () => {
  it("should correctly convert normal sheet data", () => {
    const result = convertSheetDataToObjects(
      testData.normalSheetData.map((row) => [...row])
    );
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].category).toBe("スキル・学習");
    // Check that a valid date string is converted to a Date object
    expect(result[1].completed_at).toEqual(new Date("2024-01-15T10:00:00.000Z"));
  });

  it("should handle boundary values correctly", () => {
    const result = convertSheetDataToObjects(
      testData.boundarySheetData.map((row) => [...row])
    );
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("A");
    // Check that a valid date string is converted to a Date object
    expect(result[0].completed_at).toEqual(new Date("2023-01-01T00:00:00.000Z"));
    expect(result[1].title).toHaveLength(255);
  });

  it("should handle rows with fewer columns than headers", () => {
    const result = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.abnormalSheetDataShortRow))
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
    expect(result[0].title).toBe("毎朝のジョギングを習慣にする");
    // Missing string-like keys should be normalized to an empty string.
    expect(result[0].note).toBe("");
    // `completed_at` is special and normalizes to null when missing.
    expect(result[0].completed_at).toBeNull();
  });

  it("should handle and normalize varied and unexpected data types", () => {
    const fakeNow = new Date("2020-01-01T00:00:00.000Z"); // A date when age is 40
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const result = convertSheetDataToObjects(
      // Note: JSON.stringify converts `undefined` to `null`, so we deep-copy manually.
      testData.dataTypeVarietyData.map((row) => [...row])
    );
    expect(result).toHaveLength(1);
    const item = result[0];

    // 'id' is "not-a-number", which should result in null.
    expect(item.id).toBeNull();

    // 'category' is null, should be normalized to an empty string.
    expect(item.category).toBe("");

    // 'target_age' is always overridden, should be 40 based on fakeNow.
    expect(item.target_age).toBe(40);

    // 'note' is undefined, should be normalized to an empty string.
    expect(item.note).toBe("");

    // 'image_url' is an invalid format, should be an empty string.
    expect(item.image_url).toBe("");

    // 'completed' is a string "false", should be converted to a boolean.
    expect(item.completed).toBe(false);

    // 'completed_at' is an invalid date string, should be normalized to null.
    expect(item.completed_at).toBeNull();
  });

  it("should return an empty array for header-only data", () => {
    const result = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.headerOnlySheetData))
    );
    expect(result).toEqual([]);
  });

  it("should return an empty array for completely empty data", () => {
    const result = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.emptySheetData))
    );
    expect(result).toEqual([]);
  });

  it("should pass through unhandled fields via the default case", () => {
    const result = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.normalSheetData))
    );
    expect(result[0].extra_field).toBe("extra1");
    expect(result[1].extra_field).toBe("extra2");
  });

  it("should set completed_at to the current date if completed is true but date is missing", () => {
    // Fake the system time to get a predictable ISO string
    const fakeNow = new Date("2024-07-31T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const result = convertSheetDataToObjects(
      testData.completedWithNoDate.map((row) => [...row])
    );

    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
    expect(result[0].completed_at).toEqual(fakeNow);

    // Clean up the fake timers
    vi.useRealTimers();
  });

  it("should normalize a future date to null", () => {
    const fakeNow = new Date("2024-07-31T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const result = convertSheetDataToObjects(
      testData.futureDateData.map((row) => [...row])
    );

    expect(result).toHaveLength(1);
    expect(result[0].completed_at).toBeNull();

    vi.useRealTimers();
  });

  it("should trim whitespace from string fields", () => {
    const result = convertSheetDataToObjects(
      testData.untrimmedStringsData.map((row) => [...row])
    );
    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item.category).toBe("カテゴリA");
    expect(item.title).toBe("空白のあるタイトル");
    expect(item.note).toBe("ノートのテキスト。");
    expect(item.image_url).toBe("https://example.com/image.jpg");
  });

  it("should set completed_at to null if completed is false", () => {
    const result = convertSheetDataToObjects(
      testData.completedFalseWithDateData.map((row) => [...row])
    );
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(false);
    expect(result[0].completed_at).toBeNull();
  });

  it("should conditionally normalize target_age based on calculated age", () => {
    // Set a date where the person born in 1979-09-02 is 45 years old.
    // The normalized age (floor(45 / 10) * 10) will be 40.
    const fakeNow = new Date("2024-09-02T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const result = convertSheetDataToObjects(
      testData.targetAgeNormalizationData.map((row) => [...row])
    );

    expect(result).toHaveLength(8);
    // Case 1: 20 < 40, should be overwritten.
    expect(result[0].target_age).toBe(40);
    // Case 2: 40 === 40, should NOT be overwritten.
    expect(result[1].target_age).toBe(40);
    // Case 3: 50 > 40, should NOT be overwritten.
    expect(result[2].target_age).toBe(50);
    // Case 4: 130 > 100 (invalid), should be overwritten.
    expect(result[3].target_age).toBe(40);
    // Case 5: null, should be overwritten.
    expect(result[4].target_age).toBe(40);
    // Case 6: "" (empty string), should be overwritten.
    expect(result[5].target_age).toBe(40);
    // Case 7: 49 is a valid age > 40, should be rounded down to 40.
    expect(result[6].target_age).toBe(40);
    // Case 8: 51 is a valid age > 40, should be rounded down to 50.
    expect(result[7].target_age).toBe(50);

    vi.useRealTimers();
  });
});

describe("calculateAge", () => {
  const birthDate = new Date("1979-09-02T00:00:00+09:00");

  it("should calculate age correctly the day before the birthday", () => {
    const nowDate = new Date("2025-09-01T00:00:00+09:00"); // 46th birthday is tomorrow
    expect(calculateAge(birthDate, nowDate)).toBe(45);
  });

  it("should calculate age correctly on the birthday", () => {
    const nowDate = new Date("2025-09-02T00:00:00+09:00"); // 46th birthday
    expect(calculateAge(birthDate, nowDate)).toBe(46);
  });

  it("should calculate age correctly the day after the birthday", () => {
    const nowDate = new Date("2025-09-03T00:00:00+09:00"); // 46th birthday was yesterday
    expect(calculateAge(birthDate, nowDate)).toBe(46);
  });
});
