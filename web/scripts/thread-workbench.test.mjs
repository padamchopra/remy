import assert from "node:assert/strict";
import test from "node:test";
import { cycleTab, focusedGroup } from "../src/lib/thread-workbench.ts";

const workbench = {
  focused: "left",
  root: {
    type: "split",
    id: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: {
      type: "group",
      id: "left",
      active: "thread-1",
      tabs: [
        { kind: "thread", threadId: "thread-1" },
        { kind: "terminal", threadId: "thread-1" },
      ],
    },
    second: {
      type: "group",
      id: "right",
      active: "browser:thread-1:default",
      tabs: [
        { kind: "browser", threadId: "thread-1", browserId: "default" },
        { kind: "pull-request", threadId: "thread-1" },
      ],
    },
  },
};

test("cycles open surfaces in visual order across panes", () => {
  const terminal = cycleTab(workbench, 1);
  assert.equal(focusedGroup(terminal).active, "terminal:thread-1");
  assert.equal(terminal.focused, "left");

  const browser = cycleTab(terminal, 1);
  assert.equal(focusedGroup(browser).active, "browser:thread-1:default");
  assert.equal(browser.focused, "right");
});

test("cycles backward and wraps without changing the layout", () => {
  const previous = cycleTab(workbench, -1);
  assert.equal(focusedGroup(previous).active, "pull-request:thread-1");
  assert.equal(previous.focused, "right");
  assert.deepEqual(previous.root.first.tabs, workbench.root.first.tabs);
  assert.deepEqual(previous.root.second.tabs, workbench.root.second.tabs);
});

test("leaves a one-surface workbench alone", () => {
  const single = {
    focused: "only",
    root: { type: "group", id: "only", active: "thread-1", tabs: [{ kind: "thread", threadId: "thread-1" }] },
  };
  assert.equal(cycleTab(single, 1), single);
});
