const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../lib/config');
const { launchContext, attachDialogDismisser } = require('../lib/browser');
const { makeSnapshotter } = require('../lib/snapshot');
const { makeLaserfiche } = require('../lib/laserfiche');
const { getTask, taskNames } = require('../tasks');
const { formatDuration, promptUser } = require('../lib/util');

function parseArgs(argv) {
  const flags = { headed: false, keepOpen: false, pause: false, pauseBeforeClose: false };
  const positional = [];
  for (const a of argv) {
    if (a === '--headed') flags.headed = true;
    else if (a === '--keep-open') flags.keepOpen = true;
    else if (a === '--pause') flags.pause = true;
    else if (a === '--review') flags.pauseBeforeClose = true;
    else if (!a.startsWith('--')) positional.push(a);
  }
  return { flags, configPath: positional[0] || 'config.json' };
}

// Run a config end-to-end. Reusable so `npm run setup` can run immediately
// after sign-in without shelling out.
async function runConfig({ configPath = 'config.json', flags = {} } = {}) {
  const config = loadConfig(configPath);

  const task = getTask(config.task);
  if (!task) {
    console.error(`No such task: "${config.task}". Registered: ${taskNames().join(', ')}`);
    process.exit(1);
  }

  if (!fs.existsSync(config.paths.auth)) {
    console.error(
      `No session found (${config.paths.auth}). First-time setup: npm run setup  (or re-auth: npm run login)`,
    );
    process.exit(1);
  }

  const startedAt = new Date();
  console.log(`Started: ${startedAt.toLocaleString()}`);
  console.log(`Config:  ${config.configPath}`);
  console.log(`Mode:    ${config.mode}`);
  console.log(`Task:    ${config.task}`);
  console.log(`Target:  ${config.target.url}`);

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(config.paths.steps, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const snapshot = makeSnapshotter(config.paths.steps, runId);

  const { browser, context, page } = await launchContext({
    headed: !!flags.headed,
    authFile: config.paths.auth,
  });
  attachDialogDismisser(page);

  const laserfiche = makeLaserfiche(config.selectors);

  try {
    if (!(await laserfiche.sessionLooksValid(page, config.target.url))) {
      console.error('Session expired. Re-run: npm run login');
      process.exit(2);
    }
    await snapshot(page, 'session-ok');

    const ctx = { page, snapshot, log: console.log, config, runDir, laserfiche, flags };
    await task(ctx);

    const endedAt = new Date();
    console.log(`\nStarted:  ${startedAt.toLocaleString()}`);
    console.log(`Ended:    ${endedAt.toLocaleString()}`);
    console.log(`Duration: ${formatDuration(endedAt - startedAt)}`);

    // Keep the browser open for review (and a manual re-save if needed) until
    // the user is ready to close it.
    if (flags.pauseBeforeClose) {
      await promptUser('\nReview the result in the browser. Press Enter to close it... ');
    }
  } finally {
    if (flags.keepOpen) {
      console.log('\n--keep-open set — browser left running. Press Ctrl+C to exit.');
      // Block forever so the browser window stays interactive.
      await new Promise(() => {});
    }
    await context.close();
    await browser.close();
  }
}

async function main() {
  const { flags, configPath } = parseArgs(process.argv.slice(2));
  await runConfig({ configPath, flags });
}

// Only auto-run when invoked directly (not when required by setup.js).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runConfig };
