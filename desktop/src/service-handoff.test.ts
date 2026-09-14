import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureServiceRelease, type ServiceHealth, type ServiceLifecycle } from './service-handoff';

function fixture(initial: ServiceHealth | undefined) {
  let current = initial;
  const calls: string[] = [];
  const lifecycle: ServiceLifecycle = {
    health: async () => current,
    shutdown: async (instance) => { calls.push(`shutdown:${instance}`); current = undefined; },
    stop: async () => { calls.push('stop'); },
    install: async () => { calls.push('install'); current = { ok: true, release: 'new', instance: 'replacement' }; },
    wait: async () => {},
  };
  return { calls, lifecycle, set: (health: ServiceHealth | undefined) => { current = health; } };
}

test('a healthy stale process must be replaced even when the startup file is current', async () => {
  const f = fixture({ ok: true, release: 'old', instance: 'orphan' });
  await ensureServiceRelease('new', f.lifecycle);
  assert.deepEqual(f.calls, ['shutdown:orphan', 'stop', 'install']);
});

test('current process is reused without restarting active work', async () => {
  const f = fixture({ ok: true, release: 'new', instance: 'current' });
  await ensureServiceRelease('new', f.lifecycle);
  assert.deepEqual(f.calls, []);
});

test('legacy process requires a one-time migration without killing it', async () => {
  const f = fixture({ ok: true });
  await assert.rejects(ensureServiceRelease('new', f.lifecycle), /restart your Mac/);
  assert.deepEqual(f.calls, []);
});

test('busy shutdown rejection never unloads or replaces the service', async () => {
  const f = fixture({ ok: true, release: 'old', instance: 'busy' });
  f.lifecycle.shutdown = async () => { throw new Error('Wait for your threads'); };
  await assert.rejects(ensureServiceRelease('new', f.lifecycle), /Wait for your threads/);
  assert.deepEqual(f.calls, []);
});

test('a replacement with the wrong release is never accepted', async () => {
  const f = fixture(undefined);
  f.lifecycle.install = async () => f.set({ ok: true, release: 'old', instance: 'wrong' });
  await assert.rejects(ensureServiceRelease('new', f.lifecycle), /could not finish updating/);
});

test('an orphan that does not exit prevents installation', async () => {
  const f = fixture({ ok: true, release: 'old', instance: 'orphan' });
  f.lifecycle.shutdown = async () => {};
  await assert.rejects(ensureServiceRelease('new', f.lifecycle), /could not stop/);
  assert.deepEqual(f.calls, ['stop']);
});
