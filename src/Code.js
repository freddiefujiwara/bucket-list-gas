const SPREADSHEET_ID = "1-ZPznr_lJfNU5tDBVuSEdcDigs1BC4Uu4LwkUL0bWEk";

/**
 * Converts spreadsheet data (2D array) into an array of objects.
 * The first row of the data is used as keys for the objects.
 * @param {any[][]} data - The 2D array from sheet.getDataRange().getValues().
 * @returns {Object[]} An array of objects.
 */
export function convertSheetDataToObjects(data) {
  const headers = data.shift() || [];
  return data.map((row) => {
    const normalizedObj = headers.reduce((obj, header, index) => {
      const value = row[index];

      // Assign a normalized value based on the header key
      switch (header) {
        case "id":
          const id = parseInt(value, 10);
          obj[header] = isNaN(id) ? null : id;
          break;
        case "target_age":
          let age = parseInt(value, 10);
          if (isNaN(age) || age < 0 || age > 100) {
            age = 0;
          }
          obj[header] = age;
          break;
        case "completed":
          obj[header] = String(value).toLowerCase() === "true";
          break;
        case "image_url":
          const url = String(value ?? "").trim();
          obj[header] =
            url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("data:image/")
              ? url
              : "";
          break;
        case "category":
        case "title":
        case "note":
          obj[header] = String(value ?? "").trim();
          break;
        case "completed_at":
          if (!value) {
            obj[header] = null;
            break;
          }
          const date = new Date(value);
          // A date is valid if it's a real date and not in the future.
          const isValidDate = !isNaN(date.getTime()) && date.getTime() <= new Date().getTime();
          obj[header] = isValidDate ? date : null;
          break;
        default:
          // For unspecified columns, just pass the value through.
          obj[header] = value;
          break;
      }
      return obj;
    }, {});

    // Enforce consistency between 'completed' and 'completed_at'
    if (normalizedObj.completed) {
      // If completed is true but date is missing, set default date.
      if (!normalizedObj.completed_at) {
        normalizedObj.completed_at = new Date();
      }
    } else {
      // If completed is false, date must be null.
      normalizedObj.completed_at = null;
    }

    return normalizedObj;
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
