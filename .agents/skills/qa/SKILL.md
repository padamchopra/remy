---
name: qa
description: Running and clicking Remy to prove current UI and server behavior safely beside the packaged app. Use after changing ANY component, dialog, menu, composer, empty state, shortcut, icon, or server behavior exercised through the UI.
---

# QA

`ui` owns layout and keyboard. `content` owns the words. This skill owns proving the thing works in the running app.

A snapshot of the default paint is not a test.

## Getting a page in front of you

Choose the preview by what changed:

- **UI only:** `npm run dev:web` serves the edited UI at `http://127.0.0.1:5173` against the packaged daemon and real database.
- **Server behavior, or an occupied 5173:** `npm run qa:web` builds the current checkout and starts an isolated daemon and Vite on unused loopback ports. Open the URL it prints. Its temporary database includes a disposable sample workspace and ticket; add `-- --empty` when testing an empty state.

The page does not live-reload — `server.hmr` is `false` in `web/vite.config.ts`. Reload it after every edit, or the screenshot is of the code you had before.

Never quit Remy.app, stop the process on port 8420, or replace its daemon for QA. A thread may be running through that exact process. The sidecar strips inherited `REMY_*` and `MC_*` credentials, uses temporary state, and owns only the processes it starts, so current server code can run beside production without reaching back into it.

Keep `npm run qa:web` running while clicking the app, then stop that command with Ctrl+C. It removes the temporary state. Never kill a process by port or stop another Vite instance. A pass against `npm run dev:web` verifies edited UI against the packaged server; it does not verify a server change.

`npm run qa:web -- --check` is the fast startup and proxy regression check. It is not interaction QA: for a UI or behavior change, use the ordinary command and drive the printed URL.

Playwright drives it with the cached Chromium: `web/scripts/shoot.mjs` is the working example, and `chromiumPath()` in `web/scripts/chromium.mjs` finds the binary.

## What counts as having checked it

Snapshot, click, snapshot again, then measure. A snapshot caption will happily call a staggered menu "fine".

Cover every new or changed control, not one happy path:

- Dropdowns and pickers — open; select something not already selected; select the current value; dismiss with Escape. Opening a menu must not change the value; if it does, the first item is catching the same mouseup.
- Buttons and icon-only actions — click, and confirm the tooltip or `aria-label` names the action.
- Forms — type, submit, Shift+Enter where newlines matter, and submit while empty.
- Empty, error, and populated — the branch you did not stare at is where it breaks.
- File icons — a project PNG is an `img` and item CSS sizes `svg` only, so `WorkspaceIcon` defaults to `size-4`; a well that should fill passes a larger class.

Read state back from the server rather than trusting the screen: the endpoints under `/chats` and `/server/settings` say what actually persisted.

Anything you create while testing — a thread, a workspace, a changed setting — you delete or restore before you finish.

## Named things lead somewhere

Wherever a surface names something that lives elsewhere in Remy — a workspace, a device, an agent, a thread, a ticket, a branch's checkout — it carries that thing's own mark and it opens it. A bare word is a dead end, and the person reading it came to that pane precisely because they wanted the thing behind the word.

So for every entity a feature mentions:

- **Its mark.** A workspace shows its `WorkspaceMark`, a device its `deviceIcon`, an agent its `AgentAvatar`, a ticket its status glyph. The same mark it wears on its own pane, so it is recognised rather than read.
- **Its route.** Clicking it goes there — `#/workspaces/<id>`, `#/tickets/<key>`, a thread by id — and the keyboard reaches it the same way.
- **Its absence.** When the thing is not on this machine, say so in place of the link rather than offering one that goes nowhere. A project with no local clone still has a name; it just has nothing to open.

Walk them: from the ticket pane reach its workspace, its device, its threads and its sub-tickets; from a thread row reach its ticket. A hop that lands on the wrong pane, or a name with no mark beside it, is the finding.

## Alignment

Read `getBoundingClientRect` in the page. If it looks a little off, it is off.

- Icons in a list share one `x`.
- An icon inside a sentence shares the surrounding line. The composer heading in `web/src/components/ChatComposer.tsx` is a flex row and the project well is `1em`, the height of the type, so it sits on the line rather than a step above it.
- A selected row is marked by a trailing `Check`, so it must not shift the row's other columns.

BAD
```
Snapshot the composer. The heading shows the workspace. The menu looks fine. Ship it.
```

GOOD
```
Reload, snapshot the composer. Open the workspace picker; measure icon x on every row and the trailing check on the selected one. Measure the heading: the well and the words share one vertical center. Pick a device, pick a workspace, type in the branch search, pick a branch, open Main checkout vs New worktree, open model and permission, send, and confirm through /chats that the thread carries what the toolbar said.
```

Stop when every new control has been clicked or keyed, the boxes you measured share their columns, and the last snapshot matches what you meant. If the page cannot be reached, say so rather than describing the code instead.
