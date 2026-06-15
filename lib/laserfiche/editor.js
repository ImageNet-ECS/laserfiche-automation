const { tryWaitVisible } = require('../util');

// Click the toolbar "Save changes" (floppy-disk) button to persist the
// package. The button is disabled until there are unsaved changes, so we wait
// for it to enable; if it never does, there's nothing to save.
async function clickSave(page, sel) {
  const btn = page.locator(sel.editor.saveButtonCss).first();
  if (!(await tryWaitVisible(btn, 8000))) {
    console.warn(`   Save button not found (${sel.editor.saveButtonCss}).`);
    return false;
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await btn.isDisabled().catch(() => true))) break;
    await page.waitForTimeout(300);
  }
  if (await btn.isDisabled().catch(() => true)) {
    console.log('   Save button still disabled — nothing to save.');
    return false;
  }

  await btn.click().catch(() => {});
  await page.waitForTimeout(1500);
  console.log('   saved.');
  return true;
}

module.exports = { clickSave };
