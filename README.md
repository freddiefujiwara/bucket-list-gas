# Google Sheet JSON API

This project is a simple web app built with Google Apps Script. It reads data from a Google Sheet and provides it as a JSON API.

This is useful for quickly creating a simple, free backend for small web projects.

## How it Works

- It uses a Google Sheet as a simple database.
- A Google Apps Script function `doGet(e)` runs when someone visits the app's URL.
- The script reads all the data from a specific sheet.
- It converts the data into a JSON format.
- It returns the JSON data. It can also return JSONP if you add a `callback` parameter to the URL.

## Setup

1.  **Clone the project:**
    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2.  **Install tools:**
    This project uses Node.js for testing and deployment. You need to install the dependencies.
    ```bash
    npm install
    ```

3.  **Set up `clasp` (Command Line Apps Script Projects):**
    `clasp` is the official tool for managing Google Apps Script projects.
    - If you don't have it, install it: `npm install -g @google/clasp`
    - Log in to your Google account: `clasp login`
    - Connect this project to a Google Apps Script project: `clasp create --title "My JSON API"` or `clasp clone <scriptId>` if you have an existing project.

4.  **Update the Spreadsheet ID:**
    - Create a new Google Sheet.
    - Put some data in it. The first row should be your headers (like `id`, `name`, `email`).
    - Get the ID of the sheet from its URL. The URL looks like this: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`.
    - Open `src/Code.js` and change the `SPREADSHEET_ID` variable to your sheet's ID.

## Testing

This project uses `vitest` for testing. The tests make sure the code works correctly without needing to connect to a real Google Sheet.

To run the tests:
```bash
npm test
```
This command will run all tests and show a code coverage report. The goal is to keep 100% coverage.

## Deployment

To deploy the script to your Google Apps Script project:

1.  **Build the code:**
    The code in `src/Code.js` uses modern JavaScript (ES Modules). Google Apps Script doesn't support this directly. A build step is needed to make it compatible.
    ```bash
    npm run build
    ```

2.  **Push to Google:**
    After building, use `clasp` to send your code to Google.
    ```bash
    npm run deploy
    ```
    This command runs the build and then `clasp push --force`.

After deploying, you will get a URL for your web app. You can visit that URL to see the JSON data from your sheet.
