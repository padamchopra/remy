import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['mac', 'hosted'].includes(mode)) {
  console.log('Usage: node scripts/dev-browser.mjs mac|hosted\nmac: Mac app shell in a browser, real local computer, port 5173.\nhosted: Hosted web app shell, live account, port 5174.\nSet REMY_HOSTED_PREVIEW_URL to choose a different hosted backend.');
  process.exit(mode === '--help' ? 0 : 1);
}
const env = { ...process.env };
delete env.VITE_REMY_HUB_MODE;
delete env.VITE_REMY_HUB_URL;
if (mode === 'mac') delete env.REMY_HOSTED_PREVIEW_URL;
else env.REMY_HOSTED_PREVIEW_URL ||= 'https://app.tryremy.dev';
const port = mode === 'mac' ? '5173' : '5174';
console.log(mode === 'mac' ? 'Mac shell in browser — your local Remy data.' : `Hosted web shell — live data from ${env.REMY_HOSTED_PREVIEW_URL}.`);
const child = spawn('npm', ['--prefix', 'web', 'run', 'dev', '--', '--port', port], { cwd:fileURLToPath(new URL('../',import.meta.url)), env, stdio:'inherit' });
child.on('exit', code => process.exit(code ?? 0));
child.on('error', error => {console.error(error.message);process.exit(1);});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
