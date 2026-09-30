import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addAppTab,
  closeAppTab,
  focusAppTab,
  navigateAppTab,
  newAppTabs,
  splitAppTab,
} from '../src/lib/app-tabs.ts';

test('each tab keeps its route while the focused tab changes', () => {
  const first = navigateAppTab(newAppTabs({ name: 'threads' }), { name: 'threads', threadId: 'one' });
  const second = addAppTab(first, { name: 'prs' });
  const third = addAppTab(second, { name: 'settings', tab: 'general' });
  assert.deepEqual(third.tabs.map((tab) => tab.route.name), ['threads', 'prs', 'settings']);
  assert.equal(focusAppTab(third, first.focused).tabs[2].route.name, 'settings');
  assert.equal(focusAppTab(third, first.focused).focused, first.focused);
});

test('a split has two panes and moves focus with the chosen tab', () => {
  const first = newAppTabs({ name: 'threads', threadId: 'one' });
  const split = splitAppTab(first, 'horizontal', { name: 'threads', threadId: 'two' });
  assert.equal(split.split?.first, first.focused);
  assert.equal(split.split?.second, split.focused);
  const third = addAppTab(split, { name: 'prs' });
  assert.equal(third.split?.second, third.focused);
  assert.equal(third.tabs.length, 3);
  const focused = focusAppTab(third, first.focused);
  assert.equal(focused.split?.first, first.focused);
  assert.equal(closeAppTab(focused, first.focused).split, undefined);
});

test('splitting with another open tab reuses it', () => {
  const first = newAppTabs({ name: 'threads', threadId: 'one' });
  const second = addAppTab(first, { name: 'prs' });
  const split = splitAppTab(second, 'vertical', { name: 'threads' });
  assert.equal(split.tabs.length, 2);
  assert.equal(split.split?.first, second.focused);
  assert.equal(split.split?.second, first.focused);
});
