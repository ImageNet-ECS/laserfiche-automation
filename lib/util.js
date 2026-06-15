// isVisible() doesn't actually wait in Playwright — it returns instantly.
// waitFor({state:'visible'}) is the primitive that polls until the timeout,
// which is what we want when a menu/dialog is still rendering.
async function tryWaitVisible(locator, timeout) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

const readline = require('readline');
function promptUser(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

module.exports = { tryWaitVisible, formatDuration, promptUser };
