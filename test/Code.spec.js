import { describe, it, expect, vi, beforeEach } from "vitest";

import * as testData from "./testData.js";

let doGet, doPost, convertSheetDataToObjects, calculateAge;

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

// Script properties: DEBUG mode by default so the pre-existing read tests
// run unauthenticated; auth tests replace this map.
let scriptProperties = { DEBUG: "true" };
const mockPropertiesService = {
  getScriptProperties: vi.fn(() => ({
    getProperty: vi.fn((key) => (key in scriptProperties ? scriptProperties[key] : null)),
  })),
};

let uuidCounter = 0;
const mockUtilities = {
  DigestAlgorithm: { SHA_256: "SHA_256" },
  computeDigest: vi.fn((algorithm, value) =>
    Array.from(String(value)).map((char) => char.charCodeAt(0))
  ),
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

const AUTH_PROPERTIES = {
  AVAILABLE_GMAILS: "zegenvs@gmail.com",
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
};

// Stub the global objects before each test
beforeEach(async () => {
  vi.resetModules();
  scriptProperties = { DEBUG: "true" };
  shareSheet = null;
  uuidCounter = 0;
  vi.stubGlobal("SpreadsheetApp", mockSpreadsheetApp);
  vi.stubGlobal("ContentService", mockContentService);
  vi.stubGlobal("PropertiesService", mockPropertiesService);
  vi.stubGlobal("Utilities", mockUtilities);
  vi.stubGlobal("UrlFetchApp", mockUrlFetchApp);

  const module = await import("../src/Code.js");
  doGet = module.doGet;
  doPost = module.doPost;
  convertSheetDataToObjects = module.convertSheetDataToObjects;
  calculateAge = module.calculateAge;
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

  it("should return JSON with TEXT MIME type when no callback is provided", () => {
    const e = { parameter: {} };
    const result = doGet(e);
    const parsedResult = JSON.parse(result.content);

    expect(parsedResult).toHaveLength(2);
    expect(parsedResult[0].id).toBe(1);
    expect(result.mimeType).toBe(mockContentService.MimeType.TEXT);
  });

  it("should return JSONP with a valid callback", () => {
    const callbackName = "myCallback";
    const e = { parameter: { callback: callbackName } };
    const result = doGet(e);

    expect(result.content.startsWith(`${callbackName}(`)).toBe(true);
    expect(result.content.endsWith(");")).toBe(true);
    expect(result.mimeType).toBe(mockContentService.MimeType.JAVASCRIPT);
  });

  it("should fall back to JSON with an invalid callback", () => {
    const invalidCallback = "invalid-callback;";
    const e = { parameter: { callback: invalidCallback } };
    const result = doGet(e);
    const parsedResult = JSON.parse(result.content);

    expect(parsedResult).toHaveLength(2);
    expect(result.mimeType).toBe(mockContentService.MimeType.TEXT);
  });

  it("should return a 404 error if the sheet is not found", () => {
    mockSpreadsheet.getSheetByName.mockReturnValue(null);
    const e = { parameter: {} };
    const result = doGet(e);
    const parsedError = JSON.parse(result.content);

    expect(parsedError.error.code).toBe(404);
    expect(parsedError.error.message).toBe("Sheet 'list' not found.");
    expect(result.mimeType).toBe(mockContentService.MimeType.TEXT);
  });

  it("should run without error when `e` is undefined", () => {
    // Simulates running from the Apps Script editor
    const result = doGet(undefined);
    const parsedResult = JSON.parse(result.content);
    expect(parsedResult).toHaveLength(2);
    expect(result.mimeType).toBe(mockContentService.MimeType.TEXT);
  });

  it("should handle an empty sheet (no data) and return an empty array", () => {
    setMockSheetData([]);
    const e = { parameter: {} };
    const result = doGet(e);
    const parsedResult = JSON.parse(result.content);
    expect(parsedResult).toEqual([]);
  });

  it("should handle a sheet with only headers and return an empty array", () => {
    setMockSheetData([testData.headers]);
    const e = { parameter: {} };
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
    const result = post({ action: "explode" });
    expect(JSON.parse(result.content).error.code).toBe(400);
  });

  it("requires auth when DEBUG is off", () => {
    scriptProperties = { ...AUTH_PROPERTIES };
    const result = post({ action: "delete_item", id: 1 });
    expect(JSON.parse(result.content).error.code).toBe(401);
  });

  it("updates editable fields of an existing item", () => {
    const result = post({
      action: "update_item",
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
    const result = post({ action: "update_item", item: { id: 1, completed: true } });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    const row = mockSheet.data[1];
    expect(row[6]).toBe(true);
    expect(row[7]).toBe(fakeNow.toISOString());
    vi.useRealTimers();
  });

  it("clears completed_at when an item is uncompleted", () => {
    const result = post({ action: "update_item", item: { id: 2, completed: false } });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 2 });
    const row = mockSheet.data[2];
    expect(row[6]).toBe(false);
    expect(row[7]).toBe("");
  });

  it("returns 404 when updating a missing item", () => {
    const result = post({ action: "update_item", item: { id: 999, title: "x" } });
    expect(JSON.parse(result.content).error.code).toBe(404);
  });

  it("adds an item with the next id", () => {
    const result = post({
      action: "add_item",
      item: { title: "追加アイテム", category: "場所・旅行", target_age: 50 },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 3 });
    const row = mockSheet.data[3];
    expect(row[0]).toBe(3);
    expect(row[3]).toBe("追加アイテム");
    expect(row[6]).toBe(false);
  });

  it("deletes an item", () => {
    const result = post({ action: "delete_item", id: 1 });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    expect(mockSheet.data).toHaveLength(2);
    expect(mockSheet.data[1][0]).toBe(2);
  });

  it("returns 404 when deleting a missing item", () => {
    const result = post({ action: "delete_item", id: 999 });
    expect(JSON.parse(result.content).error.code).toBe(404);
  });

  it("writes through a share token when DEBUG is off", () => {
    scriptProperties = { ...AUTH_PROPERTIES };
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
});
