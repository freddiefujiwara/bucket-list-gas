# Bucket List API

This is the backend API for the Bucket List application. It serves data from a Google Sheet as a simple JSON API.

This API is built with Google Apps Script and uses a Google Sheet as its database, providing a simple, serverless backend solution.

## Features

- **Get Bucket List Data**: Fetches all items from the bucket list stored in a Google Sheet.
- **Data Normalization**: Cleans up and formats the data. For example, it trims text, validates URLs, and sets default values.
- **Dynamic Age Calculation**: Automatically calculates and normalizes the `target_age` field based on a specific birth date.
- **JSONP Support**: Includes a `callback` parameter for JSONP requests to work around cross-domain issues if needed.

## Tech Stack

- **Google Apps Script**: The main platform for running the backend logic.
- **Google Sheets**: Used as a simple database.
- **Node.js**: For development tools, testing, and deployment.
- **Vitest**: A testing framework for running unit tests.
- **clasp**: The official command-line tool for Google Apps Script, used for deploying the code.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (which includes npm)
- A Google Account

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up `clasp`:**
    This tool lets you manage your Google Apps Script projects from the command line.
    ```bash
    # Install clasp globally if you don't have it
    npm install -g @google/clasp

    # Log in to your Google account
    clasp login
    ```

4.  **Create a Google Apps Script project:**
    You can either create a new project or connect to an existing one.
    ```bash
    # Create a new project and link it
    clasp create --title "Bucket List API"
    ```

5.  **Set up the Google Sheet:**
    - Create a new Google Sheet.
    - Add headers in the first row. The required headers are: `id`, `title`, `category`, `target_age`, `completed`, `completed_at`, `image_url`, and `note`.
    - Get the **Spreadsheet ID** from its URL:
      `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

## Configuration

The API needs to know which Google Sheet to use as its data source.

-   Open the `src/Code.js` file.
-   Find the `SPREADSHEET_ID` variable and replace its value with your own sheet ID.

## Development

### Running Tests

This project uses Vitest for testing. To run the tests:
```bash
npm test
```
This command runs all tests and shows a coverage report.

### Deployment

To deploy the API to Google Apps Script:
```bash
npm run deploy
```
This command first builds the code to make it compatible with Google Apps Script and then pushes it using `clasp`. After deploying, `clasp` will provide you with a URL for your web app.

## API Usage

The API provides one main endpoint.

- **Endpoint**: `https://script.google.com/macros/s/AKfycbwUF0Lt3OG5kE0IqTyrkciEcUFIXZULI7aM-xJtR_4nrvqOSlIOVKADtFolAvSwFko6Vw/exec`
- **Method**: `GET`
- **Description**: Returns all items from the bucket list.

**Example Request:**
```
GET https://script.google.com/macros/s/AKfycbwUF0Lt3OG5kE0IqTyrkciEcUFIXZULI7aM-xJtR_4nrvqOSlIOVKADtFolAvSwFko6Vw/exec
```

**Example Response:**
```json
[
  {
    "id": 1,
    "target_age": 40,
    "completed": true,
    "image_url": "https://example.com/image.jpg",
    "category": "Travel",
    "title": "Visit Japan",
    "note": "Explore Tokyo and Kyoto.",
    "completed_at": "2023-10-27T10:00:00.000Z"
  },
  {
    "id": 2,
    "target_age": 50,
    "completed": false,
    "image_url": "",
    "category": "Skill",
    "title": "Learn to play the guitar",
    "note": "",
    "completed_at": null
  }
]
```

## OpenAPI Specification

This repository includes an OpenAPI 3.0 specification in `openapi.yaml` at the
repository root. Use it to generate clients, validate requests, or document the
API.

- **Spec file**: `openapi.yaml`
- **Server URL**: `https://script.google.com/macros/s/AKfycbwUF0Lt3OG5kE0IqTyrkciEcUFIXZULI7aM-xJtR_4nrvqOSlIOVKADtFolAvSwFko6Vw/exec`
- **JSONP support**: Add the optional `callback` query parameter when needed.

## Relationship with the Frontend

This API serves as the backend for the "Bucket List" web application. The frontend fetches data from this API to display the bucket list to the user.

- **Frontend Repository**: [freddiefujiwara/bucket-list](https://github.com/freddiefujiwara/bucket-list/tree/main)

This separation allows the frontend and backend to be developed and deployed independently.
