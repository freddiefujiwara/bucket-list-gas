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

  completed: (() => {
    // Use a Set for efficient and readable lookups of truthy string values.
    const truthy = new Set(["true", "1", "yes"]);
    return (v) => v === true || truthy.has(safeTrim(v).toLowerCase());
  })(),

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
  next_action: parse.string,
  progress: parse.string,
  completed_at: parse.completed_at,
};

/**
 * Converts spreadsheet data (2D array) into an array of objects.
 * The first row of the data is used as keys for the objects.
 * @param {any[][]} data - The 2D array from sheet.getValues().
 * @returns {Object[]} An array of objects.
 */
export function convertSheetDataToObjects(data) {
  // Guard against non-array or empty inputs.
  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }
  // Use destructuring for a non-destructive way to get headers and rows.
  const [headerRow, ...rows] = data;
  if (!headerRow) return [];

  // Normalize headers to be robust against variations.
  const normalizedHeaders = headerRow.map((h) => safeTrim(h).toLowerCase());

  const now = new Date();
  const nowISO = now.toISOString();
  const actualAge = calculateAge(BIRTH_DATE, now);
  const normalizedTargetAge = Math.floor(actualAge / 10) * 10;
  // Pass only primitive, pre-calculated values to the context.
  const context = { normalizedTargetAge };

  return rows.map((row) => {
    const obj = normalizedHeaders.reduce((acc, header, index) => {
      const value = row[index];
      const parser = headerToParserMap[header] || parse.default;
      acc[header] = parser(value, context);
      return acc;
    }, {});

    // Post-processing to enforce consistency.
    if (obj.completed) {
      // A valid completed_at must be a non-future ISO string.
      // String comparison works for ISO 8601 format.
      if (!obj.completed_at || obj.completed_at > nowISO) {
        obj.completed_at = nowISO;
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
  // Use MimeType.TEXT as MimeType.JSON may not be available.
  // setHeader is also not reliably available on TextOutput.
  return ContentService.createTextOutput(JSON.stringify(errorObject)).setMimeType(
    ContentService.MimeType.TEXT
  );
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.TEXT
  );
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

// --- Script properties & environment separation ---
// When the SPREADSHEET_ID script property is set, it wins over the built-in
// production ID above, so a standalone staging project can serve a dummy
// copy of the spreadsheet (same scheme as health-gas).

const getScriptProperties_ = () => {
  if (typeof PropertiesService === "undefined" || !PropertiesService.getScriptProperties) {
    return null;
  }
  return PropertiesService.getScriptProperties();
};

const getScriptProperty_ = (key) => {
  const properties = getScriptProperties_();
  if (!properties || !properties.getProperty) {
    return "";
  }
  return properties.getProperty(key) || "";
};

const getSpreadsheet_ = () =>
  SpreadsheetApp.openById(getScriptProperty_("SPREADSHEET_ID") || SPREADSHEET_ID);

const isDebugMode_ = () => getScriptProperty_("DEBUG") === "true";

// --- Authentication (same scheme as health-gas / asset-gas) ---
// Script Properties required:
//   AVAILABLE_GMAILS: comma-separated emails allowed to use the app
//   GOOGLE_OAUTH_CLIENT_ID: OAuth client ID used to verify ID tokens
//   DEBUG: when "true", authentication is skipped (for local checks only)

const extractIdToken_ = (e) => {
  const headers = (e && e.headers) || {};
  const auth = headers.Authorization || headers.authorization || "";
  const bearerMatch = String(auth).match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1];
  }
  return (e && e.parameter && e.parameter.id_token) || "";
};

const getAllowedEmails_ = () =>
  getScriptProperty_("AVAILABLE_GMAILS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

const verifyGoogleIdTokenOrThrow_ = (idToken) => {
  if (!idToken) {
    throw new Error("missing id token");
  }
  const oauthClientId = getScriptProperty_("GOOGLE_OAUTH_CLIENT_ID");
  if (!oauthClientId) {
    throw new Error("missing GOOGLE_OAUTH_CLIENT_ID");
  }
  const response = UrlFetchApp.fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error("token verification failed");
  }
  const payload = JSON.parse(response.getContentText());
  const validIssuer =
    payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com";
  if (!validIssuer) {
    throw new Error("invalid iss");
  }
  if (payload.aud !== oauthClientId) {
    throw new Error("invalid aud");
  }
  const expSeconds = Number(payload.exp || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expSeconds) || expSeconds <= nowSeconds) {
    throw new Error("token expired");
  }
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  if (!emailVerified) {
    throw new Error("email not verified");
  }
  const email = String(payload.email || "").toLowerCase();
  if (!email) {
    throw new Error("missing email");
  }
  if (!getAllowedEmails_().includes(email)) {
    throw new Error("forbidden email");
  }
  return { email, sub: payload.sub };
};

// --- Temporary share sessions ---
// A logged-in owner can issue a URL token that grants full access (read and
// write, owner-equivalent like alarm) for SHARE_TTL_SECONDS without a Google
// account. Sessions are stored in a dedicated sheet (token hashes only,
// never raw tokens), which doubles as an audit log.

const SHARE_SHEET_NAME = "share_sessions";
const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;
const SHARE_HEADERS = [
  "token_hash",
  "issued_at",
  "expires_at",
  "revoked_at",
  "access_count",
  "last_accessed_at",
];

const getShareSheet_ = () => {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SHARE_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHARE_SHEET_NAME);
    sheet.appendRow(SHARE_HEADERS);
  }
  return sheet;
};

const hashShareToken_ = (token) =>
  Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token))
    .map((byte) => ((byte % 256) + 256) % 256)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const readShareRows_ = () => {
  const sheet = getShareSheet_();
  const values = sheet.getDataRange().getValues();
  return { sheet, values };
};

const shareCellIso_ = (value) => {
  if (!value) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
};

const revokeActiveShareSessions_ = (nowIso) => {
  const { sheet, values } = readShareRows_();
  values.forEach((row, index) => {
    if (index === 0) {
      return;
    }
    const revokedAt = shareCellIso_(row[3]);
    const expiresAt = shareCellIso_(row[2]);
    if (!revokedAt && expiresAt && expiresAt > nowIso) {
      sheet.getRange(index + 1, 4).setValue(nowIso);
    }
  });
};

const issueShareSession_ = () => {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + SHARE_TTL_SECONDS * 1000).toISOString();
  revokeActiveShareSessions_(nowIso);
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
  getShareSheet_().appendRow([hashShareToken_(token), nowIso, expiresIso, "", 0, ""]);
  return {
    share_token: token,
    issued_at: nowIso,
    expires_at: expiresIso,
    ttl_seconds: SHARE_TTL_SECONDS,
  };
};

const revokeShareSession_ = () => {
  revokeActiveShareSessions_(new Date().toISOString());
  return { revoked: true };
};

const validateShareToken_ = (token) => {
  if (!token) {
    return null;
  }
  const hash = hashShareToken_(token);
  const { sheet, values } = readShareRows_();
  const nowIso = new Date().toISOString();
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (row[0] !== hash) {
      continue;
    }
    if (shareCellIso_(row[3])) {
      return null;
    }
    const expiresAt = shareCellIso_(row[2]);
    if (!expiresAt || expiresAt <= nowIso) {
      return null;
    }
    sheet.getRange(index + 1, 5).setValue(Number(row[4] || 0) + 1);
    sheet.getRange(index + 1, 6).setValue(nowIso);
    return { expires_at: expiresAt };
  }
  return null;
};

/**
 * Authorizes a request. Returns a share session object (possibly empty) on
 * success and throws an Error on failure. Share tokens are owner-equivalent.
 * `credentials` is { idToken, shareToken }.
 */
const authorizeOrThrow_ = ({ idToken, shareToken }) => {
  if (isDebugMode_()) {
    return {};
  }
  if (shareToken) {
    const session = validateShareToken_(shareToken);
    if (!session) {
      throw new Error("share session expired or invalid");
    }
    return session;
  }
  verifyGoogleIdTokenOrThrow_(idToken);
  return {};
};

const authErrorResponse_ = (error) => {
  const message = (error && error.message) || "unauthorized";
  const status = message === "forbidden email" ? 403 : 401;
  return createErrorResponse(message, status);
};

// --- List sheet access ---

const getListSheet_ = () => getSpreadsheet_().getSheetByName("list");

const readListValues_ = (sheet) => {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 0 || lastCol <= 0) {
    return [];
  }
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
};

const normalizedHeadersOf_ = (values) =>
  (values[0] || []).map((h) => safeTrim(h).toLowerCase());

// Management columns are appended automatically on first write so the
// production sheet does not need a manual schema change beforehand.
const MANAGEMENT_HEADERS = ["next_action", "progress"];

const ensureManagementHeaders_ = (sheet, values) => {
  const headers = normalizedHeadersOf_(values);
  MANAGEMENT_HEADERS.forEach((name) => {
    if (!headers.includes(name)) {
      sheet.getRange(1, headers.length + 1).setValue(name);
      headers.push(name);
    }
  });
  return headers;
};

const findRowIndexById_ = (values, headers, id) => {
  const idColumn = headers.indexOf("id");
  if (idColumn < 0) {
    return -1;
  }
  for (let index = 1; index < values.length; index += 1) {
    if (parse.id(values[index][idColumn]) === id) {
      return index;
    }
  }
  return -1;
};

const EDITABLE_FIELDS = [
  "title",
  "category",
  "target_age",
  "note",
  "image_url",
  "next_action",
  "progress",
];

const hasField_ = (item, field) =>
  Object.prototype.hasOwnProperty.call(item, field) && item[field] !== undefined;

const sanitizeFieldValue_ = (field, value) => {
  if (field === "target_age") {
    const age = parseInt(value, 10);
    return isNaN(age) ? "" : age;
  }
  return safeTrim(value);
};

const updateItem_ = (sheet, item) => {
  const values = readListValues_(sheet);
  const headers = ensureManagementHeaders_(sheet, values);
  const id = parse.id(item && item.id);
  const rowIndex = id === null ? -1 : findRowIndexById_(values, headers, id);
  if (rowIndex < 0) {
    return null;
  }
  const sheetRow = rowIndex + 1;
  const setCell = (field, value) => {
    const column = headers.indexOf(field);
    if (column >= 0) {
      sheet.getRange(sheetRow, column + 1).setValue(value);
    }
  };

  EDITABLE_FIELDS.forEach((field) => {
    if (hasField_(item, field)) {
      setCell(field, sanitizeFieldValue_(field, item[field]));
    }
  });

  if (hasField_(item, "completed") || hasField_(item, "completed_at")) {
    const completedColumn = headers.indexOf("completed");
    const existingCompleted =
      completedColumn >= 0 ? parse.completed(values[rowIndex][completedColumn]) : false;
    const completed = hasField_(item, "completed")
      ? parse.completed(item.completed)
      : existingCompleted;
    if (hasField_(item, "completed")) {
      setCell("completed", completed);
    }
    if (!completed) {
      setCell("completed_at", "");
    } else if (hasField_(item, "completed_at")) {
      const parsed = parse.completed_at(item.completed_at);
      setCell("completed_at", parsed || new Date().toISOString());
    } else if (hasField_(item, "completed") && !existingCompleted) {
      setCell("completed_at", new Date().toISOString());
    }
  }
  return { ok: true, id };
};

const addItem_ = (sheet, item) => {
  const values = readListValues_(sheet);
  const headers = ensureManagementHeaders_(sheet, values);
  const idColumn = headers.indexOf("id");
  let maxId = 0;
  values.forEach((row, index) => {
    if (index === 0) {
      return;
    }
    const value = idColumn >= 0 ? parse.id(row[idColumn]) : null;
    if (value !== null && value > maxId) {
      maxId = value;
    }
  });
  const newId = maxId + 1;
  const completed = hasField_(item, "completed") ? parse.completed(item.completed) : false;
  const row = headers.map((header) => {
    if (header === "id") {
      return newId;
    }
    if (header === "completed") {
      return completed;
    }
    if (header === "completed_at") {
      if (!completed) {
        return "";
      }
      return parse.completed_at(item.completed_at) || new Date().toISOString();
    }
    if (hasField_(item, header)) {
      return sanitizeFieldValue_(header, item[header]);
    }
    return "";
  });
  sheet.appendRow(row);
  return { ok: true, id: newId };
};

const deleteItem_ = (sheet, rawId) => {
  const values = readListValues_(sheet);
  const headers = normalizedHeadersOf_(values);
  const id = parse.id(rawId);
  const rowIndex = id === null ? -1 : findRowIndexById_(values, headers, id);
  if (rowIndex < 0) {
    return null;
  }
  sheet.deleteRow(rowIndex + 1);
  return { ok: true, id };
};

/**
 * Handles HTTP GET requests.
 * @param {Object} e - The event parameter containing request details.
 * @returns {GoogleAppsScript.Content.TextOutput} The JSON or JSONP output.
 */
export function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action === "issue_share" || params.action === "revoke_share") {
    try {
      verifyGoogleIdTokenOrThrow_(extractIdToken_(e));
    } catch (error) {
      return authErrorResponse_(error);
    }
    return createJsonResponse(
      params.action === "issue_share" ? issueShareSession_() : revokeShareSession_()
    );
  }

  try {
    authorizeOrThrow_({
      idToken: extractIdToken_(e),
      shareToken: params.share_token || "",
    });
  } catch (error) {
    return authErrorResponse_(error);
  }

  const list = getListSheet_();

  if (!list) {
    return createErrorResponse("Sheet 'list' not found.", 404);
  }

  const result = convertSheetDataToObjects(readListValues_(list));
  // Handle cases where `e` is undefined (e.g., direct execution from editor).
  const callback = params.callback;

  if (isValidCallback(callback)) {
    // Valid JSONP request
    return ContentService.createTextOutput(
      `${callback}(${JSON.stringify(result)});`
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    // Standard JSON response, using TEXT as JSON is not a standard MimeType.
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.TEXT
    );
  }
}

/**
 * Handles HTTP POST requests (management writes).
 * The body is JSON: { action, id_token?, share_token?, item?, id? } with
 * action one of "update_item", "add_item", "delete_item".
 * @param {Object} e - The event parameter containing request details.
 * @returns {GoogleAppsScript.Content.TextOutput} The JSON output.
 */
export function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "");
  } catch (error) {
    return createErrorResponse("invalid JSON body", 400);
  }

  try {
    authorizeOrThrow_({
      idToken: body.id_token || extractIdToken_(e),
      shareToken: body.share_token || "",
    });
  } catch (error) {
    return authErrorResponse_(error);
  }

  const sheet = getListSheet_();
  if (!sheet) {
    return createErrorResponse("Sheet 'list' not found.", 404);
  }

  if (body.action === "update_item") {
    const result = updateItem_(sheet, body.item || {});
    return result
      ? createJsonResponse(result)
      : createErrorResponse("item not found", 404);
  }
  if (body.action === "add_item") {
    return createJsonResponse(addItem_(sheet, body.item || {}));
  }
  if (body.action === "delete_item") {
    const result = deleteItem_(sheet, body.id);
    return result
      ? createJsonResponse(result)
      : createErrorResponse("item not found", 404);
  }
  return createErrorResponse("unknown action", 400);
}
