const fs = require('fs');
const path = require('path');
const { promptUser } = require('../lib/util');
const { loadConfig, ROOT } = require('../lib/config');
const { interactiveLogin } = require('../lib/auth');
const { runConfig } = require('./run');

const CONFIG_PATH = path.join(ROOT, 'config.json');

// Prompt with a default shown in [brackets]; Enter keeps the default.
async function ask(label, def) {
  const shown = def ? ` [${def}]` : '';
  const answer = (await promptUser(`${label}${shown}: `)).trim();
  return answer || def || '';
}

async function main() {
  console.log('=== Laserfiche automation setup ===\n');

  let existing = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      console.log('Found an existing config.json — press Enter to keep the value in [brackets].\n');
    } catch {
      console.log('Found an existing config.json but could not parse it — starting fresh.\n');
    }
  }

  const exTarget = existing.target || {};
  const exParams = existing.params || {};

  // 1) account ID  2) username  3) link  4) new/existing
  const accountId = await ask('LF Cloud account / client ID', existing.accountId);
  const username = await ask('Username (no password — you sign in yourself)', existing.username);

  const url = await ask('Deployment package link', exTarget.url);
  if (!url) {
    console.error('\nA deployment package link is required. Re-run "npm run setup".');
    process.exit(1);
  }

  let mode = (await ask('Is this a NEW or EXISTING deployment package? (new/existing)', existing.mode || 'existing')).toLowerCase();
  if (mode !== 'new' && mode !== 'existing') {
    console.log('Unrecognized answer — assuming "existing".');
    mode = 'existing';
  }

  // Environment is not prompted — the picker auto-detects the dropdown at run
  // time. Defaults are written so the add-resources phase works, editable later.
  const sourceEnvironment = exTarget.sourceEnvironment || 'Global';
  const environmentFallback = Array.isArray(exTarget.environmentFallback) && exTarget.environmentFallback.length
    ? exTarget.environmentFallback
    : [sourceEnvironment, 'Global'];

  const config = {
    mode,
    accountId,
    username,
    target: { url, sourceEnvironment, environmentFallback },
    task: 'build-deployment-package',
    params: {
      maxIterations: typeof exParams.maxIterations === 'number' ? exParams.maxIterations : 150,
      nameOverrides: exParams.nameOverrides || {},
    },
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log(`\nWrote ${CONFIG_PATH} (no password is ever stored).`);

  // Sign in (only if we don't already have a saved session).
  const full = loadConfig('config.json');
  if (fs.existsSync(full.paths.auth)) {
    console.log('Using your saved session (run "npm run login" to refresh it).');
  } else {
    await interactiveLogin(full, { headed: true });
  }

  // Mode-specific reminder, then wait for the user to confirm.
  console.log('\n----------------------------------------------------------------');
  if (mode === 'new') {
    console.log('NEW package: make sure you have inserted the ONE business process you');
    console.log('want the automation to add all resources for — and nothing else.');
  } else {
    console.log('EXISTING package: make sure it currently has all its inserted resources.');
    console.log('This automation will REMOVE everything except the business process');
    console.log('resource, then re-add all resources.');
  }
  console.log('----------------------------------------------------------------');
  await promptUser('\nPress Enter when you are ready to proceed... ');

  await runConfig({ configPath: 'config.json', flags: { headed: true, pauseBeforeClose: true } });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
