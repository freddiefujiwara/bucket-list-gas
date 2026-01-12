const SPREADSHEET_ID = "1-ZPznr_lJfNU5tDBVuSEdcDigs1BC4Uu4LwkUL0bWEk";
// Define the birth date in a way that is interpreted as Japan Standard Time (JST).
// Using T00:00:00+09:00 ensures it's treated as the start of the day in JST.
const BIRTH_DATE = new Date("1979-09-02T00:00:00+09:00");

/**
 * Calculates the full age based on a birth date and a current date.
 * @param {Date} birthDate - The date of birth.
 * @param {Date} nowDate - The current date.
 * @returns {number} The calculated full age.
 */
export function calculateAge(birthDate, nowDate) {
  const birthYear = birthDate.getFullYear();
  const birthMonth = birthDate.getMonth();
  const birthDay = birthDate.getDate();

  const nowYear = nowDate.getFullYear();
  const nowMonth = nowDate.getMonth();
  const nowDay = nowDate.getDate();

  let age = nowYear - birthYear;
  // If the birthday for this year has not occurred yet, subtract one year.
  if (nowMonth < birthMonth || (nowMonth === birthMonth && nowDay < birthDay)) {
    age--;
  }
  return age;
}

/**
 * Converts spreadsheet data (2D array) into an array of objects.
 * The first row of the data is used as keys for the objects.
 * @param {any[][]} data - The 2D array from sheet.getDataRange().getValues().
 * @returns {Object[]} An array of objects.
 */
// Helper function to safely stringify and trim a value.
const safeTrim = (v) => String(v ?? "").trim();

// --- Parsers for each data field ---

const parse = {
  id: (v) => {
    const id = parseInt(v, 10);
    return isNaN(id) ? null : id;
  },

  target_age: (v, { normalizedTargetAge }) => {
    const ageValue = parseInt(v, 10);
    if (
      v == null ||
      isNaN(ageValue) ||
      ageValue < normalizedTargetAge ||
      ageValue > 100
    ) {
      return normalizedTargetAge;
    }
    return Math.floor(ageValue / 10) * 10;
  },

  completed: (v) => {
    const s = safeTrim(String(v)).toLowerCase();
    return s === "true" || s === "1" || s === "yes" || v === true;
  },

  image_url: (v) => {
    const url = safeTrim(v);
    return /^(https?:\/\/|data:image\/)/.test(url) ? url : "";
  },

  string: (v) => safeTrim(v),

  completed_at: (v) => {
    if (v instanceof Date && !isNaN(v)) {
      return v.toISOString();
    }
    if (typeof v === "string" && v.trim()) {
      const date = new Date(v.trim());
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    return null;
  },

  default: (v) => v,
};

// Map headers to their respective parser functions.
const headerToParserMap = {
  id: parse.id,
  target_age: parse.target_age,
  completed: parse.completed,
  image_url: parse.image_url,
  category: parse.string,
  title: parse.string,
  note: parse.string,
  completed_at: parse.completed_at,
};

/**
 * Converts spreadsheet data (2D array) into an array of objects.
 * The first row of the data is used as keys for the objects.
 * @param {any[][]} data - The 2D array from sheet.getValues().
 * @returns {Object[]} An array of objects.
 */
export function convertSheetDataToObjects(data) {
  // Use destructuring for a non-destructive way to get headers and rows.
  const [headerRow, ...rows] = data;
  if (!headerRow) return [];

  // Normalize headers to be robust against variations.
  const normalizedHeaders = headerRow.map((h) => safeTrim(h).toLowerCase());

  const now = new Date();
  const actualAge = calculateAge(BIRTH_DATE, now);
  const normalizedTargetAge = Math.floor(actualAge / 10) * 10;
  const context = { now, normalizedTargetAge };

  return rows.map((row) => {
    const obj = normalizedHeaders.reduce((acc, header, index) => {
      const value = row[index];
      const parser = headerToParserMap[header] || parse.default;
      acc[header] = parser(value, context);
      return acc;
    }, {});

    // Post-processing to enforce consistency.
    if (obj.completed) {
      const completedDate = obj.completed_at ? new Date(obj.completed_at) : null;
      // If the date is invalid or in the future, override it.
      if (!completedDate || completedDate.getTime() > now.getTime()) {
        obj.completed_at = now.toISOString();
      }
    } else {
      // If not completed, completed_at must be null.
      obj.completed_at = null;
    }

    return obj;
  });
}

/**
 * Creates a JSON error response.
 * @param {string} message - The error message.
 * @param {number} statusCode - The HTTP status code.
 * @returns {GoogleAppsScript.Content.TextOutput} The JSON error output.
 */
function createErrorResponse(message, statusCode) {
  const errorObject = {
    error: {
      code: statusCode,
      message: message,
    },
  };
  return ContentService.createTextOutput(JSON.stringify(errorObject))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader("X-Content-Type-Options", "nosniff");
}

/**
 * Validates a JSONP callback function name.
 * @param {string} callback - The callback name to validate.
 * @returns {boolean} True if the callback name is valid, false otherwise.
 */
function isValidCallback(callback) {
  if (!callback || typeof callback !== "string") {
    return false;
  }
  // A stricter regex to ensure it's a valid JavaScript function name/path.
  return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(
    callback
  );
}

/**
 * Handles HTTP GET requests.
 * @param {Object} e - The event parameter containing request details.
 * @returns {GoogleAppsScript.Content.TextOutput} The JSON or JSONP output.
 */
export function doGet(e) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const list = sheet.getSheetByName("list");

  if (!list) {
    return createErrorResponse("Sheet 'list' not found.", 404);
  }

  const lastRow = list.getLastRow();
  const lastCol = list.getLastColumn();

  let values = [];
  // Only fetch data if the sheet is not empty.
  if (lastRow > 0 && lastCol > 0) {
    values = list.getRange(1, 1, lastRow, lastCol).getValues();
  }

  const result = convertSheetDataToObjects(values);
  const output = ContentService.createTextOutput();
  const callback = e.parameter.callback;

  if (isValidCallback(callback)) {
    // Valid JSONP request
    output
      .setContent(`${callback}(${JSON.stringify(result)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    // Standard JSON response
    output
      .setContent(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return output;
}
