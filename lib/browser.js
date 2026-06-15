const { chromium } = require('playwright');

// Launch chromium and open a page. When authFile is given the context is
// seeded with that saved session (cookies + storage).
async function launchContext({ headed = false, authFile = null } = {}) {
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext(
    authFile ? { storageState: authFile } : {},
  );
  const page = await context.newPage();
  return { browser, context, page };
}

// Some Insert/Validate clicks pop a JS confirm dialog. One persistent handler
// is cleaner than scattering page.once('dialog', ...) calls (which leak if the
// expected dialog never fires).
function attachDialogDismisser(page, log = console.log) {
  page.on('dialog', (d) => {
    log(`  Dialog dismissed: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
}

module.exports = { launchContext, attachDialogDismisser };
