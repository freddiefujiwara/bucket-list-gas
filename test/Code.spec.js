import { describe, it, expect, vi, beforeEach } from "vitest";

let doGet, convertSheetDataToObjects;

// Mock data representing spreadsheet values
const mockValues = [
  ["id", "name"],
  [1, "foo"],
  [2, "bar"],
];

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
    getValues: vi.fn(() => JSON.parse(JSON.stringify(mockValues))), // Return a deep copy
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
    const expectedJson = JSON.stringify([
      { id: 1, name: "foo" },
      { id: 2, name: "bar" },
    ]);

    const result = doGet(e);

    expect(result.content).toBe(expectedJson);
    expect(result.mimeType).toBe("application/javascript");
  });

  it("should return JSONP when a callback is provided", () => {
    const callbackName = "myCallback";
    const e = { parameter: { callback: callbackName } };
    const expectedJsonp = `${callbackName}&&${callbackName}(${JSON.stringify([
      { id: 1, name: "foo" },
      { id: 2, name: "bar" },
    ])});`;

    const result = doGet(e);

    expect(result.content).toBe(expectedJsonp);
    expect(result.mimeType).toBe("application/javascript");
  });
});

describe("convertSheetDataToObjects", () => {
  it("should convert a 2D array to an array of objects", () => {
    const input = [
      ["id", "name"],
      [1, "foo"],
      [2, "bar"],
    ];
    const expected = [
      { id: 1, name: "foo" },
      { id: 2, name: "bar" },
    ];

    const result = convertSheetDataToObjects(input);
    expect(result).toEqual(expected);
  });

  it("should handle empty data gracefully", () => {
    const input = [];
    const expected = [];
    const result = convertSheetDataToObjects(input);
    expect(result).toEqual(expected);
  });

  it("should handle data with only a header row", () => {
    const input = [["id", "name"]];
    const expected = [];
    const result = convertSheetDataToObjects(input);
    expect(result).toEqual(expected);
  });
});
