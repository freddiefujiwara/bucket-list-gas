import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

import * as testData from "./testData.js";

// Abnormal-case tests: the inputs from outside this service are
// (a) spreadsheet cell values (getValues() can hand back short/long rows
// and unexpected types) and (b) the JSON request bodies the admin front
// end posts (fully user-controlled). A single deformed value must never
// take down the whole list response or a write; it degrades to the same
// "missing" value the parsers already produce for empty cells.
//
// The canonical deformed value below is { toString: [] }: JSON.parse can
// produce it ('{"toString":[]}'), and String() / parseInt() throw on it
// because neither toString nor valueOf yields a primitive.

let doGet, doPost, convertSheetDataToObjects, buildArticleBlocks;

const unstringifiable = () => ({ toString: [] });

const createMockTextOutput = (content = "") => ({
  content,
  mimeType: "",
  setMimeType: function (type) {
    this.mimeType = type;
    return this;
  },
});

const mockContentService = {
  createTextOutput: vi.fn((content) => createMockTextOutput(content)),
  MimeType: { JAVASCRIPT: "application/javascript", TEXT: "text/plain" },
};

// Sheet mock that stores rows verbatim (no JSON round-trip), so null
// rows and unstringifiable cell values survive into the code under test.
const makeSheet = (initialData) => ({
  data: initialData || [],
  getLastRow: vi.fn(function () {
    return this.data.length;
  }),
  getLastColumn: vi.fn(function () {
    return Array.isArray(this.data[0]) ? this.data[0].length : 0;
  }),
  getRange: vi.fn(function (row, column, numRows, numCols) {
    const self = this;
    return {
      getValues: vi.fn(() => {
        if (numRows === undefined) {
          return self.data.map((r) => (Array.isArray(r) ? [...r] : r));
        }
        return self.data
          .slice(row - 1, row - 1 + numRows)
          .map((r) =>
            Array.isArray(r) ? r.slice(column - 1, column - 1 + numCols) : r
          );
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
      getValues: vi.fn(() =>
        self.data.map((r) => (Array.isArray(r) ? [...r] : r))
      ),
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
const setMockSheetData = (data) => {
  mockSheet.data = data;
};

const mockSpreadsheet = {
  getSheetByName: vi.fn((name) => (name === "list" ? mockSheet : null)),
  insertSheet: vi.fn(() => makeSheet([])),
};
const mockSpreadsheetApp = { openById: vi.fn(() => mockSpreadsheet) };

let scriptProperties = {};
const mockPropertiesService = {
  getScriptProperties: vi.fn(() => ({
    getProperty: vi.fn((key) =>
      key in scriptProperties ? scriptProperties[key] : null
    ),
    setProperty: vi.fn((key, value) => {
      scriptProperties[key] = String(value);
    }),
  })),
};

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
  getUuid: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
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
        getContentText: () =>
          JSON.stringify(tokenInfoPayload("zegenvs@gmail.com")),
      };
    }
    return { getResponseCode: () => 400, getContentText: () => "{}" };
  }),
};

const AUTH_PROPERTIES = {
  AVAILABLE_GMAILS: "zegenvs@gmail.com",
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
};

beforeEach(async () => {
  vi.resetModules();
  scriptProperties = { ...AUTH_PROPERTIES };
  vi.stubGlobal("SpreadsheetApp", mockSpreadsheetApp);
  vi.stubGlobal("ContentService", mockContentService);
  vi.stubGlobal("PropertiesService", mockPropertiesService);
  vi.stubGlobal("Utilities", mockUtilities);
  vi.stubGlobal("UrlFetchApp", mockUrlFetchApp);

  const module = await import("../src/Code.js");
  doGet = module.doGet;
  doPost = module.doPost;
  convertSheetDataToObjects = module.convertSheetDataToObjects;
  buildArticleBlocks = module.buildArticleBlocks;
  setMockSheetData(testData.normalSheetData.map((row) => [...row]));
});

afterEach(() => {
  vi.useRealTimers();
});

const H = testData.headers;
// Column indexes within testData.headers.
const COL = {
  id: 0,
  category: 1,
  target_age: 2,
  title: 3,
  note: 4,
  image_url: 5,
  completed: 6,
  completed_at: 7,
};

const rowWith = (overrides) => {
  const row = [1, "C", 50, "T", "N", "", false, "", "x"];
  for (const [column, value] of Object.entries(overrides)) {
    row[COL[column]] = value;
  }
  return row;
};

describe("convertSheetDataToObjects with deformed rows", () => {
  it("survives null and scalar rows mixed with valid rows", () => {
    const data = [
      H,
      rowWith({ id: 1, title: "有効な行" }),
      null,
      42,
      "junk",
      rowWith({ id: 2, title: "もう一つの有効な行" }),
    ];
    const result = convertSheetDataToObjects(data);
    expect(result).toHaveLength(5);
    expect(result[0].title).toBe("有効な行");
    expect(result[4].title).toBe("もう一つの有効な行");
    // Deformed rows read as empty rows: every parsed field is "missing".
    for (const item of [result[1], result[2], result[3]]) {
      expect(item.id).toBeNull();
      expect(item.title).toBe("");
      expect(item.completed).toBe(false);
      expect(item.completed_at).toBeNull();
    }
  });

  it("reads an unstringifiable title cell as empty and keeps sibling rows", () => {
    const data = [
      H,
      rowWith({ id: 1, title: unstringifiable() }),
      rowWith({ id: 2, title: "無事な行" }),
    ];
    const result = convertSheetDataToObjects(data);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("");
    expect(result[1].title).toBe("無事な行");
  });

  it("reads unstringifiable category/completed/image_url cells without throwing", () => {
    const data = [
      H,
      rowWith({
        category: unstringifiable(),
        completed: unstringifiable(),
        image_url: unstringifiable(),
        note: unstringifiable(),
      }),
    ];
    const [item] = convertSheetDataToObjects(data);
    expect(item.category).toBe("");
    expect(item.note).toBe("");
    expect(item.image_url).toBe("");
    expect(item.completed).toBe(false);
    expect(item.completed_at).toBeNull();
  });

  it("survives an unstringifiable header cell and still parses other columns", () => {
    const headers = [...H];
    headers[COL.note] = unstringifiable();
    const result = convertSheetDataToObjects([headers, rowWith({ id: 7 })]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(7);
    expect(result[0].title).toBe("T");
  });

  it("survives a non-array header row", () => {
    const result = convertSheetDataToObjects(["id,title", rowWith({})]);
    expect(result).toHaveLength(1);
    expect(result[0].completed_at).toBeNull();
  });

  it("does not let an array cell invent an id or article_order", () => {
    const data = [
      [...H, "article_order"],
      [...rowWith({ id: [65] }), [12]],
    ];
    const [item] = convertSheetDataToObjects(data);
    expect(item.id).toBeNull();
    expect(item.article_order).toBeNull();
  });

  it("reads an unstringifiable id cell as null", () => {
    const [item] = convertSheetDataToObjects([
      H,
      rowWith({ id: unstringifiable() }),
    ]);
    expect(item.id).toBeNull();
  });

  it("falls back for array and unstringifiable target_age cells", () => {
    // Normalized target age at 2024-09-02 (age 45) is 40.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-09-02T10:00:00.000Z"));
    const data = [
      H,
      rowWith({ id: 1, target_age: [50] }),
      rowWith({ id: 2, target_age: unstringifiable() }),
      rowWith({ id: 3, target_age: true }),
    ];
    const result = convertSheetDataToObjects(data);
    expect(result.map((item) => item.target_age)).toEqual([40, 40, 40]);
  });

  it.each([
    ["2026-02-30"],
    ["2026/02/30"],
    ["2023-02-29"],
    ["2026-02-30T10:00:00.000Z"],
    ["2026-13-01"],
  ])("does not roll the non-existent date %s over to a different day", (value) => {
    const before = Date.now();
    const [item] = convertSheetDataToObjects([
      H,
      rowWith({ completed: true, completed_at: value }),
    ]);
    const after = Date.now();
    // A rejected date is "missing", and a completed item with a missing
    // date is stamped with the current time — never with the rolled-over
    // day the Date parser would invent (Mar 2, Jan 2027, ...).
    const stamped = Date.parse(item.completed_at);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(after + 1000);
  });

  it("keeps a real leap day in completed_at", () => {
    const [item] = convertSheetDataToObjects([
      H,
      rowWith({ completed: true, completed_at: "2024-02-29" }),
    ]);
    expect(item.completed_at).toBe("2024-02-29T00:00:00.000Z");
  });

  it("treats an invalid Date object and a numeric completed_at as missing", () => {
    // Both are rejected by the parser, and a completed item with a
    // missing date is stamped with the current time.
    for (const value of [new Date(NaN), 20240115]) {
      const before = Date.now();
      const [item] = convertSheetDataToObjects([
        H,
        rowWith({ completed: true, completed_at: value }),
      ]);
      const stamped = Date.parse(item.completed_at);
      expect(stamped).toBeGreaterThanOrEqual(before - 1000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it("keeps valid rows exact when one row is deformed in every cell", () => {
    const bad = rowWith({
      id: unstringifiable(),
      category: unstringifiable(),
      target_age: unstringifiable(),
      title: unstringifiable(),
      note: unstringifiable(),
      image_url: unstringifiable(),
      completed: unstringifiable(),
      completed_at: unstringifiable(),
    });
    const data = [H, rowWith({ id: 1, title: "前" }), bad, rowWith({ id: 3, title: "後" })];
    const result = convertSheetDataToObjects(data);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ id: 1, title: "前" });
    expect(result[2]).toMatchObject({ id: 3, title: "後" });
    expect(result[1].id).toBeNull();
    expect(result[1].title).toBe("");
  });
});

describe("buildArticleBlocks with deformed items", () => {
  const now = new Date("2026-11-15T00:00:00.000Z");

  it("builds the scaffolding for null and non-array item lists", () => {
    for (const items of [null, undefined, "junk", 42]) {
      const blocks = buildArticleBlocks(items, now);
      expect(blocks[0]).toEqual({ kind: "paragraph", text: "[[タグ：暮らし]]" });
      expect(blocks.some((b) => b.kind === "itemTitle")).toBe(false);
    }
  });

  it("skips null and scalar entries and counts only real items", () => {
    const items = [
      null,
      42,
      "junk",
      {
        id: 1,
        category: "Health",
        target_age: 50,
        title: "本物の項目",
        note: "",
        image_url: "",
        completed: false,
        completed_at: null,
        status: "",
        article_order: 1,
      },
    ];
    const blocks = buildArticleBlocks(items, now);
    const titles = blocks.filter((b) => b.kind === "itemTitle");
    expect(titles).toEqual([{ kind: "itemTitle", text: "本物の項目" }]);
    const summary = blocks.find(
      (b) => b.kind === "paragraph" && b.text.includes("書き出しています")
    );
    expect(summary.text).toContain("を1個、");
  });

  it("shows a completed item without a date when completed_at is not a date", () => {
    for (const completedAt of ["not-a-date", "2026-02-30", 42, unstringifiable()]) {
      const blocks = buildArticleBlocks(
        [
          {
            id: 1,
            category: "Health",
            target_age: 50,
            title: "達成した項目",
            note: "",
            image_url: "",
            completed: true,
            completed_at: completedAt,
            status: "",
            article_order: 1,
          },
        ],
        now
      );
      const meta = blocks.find(
        (b) => b.kind === "paragraph" && b.text.startsWith("目標")
      );
      expect(meta.text).toBe("目標：50歳台／達成済み");
    }
  });
});

describe("doPost / doGet with deformed request bodies", () => {
  const post = (raw) => doPost({ postData: { contents: raw } });
  const postJson = (body) => post(JSON.stringify(body));

  it("answers a JSON error for a null JSON body instead of throwing", () => {
    const result = post("null");
    const parsed = JSON.parse(result.content);
    expect(parsed.error.code).toBe(401);
  });

  it.each([["42"], ["[1,2]"], ['"x"'], ["true"]])(
    "answers a JSON error for the scalar/array body %s",
    (raw) => {
      const parsed = JSON.parse(post(raw).content);
      expect(parsed.error.code).toBe(401);
    }
  );

  it("stores an unstringifiable title as empty on update_item", () => {
    const result = post(
      '{"action":"update_item","id_token":"valid-token","item":{"id":1,"title":{"toString":[]}}}'
    );
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    expect(mockSheet.data[1][COL.title]).toBe("");
  });

  it("answers 404 for an unstringifiable id on update_item", () => {
    const result = post(
      '{"action":"update_item","id_token":"valid-token","item":{"id":{"toString":[]},"title":"x"}}'
    );
    expect(JSON.parse(result.content).error.code).toBe(404);
  });

  it("does not delete an item when delete_item's id is an array", () => {
    const result = postJson({
      action: "delete_item",
      id_token: "valid-token",
      id: [1],
    });
    expect(JSON.parse(result.content).error.code).toBe(404);
    expect(mockSheet.data).toHaveLength(3);
  });

  it("stores an empty target_age when update_item's target_age is an array", () => {
    const result = postJson({
      action: "update_item",
      id_token: "valid-token",
      item: { id: 1, target_age: [50] },
    });
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    expect(mockSheet.data[1][COL.target_age]).toBe("");
  });

  it("treats an unstringifiable completed flag as not completed", () => {
    const result = post(
      '{"action":"update_item","id_token":"valid-token","item":{"id":1,"completed":{"toString":[]}}}'
    );
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    expect(mockSheet.data[1][COL.completed]).toBe(false);
  });

  it("stores an unstringifiable completed_at as a fresh stamp, not a crash", () => {
    const result = post(
      '{"action":"update_item","id_token":"valid-token","item":{"id":1,"completed":true,"completed_at":{"toString":[]}}}'
    );
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 1 });
    const stored = mockSheet.data[1][COL.completed_at];
    expect(typeof stored).toBe("string");
    expect(stored).not.toBe("");
  });

  it("adds an item with an unstringifiable title stored as empty", () => {
    const result = post(
      '{"action":"add_item","id_token":"valid-token","item":{"title":{"toString":[]}}}'
    );
    expect(JSON.parse(result.content)).toEqual({ ok: true, id: 3 });
    expect(mockSheet.data[3][COL.title]).toBe("");
  });

  it("answers 404 without throwing when item is a string", () => {
    const result = postJson({
      action: "update_item",
      id_token: "valid-token",
      item: "junk",
    });
    expect(JSON.parse(result.content).error.code).toBe(404);
  });

  it("serves the list even when the sheet holds deformed rows", () => {
    setMockSheetData([
      H,
      rowWith({ id: 1, title: unstringifiable() }),
      null,
      rowWith({ id: 2, title: "無事な行" }),
    ]);
    const result = doGet({ parameter: { id_token: "valid-token" } });
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].title).toBe("");
    expect(parsed[2].title).toBe("無事な行");
  });

  it("always answers with JSON for arbitrary request bodies", () => {
    fc.assert(
      fc.property(
        fc.record({
          action: fc.constantFrom(
            "update_item",
            "add_item",
            "delete_item",
            "unknown",
            undefined
          ),
          item: fc.jsonValue(),
          id: fc.jsonValue(),
          withToken: fc.boolean(),
        }),
        ({ action, item, id, withToken }) => {
          setMockSheetData(testData.normalSheetData.map((row) => [...row]));
          const body = { item, id };
          if (action !== undefined) body.action = action;
          if (withToken) body.id_token = "valid-token";
          const result = postJson(body);
          const parsed = JSON.parse(result.content);
          expect(
            parsed.ok === true ||
              (parsed.error && typeof parsed.error.code === "number")
          ).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
