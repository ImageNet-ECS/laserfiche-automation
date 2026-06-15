const { tryWaitVisible } = require('../util');

// Click the "Resources" tab in the editor's tab strip. The tab is part of a
// mat-tab group (role="tab"). Returns true if the tab became visible/active.
async function gotoResourcesTab(page, sel) {
  const tab = page.getByRole('tab', { name: sel.resourcesTab.tabLabel, exact: true });
  if (!(await tryWaitVisible(tab, 4000))) return false;
  await tab.click().catch(() => {});
  // Wait for the row content to render in the tab panel.
  await page.waitForTimeout(400);
  return true;
}

// Remove a previously-added resource by display name + project/env from the
// Resources tab. Each row has its OWN Remove button (inside its
// actions-container), so we must scope by row — not click the first one on the
// page. Returns true if it found and clicked Remove, false if no matching row.
async function removeResourceByName(page, name, project, sel) {
  if (!(await gotoResourcesTab(page, sel))) {
    throw new Error('Could not switch to Resources tab');
  }

  // Find the row that contains BOTH the name (in its title="..." cell) AND the
  // project column text. Multiple rows can share a name across projects — the
  // project disambiguates.
  const row = page
    .locator(sel.picker.rowCss)
    .filter({ has: page.locator(`[title="${name.replace(/"/g, '\\"')}"]`) })
    .filter({ hasText: project })
    .first();

  if (!(await tryWaitVisible(row, 4000))) return false;
  await row.scrollIntoViewIfNeeded().catch(() => {});
  // Click into the row first so any per-row toolbar that's hover/focus-revealed
  // becomes interactable.
  await row.click().catch(() => {});
  await page.waitForTimeout(200);

  const removeBtn = row.locator(sel.resourcesTab.removeButtonCss).first();
  if (!(await tryWaitVisible(removeBtn, 3000))) return false;
  await removeBtn.click();

  // Confirmation dialog (in-page mat-dialog or similar). Browser-level confirm
  // dialogs are caught by the global page.on('dialog') handler which dismisses;
  // if removal requires accept, we'd swap the handler. For now assume in-page
  // confirmation only.
  for (const label of sel.resourcesTab.confirmLabels) {
    const btn = page.getByRole('button', { name: label, exact: true });
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(400);

  // Verify the row actually went away — if it's still there, the click didn't
  // take effect (toolbar covered, animation, etc).
  const stillThere = await row.isVisible().catch(() => false);
  return !stillThere;
}

// Remove every resource on the Resources tab EXCEPT the business process,
// identified by its type label (e.g. "Business Process"). Used to reset an
// existing package back to just its process before re-adding resources.
//
// Best-effort and conservative: rows without a Remove button (e.g. header rows,
// or the business process itself) are left alone, and it stops if a pass
// removes nothing (so it can never loop forever). Logs each row's text so the
// first headed run reveals the real structure if the type label needs tuning.
async function removeResourcesExceptType(page, keepTypeLabel, sel) {
  if (!(await gotoResourcesTab(page, sel))) {
    throw new Error('Could not switch to Resources tab');
  }

  const removed = [];
  const skipped = new Set(); // row texts we couldn't remove — don't retry them
  const MAX_PASSES = 500;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const rows = page.locator(sel.picker.rowCss);
    const count = await rows.count();

    let target = null;
    let targetText = '';
    for (let r = 0; r < count; r++) {
      const row = rows.nth(r);
      const text = ((await row.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (text.includes(keepTypeLabel)) continue; // keep the business process
      if (skipped.has(text)) continue;
      target = row;
      targetText = text;
      break;
    }

    if (!target) break; // nothing left to remove

    await target.scrollIntoViewIfNeeded().catch(() => {});
    await target.click().catch(() => {});
    await page.waitForTimeout(150);

    const removeBtn = target.locator(sel.resourcesTab.removeButtonCss).first();
    if (!(await tryWaitVisible(removeBtn, 2500))) {
      // No Remove control on this row (header / non-removable) — skip it.
      console.warn(`   no Remove button on row: "${targetText.slice(0, 80)}" — skipping`);
      skipped.add(targetText);
      continue;
    }
    await removeBtn.click().catch(() => {});

    for (const label of sel.resourcesTab.confirmLabels) {
      const btn = page.getByRole('button', { name: label, exact: true });
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(400);
    console.log(`   removed: ${targetText.slice(0, 80)}`);
    removed.push(targetText);
  }

  return removed;
}

module.exports = { gotoResourcesTab, removeResourceByName, removeResourcesExceptType };
