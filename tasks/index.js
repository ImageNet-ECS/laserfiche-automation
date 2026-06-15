// Task registry. Add a new admin task by writing a module that exports
// `async function run(ctx)` and registering it here under a name you can put
// in a config/job file's "task" field.
//
// ctx = { page, snapshot, log, config, runDir, laserfiche, flags }
const tasks = {
  'build-deployment-package': require('./build-deployment-package'),
  'resolve-missing-resources': require('./resolve-missing-resources'),
};

function getTask(name) {
  return tasks[name] || null;
}

function taskNames() {
  return Object.keys(tasks);
}

module.exports = { getTask, taskNames };
