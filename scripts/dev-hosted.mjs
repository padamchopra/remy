import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The hosted backend's origin allowlist names this exact URL; `localhost`
// redirects here from the preview itself.
const url = 'http://127.0.0.1:5174';
if (process.argv.includes('--help')) {
  console.log(`Usage: npm run dev:hosted\nRuns this checkout's web app against your live hosted account at ${url}.\nSet REMY_HOSTED_PREVIEW_URL to choose a different hosted backend.`);
  process.exit(0);
}
const env = { ...process.env };
delete env.VITE_REMY_HUB_URL;
delete env.MC_SERVER_URL;
delete env.MC_TOKEN;
env.REMY_HOSTED_PREVIEW_URL ||= 'https://app.tryremy.dev';
console.log(`Hosted web shell — live data from ${env.REMY_HOSTED_PREVIEW_URL}.\nOpen ${url}`);
const child = spawn('npm', ['--prefix', 'web', 'run', 'dev', '--', '--port', '5174'], { cwd:fileURLToPath(new URL('../',import.meta.url)), env, stdio:'inherit' });
child.on('exit', code => process.exit(code ?? 0));
child.on('error', error => {console.error(error.message);process.exit(1);});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
