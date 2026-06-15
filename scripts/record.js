// Open your real deployment package in a browser that's already signed in
// (using the saved session), then drop into the Playwright Inspector so you
// can click through the flow and capture selectors.
//
// Use the Inspector's "Record" and "Pick locator" to grab:
//   - the Insert Resources -> Business Processes menu labels
//   - how the picker behaves (environment dropdown? search box?)
//   - the floppy-disk Save button (hover it to read its title/aria-label)
//   - the business process's row type as shown on the Resources tab
//
//   npm run record            (uses config.json)
//   npm run record -- jobs/foo.json
const fs = require('fs');
const { loadConfig } = require('../lib/config');
const { launchContext, attachDialogDismisser } = require('../lib/browser');

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const configPath = positional[0] || 'config.json';

async function main() {
  const config = loadConfig(configPath);
  if (!fs.existsSync(config.paths.auth)) {
    console.error(`No session found (${config.paths.auth}). Run "npm run setup" or "npm run login" first.`);
    process.exit(1);
  }

  const { browser, context, page } = await launchContext({ headed: true, authFile: config.paths.auth });
  attachDialogDismisser(page);

  console.log(`Opening ${config.target.url} ...`);
  await page.goto(config.target.url, { waitUntil: 'load' });

  console.log('\n=== Playwright Inspector ===');
  console.log('A browser + Inspector window is open and you are signed in.');
  console.log('Click through the flow; use "Pick locator" to copy selectors, and note:');
  console.log('  - Insert Resources -> Business Processes menu labels');
  console.log('  - picker behavior (environment dropdown? search box?)');
  console.log('  - the Save (floppy disk) button title');
  console.log('  - the business process row type on the Resources tab');
  console.log('Press Resume in the Inspector (or close the window) when done.\n');

  await page.pause();

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
