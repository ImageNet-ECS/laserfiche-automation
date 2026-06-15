const { launchContext } = require('./browser');
const { tryWaitVisible } = require('./util');

// Interactive sign-in: open a real browser, pre-fill the non-secret fields
// (account ID + username) for convenience, then hand control to the user to
// complete the password + any SSO/MFA. We never read or store a password —
// only the resulting session is saved to auth.json.
async function interactiveLogin(config, { headed = true } = {}) {
  const sel = config.selectors.login;
  const { browser, context, page } = await launchContext({ headed });

  try {
    await page.goto(sel.startUrl, { waitUntil: 'domcontentloaded' });

    // Best-effort pre-fill. If the SSO flow differs (org SSO, already signed
    // in, a different first screen), skip silently — the user finishes in the
    // window regardless.
    if (config.accountId) {
      const accountField = page.getByRole('textbox', { name: sel.accountIdLabel });
      if (await tryWaitVisible(accountField, 8000)) {
        await accountField.fill(config.accountId).catch(() => {});
        await page.getByRole('button', { name: sel.nextLabel }).click().catch(() => {});
      }
    }
    if (config.username) {
      const userField = page.getByRole('textbox', { name: sel.usernameLabel });
      if (await tryWaitVisible(userField, 8000)) {
        await userField.fill(config.username).catch(() => {});
      }
    }

    console.log('\n=== Sign in ===');
    console.log('A browser window is open. Finish signing in there:');
    console.log('  - enter your password and complete any MFA / SSO prompts');
    console.log('  - the script detects when you reach the app and saves your session');
    console.log('Waiting (up to 5 minutes)...\n');

    const successRe = new RegExp(sel.successUrlPattern, 'i');
    await page.waitForURL(successRe, { timeout: 5 * 60_000 });
    await page.waitForLoadState('load').catch(() => {});
    // A brief client-side bounce sometimes sets extra session cookies after
    // the URL matches; give it a moment, then confirm we weren't kicked back.
    await page.waitForTimeout(2000);

    const loginRe = new RegExp(sel.loginDomainPattern, 'i');
    if (loginRe.test(page.url())) {
      throw new Error(`Login appears to have failed — ended up at ${page.url()}`);
    }

    await context.storageState({ path: config.paths.auth });
    console.log(`Logged in. Saved session to ${config.paths.auth}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { interactiveLogin };
