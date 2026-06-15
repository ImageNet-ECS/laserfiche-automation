const { tryWaitVisible } = require('../util');

async function clickMenuItem(page, label, sel) {
  // Try exact accessible-name match first (matches codegen output).
  const exact = page.getByRole('menuitem', { name: label, exact: true });
  if (await tryWaitVisible(exact, 2000)) {
    await exact.click();
    return;
  }
  // Fallback: case-insensitive substring on rendered text. Catches items with
  // icons or trailing whitespace that change the accessible name.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loose = page.locator(`${sel.picker.menuItemCss}:visible`).filter({ hasText: new RegExp(escaped, 'i') }).first();
  if (await tryWaitVisible(loose, 1500)) {
    await loose.click();
    return;
  }
  // Diagnostic: dump what menu items ARE visible so we can fix the path.
  const visibles = await page.locator(`${sel.picker.menuItemCss}:visible`).all();
  const names = [];
  for (const el of visibles) {
    const aria = await el.getAttribute('aria-label').catch(() => null);
    const text = ((await el.textContent().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    names.push(`{aria:"${aria || ''}", text:"${text}"}`);
  }
  throw new Error(`Menu item not visible: "${label}". Visible menuitems: [${names.join(' | ')}]`);
}

async function openInsertMenu(page, menuPath, sel) {
  await page.getByRole('button', { name: sel.picker.insertResourcesLabel }).click();
  for (const item of menuPath) {
    try {
      await clickMenuItem(page, item, sel);
    } catch (err) {
      throw new Error(`${err.message} (path so far: ${menuPath.join(' > ')})`);
    }
  }
}

async function insertViaEnvSearchPicker(page, { environment, name }, sel) {
  const dialog = page.locator(sel.picker.dialogCss).first();
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });

  const envSelect = dialog.locator(sel.picker.environmentSelectCss).first();
  const hasEnvDropdown = await tryWaitVisible(envSelect, 2000);

  async function pickEnv(envName) {
    if (!hasEnvDropdown) return false;
    // If the trigger already shows the target env, skip the click —
    // re-selecting the same option can cause a table refresh and drop any
    // in-flight state we've set up.
    const current = ((await envSelect.textContent().catch(() => '')) || '').trim();
    if (current === envName) return true;

    await envSelect.click();
    // .first() — under Angular re-renders the dropdown sometimes shows the same
    // option twice briefly, which trips strict-mode on click. Either duplicate
    // refers to the same logical option, so taking the first visible one is safe.
    const option = page.getByRole('option', { name: envName, exact: true }).first();
    if (!(await tryWaitVisible(option, 2000))) {
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }
    await option.click();
    // Wait for the cdk overlay (the dropdown panel) to fully close before we
    // touch the search input — otherwise the closing animation can steal focus
    // or trigger a re-render that wipes our typed search.
    await page.locator(sel.picker.overlayBackdropCss).first()
      .waitFor({ state: 'hidden', timeout: 3000 })
      .catch(() => {});
    return true;
  }

  async function searchAndCheck(searchText) {
    // Wait for the picker's row list to populate after the env switch. 10s
    // covers first-iteration loads where the server hasn't streamed yet.
    const anyRow = dialog.locator(sel.picker.rowCss).first();
    if (!(await tryWaitVisible(anyRow, 10_000))) return false;

    // Find the target row by scrolling the list instead of using the search
    // box. Search was producing flaky results — rows would render "matched"
    // before the picker had finished syncing, so Insert hit a half-loaded
    // selection (ghost-insert). Scroll-and-find reads the same rows the user
    // sees and confirms the row exists before checking it.
    //
    // The list is virtualized (cdk-virtual-scroll), so rows outside the
    // viewport aren't in the DOM. We scroll, check for the row, repeat.
    //
    // Prefer exact-text matching. Substring (hasText) would let "Document Type"
    // pick up "Document Type ID" — leading to ghost-inserts where the picker
    // accepts a row whose name shares a prefix/suffix with the one we wanted.
    const exactRow = dialog
      .locator(sel.picker.rowCss)
      .filter({ has: page.getByText(searchText, { exact: true }) })
      .first();
    const substringRow = dialog
      .locator(sel.picker.rowCss)
      .filter({ hasText: searchText })
      .first();
    // Use the exact matcher as our primary; if scrolling fails to find it (e.g.
    // cell text has surrounding markup that breaks exact match), we'll retry
    // with substring before giving up.
    let targetRow = exactRow;

    // Already visible without scrolling?
    if (await targetRow.isVisible().catch(() => false)) {
      // fall through to selection
    } else {
      // Locate the scroll container. cdk-virtual-scroll-viewport is the standard
      // Material virtualized list. Fall back to any scrollable descendant of the
      // dialog if the picker uses a custom one.
      const viewport = dialog
        .locator(sel.picker.virtualScrollCss)
        .first();
      const hasViewport = await viewport.count() > 0;

      let lastScrollTop = -1;
      let stuckRounds = 0;
      const maxRounds = 80;

      for (let i = 0; i < maxRounds; i++) {
        if (await targetRow.isVisible().catch(() => false)) break;

        let scrollTop;
        if (hasViewport) {
          scrollTop = await viewport
            .evaluate((el) => {
              const before = el.scrollTop;
              el.scrollTop = before + Math.max(200, el.clientHeight - 60);
              return el.scrollTop;
            })
            .catch(() => null);
        } else {
          // Fallback: scroll the dialog itself with the mouse wheel, positioned
          // in the row area.
          const box = await dialog.boundingBox();
          if (!box) break;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(0, 400);
          scrollTop = null;
        }

        await page.waitForTimeout(150);

        if (scrollTop != null && scrollTop === lastScrollTop) {
          // Two consecutive rounds with no scroll progress = hit bottom.
          if (++stuckRounds >= 2) break;
        } else {
          stuckRounds = 0;
          lastScrollTop = scrollTop ?? lastScrollTop;
        }
      }

      if (!(await targetRow.isVisible().catch(() => false))) {
        // Exact match never found it. Retry with the substring fallback —
        // covers cells that have surrounding markup or extra text beyond the
        // name (which would break exact match).
        if (targetRow !== substringRow) {
          targetRow = substringRow;
          if (!(await targetRow.isVisible().catch(() => false))) return false;
        } else {
          return false;
        }
      }
      // Make sure the row is centred so the checkbox click lands cleanly.
      await targetRow.scrollIntoViewIfNeeded().catch(() => {});
    }

    await targetRow.getByLabel(sel.picker.rowToggleLabel).check();
    // After check(), the picker fetches details for the selected resource
    // before Insert is meaningful. Without this wait, Insert fires against a
    // half-loaded selection — the dialog closes ("inserted"), but the resource
    // never lands in the package (ghost-insert).
    await page.waitForTimeout(1000);
    return true;
  }

  // Preferred env first; fall back to Global if not found there.
  await pickEnv(environment);
  let found = await searchAndCheck(name);
  if (!found && hasEnvDropdown && environment !== 'Global') {
    console.log(`   not in ${environment}, retrying in Global`);
    if (await pickEnv('Global')) {
      found = await searchAndCheck(name);
    }
  }
  if (!found) {
    throw new Error(`Row not found for "${name}" in ${environment}${hasEnvDropdown ? ' or Global' : ''}`);
  }

  await page.getByRole('button', { name: sel.picker.insertLabel }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

module.exports = { clickMenuItem, openInsertMenu, insertViaEnvSearchPicker };
