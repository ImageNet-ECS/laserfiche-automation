# Laserfiche Automation

Config-driven browser automation for Laserfiche Cloud, built on [Playwright](https://playwright.dev).

It builds (or rebuilds) a **deployment package** and adds all of its referenced resources for you —
driving the real Laserfiche UI: Validate, read the missing-resource warnings, and insert each one
through the picker, with ghost-insert recovery and environment fallback. Then it clicks **Save
changes**.

Two modes:

- **new** — a clean package that contains only the business process you inserted. The tool adds all
  of that process's resources.
- **existing** — a package that already has resources. The tool removes everything *except* the
  business-process resource, then re-adds them all from scratch.

Nothing about a specific package, environment, or step is hard-coded — it all lives in JSON config.
**No password is ever stored:** you sign in yourself in a real browser and only the resulting
session is saved locally.

## Prerequisites

- [Node.js](https://nodejs.org) 18 or newer (`node -v` to check)
- A Laserfiche Cloud account with access to the deployment package you're targeting

## Install

```bash
git clone <REPO_URL> laserfiche-automation
cd laserfiche-automation
npm install
npx playwright install chromium    # one-time: download the browser Playwright drives
```

## Set up & run — one command

```bash
npm run setup
```

`setup` walks you through everything:

1. **Account / client ID**, **username** (no password — see below)
2. **Deployment package link** — paste the package's URL
3. **Project name** — the project the resources live in; leave blank to use **Global** only
4. **new or existing?**
5. **Sign in** — a browser opens; you enter your password and complete any MFA/SSO. When you reach
   the app, your session is saved to `auth.json`. (Skipped if you already have a saved session.)
6. A **reminder** for the mode you chose, then **"Press Enter to proceed"**
7. It runs the flow in a visible browser, **saves**, and **pauses so you can review** before closing.

> **Before you proceed:**
> - **new:** make sure you've inserted the one business process you want resources added for — and nothing else.
> - **existing:** make sure the package currently has its resources — they'll be removed (except the business process) and re-added.

### Running again

Your config and session are saved, so you don't need full setup again:

```bash
npm start -- --headed --review     # run saved config, visible, pause before closing
```

## Commands & flags

| Command | What it does |
| --- | --- |
| `npm run setup` | First-time (or re-)configuration, sign-in, and a guided run. |
| `npm start` | Run the saved `config.json`. |
| `npm run job -- jobs/foo.json` | Run a different package/job file instead of `config.json`. |
| `npm run login` | Re-authenticate when your session expires (re-saves `auth.json`). |
| `npm run record` | Open your package signed-in with the Playwright Inspector to capture selectors. |

Flags (pass after `--`): `--headed` (show the browser), `--review` (pause before closing so you can
verify/save), `--pause` (stop on failures so you can fix them by hand mid-run), `--keep-open` (leave
the browser running until Ctrl+C).

## Configuration

`config.json` is created by `setup` and is **gitignored** (it's per-user — see `config.example.json`):

```json
{
  "mode": "existing",
  "accountId": "485293953",
  "username": "your-username",
  "target": {
    "url": "https://app.laserfiche.com/resourcemanagement/#/template/<TEMPLATE_ID>",
    "sourceEnvironment": "Global",
    "environmentFallback": ["Global"]
  },
  "task": "build-deployment-package",
  "params": { "maxIterations": 150, "nameOverrides": {} }
}
```

- **`mode`** — `new` or `existing` (see top of this README).
- **`target.url`** — the deployment package link. Change it (or re-run setup) to target another package.
- **`target.sourceEnvironment`** — the **project** the resources live in (what `setup` asks for as
  "Project name"). Leave it blank at setup and it becomes `Global`. The picker searches this project
  first, then falls back to Global.
- **`target.environmentFallback`** — the search order, derived automatically: `["<project>", "Global"]`,
  or just `["Global"]` when no project is set. Editable here if you need a different order.
- **`params.nameOverrides`** — if a resource was renamed since the package was built, map the old
  (warning) name to the new (picker) name: `{ "Old Name": "New Name" }`.

**Multiple packages:** drop extra files in `jobs/` and run `npm run job -- jobs/your-file.json`.

## How it's organized

```
config/selectors.json          # every Laserfiche UI string (names, CSS, URL patterns)
config/resource-handlers.json  # per-resource-type menu paths for the insert picker
config.json                    # your package + mode (from setup; gitignored)
jobs/*.json                    # extra packages
lib/                           # engine: config, browser, snapshot, auth (interactive login)
lib/laserfiche/                # the Laserfiche actions: validate / picker / resources-tab / editor
tasks/                         # pluggable tasks + the registry (tasks/index.js)
scripts/                       # setup.js, run.js, login.js, record.js
steps/<run-id>/                # per-run artifacts (gitignored)
```

Each run writes to `steps/<timestamp>/`: `missing.json` (what was detected), `results.json` (final
status of every item), and a numbered folder per step with `screenshot.png`, `page.html`, `meta.json`.

## Troubleshooting

- **"Session expired"** → `npm run login` to sign in again.
- **Existing mode removed the wrong rows (or nothing)** → the business-process row is matched by the
  type label in `config/selectors.json` → `businessProcess.typeLabel`. The run logs each `removed:`
  row; adjust the label to match what your package actually shows.
- **A button/menu isn't found** → the console prints what it saw. Update the matching string in
  `config/selectors.json` (no code change needed).
- **A resource type is skipped (`skipped-unknown-type`)** → add it to
  `config/resource-handlers.json` with its "Insert Resources" menu path.

## Extending it

- **Add a resource type:** add an entry to `config/resource-handlers.json` with the menu path to
  click under "Insert Resources".
- **Adapt to UI changes / a different tenant:** edit `config/selectors.json` — no code changes.
- **Add a new task:** create `tasks/my-task.js` exporting `async function run(ctx)`
  (`ctx = { page, snapshot, log, config, runDir, laserfiche, flags }`), register it in
  `tasks/index.js`, then set `"task": "my-task"` in your config.

## Security

No password is stored anywhere. Sign-in opens a real browser; you complete the password and any
MFA/SSO yourself, and only the session (`auth.json`) is saved locally. **Each user signs in as
themselves** — `auth.json`, `config.json`, and `steps/` are gitignored and never committed.
