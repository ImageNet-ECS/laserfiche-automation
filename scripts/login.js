// Thin wrapper: re-run interactive sign-in to refresh auth.json. Reads the
// account ID / username from your config so it can pre-fill them; you complete
// the password + MFA in the browser. No password is read or stored.
const { loadConfig } = require('../lib/config');
const { interactiveLogin } = require('../lib/auth');

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const configPath = positional[0] || 'config.json';

async function main() {
  const config = loadConfig(configPath);
  await interactiveLogin(config, { headed: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
