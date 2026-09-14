import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

// Both processes use copied code and temporary state; neither can reach the
// user's running service or read its credentials through inherited variables.
test('an authenticated idle handoff replaces the actual listener and preserves state', { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'remy-handoff-'));
  const state = join(root, 'state');
  const bundle = join(root, 'server');
  const token = randomBytes(32).toString('hex');
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  mkdirSync(state);
  mkdirSync(bundle);
  const db = new DatabaseSync(join(state, 'remy.db'));
  db.exec('create table kv (key text primary key, value text not null)');
  db.prepare('insert into kv values (?, ?)').run('config', JSON.stringify({ port, token, automaticUpdates: false }));
  db.close();
  const source = fileURLToPath(new URL('../', import.meta.url));
  cpSync(join(source, 'dist'), join(bundle, 'dist'), { recursive: true });
  symlinkSync(join(source, 'node_modules'), join(bundle, 'node_modules'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MC_') || key.startsWith('REMY_')) delete env[key];
  const children: ReturnType<typeof spawn>[] = [];
  const request = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(2_000),
  });
  const launch = async (release: string) => {
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ type: 'module', version: release }));
    const child = spawn(process.execPath, [join(bundle, 'dist/index.js')], { env: { ...env, MC_CONFIG_DIR: state, REMY_SERVER_RELEASE: 'stale-plist' }, stdio: 'pipe' });
    children.push(child);
    let output = '';
    child.stdout!.on('data', b => { output += b; });
    child.stderr!.on('data', b => { output += b; });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Isolated service exited: ${output.slice(-2000)}`);
      try { const response = await request('/health'); if (response.ok) return { child, health: await response.json() as { release: string; instance: string } }; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Isolated service did not start: ${output.slice(-2000)}`);
  };
  try {
    const first = await launch('old');
    assert.equal(first.health.release, 'old');
    assert.ok(first.health.instance);
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ type: 'module', version: 'new' }));
    assert.equal((await (await request('/health')).json() as { release: string }).release, 'old');
    const denied = await request('/server/update/shutdown', { method: 'POST', headers: { Authorization: '' }, body: JSON.stringify({ instance: first.health.instance }) });
    assert.equal(denied.status, 401);
    const stale = await request('/server/update/shutdown', { method: 'POST', body: JSON.stringify({ instance: 'other-process' }) });
    assert.equal(stale.status, 409);
    assert.equal((await request('/health')).status, 200);
    const exit = once(first.child, 'exit');
    const stopped = await request('/server/update/shutdown', { method: 'POST', body: JSON.stringify({ instance: first.health.instance }) });
    assert.equal(stopped.status, 202);
    assert.deepEqual(await exit, [0, null]);
    const second = await launch('new');
    assert.equal(second.health.release, 'new');
    assert.notEqual(second.health.instance, first.health.instance);
    assert.equal((await request('/server/hub/computer')).status, 200);
    assert.equal((await request('/server/hub/authorize', { method: 'POST', body: '{}' })).status, 400);
    const preserved = new DatabaseSync(join(state, 'remy.db'), { readOnly: true });
    const row = preserved.prepare("select value from kv where key = 'config'").get() as { value: string };
    assert.equal(JSON.parse(row.value).token, token);
    preserved.close();
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
