import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareServiceRestart, withAppUpdateGuard, assertAppNotRestarting } from './app-update.js';

test('restart preserves active and pending turns and closes the start gate before shutdown', async () => {
  assert.throws(() => prepareServiceRestart(1), /Wait for your threads/);
  assertAppNotRestarting();
  let finish!: () => void;
  const pending = withAppUpdateGuard(() => new Promise<void>(resolve => { finish = resolve; }));
  assert.throws(() => prepareServiceRestart(0), /Wait for your threads/);
  assertAppNotRestarting();
  finish();
  await pending;
  prepareServiceRestart(0);
  let started = false;
  await assert.rejects(withAppUpdateGuard(async () => { started = true; }), /relaunching/);
  assert.equal(started, false);
});
