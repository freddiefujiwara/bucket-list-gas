/**
 * This file contains mock data for tests, based on user-provided JSON.
 * The data is structured as 2D arrays to simulate the output of
 * `sheet.getDataRange().getValues()`, which is the format expected by
 * the `convertSheetDataToObjects` function.
 */

// Common headers based on the input JSON structure.
export const headers = [
  "id",
  "category",
  "target_age",
  "title",
  "note",
  "image_url",
  "completed",
  "completed_at",
  "extra_field", // Add a field that is not explicitly handled in the switch case
];

// --- 1. Normal Case Data ---
// A standard, well-formed dataset.
export const normalSheetData = [
  headers,
  [
    1,
    "場所・旅行",
    50,
    "沖縄に長期滞在したい",
    "旅行で何度も訪れている沖縄、いつも一週間くらいなので一ヶ月単位で滞在してみたいです",
    "data:image/jpeg;base64,/9j/4AAQSk.../Z", // Shortened for readability
    false,
    "",
    "extra1",
  ],
  [
    2,
    "スキル・学習",
    30,
    "新しいプログラミング言語を習득する",
    "Webフロントエンドの知識を深めるために、TypeScriptを学びたい。",
    "data:image/png;base64,iVBORw0KGgo...", // Shortened for readability
    true,
    "2024-01-15T10:00:00.000Z",
    "extra2",
  ],
];

// --- 2. Boundary Value Data ---
// Data that tests the edges of expected inputs.
export const boundarySheetData = [
  headers,
  // Case 1: Minimum values and empty strings
  [
    3,
    "", // Empty category
    0,  // Minimum target_age
    "A", // Single-character title
    "", // Empty note
    "", // Empty image_url
    true,
    "2023-01-01T00:00:00.000Z",
  ],
  // Case 2: Maximum plausible values and long strings
  [
    4,
    "趣味・創作",
    120, // High target_age
    "a".repeat(255), // Long title (255 chars)
    "b".repeat(1000), // Long note (1000 chars)
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", // 1x1 transparent gif
    false,
    "",
  ],
];

// --- 3. Abnormal / Edge Case Data ---
// Data designed to test how the function handles unexpected or malformed inputs.

// Case 1: A row with fewer columns than the header (simulates missing keys)
export const abnormalSheetDataShortRow = [
  headers,
  [
    5,
    "健康・運動",
    40,
    "毎朝のジョギングを習慣にする",
    // 'note', 'image_url', 'completed', 'completed_at' are missing.
  ],
];

// Case 2: Data with mismatched or unexpected types.
// The current `convertSheetDataToObjects` is robust and will convert these
// without errors, which is a valid test outcome.
export const dataTypeVarietyData = [
  headers,
  [
    "not-a-number", // id as an unparsable string
    null, // category as null
    "sixty", // target_age as string
    "データ型が混在したリスト",
    undefined, // note as undefined
    "not-a-base64-string",
    "false", // completed as string
    "2024-99-99", // Invalid date format string
  ],
];

// Case 3: A sheet with no data rows, only a header.
export const headerOnlySheetData = [headers];

// Case 4: A completely empty sheet.
export const emptySheetData = [];

// Case 5: A row that is completed but has no completed_at date.
export const completedWithNoDate = [
  headers,
  [
    7,
    "自己改善",
    25,
    "読書量を増やす",
    "月に4冊の本を読むことを目標にする。",
    "",
    true, // completed is true
    "",   // completed_at is empty
    "extra7"
  ],
];

// Case 6: A row with a future date for completed_at.
export const futureDateData = [
  headers,
  [
    8,
    "計画",
    40,
    "来年の旅行計画を立てる",
    "ヨーロッパ周遊を計画中。",
    "",
    false,
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
    "extra8"
  ],
];
