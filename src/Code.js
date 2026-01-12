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
export function convertSheetDataToObjects(data) {
  const headers = data.shift() || [];
  const now = new Date(); // Use a single timestamp for the entire conversion process.
  const actualAge = calculateAge(BIRTH_DATE, now);
  const normalizedTargetAge = Math.floor(actualAge / 10) * 10;

  return data.map((row) => {
    const obj = headers.reduce((acc, header, index) => {
      const value = row[index];
      switch (header) {
        case "id":
          const id = parseInt(value, 10);
          acc[header] = isNaN(id) ? null : id;
          break;
        case "target_age":
          const ageValue = parseInt(value, 10);
          if (
            value == null || // Catches null and undefined
            isNaN(ageValue) || // Catches non-numeric strings like ""
            ageValue < normalizedTargetAge ||
            ageValue > 100
          ) {
            acc[header] = normalizedTargetAge;
          } else {
            acc[header] = ageValue;
          }
          break;
        case "completed":
          acc[header] = String(value).toLowerCase() === "true";
          break;
        case "image_url":
          const url = String(value ?? "").trim();
          acc[header] = /^(https?:\/\/|data:image\/)/.test(url) ? url : "";
          break;
        case "category":
        case "title":
        case "note":
          acc[header] = String(value ?? "").trim();
          break;
        case "completed_at":
          const date = new Date(value);
          acc[header] =
            !isNaN(date.getTime()) && date.getTime() <= now.getTime()
              ? date
              : null;
          break;
        default:
          acc[header] = value;
          break;
      }
      return acc;
    }, {});

    // Enforce consistency: `completed_at` is null if not completed,
    // or its valid value (or the current time) if it is.
    obj.completed_at = obj.completed ? obj.completed_at || now : null;

    return obj;
  });
}

/**
 * Handles HTTP GET requests.
 * @param {Object} e - The event parameter containing request details.
 * @returns {GoogleAppsScript.Content.TextOutput} The JSON or JSONP output.
 */
export function doGet(e) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const list = sheet.getSheetByName("list");
  const values = list.getDataRange().getValues();

  const result = convertSheetDataToObjects(values);
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JAVASCRIPT);

  const callback = e.parameter.callback;

  if (callback) {
    // JSONP response for callbacks
    output.setContent(`${callback}&&${callback}(${JSON.stringify(result)});`);
  } else {
    // Standard JSON response
    output.setContent(JSON.stringify(result));
  }

  return output;
}
