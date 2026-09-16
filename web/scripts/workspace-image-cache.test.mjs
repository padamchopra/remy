import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['src/lib/workspace-image-cache.ts'], bundle: true, write: false, format: 'esm', platform: 'node', absWorkingDir: new URL('..', import.meta.url).pathname });
const { createWorkspaceImageCache } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('navigation reuses loaded images and concurrent requests', async () => {
  const cache = createWorkspaceImageCache();
  let calls = 0;
  const fetchImage = async () => { calls++; return 'image'; };
  await Promise.all([cache.load('org/workspace/icon', fetchImage), cache.load('org/workspace/icon', fetchImage)]);
  assert.equal(cache.peek('org/workspace/icon'), 'image');
  await cache.load('org/workspace/icon', fetchImage);
  assert.equal(calls, 1);
  assert.equal(cache.peek('other/workspace/icon'), undefined);
});
test('bounded cache refreshes stale images and retries failed loads', async () => {
  const cache = createWorkspaceImageCache(1, 0);
  await cache.load('a', async () => 'old');
  await assert.rejects(cache.load('a', async () => { throw Error('offline'); }));
  assert.equal(cache.peek('a'), 'old');
  await cache.load('a', async () => 'new');
  assert.equal(cache.peek('a'), 'new');
  await cache.load('b', async () => 'second');
  assert.equal(cache.peek('a'), undefined);
});
