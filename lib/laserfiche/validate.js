const { tryWaitVisible } = require('../util');

// Parse one line of the validation warning list.
//   "Rule/LookupTableQuery: LookupTableQuery_7gObaCrJ [Addepar - Get Asset Types for Multi]"
//   -> { fullType, internalId, name, raw }
function parseResourceLine(line) {
  const m = line.trim().match(/^([^:]+):\s*(\S+)\s*\[(.+)\]\s*$/);
  if (!m) return null;
  return { fullType: m[1].trim(), internalId: m[2].trim(), name: m[3].trim(), raw: line.trim() };
}

async function extractMissingResources(page, sel) {
  const list = page.locator(sel.warnings.listCss);
  const count = await list.count();
  if (count === 0) return [];
  const texts = await list.allInnerTexts();
  return texts.map(parseResourceLine).filter(Boolean);
}

async function dismissValidationToast(page, sel) {
  // Multiple toasts can stack; close them all. Cap iterations defensively.
  for (let i = 0; i < 5; i++) {
    const closeBtn = page.locator(sel.warnings.toastCloseCss).first();
    if (!(await closeBtn.isVisible().catch(() => false))) return;
    await closeBtn.click({ timeout: 2000 }).catch(() => {});
    // Brief settle so the next iteration sees an updated DOM.
    await page.waitForTimeout(150);
  }
}

// Click Validate and wait for the warning list to stop changing. The backend
// runs validation asynchronously: the list often goes transiently empty while
// it works, then re-populates with newly-discovered dependencies. A naive 2s
// wait misses items that appear after that.
async function revalidateAndWaitForSettled(page, sel) {
  await page.getByRole('button', { name: sel.warnings.validateLabel })
    .click({ timeout: 5000 })
    .catch(() => {});

  const list = page.locator(sel.warnings.listCss);
  // Grace period for the backend to start processing.
  await page.waitForTimeout(4000);

  // Then poll until the count is unchanged for 2 consecutive seconds, capped
  // at 20s total in case the backend is slow.
  let lastCount = await list.count();
  let stableSince = Date.now();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const count = await list.count();
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 2000) {
      break;
    }
  }

  // After Validate, a toast appears ("Validation successful, but there were
  // warnings."). It's not modal but it lives in an overlay above the picker and
  // intercepts clicks on mat-select. Close it explicitly — more reliable than
  // waiting it out, especially if multiple toasts stack across iterations.
  await dismissValidationToast(page, sel);
}

async function sessionLooksValid(page, protectedUrl, sel) {
  await page.goto(protectedUrl, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const finalUrl = page.url();
  console.log(`Session check landed on: ${finalUrl}`);
  return !new RegExp(sel.login.loginDomainPattern, 'i').test(finalUrl);
}

// Switch back to the JSON Editor tab where the warning banner with the
// warning list lives. After working on the Resources tab, this is how we get
// the view that exposes remaining linked-resource warnings.
async function gotoWarningView(page, sel) {
  // Primary path: the tab strip's "JSON Editor" tab.
  const jsonTab = page.getByRole('tab', { name: sel.warnings.jsonEditorTabLabel, exact: true });
  if (await tryWaitVisible(jsonTab, 3000)) {
    await jsonTab.click().catch(() => {});
    await page.waitForTimeout(400);
  } else {
    // Fallback: the original Validate -> go-to-json-editor-link path used at
    // first navigation. Only reached if the tab strip isn't visible.
    await page.getByRole('button', { name: sel.warnings.validateLabel })
      .click({ timeout: 3000 })
      .catch(() => {});
    const link = page.getByTestId(sel.warnings.jsonEditorLinkTestId);
    if (await link.isVisible().catch(() => false)) {
      await link.click().catch(() => {});
    }
  }

  // Wait for the warning list to render. It may legitimately be empty (no
  // remaining warnings), so don't fail if it never appears.
  await page.locator(sel.warnings.listCss).first()
    .waitFor({ state: 'visible', timeout: 6000 })
    .catch(() => {});
}

module.exports = {
  parseResourceLine,
  extractMissingResources,
  dismissValidationToast,
  revalidateAndWaitForSettled,
  sessionLooksValid,
  gotoWarningView,
};
