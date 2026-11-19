# Device Information Manager

A web application for viewing and maintaining `deviceInformation.json`, the central record of firmware and app versions for each test device and port.

You select a **Device** and a **Port**, edit the six properties of the matching record, and save. Each save becomes a commit to the JSON file in GitHub. GitHub stays the single source of truth: nothing is stored in a database or in the browser.

> **Live data file:** [`VFTV-Testing/Configs` → `Main` → `AVSB_GEN3_Configs/deviceInformation.json`](https://github.com/VFTV-Testing/Configs/blob/Main/AVSB_GEN3_Configs/deviceInformation.json).
> The `deviceInformation.json` in *this* repository is only a snapshot used by the tests.

## Two ways to run it

| | **A. GitHub Pages (browser-only)**, used by the team | **B. Node server** |
|---|---|---|
| Hosting | Static site on GitHub Pages, no server | Any Node host, VM or Docker |
| Who can save | Each user signs in with **their own** GitHub token. Only collaborators with **Write** access to `Configs` can save. | One server-side credential (GitHub App or token). Optional sign-in for users. |
| Commit author | The signed-in user | The App or bot, with `Requested by: <user>` in the message |
| Settings | [`.env.pages`](.env.pages): public, no secrets | `.env` / environment variables: secret |
| Build | `npm run build:pages` → `dist-pages/` | `npm run build` → `dist/` + `dist-server/` |

Both modes run the **same** shared logic, so validation, record-level merging, conflict detection and format-preserving commits behave identically.

### Option A: GitHub Pages setup (one time)

1. In this repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
   *If Pages can't be enabled because the repository is private on a free plan, see [Pages on a private repository](#pages-on-a-private-repository).*
2. Push to `main`. The [Deploy to GitHub Pages](.github/workflows/pages.yml) workflow runs the tests, builds the site and publishes it at `https://vftv-testing.github.io/Device_Info_Utility/`.
3. For each person who should edit, go to the **Configs** repository → **Settings → Collaborators → Add people** and give them **Write** access.
4. Each user opens the site, creates a fine-grained token (the sign-in page shows the steps: resource owner **VFTV-Testing**, repository **Configs** only, **Contents: Read and write**), and signs in.

Notes:
- A token is sent only to `api.github.com`, enforced by the page's Content-Security-Policy. It's kept in the browser tab, or on the device if the user ticks *Remember me*. **Sign out** deletes it.
- Users without write access can still sign in and view the data, but the app shows a read-only banner and refuses saves.
- To test browser-only mode locally, run `npm run dev:pages` and open http://localhost:5173.

### "Sign in with GitHub" (instead of personal tokens)

```
Page (GitHub Pages) ──► github.com: "Authorize VFTV Device Info Manager" ──► back to page with a one-time code
        │                                                                              │
        └──── code ──► sign-in helper (auth-helper/, holds the client secret) ──► GitHub ──► user token (8 h, auto-renewed)
```

A static page can't keep a client secret, so a very small **sign-in helper** ([auth-helper/handler.ts](auth-helper/handler.ts)) does only the code→token exchange. It stores and logs nothing, and only answers pages listed in `ALLOWED_ORIGINS`. Everything else still runs in the browser, and commits are authored by the signed-in user.

1. **GitHub App** (*VFTV Device Info Manager*, owned by VFTV-Testing): Repository permission **Contents: Read and write**, installed on **Configs** only, with **Expire user authorization tokens** turned on. The redirect URIs are `http://localhost:5173/` and `https://vftv-testing.github.io/Device_Info_Utility/`.
2. **Helper settings:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (secret) and `ALLOWED_ORIGINS` (for example `https://vftv-testing.github.io`).
   - Local: put `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and optionally `OAUTH_ALLOWED_ORIGINS` in `.env`, then run `npm run auth-helper` (port 8787).
   - Cloudflare Workers: run `npm run build:auth-helper`, create a Worker with `dist-auth-helper/worker.js`, and set the three variables (the secret as an encrypted Secret). Any host that runs a fetch-style handler works the same way.
3. **Site settings** (public): `VITE_OAUTH_CLIENT_ID` and `VITE_AUTH_HELPER_URL` in `.env.pages`. For a local test, use the git-ignored `.env.pages.local`. When they're unset, the page falls back to personal access tokens.

Local test: run `npm run auth-helper` and `npm run dev:pages`, then open http://localhost:5173 (it must be `localhost` to match the redirect URI).

### Pages on a private repository

GitHub Pages for a **private** repository needs a paid plan (GitHub Pro, Team or Enterprise). On a free plan you can either:
- move the site to a **public** repository (the site contains no secrets, only the code and the public `.env.pages` settings), or
- publish the built `dist-pages/` folder from the public `Configs` repository, for example on a `gh-pages` branch.

---

## Contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Quick start (local)](#quick-start-local)
4. [Connecting to GitHub securely](#connecting-to-github-securely)
5. [Configuration reference](#configuration-reference)
6. [Deployment](#deployment)
7. [Using the app](#using-the-app)
8. [Data rules](#data-rules)
9. [Development, build and tests](#development-build-and-tests)
10. [Project structure](#project-structure)
11. [Troubleshooting](#troubleshooting)

---

## Features

| Area | What it does |
|---|---|
| **Device Manager** | Independent, searchable **Device** and **Port** dropdowns, built from the JSON keys at runtime with nothing hard-coded. Loads the exact matching record, shows its full identifier, and lets you edit and save it or reset, cancel or delete. |
| **All Devices** | Searchable, sortable, paginated table of every record. Filters by Device, Port, Hardware and Country. Each row has Edit and Delete actions. |
| **JSON Preview** | Read-only, syntax-highlighted view of the current file, with in-file search, copy, record count and sync status. |
| **Add New Device** | Builds a new identifier from *Device + Port + remaining segments* and shows a live preview of the key. Duplicates are refused, and you can copy values from an existing record. |
| **Bulk import** | Upload a JSON file, validate it, preview new and changed records, then choose **Add only** or **Update existing**. Each import is one commit. |
| **Pipeline** | A visible placeholder dropdown (*Select Pipeline (Coming Soon)*). It is not used anywhere in the business logic. |
| **Safety** | Record-level conflict detection, commits that are checked against the file's SHA with automatic retry, success shown only after GitHub confirms the commit, warnings for unsaved changes, and a confirmation step for every delete. |
| **UX** | Light and dark themes, responsive layout down to phone width, loading skeletons, empty states, toasts, and keyboard-accessible dropdowns and dialogs. |

---

## How it works

```
 Browser (React SPA)                       Node server (Express)                     GitHub
 ──────────────────                        ─────────────────────                     ──────
 Device / Port dropdowns   GET  /api/devices  ─►  read file + SHA  ───────────────►  contents API
 Edit form                 PUT  /api/devices/records
                           { key, base, values } ─► 1. fetch LATEST file + SHA  ◄──
                                                     2. check record == base (else 409 conflict)
                                                     3. change only that record
                                                     4. validate whole file
                                                     5. commit with SHA  ─────────►  new commit
                                                     6. stale SHA? retry from step 1
 "Saved to GitHub" ◄─────────── commit SHA + fresh data ◄────────────────────────────
```

- **The browser never sees a GitHub credential.** The token or GitHub App key exists only on the server, read from environment variables.
- **Every write is record-level.** The browser sends the record's key, the values you originally loaded (`base`), and your new values. The server applies that one change to the *latest* file from GitHub, so concurrent edits to other records are never lost.
- **Conflicts are detected, never overwritten.** If someone else changed the same record after you loaded it, the save is rejected. The app then shows your values next to the latest ones and lets you reload or review before saving again.
- **The file's formatting is preserved:** 4-space indentation, key order, and the trailing newline. A save changes only the lines that changed, so Git diffs stay small and readable.

> **Why not GitHub Pages?** A static site can't keep a write credential secret. Every write must go through a server you control, which is this app's Node backend. The frontend and backend are served together by one Node process.

---

## Quick start (local)

Requirements: **Node.js 20.19+** (22 or 24 LTS recommended) and npm.

```bash
npm install

# Option 1 — try it immediately against the JSON file in this folder (no GitHub needed)
#   PowerShell:
$env:STORAGE_MODE="local"; npm run dev
#   bash / zsh:
STORAGE_MODE=local npm run dev

# Option 2 — real GitHub mode
cp .env.example .env        # then fill in GITHUB_OWNER, GITHUB_REPO and credentials
npm run dev
```

Open **http://localhost:5173**. `npm run dev` starts the API on port 3001 and the Vite dev server on port 5173, and proxies `/api` between them.

> `STORAGE_MODE=local` is for development and demos only. It writes to the file on disk with the same validation and conflict rules, **but makes no Git commit**. The header always shows which data source is in use.

---

## Connecting to GitHub securely

The server needs **Contents: Read and write** permission on the repository that holds `deviceInformation.json`, and nothing else. Choose one of these two options.

### Option A: GitHub App (recommended for teams)

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**. Use your organization's settings if the repo belongs to an org.
   - Webhook: uncheck **Active**.
   - Repository permissions: **Contents → Read and write**. Leave every other permission at *No access*.
2. Create the App and note its **App ID**.
3. Under **Private keys → Generate a private key**, download the `.pem` file. Store it outside the repository. `*.pem` is git-ignored.
4. Click **Install App** and install it on **only this repository**. The number at the end of the installation URL (`…/installations/12345678`) is the **Installation ID**.
5. Configure the server:
   ```env
   GITHUB_APP_ID=123456
   GITHUB_APP_INSTALLATION_ID=12345678
   GITHUB_APP_PRIVATE_KEY_PATH=/secure/path/device-info-manager.pem
   ```

The server signs a short-lived JWT, exchanges it for a 1-hour installation token, and caches that token only in memory. Commits appear as made by the App.

### Option B: fine-grained personal access token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Resource owner: the org or user that owns the repo. Repository access: **Only select repositories → this repo**.
3. Permissions: **Repository → Contents → Read and write**.
4. Set `GITHUB_TOKEN=github_pat_…` on the server.

Commits will appear as the token owner. A bot or service account is better than a personal account.

### Branch protection

If the target branch requires pull requests, direct commits from the app are rejected and the app shows a permission error. Either add the App or bot account to the branch-protection bypass list, or point `GITHUB_BRANCH` at an unprotected data branch.

### Who can use the app

The app commits on behalf of anyone who can reach it, so control access to it:

- **Simplest:** set `APP_BASIC_AUTH_USER` and `APP_BASIC_AUTH_PASSWORD`. Every page and API call then needs a sign-in, and the user name is recorded in each commit message (`Requested by: …`).
- **Company SSO:** deploy behind your identity-aware proxy or SSO gateway (Azure App Service Authentication, Cloudflare Access, oauth2-proxy and similar).
- Always serve the app over **HTTPS** in production.

---

## Configuration reference

All settings are server-side environment variables. In development they can also go in a git-ignored `.env` file. See [.env.example](.env.example) for the annotated template.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `STORAGE_MODE` | no | `github` | `github` for real use, `local` for development |
| `PORT` | no | `3001` | Server port |
| `GITHUB_OWNER` | yes (github) | | Organization or user that owns the repo |
| `GITHUB_REPO` | yes (github) | | Repository name |
| `GITHUB_BRANCH` | no | `main` | Branch to read from and commit to |
| `GITHUB_FILE_PATH` | no | `deviceInformation.json` | Path of the file in the repo. Nested paths are allowed. |
| `GITHUB_API_URL` | no | `https://api.github.com` | Change for GitHub Enterprise Server |
| `GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` | option A | | GitHub App credentials |
| `GITHUB_APP_PRIVATE_KEY_PATH` or `GITHUB_APP_PRIVATE_KEY` | option A | | App private key, as a file path or inline with `\n` for newlines |
| `GITHUB_TOKEN` | option B | | Fine-grained PAT |
| `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` | no | | Override the committer identity |
| `APP_BASIC_AUTH_USER` / `APP_BASIC_AUTH_PASSWORD` | no | | Require sign-in for the whole app |
| `LOCAL_DATA_FILE` | no | `deviceInformation.json` | File used in `local` mode |
| `STATIC_DIR` | no | `dist` | Built frontend directory |

The server refuses to start, with a clear list of what's missing, if the configuration is incomplete. None of these values reach the browser. `GET /api/config` returns only the repo location shown in the header.

---

## Deployment

The app runs as **one Node process** that serves both the API and the built frontend.

### Any Node host (VM, Azure App Service, Render, Railway…)

```bash
npm ci
npm run build          # typecheck + frontend (dist/) + server (dist-server/)
npm prune --omit=dev   # optional: the runtime only needs express
npm start              # node dist-server/index.js
```

Set the environment variables from the [configuration reference](#configuration-reference) in the host's settings, not in files committed to Git. The health check endpoint is `GET /api/health`.

### Docker

```bash
docker build -t device-info-manager .
docker run -p 3001:3001 --env-file .env \
  -v /secure/keys/app.pem:/keys/app.pem:ro -e GITHUB_APP_PRIVATE_KEY_PATH=/keys/app.pem \
  device-info-manager
```

The image builds and **runs the test suite** during the build, then runs as the non-root `node` user.

### CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs the tests and the production build on every push and pull request.

---

## Using the app

### Device Manager (main screen)

1. **Device:** pick a device. The list holds the unique `X101-GER`, `X106-IE`… prefixes found in the file.
2. **Port:** becomes active once a device is chosen and lists *only that device's* ports. Changing the device always clears the port.
3. **Pipeline:** a placeholder for a future feature. It has no effect.
4. The matching record's **full identifier** appears above an editable form with the six fields.
   - Changed fields are marked and show their previous value. The header shows **Unsaved Changes**.
   - **Save changes** commits to GitHub. The toast links to the commit.
   - **Reset changes** restores the loaded values. **Cancel** closes the record. **Delete record** asks for confirmation first.
   - Leaving the page, switching device or port, or closing the tab with unsaved edits asks you to confirm.

Special cases:

- **No record for the device and port:** the app says *"No existing record found for this Device and Port."* and offers **Add new device**. Nothing is created automatically.
- **Several records share the same device and port:** every matching identifier is listed, and nothing can be edited until you pick one.
- **Conflict:** someone else saved the same record while you were editing. You see both versions side by side and choose **Discard mine, load latest** or **Keep my edits and review**.

### All Devices

Search across identifiers and all six values. Filter by Device, Port, Hardware or Country, click a column header to sort, and page through the results. **Edit** opens the record in Device Manager with Device and Port already selected. This page also has **Import JSON** and **Add device**.

### JSON Preview

A read-only view of exactly what is saved. Press **Enter** or **Shift+Enter** in the search box to jump between matches. A banner warns you if you have unsaved edits that the preview doesn't include.

### Bulk import

Upload a `.json` file in the same shape as `deviceInformation.json`. The app checks JSON syntax, the root object, the six properties and their string types, and duplicate keys. It then previews:

- **New** records, which are always added.
- **Existing records with different values**, shown field by field. These are applied only in **Update existing** mode, after a confirmation.
- **Identical** records, which are skipped.

The import is all-or-nothing: if any record conflicts with a newer GitHub change, nothing is committed, and the preview refreshes against the latest data.

---

## Data rules

`deviceInformation.json` is an object keyed by the full device identifier:

```json
{
    "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC": {
        "sprintNo": "67.00+422608.047.00150",
        "Cver": "0.67.00",
        "firmwareVersion": "422608.047.00150",
        "appVersion": "0.67.00",
        "Hardware": "AVSB",
        "Country": "DE_DVBC"
    }
}
```

- **Identifier convention:** `<device>-PORT<n>-<remaining segments>`. The device is everything before the first `-PORT<n>-`. The app always uses the original key from the file and never rebuilds it from Device and Port.
- **Exactly six string properties per record:** `sprintNo`, `Cver`, `firmwareVersion`, `appVersion`, `Hardware`, `Country`. Missing, extra (for example `Pipeline`) or non-string properties are rejected when the file is read, when changes are saved, and when files are imported.
- **Values are never trimmed or rewritten.** Empty values, values with leading or trailing spaces, and control characters are rejected with a message instead.
- **New records** are inserted at their natural-sort position. Existing records never move.
- **Records without a `PORT<n>` segment** still appear in All Devices and JSON Preview, flagged, but can't be selected through the Device and Port dropdowns.

---

## Development, build and tests

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch, port 3001) and Vite dev server (port 5173) with hot reload |
| `npm test` | Runs all tests once with Vitest |
| `npm run test:watch` | Runs tests in watch mode |
| `npm run typecheck` | TypeScript strict-mode check of frontend, backend and tests |
| `npm run build` | Typecheck, then production frontend (`dist/`) and server (`dist-server/`) |
| `npm start` | Runs the production build |

The test suite has 112 tests:

- **`tests/shared`:** identifier parsing (every key in the real file), device and port options, exact and duplicate matching, update, add, delete and conflict logic, and import validation (invalid JSON, missing or non-string properties, duplicate keys, add-only and update modes). It also checks that saving preserves the formatting byte for byte and that a Pipeline property never reaches the output.
- **`tests/server`:** the real Express app running against an in-memory imitation of the GitHub contents API. Covers fetch, commit messages, minimal diffs, 401/403/429/5xx handling, the missing-file and initialize flow, stale-SHA retry, same-record conflicts, simultaneous saves by two users, all-or-nothing imports, basic auth, GitHub App JWT signing, and the rule that no success is reported when the commit fails.
- **`tests/ui`:** React Testing Library tests. Covers the Device and Port dropdown behavior, port reset, exact and multiple-match selection, deep links, the Pipeline placeholder (empty, optional, never in the save payload), success shown only after GitHub confirms, conflict UI, required-field validation, and Add Device duplicate rejection and creation.

---

## Project structure

```
├── deviceInformation.json        The data file (source of truth when in GitHub)
├── shared/                       Logic used by BOTH browser and server
│   ├── types.ts                  Record model, six fixed fields
│   ├── deviceId.ts               Identifier parsing, dropdown options, exact matching
│   ├── validation.ts             Structure, value and identifier validation
│   ├── operations.ts             Record-level create/update/delete with conflict detection
│   ├── importer.ts               Bulk-import analysis (incl. duplicate-key scan)
│   └── serialize.ts              Format-preserving JSON output
├── server/                       Express backend (holds the GitHub credentials)
│   ├── index.ts / app.ts         Startup, middleware, static hosting
│   ├── config.ts                 Environment configuration + validation
│   ├── github/auth.ts            GitHub App JWT / installation token, or PAT
│   ├── storage/                  GitHub contents-API store, local-file store (dev)
│   ├── services/deviceService.ts Fetch → merge → validate → commit-with-SHA → retry
│   ├── routes/devices.ts         REST API
│   └── middleware/               Basic auth, security headers, safe error handler
├── src/                          React + TypeScript frontend
│   ├── pages/                    DeviceManager, AllDevices, JsonPreview
│   ├── components/               layout, device (form, pipeline, conflict), dialogs, ui
│   ├── context/                  Data/sync state shared across pages
│   ├── services/api.ts           Typed API client
│   ├── hooks/, utils/, lib/, styles/
├── tests/                        shared/, server/, ui/
├── Dockerfile, .env.example, .github/workflows/ci.yml
```

**Adding the Pipeline feature later:** all Pipeline code is in [src/components/device/PipelineSelect.tsx](src/components/device/PipelineSelect.tsx). It owns its own state and exposes nothing, so it can be built out without touching device selection, matching or saving.

---

## Troubleshooting

| Message / symptom | Cause and fix |
|---|---|
| Server exits with *Invalid server configuration* | Required environment variables are missing. The message lists them. Compare with `.env.example`. |
| **Connection Failed**: *GitHub rejected the server credentials* | The token is invalid or expired, or the App private key or IDs are wrong. Regenerate the token or key. |
| *…do not have permission to commit the device file* | The token or App lacks **Contents: Read and write**, isn't installed on this repo, or branch protection blocks direct commits (see [Branch protection](#branch-protection)). |
| *Repository … was not found* / *Branch … does not exist* | Check `GITHUB_OWNER`, `GITHUB_REPO` and `GITHUB_BRANCH`. A private repo also returns *not found* when the credentials can't access it. |
| **File Missing** screen | `GITHUB_FILE_PATH` doesn't exist on that branch. Fix the path, or use **Initialise file** to create `{}`. This never replaces an existing file. |
| **Invalid File** screen | The file in GitHub isn't valid JSON or breaks the six-property rule. The screen lists the problems. Fix them in GitHub, then press **Try again**. |
| *GitHub API rate limit reached* | Wait until the time shown. GitHub Apps get higher limits than personal tokens. |
| **Conflict Detected** | Someone else saved the same record. Review the side-by-side values and save again. |
| *No changes to save* | GitHub already has exactly these values, for example because a colleague saved the same edit. |
| `npm run dev` shows *ECONNREFUSED /api* | The API didn't start, usually because of configuration. Check the `api` lines in the terminal. |
| Local file and GitHub disagree | In `github` mode the app edits the file **in GitHub**. Run `git pull` to update your local checkout. |
| Pages sign-in: *GitHub rejected this token* | The token was mistyped, has expired or has been revoked. Create a new one using the steps on the sign-in page. |
| Pages sign-in: *This token cannot see VFTV-Testing/Configs* | When creating the token, choose resource owner **VFTV-Testing** and include the **Configs** repository. |
| Pages: **Read-only** banner after sign-in | Your account isn't a collaborator with **Write** access on Configs. Ask an owner to add you, then sign out and back in. |
| Pages: *…do not have permission to commit…* | The token lacks **Contents: Read and write**, or the `Main` branch is protected. |
