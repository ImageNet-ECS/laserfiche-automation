const resolveMissingResources = require('./resolve-missing-resources');

// Add all of a deployment package's resources.
//
//   mode === 'new'      -> the package already contains just the business
//                          process (you inserted it). Nothing to prepare —
//                          go straight to adding all resources.
//   mode === 'existing' -> the package already has resources. Remove every
//                          resource except the business process, then re-add
//                          them all.
//
// There is no separate Save step — Validate (clicked by the add-resources
// loop) is what persists and re-checks the package.
module.exports = async function run(ctx) {
  const { page, snapshot, config, laserfiche: lf } = ctx;
  const sel = config.selectors;

  if (config.mode === 'existing') {
    console.log(
      `\nExisting package: removing all resources except the business process ` +
        `(type "${sel.businessProcess.typeLabel}")...`,
    );
    await snapshot(page, 'before-strip');
    const removed = await lf.removeResourcesExceptType(page, sel.businessProcess.typeLabel);
    console.log(`Removed ${removed.length} resource(s).`);
    await snapshot(page, 'after-strip');
  } else {
    console.log('\nNew package: business process already inserted — adding its resources.');
  }

  // Add all referenced resources (same Validate -> add loop as the standalone
  // resolve-missing-resources task).
  const results = await resolveMissingResources(ctx);

  // Persist the package. Validate re-checks but does not save — the toolbar
  // "Save changes" button is what commits the inserts/removals.
  console.log('\nSaving changes...');
  await lf.clickSave(page);
  await snapshot(page, 'after-save');

  return results;
};
