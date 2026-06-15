const fs = require('fs');
const path = require('path');

// Returns snapshot(page, label): writes a numbered step folder under
// <stepsDir>/<runId>/ containing a full-page screenshot, the page HTML, and a
// meta.json — the per-step record used to inspect a run after the fact.
function makeSnapshotter(stepsDir, runId) {
  let i = 0;
  return async function snapshot(page, label) {
    i += 1;
    const safe = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 80);
    const dir = path.join(stepsDir, runId, `${String(i).padStart(3, '0')}-${safe}`);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true });
    fs.writeFileSync(path.join(dir, 'page.html'), await page.content());
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({ url: page.url(), title: await page.title(), label }, null, 2),
    );
  };
}

module.exports = { makeSnapshotter };
