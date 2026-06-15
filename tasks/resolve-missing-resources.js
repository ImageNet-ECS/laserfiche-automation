const fs = require('fs');
const path = require('path');
const { promptUser } = require('../lib/util');

// Open the insert menu for a resource's type and insert it via the configured
// flow. Caller can force an environment (e.g. 'Global' on a ghost-insert retry).
async function tryInsertResource(ctx, resource, options = {}) {
  const { config, laserfiche: lf } = ctx;
  const handler = config.resourceHandlers[resource.fullType];
  if (!handler) {
    return { ...resource, status: 'skipped-unknown-type' };
  }
  const searchName = config.getSearchNameFor(resource.name);
  const environment = options.environment || handler.environment || config.target.sourceEnvironment;
  try {
    await lf.openInsertMenu(ctx.page, handler.menuPath);
    if (handler.kind === 'env-search-table') {
      await lf.insertViaEnvSearchPicker(ctx.page, { environment, name: searchName });
    } else {
      throw new Error(`Unknown handler kind: ${handler.kind}`);
    }
    return { ...resource, status: 'inserted' };
  } catch (err) {
    // Best-effort: dismiss anything that might be open so the next iteration
    // starts from a clean state.
    await ctx.page.keyboard.press('Escape').catch(() => {});
    await ctx.page.keyboard.press('Escape').catch(() => {});
    return { ...resource, status: 'failed', error: err.message };
  }
}

// Detect missing referenced resources in a Deployment/resource-management
// template and insert them one at a time, revalidating after each so the loop
// always works against the freshest warning list.
module.exports = async function run(ctx) {
  const { page, snapshot, config, runDir, laserfiche: lf, flags } = ctx;
  const sel = config.selectors;
  const PAUSE = !!flags.pause;
  const DEFAULT_ENVIRONMENT = config.target.sourceEnvironment;
  const MAX_ITERS = config.params.maxIterations;

  // Order matters: on the main template view the JSON editor link is hidden
  // until Validate runs. After Validate, the link appears; clicking it switches
  // to the JSON editor where the warning list is rendered.
  await page.getByRole('button', { name: sel.warnings.validateLabel }).click();
  await snapshot(page, 'validated-main');

  const jsonEditorLink = page.getByTestId(sel.warnings.jsonEditorLinkTestId);
  await jsonEditorLink.waitFor({ state: 'visible', timeout: 10_000 });
  await jsonEditorLink.click();
  await snapshot(page, 'json-editor');

  // Give the warning list a moment to render after the view switch.
  await page.locator(sel.warnings.listCss).first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => console.warn('No warning list rendered — package may already be complete.'));

  const initialMissing = await lf.extractMissingResources(page);
  console.log(`Found ${initialMissing.length} missing referenced resources.`);
  fs.writeFileSync(path.join(runDir, 'missing.json'), JSON.stringify(initialMissing, null, 2));

  // Per-iteration loop: insert one resource at a time, revalidate, refresh the
  // warning list, then pick the next. Re-validating after every insert means
  // the loop always works against the freshest list — duplicates by name
  // disappear automatically, ghost detection is immediate, and pulled-in
  // dependencies surface as soon as they appear.
  const results = [];
  const attempted = new Set(); // internalIds already tried (success or fail)
  // For each (fullType, name) we track which environments we've already
  // attempted. Two warnings with the same display name but different internal
  // IDs are DISTINCT resources living in different projects — we must insert
  // both, but the second one needs to come from the OTHER project.
  const triedEnvsByName = new Map(); // nameKey -> Set<env>
  const nameKey = (r) => `${r.fullType}|${r.name}`;
  const ENV_OPTIONS = config.target.environmentFallback;

  let missing = initialMissing;
  let iter = 0;

  while (iter < MAX_ITERS) {
    iter++;

    if (missing.length === 0) {
      // Don't trust an empty list yet — Laserfiche's backend often surfaces
      // dependencies of just-added items several seconds after the warning
      // list first goes empty. Wait, revalidate, and check again before
      // declaring done.
      console.log(`\nIter ${iter}: warning list empty — extended check before exit...`);
      await page.waitForTimeout(8000);
      await lf.revalidateAndWaitForSettled(page);
      missing = await lf.extractMissingResources(page);
      if (missing.length === 0) {
        console.log(`   confirmed empty. Done.`);
        break;
      }
      console.log(`   ${missing.length} late-appearing dependenc${missing.length === 1 ? 'y' : 'ies'} found — continuing.`);
      continue;
    }

    const next = missing.find((r) => !attempted.has(r.internalId));
    if (!next) {
      console.log(
        `\nIter ${iter}: ${missing.length} item(s) remain but all have been attempted — stopping.`,
      );
      break;
    }

    attempted.add(next.internalId);
    console.log(
      `\n[iter ${iter} | ${missing.length} remaining] -> ${next.fullType}: ${next.name}`,
    );
    console.log(`   expected ID: ${next.internalId}`);

    // Pick which environment to try first for this name. If we've already tried
    // one env for this (type, name), pick a different one — two warnings with
    // the same display name but distinct internal IDs are separate resources
    // living in different projects.
    const handler = config.resourceHandlers[next.fullType] || {};
    const defaultEnv = handler.environment || DEFAULT_ENVIRONMENT;
    const envOrder = [
      defaultEnv,
      ...ENV_OPTIONS.filter((e) => e !== defaultEnv),
    ];
    const triedEnvs = triedEnvsByName.get(nameKey(next)) || new Set();
    const envForThis = envOrder.find((e) => !triedEnvs.has(e));

    let result;
    if (!envForThis) {
      result = {
        ...next,
        status: 'skipped-duplicate',
        error: `All envs (${envOrder.join(', ')}) already attempted for this name`,
      };
      console.log(`   ${result.status} — ${result.error}`);
    } else {
      triedEnvs.add(envForThis);
      triedEnvsByName.set(nameKey(next), triedEnvs);
      console.log(`   trying env: ${envForThis}`);
      result = await tryInsertResource(ctx, next, { environment: envForThis });
    }

    // Revalidate after every action — even skipped-duplicate, since the warning
    // list may have moved on independently.
    await lf.revalidateAndWaitForSettled(page);
    missing = await lf.extractMissingResources(page);

    // Ghost detection per-iteration: if the picker said "inserted" but the
    // resource is still in the warning list, the picker grabbed the wrong row.
    const wasInserted = result.status === 'inserted';
    const stillMissing = missing.some((r) => r.internalId === next.internalId);

    if (wasInserted) {
      console.log(
        `   verify ${next.internalId} in package: ${
          stillMissing ? 'NO ✗ still in warnings (wrong row)' : 'YES ✓ match'
        }`,
      );
    }

    if (wasInserted && stillMissing) {
      result = {
        ...result,
        status: 'ghost-inserted',
        error: 'Picker workflow completed but resource still missing — wrong row selected',
      };
    }

    // Mid-loop pause: when --pause is on and we just hit a problem, stop
    // immediately so the user can fix it in the browser before the loop moves
    // to the next item.
    if (PAUSE && (result.status === 'failed' || result.status === 'ghost-inserted')) {
      console.log(
        `\n⏸  Pausing on [${result.status}] ${next.raw}` +
          (result.error ? `\n    ${result.error}` : '') +
          `\n    Fix it in the browser, then press Enter to revalidate and continue.`,
      );
      await promptUser('   Press Enter to continue... ');
      await lf.revalidateAndWaitForSettled(page);
      missing = await lf.extractMissingResources(page);
      const stillMissingAfterPause = missing.some(
        (r) => r.internalId === next.internalId,
      );
      if (!stillMissingAfterPause) {
        console.log(`   ✓ resolved during pause`);
        result = { ...result, status: 'inserted-after-pause', error: undefined };
      } else {
        console.log(`   ⚠ still missing — moving on; you can revisit at end of run.`);
      }
    }

    console.log(
      `   ${result.status}${result.error ? ` — ${result.error}` : ''}` +
        ` (warnings: ${missing.length} remain)`,
    );
    results.push(result);
    if (result.status !== 'skipped-unknown-type') {
      await snapshot(page, `i${iter}-${result.status}-${next.name}`);
    }
  }

  if (iter === MAX_ITERS) {
    console.warn(
      `\nHit max iterations (${MAX_ITERS}). Stopping — there may still be unresolved resources.`,
    );
  }

  // End-of-run pause: present unresolved items (failed + ghost) in one batch so
  // the user can fix them. Filter against the CURRENT warning list first — an
  // item that failed mid-loop may have been fixed as a side-effect of another
  // action, in which case it's no longer truly unresolved.
  if (PAUSE) {
    await lf.revalidateAndWaitForSettled(page);
    const currentForPause = await lf.extractMissingResources(page);
    const stillMissingIdsForPause = new Set(currentForPause.map((m) => m.internalId));
    const unresolved = results
      .filter((r) => r.status === 'failed' || r.status === 'ghost-inserted')
      .filter((r) => stillMissingIdsForPause.has(r.internalId));
    if (unresolved.length) {
      console.log(
        `\n=== ${unresolved.length} unresolved item(s) — manual fixes needed ===`,
      );
      for (const r of unresolved) {
        console.log(`  [${r.status}] ${r.raw}`);
        if (r.error) console.log(`     → ${r.error}`);
      }
      await promptUser(
        '\nFix these in the browser (it\'s still open). ' +
          'When ready, press Enter to revalidate and learn any renames... ',
      );

      await lf.revalidateAndWaitForSettled(page);
      const finalMissing = await lf.extractMissingResources(page);
      await snapshot(page, 'after-final-pause');
      const stillMissingIds = new Set(finalMissing.map((m) => m.internalId));

      const userResolved = unresolved.filter(
        (r) => !stillMissingIds.has(r.internalId),
      );
      if (userResolved.length) {
        console.log(`\nResolved during pause (${userResolved.length}):`);
        for (const r of userResolved) {
          console.log(`  - ${r.name}`);
          // Reclassify in results so the summary reflects reality.
          const idx = results.indexOf(r);
          if (idx !== -1) {
            results[idx] = { ...r, status: 'inserted-after-pause', error: undefined };
          }
        }
      }
      const stillUnresolved = unresolved.filter(
        (r) => stillMissingIds.has(r.internalId),
      );
      if (stillUnresolved.length) {
        console.log(`\nStill unresolved (${stillUnresolved.length}):`);
        for (const r of stillUnresolved) console.log(`  - ${r.raw}`);
      }
    }
  }

  // Final defensive validate: make sure we're on the JSON Editor view (a ghost
  // recovery may have left us on the Resources tab), then click Validate one
  // more time and confirm no new warnings appeared since the last revalidate.
  console.log('\nFinal validate to confirm no new warnings remain...');
  await lf.gotoWarningView(page);
  await lf.revalidateAndWaitForSettled(page);
  const finalMissing = await lf.extractMissingResources(page);
  await snapshot(page, 'final-validated');
  if (finalMissing.length === 0) {
    console.log('   ✓ no warnings — package is clean.');
  } else {
    console.log(`   ⚠ ${finalMissing.length} new warning(s) appeared after the loop ended:`);
    for (const m of finalMissing) console.log(`     - ${m.raw}`);
    console.log('   Re-run the task to resolve them.');
  }

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const unknownTypes = [...new Set(
    results.filter((r) => r.status === 'skipped-unknown-type').map((r) => r.fullType),
  )];

  console.log('\n=== Summary ===');
  console.log(summary);
  if (unknownTypes.length) {
    console.log('\nTypes still needing a handler in config/resource-handlers.json:');
    for (const t of unknownTypes) console.log(`  - ${t}`);
  }

  // Everything that wasn't successfully inserted, printed in the same format as
  // the source warning list so the lines can be diffed directly.
  const successStatuses = new Set([
    'inserted',
    'inserted-after-retry-global',
    'inserted-after-pause',
  ]);
  const notAdded = results.filter((r) => !successStatuses.has(r.status));
  if (notAdded.length) {
    console.log(`\n=== Not Added (${notAdded.length}) ===`);
    for (const r of notAdded) console.log(r.raw);

    const failedWithReasons = notAdded.filter((r) => (r.status === 'failed' || r.status === 'ghost-inserted') && r.error);
    if (failedWithReasons.length) {
      console.log('\nFailure reasons:');
      for (const r of failedWithReasons) console.log(`  [${r.status}] ${r.name} — ${r.error}`);
    }
    const skippedTypes = [...new Set(
      notAdded.filter((r) => r.status === 'skipped-unknown-type').map((r) => r.fullType),
    )];
    if (skippedTypes.length) {
      console.log('\nTypes with no handler in config/resource-handlers.json:');
      for (const t of skippedTypes) console.log(`  ${t}`);
    }
  }

  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nSnapshots and JSON logs in ${runDir}`);

  return results;
};
