---
name: qa
description: Usability and behavior review in running Remy. Use when reviewing ANY user journey, recording PR artifacts, or changing a component, dialog, menu, composer, empty state, shortcut, icon, or server behavior exercised through the UI.
---

# QA

`ui` owns layout and keyboard. `content` owns the words. This skill owns proving the thing works in the running app.

A snapshot of the default paint is not a test.

## Review the user journey

QA includes design and UX gaps. Walk the affected journey from its real entry point to a useful outcome, using only information and actions available in the interface. For onboarding, start signed out with no computers or workspaces and reach a first thread response. Exercise each supported setup path with its deployment-enabled authentication and prerequisites; a seeded account or local preview does not establish that hosted onboarding works.

At each step, judge whether the purpose and next action are clear, the requested information is necessary, the hierarchy keeps the main action obvious, and loading, success and failure explain what happens next. Follow handoffs between the browser, desktop and external providers. Exercise missing prerequisites, cancellation and retry, including keyboard and narrow layouts.

Record observed friction with its starting state, action, consequence and proposed fix. Missing actions, misleading copy, unnecessary decisions and inaccessible controls are findings even when requests succeed. Fix gaps within the authorized scope and repeat the affected journey. Ask for a product decision only when the resolution needs one; do not silently defer a usability finding because it is not a code defect.

Distinguish observed behavior from code-based hypotheses and subjective alternatives. Record untested steps and their concrete blockers. A required journey that cannot complete or has unresolved usability blockers is not ready; passing builds, screenshots and component checks do not close it. This is a review convention, not an automated gate.

BAD
```text
The sign-in buttons render, a seeded account creates a ticket, and the build passes. Onboarding passes.
```

GOOD
```text
Start with an empty account, follow the computer setup handoff, add a workspace and send a request. Report a missing next action as a usability finding, fix it, and repeat the flow. Keep an external sign-in step explicitly unverified if its provider cannot be exercised.
```

## Getting a page in front of you

Choose the preview by what changed:

- **UI only:** `npm run dev:web` serves the edited UI at `http://127.0.0.1:5173` against the packaged daemon and real database.
- **Server behavior, or an occupied 5173:** `npm run qa:web` builds the current checkout and starts an isolated daemon and Vite on unused loopback ports. Open the URL it prints. Its temporary database includes a disposable sample workspace and ticket; add `-- --empty` when testing an empty state.
- **Hosted web:** build with `npm run build:hub --prefix web` and use the isolated hosted setup in `hub/docs/web.md`. The local daemon preview does not exercise hosted runtime selection, account permissions, or cloud availability.

Match the hosted fixture's asset routing and runtime configuration to the deployment configuration. Open its printed URL and confirm it reaches the authenticated app before running a journey; serving the public homepage or a development-only asset layout is not hosted app coverage.

Probe `http://127.0.0.1:5173` before starting Vite. If it already responds, do not retry `npm run dev:web`: reuse it only for a UI-only change, and use `npm run qa:web` for current server code.

The page does not live-reload — `server.hmr` is `false` in `web/vite.config.ts`. Reload it after every edit, or the screenshot is of the code you had before.

Never quit Remy.app, stop the process on port 8420, or replace its daemon for QA. A thread may be running through that exact process. The sidecar strips inherited `REMY_*` and `MC_*` credentials, uses temporary state, and owns only the processes it starts, so current server code can run beside production without reaching back into it.

Keep `npm run qa:web` running while clicking the app, then stop that command with Ctrl+C. It removes the temporary state. Never kill a process by port or stop another Vite instance. A pass against `npm run dev:web` verifies edited UI against the packaged server; it does not verify a server change.

`npm run qa:web -- --check` is the fast startup and proxy regression check. It is not interaction QA: for a UI or behavior change, use the ordinary command and drive the printed URL.

Use Remy's browser tools when they are available. For an ad-hoc Playwright check, run from `web/`, where `playwright-core` is installed; `web/scripts/shoot.mjs` is the working example and `chromiumPath()` in `web/scripts/chromium.mjs` finds the binary.

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

## Regression tests

For a behavior bug, reproduce the reported starting state in an executable test and observe it fail before applying the fix. Assert the useful outcome and the forbidden side effect at the boundary that failed; a rendered heading alone does not prove that the controls or requests are correct. Run the test after the fix and wire it into the relevant CI job. Read the workflow before claiming that an existing test runs automatically.

For shared local and hosted UI, exercise runtime selection with both a fresh browser and saved state from an earlier session. Cover the affected personal and organization routes through navigation and direct reload, on desktop and a touch phone viewport. Confirm that hosted pages do not issue local APIs, and that available, unavailable, and retry states retain their intended actions. Search sibling consumers of the same runtime or cache before limiting the fix to one component.

`web/scripts/hosted-runtime-check.mjs` is the built-app regression for this boundary, run by `.github/workflows/hub.yml`. Its controlled API responses prove client behavior; use the isolated hosted setup for real authentication and backend integration, and report external provider steps separately.

BAD
```text
The sign-in screen loads in a fresh browser. The web tests pass.
```

GOOD
```text
Load Computers with a saved local computer in browser storage. Verify cloud setup and notifications, reload the account route, retry unavailable hosting, and reject any local computer API request. Keep this regression in CI alongside the fresh-profile case.
```

## Recording PR artifacts

Record a slower showcase with safe sample state. Let the viewer read the starting screen, follow each action, and inspect its result before moving on.

- Show the pointer and a visible click indicator in the captured video. Enable the recorder's click highlight, or use a temporary capture-only pointer and click overlay when supported. Keep it clear of labels and remove it after capture; do not add recording decoration to the product.
- Move the pointer visibly to each target, pause over it, then click. Leave menus, selections, and changed states open long enough to read. Scroll smoothly and pause at the content being demonstrated.
- Type short, meaningful sample text at a readable human pace. Prepare long setup text before recording; avoid instant field fills or paste bursts during the demonstrated interaction. Pause after typing so the viewer can read before submission.
- Keep playback at normal speed and preserve real loading and animation timing. Do not fast-forward clocks or speed up the interaction. Trim idle setup and unrelated waits outside the demonstrated behavior.
- Play the exported recording at normal speed before upload. Confirm that the pointer and click indicators survived capture, text is readable, and the final result stays visible long enough to inspect. Re-record any rushed passage.

BAD
```
Open the workspace picker, instantly select a row, fill the composer in one insertion, and send before the viewer can read it.
```

GOOD
```
Hold on the composer. Move to the workspace picker and show the click. Pause on the choices, select a workspace, and let the selection settle. Type a short prompt visibly, pause to read it, then show the send click and hold on the resulting thread.
```

## Remote live state

Use this scenario after changing peer transport, subscriptions, caching, remote detail loading, reconnect behavior, or a view whose state can be owned by another device.

- Open a real thread owned by another available device and keep its hash route visible.
- Record catalogue and detail request counts before judging the paint.
- Observe a remote turn while it changes; the feed updates without switching threads, changing sections, or reloading.
- In an isolated paired test, disconnect and reconnect the peer stream; missed entries arrive once, in order, without replacing useful cached content during the gap.
- In an isolated paired test, restart or reset the remote stream; the open detail performs a full read when it cannot resume.
- Reload the remote thread's deep link; it stays on that route while the remote catalogue answers and does not flash the composer for a different thread.
- Hide and show the window; foregrounding does not create overlapping detail reads.

Do not send, interrupt, restart, or otherwise mutate somebody's active production thread merely to create an update. Observe existing safe activity, use disposable paired instances, or report that live interaction proof is unavailable.

A UI preview against the packaged daemon does not prove current server relay code. Pair it with the relay integration test or an isolated current-server run, and state which boundary each result covers.

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
