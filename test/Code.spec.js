import { describe, it, expect, vi, beforeEach } from "vitest";

import * as testData from "./testData.js";

let doGet,
  doPost,
  convertSheetDataToObjects,
  calculateAge,
  generateArticle,
  syncArticleFromSheet,
  buildArticleBlocks;

// Mock implementation for Google Apps Script APIs
// A factory function to create a new mock TextOutput object for each call,
// ensuring test isolation.
const createMockTextOutput = (content = "") => ({
  content: content,
  mimeType: "",
  setContent: function (text) {
    this.content = text;
    return this;
  },
  setMimeType: function (type) {
    this.mimeType = type;
    return this;
  },
});

const mockContentService = {
  // Pass the optional content argument to the factory.
  createTextOutput: vi.fn((content) => createMockTextOutput(content)),
  MimeType: {
    JAVASCRIPT: "application/javascript",
    TEXT: "text/plain",
  },
};

// A sheet mock backed by a plain 2D array, supporting reads and writes.
const makeSheet = (initialData) => ({
  data: JSON.parse(JSON.stringify(initialData || [])),
  getLastRow: vi.fn(function () {
    return this.data.length;
  }),
  getLastColumn: vi.fn(function () {
    return this.data[0]?.length || 0;
  }),
  getRange: vi.fn(function (row, column, numRows, numCols) {
    const self = this;
    return {
      getValues: vi.fn(() => {
        if (numRows === undefined) {
          return self.data.map((r) => [...r]);
        }
        return self.data
          .slice(row - 1, row - 1 + numRows)
          .map((r) => r.slice(column - 1, column - 1 + numCols));
      }),
      setValue: vi.fn((value) => {
        while (self.data.length < row) {
          self.data.push([]);
        }
        const target = self.data[row - 1];
        while (target.length < column) {
          target.push("");
        }
        target[column - 1] = value;
      }),
    };
  }),
  getDataRange: vi.fn(function () {
    const self = this;
    return {
      getValues: vi.fn(() => self.data.map((r) => [...r])),
    };
  }),
  appendRow: vi.fn(function (row) {
    this.data.push([...row]);
  }),
  deleteRow: vi.fn(function (row) {
    this.data.splice(row - 1, 1);
  }),
});

const mockSheet = makeSheet(testData.normalSheetData);
let shareSheet = null;

// Function to reset the mock sheet's data for different test scenarios
const setMockSheetData = (data) => {
  mockSheet.data = JSON.parse(JSON.stringify(data));
};

const mockSpreadsheet = {
  getSheetByName: vi.fn((name) => {
    if (name === "list") {
      return mockSheet;
    }
    if (name === "share_sessions") {
      return shareSheet;
    }
    return null;
  }),
  insertSheet: vi.fn((name) => {
    shareSheet = makeSheet([]);
    return shareSheet;
  }),
};

const mockSpreadsheetApp = {
  openById: vi.fn(() => mockSpreadsheet),
};

// Script properties: the top-level beforeEach installs AUTH_PROPERTIES by
// default, so every test runs with authentication on; tests present
// "valid-token" as the ID token credential.
let scriptProperties = {};
const mockPropertiesService = {
  getScriptProperties: vi.fn(() => ({
    getProperty: vi.fn((key) => (key in scriptProperties ? scriptProperties[key] : null)),
    setProperty: vi.fn((key, value) => {
      scriptProperties[key] = String(value);
    }),
  })),
};

let uuidCounter = 0;
const mockUtilities = {
  DigestAlgorithm: { SHA_256: "SHA_256" },
  computeDigest: vi.fn((algorithm, value) =>
    Array.from(String(value)).map((char) => char.charCodeAt(0))
  ),
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
  getUuid: vi.fn(
    () =>
      `00000000-0000-4000-8000-${String((uuidCounter += 1)).padStart(12, "0")}`
  ),
};

const tokenInfoPayload = (email) => ({
  iss: "https://accounts.google.com",
  aud: "test-client-id",
  exp: Math.floor(Date.now() / 1000) + 3600,
  email_verified: "true",
  email,
  sub: "subject-1",
});

const mockUrlFetchApp = {
  fetch: vi.fn((url) => {
    const token = new URL(url).searchParams.get("id_token");
    if (token === "valid-token") {
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify(tokenInfoPayload("zegenvs@gmail.com")),
      };
    }
    if (token === "other-token") {
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify(tokenInfoPayload("someone@example.com")),
      };
    }
    return {
      getResponseCode: () => 400,
      getContentText: () => "{}",
    };
  }),
};

// Document mock that records every appended paragraph so article
// generation can be asserted structurally.
const makeMockParagraph = (text) => ({
  text,
  heading: null,
  bold: null,
  images: [],
  getType: vi.fn(() => "PARAGRAPH"),
  asParagraph: vi.fn(function () {
    return this;
  }),
  setText: vi.fn(function (value) {
    this.text = value;
  }),
  setHeading: vi.fn(function (heading) {
    this.heading = heading;
    return this;
  }),
  editAsText: vi.fn(function () {
    const self = this;
    return {
      setBold: vi.fn((bold) => {
        self.bold = bold;
      }),
    };
  }),
  appendInlineImage: vi.fn(function (blob) {
    const image = {
      blob,
      width: null,
      height: null,
      setWidth: vi.fn(function (width) {
        this.width = width;
        return this;
      }),
      setHeight: vi.fn(function (height) {
        this.height = height;
        return this;
      }),
    };
    this.images.push(image);
    return image;
  }),
});

let mockDoc = null;
const makeMockDoc = () => {
  const body = {
    paragraphs: [],
    clear: vi.fn(function () {
      // The real Body.clear() leaves one empty paragraph behind.
      this.paragraphs = [makeMockParagraph("")];
    }),
    getNumChildren: vi.fn(function () {
      return this.paragraphs.length;
    }),
    getChild: vi.fn(function (index) {
      return this.paragraphs[index];
    }),
    appendParagraph: vi.fn(function (text) {
      // The real Body.appendParagraph requires a String (or Paragraph)
      // argument; calling it with no argument throws.
      if (typeof text !== "string") {
        throw new Error(
          "The parameters () don't match the method signature for DocumentApp.Body.appendParagraph."
        );
      }
      const paragraph = makeMockParagraph(text);
      this.paragraphs.push(paragraph);
      return paragraph;
    }),
  };
  return { body, getBody: vi.fn(() => body), saveAndClose: vi.fn() };
};

const mockDocumentApp = {
  ElementType: { PARAGRAPH: "PARAGRAPH" },
  // Mirrors the real Apps Script enum member names (HEADING2, not HEADING_2).
  ParagraphHeading: {
    NORMAL: "NORMAL",
    HEADING1: "HEADING1",
    HEADING2: "HEADING2",
    TITLE: "TITLE",
    SUBTITLE: "SUBTITLE",
  },
  openById: vi.fn(() => mockDoc),
};

let projectTriggers = [];
const mockScriptApp = {
  getProjectTriggers: vi.fn(() => [...projectTriggers]),
  newTrigger: vi.fn((handler) => ({
    timeBased: () => ({
      everyHours: () => ({
        create: () => {
          projectTriggers.push({ getHandlerFunction: () => handler });
        },
      }),
    }),
  })),
};

const AUTH_PROPERTIES = {
  AVAILABLE_GMAILS: "zegenvs@gmail.com",
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
};

// Stub the global objects before each test
beforeEach(async () => {
  vi.resetModules();
  scriptProperties = { ...AUTH_PROPERTIES };
  shareSheet = null;
  uuidCounter = 0;
  mockDoc = makeMockDoc();
  projectTriggers = [];
  vi.stubGlobal("SpreadsheetApp", mockSpreadsheetApp);
  vi.stubGlobal("ContentService", mockContentService);
  vi.stubGlobal("PropertiesService", mockPropertiesService);
  vi.stubGlobal("Utilities", mockUtilities);
  vi.stubGlobal("UrlFetchApp", mockUrlFetchApp);
  vi.stubGlobal("DocumentApp", mockDocumentApp);
  vi.stubGlobal("ScriptApp", mockScriptApp);

  const module = await import("../src/Code.js");
  doGet = module.doGet;
  doPost = module.doPost;
  convertSheetDataToObjects = module.convertSheetDataToObjects;
  calculateAge = module.calculateAge;
  generateArticle = module.generateArticle;
  syncArticleFromSheet = module.syncArticleFromSheet;
  buildArticleBlocks = module.buildArticleBlocks;
});

describe("doGet", () => {
  beforeEach(() => {
    // Reset mocks to their default state before each test
    vi.clearAllMocks();
    mockSpreadsheet.getSheetByName.mockImplementation((name) => {
      if (name === "list") {
        return mockSheet;
      }
      if (name === "share_sessions") {
        return shareSheet;
      }
      return null;
    });
    setMockSheetData(testData.normalSheetData);
  });

  it("should return JSON with TEXT MIME type", () => {
    const e = { parameter: { id_token: "valid-token" } };
    const result = doGet(e);
    const parsedResult = JSON.parse(result.content);

    expect(parsedResult).toHaveLength(2);
    expect(parsedResult[0].id).toBe(1);
    expect(result.mimeType).toBe(mockContentService.MimeType.TEXT);
  });

  it("should return a 404 error if the sheet is not found", () => {
    mockSpreadsheet.getSheetByName.mockReturnValue(null);
    const e = { parameter: { id_token: "valid-token" } };
    const result = doGet(e);
    const parsedError = JSON.parse(result.content);

    expect(parsedError.error.code).toBe(404);
    expect(parsedError.error.message).toBe("Sheet 'list' not found.");
    expect(result.mimeType).toBe(mockContentService.MimeType.TEXT);
  });

  it("should run without error when called with a minimal event", () => {
    // The smallest event object a real authenticated HTTP request produces
    const result = doGet({ parameter: { id_token: "valid-token" } });
    const parsedResult = JSON.parse(result.content);
    expect(parsedResult).toHaveLength(2);
    expect(result.mimeType).toBe(mockContentService.MimeType.TEXT);
  });

  it("should handle an empty sheet (no data) and return an empty array", () => {
    setMockSheetData([]);
    const e = { parameter: { id_token: "valid-token" } };
    const result = doGet(e);
    const parsedResult = JSON.parse(result.content);
    expect(parsedResult).toEqual([]);
  });

  it("should handle a sheet with only headers and return an empty array", () => {
    setMockSheetData([testData.headers]);
    const e = { parameter: { id_token: "valid-token" } };
    const result = doGet(e);
    const parsedResult = JSON.parse(result.content);
    expect(parsedResult).toEqual([]);
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
    // Check that a valid date string is converted to an ISO string.
    expect(result[1].completed_at).toBe("2024-01-15T10:00:00.000Z");
  });

  it("should handle boundary values correctly", () => {
    const result = convertSheetDataToObjects(
      testData.boundarySheetData.map((row) => [...row])
    );
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("A");
    // Check that a valid date string is converted to an ISO string.
    expect(result[0].completed_at).toBe("2023-01-01T00:00:00.000Z");
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

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty array", []],
    ["an array with one empty row", [[]]],
  ])("should return an empty array when input is %s", (name, input) => {
    const result = convertSheetDataToObjects(input);
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
    // Should be the ISO string representation of the fake Date
    expect(result[0].completed_at).toBe(fakeNow.toISOString());

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

  it("should handle varied header casing and spacing", () => {
    const dataWithVariedHeaders = [
      [
        " ID ",
        "Category",
        "TARGET_AGE",
        "  TITLE",
        "note  ",
        "IMAGE_URL",
        "Completed",
        "completed_at",
      ],
      [
        1,
        "Test",
        40,
        "Header Test",
        "Note",
        "http://example.com",
        true,
        "2024-01-01T00:00:00.000Z",
      ],
    ];
    const result = convertSheetDataToObjects(dataWithVariedHeaders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].category).toBe("Test");
    expect(result[0].target_age).toBe(40);
    expect(result[0].title).toBe("Header Test");
    expect(result[0].image_url).toBe("http://example.com");
    expect(result[0].completed).toBe(true);
    expect(result[0].completed_at).toBe("2024-01-01T00:00:00.000Z");
  });

  it("should correctly parse various truthy values for 'completed'", () => {
    const data = [
      testData.headers,
      [1, "C", 30, "T1", "N", "", true, ""],
      [2, "C", 30, "T2", "N", "", "true", ""],
      [3, "C", 30, "T3", "N", "", "TRUE", ""],
      [4, "C", 30, "T4", "N", "", 1, ""],
      [5, "C", 30, "T5", "N", "", "1", ""],
      [6, "C", 30, "T6", "N", "", "yes", ""],
    ];
    const result = convertSheetDataToObjects(data);
    expect(result.every((item) => item.completed === true)).toBe(true);
  });

  it("should correctly handle Date objects for 'completed_at'", () => {
    const date = new Date("2024-01-20T12:00:00.000Z");
    const data = [
      testData.headers,
      [1, "C", 30, "T1", "N", "", true, date],
    ];
    const result = convertSheetDataToObjects(data);
    expect(result[0].completed_at).toBe(date.toISOString());
  });

  it("should override a future Date object with the current time", () => {
    const fakeNow = new Date("2024-08-01T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const futureDate = new Date("2099-01-01T00:00:00.000Z");
    const data = [
      testData.headers,
      [1, "C", 30, "T1", "N", "", true, futureDate], // `completed` is true
    ];
    const result = convertSheetDataToObjects(data);

    // If completed is true, a future date is invalid, so it should be replaced by now.
    expect(result[0].completed_at).toBe(fakeNow.toISOString());

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

describe("doGet authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scriptProperties = { ...AUTH_PROPERTIES };
    setMockSheetData(testData.normalSheetData);
  });

  it("rejects requests without credentials", () => {
    const result = doGet({ parameter: {} });
    const parsed = JSON.parse(result.content);
    expect(parsed.error.code).toBe(401);
    expect(parsed.error.message).toBe("missing id token");
  });

  it("does not skip auth when the DEBUG property is true", () => {
    scriptProperties = { ...AUTH_PROPERTIES, DEBUG: "true" };
    const read = doGet({ parameter: {} });
    expect(JSON.parse(read.content).error.code).toBe(401);
    const write = doPost({
      postData: { contents: JSON.stringify({ action: "delete_item", id: 1 }) },
    });
    expect(JSON.parse(write.content).error.code).toBe(401);
    // The unauthenticated write must not have deleted anything.
    expect(mockSheet.data).toHaveLength(3);
  });

  it("rejects an invalid id token", () => {
    const result = doGet({ parameter: { id_token: "bogus" } });
    const parsed = JSON.parse(result.content);
    expect(parsed.error.code).toBe(401);
    expect(parsed.error.message).toBe("token verification failed");
  });

  it("rejects a forbidden email with 403", () => {
    const result = doGet({ parameter: { id_token: "other-token" } });
    const parsed = JSON.parse(result.content);
    expect(parsed.error.code).toBe(403);
    expect(parsed.error.message).toBe("forbidden email");
  });

  it("accepts a valid id token", () => {
    const result = doGet({ parameter: { id_token: "valid-token" } });
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it("accepts an id token from the Authorization header", () => {
    const result = doGet({
      parameter: {},
      headers: { Authorization: "Bearer valid-token" },
    });
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("issues and revokes share sessions for the owner only", () => {
    const denied = doGet({ parameter: { action: "issue_share" } });
    expect(JSON.parse(denied.content).error.code).toBe(401);

    const issued = doGet({
      parameter: { action: "issue_share", id_token: "valid-token" },
    });
    const issuedBody = JSON.parse(issued.content);
    expect(issuedBody.share_token).toBeTruthy();
    expect(issuedBody.expires_at).toBeTruthy();

    const viaShare = doGet({ parameter: { share_token: issuedBody.share_token } });
    expect(JSON.parse(viaShare.content)).toHaveLength(2);

    const revoked = doGet({
      parameter: { action: "revoke_share", id_token: "valid-token" },
    });
    expect(JSON.parse(revoked.content)).toEqual({ revoked: true });

    const afterRevoke = doGet({ parameter: { share_token: issuedBody.share_token } });
    expect(JSON.parse(afterRevoke.content).error.code).toBe(401);
  });

  it("rejects an unknown share token", () => {
    const result = doGet({ parameter: { share_token: "no-such-token" } });
    expect(JSON.parse(result.content).error.code).toBe(401);
  });
});

describe("doGet owner sessions", () => {
  let ownerSheet = null;

  beforeEach(() => {
    vi.clearAllMocks();
    scriptProperties = { ...AUTH_PROPERTIES };
    setMockSheetData(testData.normalSheetData);
    ownerSheet = null;
    mockSpreadsheet.getSheetByName.mockImplementation((name) => {
      if (name === "list") return mockSheet;
      if (name === "share_sessions") return shareSheet;
      if (name === "owner_sessions") return ownerSheet;
      return null;
    });
    mockSpreadsheet.insertSheet.mockImplementation((name) => {
      if (name === "owner_sessions") {
        ownerSheet = makeSheet([]);
        return ownerSheet;
      }
      shareSheet = makeSheet([]);
      return shareSheet;
    });
  });

  const exchange = () =>
    JSON.parse(
      doGet({ parameter: { action: "exchange_session", id_token: "valid-token" } }).content
    );

  it("exchanges a Google ID token for a 30-day owner session", () => {
    const before = Date.now();
    const issued = exchange();
    expect(issued.session_token).toBeTruthy();
    expect(Date.parse(issued.expires_at) - before).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(ownerSheet.data[1][0]).not.toBe(issued.session_token);

    const viaSession = doGet({ parameter: { session_token: issued.session_token } });
    expect(JSON.parse(viaSession.content)).toHaveLength(2);
  });

  it("keeps the previous owner session valid when issuing a new one", () => {
    const first = exchange();
    const second = exchange();
    expect(second.session_token).toBeTruthy();
    expect(second.session_token).not.toBe(first.session_token);

    const viaFirst = doGet({ parameter: { session_token: first.session_token } });
    expect(JSON.parse(viaFirst.content)).toHaveLength(2);

    const viaSecond = doGet({ parameter: { session_token: second.session_token } });
    expect(JSON.parse(viaSecond.content)).toHaveLength(2);
  });

  it("rejects the exchange without a valid ID token", () => {
    const result = doGet({ parameter: { action: "exchange_session" } });
    expect(JSON.parse(result.content).error.code).toBe(401);
  });

  it("rejects an unknown session token", () => {
    const result = doGet({ parameter: { session_token: "no-such-token" } });
    const parsed = JSON.parse(result.content);
    expect(parsed.error.code).toBe(401);
    expect(parsed.error.message).toBe("session expired or invalid");
  });

  it("revokes the session on revoke_session (logout)", () => {
    const issued = exchange();
    const revoked = doGet({
      parameter: { action: "revoke_session", session_token: issued.session_token },
    });
    expect(JSON.parse(revoked.content)).toEqual({ revoked: true });
    const after = doGet({ parameter: { session_token: issued.session_token } });
    expect(JSON.parse(after.content).error.code).toBe(401);
  });

  it("lets an owner session issue share links", () => {
    const issued = exchange();
    const share = doGet({
      parameter: { action: "issue_share", session_token: issued.session_token },
    });
    expect(JSON.parse(share.content).share_token).toBeTruthy();
  });

  it("lets an owner session write via doPost", () => {
    const issued = exchange();
    const result = doPost({
      postData: {
        contents: JSON.stringify({
          action: "update_item",
          session_token: issued.session_token,
          item: { id: 1, title: "セッション経由の更新" },
        }),
      },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
  });
});

describe("doPost", () => {
  const post = (body) =>
    doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } });

  beforeEach(() => {
    vi.clearAllMocks();
    setMockSheetData(testData.normalSheetData);
  });

  it("rejects an invalid JSON body", () => {
    const result = post("{not json");
    expect(JSON.parse(result.content).error.code).toBe(400);
  });

  it("rejects an unknown action", () => {
    const result = post({ action: "explode", id_token: "valid-token" });
    expect(JSON.parse(result.content).error.code).toBe(400);
  });

  it("requires auth", () => {
    const result = post({ action: "delete_item", id: 1 });
    expect(JSON.parse(result.content).error.code).toBe(401);
  });

  it("updates editable fields of an existing item", () => {
    const result = post({
      action: "update_item",
      id_token: "valid-token",
      item: { id: 1, title: "新しいタイトル", note: "更新メモ", next_action: "予約する" },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    const row = mockSheet.data[1];
    expect(row[3]).toBe("新しいタイトル");
    expect(row[4]).toBe("更新メモ");
    // Management headers are appended automatically (after extra_field).
    expect(mockSheet.data[0]).toContain("next_action");
    expect(row[mockSheet.data[0].indexOf("next_action")]).toBe("予約する");
  });

  it("marks an item completed and stamps completed_at", () => {
    const fakeNow = new Date("2026-11-07T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);
    const result = post({ action: "update_item", id_token: "valid-token", item: { id: 1, completed: true } });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    const row = mockSheet.data[1];
    expect(row[6]).toBe(true);
    expect(row[7]).toBe(fakeNow.toISOString());
    vi.useRealTimers();
  });

  it("clears completed_at when an item is uncompleted", () => {
    const result = post({ action: "update_item", id_token: "valid-token", item: { id: 2, completed: false } });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 2 });
    const row = mockSheet.data[2];
    expect(row[6]).toBe(false);
    expect(row[7]).toBe("");
  });

  it("returns 404 when updating a missing item", () => {
    const result = post({ action: "update_item", id_token: "valid-token", item: { id: 999, title: "x" } });
    expect(JSON.parse(result.content).error.code).toBe(404);
  });

  it("adds an item with the next id", () => {
    const result = post({
      action: "add_item",
      id_token: "valid-token",
      item: { title: "追加アイテム", category: "場所・旅行", target_age: 50 },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 3 });
    const row = mockSheet.data[3];
    expect(row[0]).toBe(3);
    expect(row[3]).toBe("追加アイテム");
    expect(row[6]).toBe(false);
  });

  it("deletes an item", () => {
    const result = post({ action: "delete_item", id_token: "valid-token", id: 1 });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    expect(mockSheet.data).toHaveLength(2);
    expect(mockSheet.data[1][0]).toBe(2);
  });

  it("returns 404 when deleting a missing item", () => {
    const result = post({ action: "delete_item", id_token: "valid-token", id: 999 });
    expect(JSON.parse(result.content).error.code).toBe(404);
  });

  it("writes through a share token", () => {
    const issued = doGet({
      parameter: { action: "issue_share", id_token: "valid-token" },
    });
    const token = JSON.parse(issued.content).share_token;
    const result = post({
      action: "update_item",
      share_token: token,
      item: { id: 1, progress: "半分進んだ" },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    const row = mockSheet.data[1];
    expect(row[mockSheet.data[0].indexOf("progress")]).toBe("半分進んだ");
  });

  it("updates the status field of an existing item", () => {
    const result = post({
      action: "update_item",
      id_token: "valid-token",
      item: { id: 1, status: "in_progress" },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    const row = mockSheet.data[1];
    expect(mockSheet.data[0]).toContain("status");
    expect(row[mockSheet.data[0].indexOf("status")]).toBe("in_progress");
  });

  it("stores an unknown status value as an empty string", () => {
    const result = post({
      action: "update_item",
      id_token: "valid-token",
      item: { id: 1, status: "doing" },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    const row = mockSheet.data[1];
    expect(row[mockSheet.data[0].indexOf("status")]).toBe("");
  });

  it("adds an item with a status", () => {
    const result = post({
      action: "add_item",
      id_token: "valid-token",
      item: { title: "進行中の項目", status: "in_progress" },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 3 });
    const row = mockSheet.data[3];
    expect(row[mockSheet.data[0].indexOf("status")]).toBe("in_progress");
  });
});

describe("convertSheetDataToObjects management fields", () => {
  it("parses next_action and progress as trimmed strings", () => {
    const data = [
      [...testData.headers, "next_action", "progress"],
      [1, "C", 50, "T", "N", "", false, "", "x", "  予約する  ", "  途中  "],
    ];
    const result = convertSheetDataToObjects(data);
    expect(result[0].next_action).toBe("予約する");
    expect(result[0].progress).toBe("途中");
  });

  it("parses status as a trimmed string", () => {
    const data = [
      [...testData.headers, "status"],
      [1, "C", 50, "T", "N", "", false, "", "x", "  in_progress  "],
    ];
    const result = convertSheetDataToObjects(data);
    expect(result[0].status).toBe("in_progress");
  });

  it("parses article_order as an integer or null", () => {
    const data = [
      [...testData.headers, "article_order"],
      [1, "C", 50, "T", "N", "", false, "", "x", 12],
      [2, "C", 50, "T", "N", "", false, "", "x", ""],
    ];
    const result = convertSheetDataToObjects(data);
    expect(result[0].article_order).toBe(12);
    expect(result[1].article_order).toBeNull();
  });
});

describe("article generation", () => {
  const articleHeaders = [
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
  const articleSheetData = [
    articleHeaders,
    [2, "Health", 50, "運動系の趣味を作る", "", "https://lh3.example/2.jpg", false, "", "", "", "", 2],
    [1, "Health", 40, "体重を痩せる", "メモです", "https://lh3.example/1.jpg", false, "", "", "", "in_progress", 1],
    [3, "Something else", 70, "遺言書を作る", "ノートです", "https://lh3.example/3.jpg", true, "2023-10-26T15:00:00.000Z", "", "", "", 3],
    [4, "謎カテゴリ", 50, "行き先不明", "", "", false, "", "", "", "", ""],
  ];

  const post = (body) =>
    doPost({ postData: { contents: JSON.stringify(body) } });

  beforeEach(() => {
    vi.clearAllMocks();
    setMockSheetData(articleSheetData);
    scriptProperties.ARTICLE_DOC_ID = "article-doc-1";
    const originalFetch = mockUrlFetchApp.fetch.getMockImplementation();
    mockUrlFetchApp.fetch.mockImplementation((url) => {
      if (String(url).includes("lh3.example")) {
        return { getBlob: () => ({ image: url }) };
      }
      return originalFetch(url);
    });
  });

  it("builds the article blocks in sheet order with status and completion marks", () => {
    const items = convertSheetDataToObjects(articleSheetData);
    const blocks = buildArticleBlocks(items, new Date("2026-11-15T00:00:00.000Z"));
    const summary = blocks.map((block) =>
      block.kind === "image" ? ["image", block.url] : [block.kind, block.text]
    );
    expect(summary).toEqual([
      ["paragraph", "[[タグ：暮らし]]"],
      ["title", "死ぬまでにやりたいことリスト"],
      ["paragraph", "「死ぬまでにやりたいこと」を4個、書き出しています。目標の年齢はあくまで目安で、順番に縛られず、できそうなものから叶えていく前提です。"],
      ["paragraph", "これまでは専用ページでタイル状に並べて公開していましたが、これからはブログ記事として公開することにしました。達成したり、新しく思いついたりしたときに、この記事を更新していきます。"],
      ["paragraph", "2026年11月現在、達成できたのは4個のうち1つだけです。"],
      ["heading", "Health"],
      ["paragraph", "[[目次]]"],
      ["itemTitle", "体重を痩せる"],
      ["paragraph", "目標：40歳台／仕掛り中"],
      ["paragraph", "[[アンカーリンク]]"],
      ["image", "https://lh3.example/1.jpg"],
      ["paragraph", "メモです"],
      ["itemTitle", "運動系の趣味を作る"],
      ["paragraph", "目標：50歳台"],
      ["paragraph", "[[アンカーリンク]]"],
      ["image", "https://lh3.example/2.jpg"],
      ["heading", "Relationships"],
      ["paragraph", "[[目次]]"],
      ["heading", "Finance"],
      ["paragraph", "[[目次]]"],
      ["heading", "Career"],
      ["paragraph", "[[目次]]"],
      ["heading", "Interests"],
      ["paragraph", "[[目次]]"],
      ["heading", "Something else"],
      ["paragraph", "[[目次]]"],
      ["itemTitle", "行き先不明"],
      ["paragraph", "目標：50歳台"],
      ["paragraph", "[[アンカーリンク]]"],
      ["heading", "達成したもの"],
      ["paragraph", "[[目次]]"],
      ["itemTitle", "遺言書を作る"],
      ["paragraph", "目標：70歳台／達成済み（2023年10月27日）"],
      ["paragraph", "[[アンカーリンク]]"],
      ["paragraph", "[[画像グレーアウト]]"],
      ["image", "https://lh3.example/3.jpg"],
      ["paragraph", "ノートです"],
      ["paragraph", "どれか一つでも多く叶えられるよう、ときどき見返していきます。"],
    ]);
  });

  it("writes the generated blocks into the document", () => {
    const result = generateArticle();
    expect(result.ok).toBe(true);
    expect(result.items).toBe(4);

    const paragraphs = mockDoc.body.paragraphs;
    // The empty paragraph left by clear() is reused for the first block,
    // so the document does not start with a blank paragraph.
    expect(paragraphs[0].text).toBe("[[タグ：暮らし]]");
    expect(
      paragraphs.every((p) => p.text !== "" || p.images.length > 0)
    ).toBe(true);
    const title = paragraphs.find((p) => p.text === "死ぬまでにやりたいことリスト");
    expect(title.heading).toBe("TITLE");
    const heading = paragraphs.find((p) => p.text === "Health");
    expect(heading.heading).toBe("HEADING2");
    const itemTitle = paragraphs.find((p) => p.text === "体重を痩せる");
    expect(itemTitle.bold).toBe(true);
    const meta = paragraphs.find((p) => p.text === "目標：40歳台／仕掛り中");
    expect(meta.bold).toBe(false);
    const imageParagraph = paragraphs.find((p) => p.images.length > 0);
    expect(imageParagraph.images[0].width).toBe(468);
    expect(imageParagraph.images[0].height).toBe(468);
    expect(mockDoc.saveAndClose).toHaveBeenCalled();
    expect(scriptProperties.ARTICLE_SYNC_HASH).toBeTruthy();
  });

  it("throws when ARTICLE_DOC_ID is not set", () => {
    delete scriptProperties.ARTICLE_DOC_ID;
    expect(() => generateArticle()).toThrow("ARTICLE_DOC_ID");
    expect(syncArticleFromSheet()).toEqual({
      ok: false,
      reason: "ARTICLE_DOC_ID script property is not set",
    });
  });

  it("regenerates only when the sheet data changed", () => {
    expect(syncArticleFromSheet()).toEqual({ ok: true, regenerated: true });
    expect(syncArticleFromSheet()).toEqual({ ok: true, regenerated: false });
  });

  it("runs generation through doPost actions and installs the hourly trigger once", () => {
    const generated = post({ action: "generate_article", id_token: "valid-token" });
    expect(JSON.parse(generated.content).ok).toBe(true);

    const first = post({ action: "sync_article", id_token: "valid-token" });
    expect(JSON.parse(first.content)).toEqual({
      ok: true,
      regenerated: false,
      triggerInstalled: true,
    });

    const second = post({ action: "sync_article", id_token: "valid-token" });
    expect(JSON.parse(second.content)).toEqual({
      ok: true,
      regenerated: false,
      triggerInstalled: false,
    });
  });

  it("returns a 500 error from doPost when ARTICLE_DOC_ID is missing", () => {
    delete scriptProperties.ARTICLE_DOC_ID;
    const result = post({ action: "generate_article", id_token: "valid-token" });
    expect(JSON.parse(result.content).error.code).toBe(500);
  });
});
