import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(web, 'dist');
const temporary = await mkdtemp(join(tmpdir(), 'remy-hub-assets-'));
try {
  await cp(output, temporary, { recursive: true });
  await rm(output, { recursive: true });
  await cp(join(web, 'dist-website'), output, { recursive: true });
  await cp(temporary, join(output, 'app'), { recursive: true });
  const appIndex = join(output, 'app', 'index.html');
  await writeFile(appIndex, (await readFile(appIndex, 'utf8')).replace('<head>', '<head>\n    <base href="/app/" />'));
  await cp(join(temporary, 'assets'), join(output, 'assets'), { recursive: true });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
