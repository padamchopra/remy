import assert from "node:assert/strict";
import test from "node:test";
import { AutomaticUpdate } from "./automatic-update.js";

function fixture() {
  let now = 0;
  let downloads = 0;
  let installs = 0;
  const update = new AutomaticUpdate({
    now: () => now,
    download: () => downloads++,
    install: () => installs++,
    changed: () => {},
  });
  return {
    update,
    advance: (ms: number) => {
      now += ms;
    },
    downloads: () => downloads,
    installs: () => installs,
  };
}

test("automatic updates stay off by default and wait for settled threads", () => {
  const f = fixture();
  f.update.tick(false, true, false);
  f.update.tick(true, false, false);
  f.update.tick(true, true, true);
  assert.equal(f.downloads(), 0);
  f.update.tick(true, true, false);
  assert.equal(f.downloads(), 1);
  f.update.downloaded(true);
  f.update.tick(true, true, false);
  assert.equal(f.update.status.deadline, 30_000);
  f.advance(29_999);
  f.update.tick(true, true, false);
  assert.equal(f.installs(), 0);
  f.advance(1);
  f.update.tick(true, true, false);
  assert.equal(f.installs(), 1);
});

test("new work cancels a countdown and settling starts a full new countdown", () => {
  const f = fixture();
  f.update.tick(true, true, false);
  f.update.downloaded(true);
  f.update.tick(true, true, false);
  f.advance(29_999);
  f.update.tick(true, true, true);
  assert.equal(f.update.status.phase, "waiting");
  assert.throws(() => f.update.relaunch(30_000));
  f.advance(90_000);
  f.update.tick(true, true, false);
  assert.equal(f.installs(), 0);
  assert.equal(f.update.status.deadline, 149_999);
});

test("snooze waits five minutes, then checks activity and gives another thirty seconds", () => {
  const f = fixture();
  f.update.tick(true, true, false);
  f.update.downloaded(true);
  f.update.tick(true, true, false);
  f.update.snooze(30_000);
  assert.throws(() => f.update.relaunch(30_000));
  f.advance(299_999);
  f.update.tick(true, true, false);
  assert.equal(f.update.status.phase, "waiting");
  f.advance(1);
  f.update.tick(true, true, true);
  assert.equal(f.update.status.phase, "waiting");
  f.advance(5000);
  f.update.tick(true, true, false);
  assert.equal(f.update.status.deadline, 335_000);
  f.update.relaunch(335_000);
  assert.equal(f.installs(), 1);
});

test("disabling and disconnecting prevent installation, including a completed download", () => {
  for (const [enabled, connected] of [
    [false, true],
    [true, false],
  ]) {
    const f = fixture();
    f.update.tick(true, true, false);
    f.update.downloaded(true);
    f.update.tick(true, true, false);
    f.advance(30_000);
    f.update.tick(enabled, connected, false);
    assert.equal(f.installs(), 0);
    assert.throws(() => f.update.relaunch(30_000));
  }
});

test("no release checks hourly and failed downloads retry with backoff", () => {
  const f = fixture();
  f.update.tick(true, true, false);
  f.update.downloaded(false);
  f.advance(3_599_999);
  f.update.tick(true, true, false);
  assert.equal(f.downloads(), 1);
  f.advance(1);
  f.update.tick(true, true, false);
  assert.equal(f.downloads(), 2);
  f.update.fail("No connection");
  f.advance(299_999);
  f.update.tick(true, true, false);
  assert.equal(f.downloads(), 2);
  f.advance(1);
  f.update.tick(true, true, false);
  assert.equal(f.downloads(), 3);
});
