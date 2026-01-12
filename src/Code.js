const SPREADSHEET_ID = "1-ZPznr_lJfNU5tDBVuSEdcDigs1BC4Uu4LwkUL0bWEk";
const sheet = SpreadsheetApp.openById(SPREADSHEET_ID);
const list = sheet.getSheetByName("list");

export function doGet(e) {
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JAVASCRIPT);
    const values = list.getDataRange().getValues();
    const headers = values.shift();
    const result = values.map((row) => {
        let data = {};
        row.map((column, index) => {
            data[headers[index]] = column;
        });
        return data;
    });
    if (e.parameter.callback === undefined) {
        output.setContent(JSON.stringify(result));
    } else {
        output.setContent(e.parameter.callback + "&&" + e.parameter.callback + "(" + JSON.stringify(result) + ");");
    }
    return output;
}
