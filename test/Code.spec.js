import { describe, it, expect, vi, beforeEach } from "vitest";

import * as testData from "./testData.js";

let doGet, convertSheetDataToObjects;

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
      JSON.parse(JSON.stringify(testData.normalSheetData))
    );
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].category).toBe("スキル・学習");
  });

  it("should handle boundary values correctly", () => {
    const result = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.boundarySheetData))
    );
    expect(result).toHaveLength(2);
    expect(result[0].target_age).toBe(0);
    expect(result[0].title).toBe("A");
    expect(result[1].target_age).toBe(120);
    expect(result[1].title).toHaveLength(255);
  });

  it("should handle rows with fewer columns than headers", () => {
    const result = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.abnormalSheetDataShortRow))
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
    expect(result[0].title).toBe("毎朝のジョギングを習慣にする");
    // Missing keys should result in undefined properties
    expect(result[0].note).toBeUndefined();
    expect(result[0].completed_at).toBeUndefined();
  });

  it("should handle varied and unexpected data types", () => {
    const result = convertSheetDataToObjects(
      JSON.parse(JSON.stringify(testData.dataTypeVarietyData))
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("6"); // Stays as a string
    expect(result[0].category).toBeNull(); // Stays as null
    // undefined in the source array becomes null after JSON.parse(JSON.stringify())
    expect(result[0].note).toBeNull();
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
});
