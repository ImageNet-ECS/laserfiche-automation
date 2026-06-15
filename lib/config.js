const fs = require('fs');
const path = require('path');

// Project root (one level up from lib/). All bundled config and runtime
// artifacts resolve against this so the tool works regardless of cwd.
const ROOT = path.join(__dirname, '..');

const SELECTORS_FILE = path.join(ROOT, 'config', 'selectors.json');
const HANDLERS_FILE = path.join(ROOT, 'config', 'resource-handlers.json');
const OVERRIDES_FILE = path.join(ROOT, 'overrides.json');
const AUTH_FILE = path.join(ROOT, 'auth.json');
const STEPS_DIR = path.join(ROOT, 'steps');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Persistent map of resource renames learned during interactive --pause runs.
function loadLearnedOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return {};
  try {
    return readJson(OVERRIDES_FILE);
  } catch (err) {
    console.warn(`Could not parse ${OVERRIDES_FILE}: ${err.message}. Ignoring.`);
    return {};
  }
}

function saveLearnedOverrides(overrides) {
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2) + '\n');
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// Load and validate a job/config file (defaults to <root>/config.json) and
// merge in the bundled selectors + resource handlers. Returns the full config
// object consumed by run.js and the tasks.
function loadConfig(configPath) {
  const resolved = path.isAbsolute(configPath)
    ? configPath
    : path.join(ROOT, configPath);

  if (!fs.existsSync(resolved)) {
    fail(
      `Config not found: ${resolved}\n` +
        `Run "npm run setup" to create one, or pass a path: npm run job -- jobs/foo.json`,
    );
  }

  let cfg;
  try {
    cfg = readJson(resolved);
  } catch (err) {
    fail(`Could not parse ${resolved}: ${err.message}`);
  }

  if (!cfg.target || !cfg.target.url) {
    fail(`Config ${resolved} is missing target.url (the resource-management template link).`);
  }
  if (!cfg.task) {
    fail(`Config ${resolved} is missing "task".`);
  }

  const selectors = readJson(SELECTORS_FILE);
  const resourceHandlers = readJson(HANDLERS_FILE);

  const target = cfg.target;
  if (!target.sourceEnvironment) target.sourceEnvironment = 'Global';
  if (!Array.isArray(target.environmentFallback) || target.environmentFallback.length === 0) {
    target.environmentFallback = [target.sourceEnvironment, 'Global'];
  }

  const params = cfg.params || {};
  if (typeof params.maxIterations !== 'number') params.maxIterations = 150;
  const codeOverrides = params.nameOverrides || {};
  const learnedOverrides = loadLearnedOverrides();

  // If a resource was renamed since the package was built, the warning list
  // shows the OLD name but the picker has the NEW one. Code-defined overrides
  // (from the config) win; learned overrides fill the rest.
  function getSearchNameFor(warningName) {
    return codeOverrides[warningName] || learnedOverrides[warningName] || warningName;
  }

  return {
    configPath: resolved,
    accountId: cfg.accountId || '',
    username: cfg.username || '',
    // 'new' = a clean package with only the business process you inserted (just
    // add its resources). 'existing' = a package that already has resources
    // (strip everything except the business process, then re-add resources).
    mode: cfg.mode || 'existing',
    target,
    task: cfg.task,
    params,
    selectors,
    resourceHandlers,
    learnedOverrides,
    getSearchNameFor,
    saveLearnedOverrides,
    paths: { root: ROOT, auth: AUTH_FILE, overrides: OVERRIDES_FILE, steps: STEPS_DIR },
  };
}

module.exports = { loadConfig, loadLearnedOverrides, saveLearnedOverrides, ROOT, AUTH_FILE, STEPS_DIR, SELECTORS_FILE };
