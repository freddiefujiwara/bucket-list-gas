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
    return row.reduce((obj, cell, index) => {
      obj[headers[index]] = cell;
      return obj;
    }, {});
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
