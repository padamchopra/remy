---
name: product-design
description: Product structure, platform parity, and ownership in Remy. Use before making ANY product decision that changes a screen, control, setting, default, integration, automation, agent behavior, entity relationship, or deletion behavior.
---

# Product design

`ui` owns layout and interaction. `content` owns the words. `qa` owns proving the result. This skill owns the product model they express. Redesigns and new capabilities' UI use Base UI; see `ui`.

## Web and desktop parity

The hosted web app, desktop browser shell, and Mac app expose the same capabilities for the same concept by default. Match controls, navigation, editing, icon choices, defaults, and visual hierarchy. This applies to the web product, not the marketing website's page layout.

Before designing or changing a surface, inspect its counterpart in the running app and source. Reuse shared components and interaction patterns; adapt the data source behind them when platforms reach the same capability differently. A missing endpoint, separate implementation, or unfinished integration is work to complete, not a platform exception.

Allow a difference only when the capability genuinely depends on the platform or its role: attaching the current Mac requires the desktop app; a Mac download action belongs on the web. Name the concrete constraint for every exception. Missing credentials or an unavailable computer calls for a connection or availability state, not removal of a capability the platform can support.

BAD
```text
Desktop: open workspace details in the main pane and select a repository image as its icon.
Web: open an edit modal and offer only built-in icons because there is no local filesystem.
```

GOOD
```text
Both: open workspace details in the main pane with the same icon picker and Glyph/Image choices.
Desktop reads images from the checkout; web reads them through an authorized repository or computer connection.
```

Verify the same user journey on both surfaces, including saved state after refresh. Report remaining differences and their actual platform constraints; do not call a shared-looking subset parity. This is a design and review requirement, not an automated check.

Sidebar thread rows are one of those shared surfaces. Hosted `HubThreadSidebar` and Mac `AppSidebar` both render `ThreadMenu` — the same right-click `ContextMenu` and hover ⋯ `DropdownMenu`. Item order and enablement come from `threadMenuGroups` in `web/src/lib/thread-menu.ts`. A missing hosted endpoint is work to complete, not a reason to drop the item or fork the menu. Allow a difference only when the platform cannot support the action: hosted threads cannot start a subthread.

BAD
```text
Mac: ThreadMenu with pin, rename, copy link, start subthread, archive, delete.
Web: a separate HubThreadMenu, or a shorter list, because hosted routes were never wired.
```

GOOD
```text
Both: ThreadMenu. Hosted adapts pin, rename, archive, and delete onto hub routes.
Hosted omits Start subthread because that action has no hosted API.
```

Hosted menu enablement follows hub ownership, not Mac daemon reachability. Pin, rename, archive, and delete stay usable when a cloud computer is idle, missing from the computers list, or marked stale. The hub can wake that computer. Disable an item only when the person cannot write or the thread is still pending. Copying a link does not need write access.

BAD
```text
Hosted: disable every ThreadMenu item unless the computers list has that row online.
```

GOOD
```text
Hosted: enable pin, rename, archive, and delete when you can write.
A missing or idle cloud computer is not a disabled menu.
```

## Organization selection is a viewing filter

Remy presents one place for one user who can belong to multiple organizations. The account switcher filters that shared view: All includes Personal and every accessible organization; selecting Personal or an organization narrows the same surface.

Do not divide a screen into organization sections or repeat its heading, add button, composer, or empty state per organization. Use one list or context area for the selected view across threads, workspaces, tasks, and settings. Show ownership on an item only where it helps the user make a decision.

Viewing scope and ownership are separate. Creation lets the user choose Personal or an organization, preselecting the current filter when applicable. Existing items retain their owner and permissions; opening, editing, inviting, or deleting targets that owner without treating All as an owner or widening access. Organization administration opens explicitly from that organization's settings control.

BAD
```text
Workspaces → All
Personal: Add workspace + list
Remy: Add workspace + empty state
```

GOOD
```text
Workspaces → All
One Add workspace button + one combined list
Add workspace → Account: Personal / Remy
Select Remy in the switcher → the same list, filtered to Remy
```

## An escape hatch stays reachable where it is needed

A fallback for a blocked path is not first-run scenery. Offer it in the state where the person discovers they need it, which is usually not the state where they first saw it.

A personal access token is the worked example. It looks like the alternative to connecting GitHub, so it is tempting to show it only when nothing is connected. But the case it solves — a repository in an organization that will not install Remy — is invisible until the connection succeeds and the list comes back missing those repositories. Gated behind a missing connection, the way out disappears exactly when it is wanted.

Before restricting an alternative path to one state, ask when the person learns they need it. If that moment is later, the path belongs there too, and its copy says what it is for in that state.

BAD
```
Show the token only when GitHub is not connected; a connected account does not need one.
```

GOOD
```
Keep the token reachable after connecting, and say there what it is for: repositories in an organization that has not installed Remy.
```

Say what an alternative costs. When it replaces a credential, a setting, or a connection rather than adding to it, the surface that offers it says so in a sentence.

## Connections are grouped by provider

Connections is one account-wide list, like Computers. Show one block for each provider and put every connected account inside it. Once a provider has an account, its add action becomes a `+` in that block instead of creating another provider section.

Availability is part of connecting an account. A Personal connection is available to every organization the person belongs to. An organization connection is available only there and overrides the Personal connection for that organization. Keep credentials on the person who connected them; availability never copies a secret into an organization.

BAD
```text
Connections
padamchopra · Personal
padamchopra · Jupiter Global
padamchopra · Remy
```

GOOD
```text
GitHub                                      [+]
padamchopra              All organizations
release-bot              Jupiter Global

Linear                                      [+]
Remy workspace            Remy
```

## Model the capability first

Name the capability, its durable owner, the actor that performs it, the event that triggers it, and what happens when either owner or actor disappears before choosing a screen or schema.

A setting lives with the thing whose behavior it controls. The actor that carries out that behavior is a reference, not the owner, when another actor could reasonably take its place.

- A machine integration belongs to that machine's settings. Hosted thread start uses the providers enabled on the chosen computer, including a cloud computer's OpenRouter, Router, OpenAI, and Anthropic access. A cloud computer shared into an organization carries that source account's enabled model access. A Remy-wide OpenRouter default does not start on an organization that has no OpenRouter key and no shared computer that does.
- A Personal computer or cloud connection shared into an organization is a start grant. The member who owns that computer or connection can share it, unshare it, and choose which of its advertised providers other members may use to start a new thread. Administrators can revoke the grant; they cannot configure someone else's machine. Sharing turns every currently advertised provider on. The owner can always start with any provider on that computer, and always sees that computer in the thread picker for every organization they belong to. Turning share off hides it from other members, not from the owner. Other members can still reply, approve, and otherwise contribute on threads that already exist. An account can keep multiple named Fly.io, OpenRouter, and other integration keys; sharing and new work use the active key.
- A shared cloud computer advertises the source account's enabled model access — OpenRouter, Router, OpenAI, Anthropic — not the Codex or Claude runtime those gateways execute through. Codex appears only when Codex itself is configured.
- Hosted Model access is API keys. ChatGPT device-code and Claude Code account login belong on a computer you own. Do not start those logins on a Fly, Modal, or other hosted computer.

BAD
```text
Cloud Model access offers Connect Claude Code and Connect Codex, then injects that session onto a sprite.
```

GOOD
```text
Cloud Model access saves Anthropic, OpenAI, Router, and OpenRouter keys.
Computers → Connected signs in to Claude Code and Codex on a computer you own, or sets an API key there.
```

BAD
```text
Apollo is Personal and not shared with Remy.
A new Remy thread only offers Cloud · Fly.io Sprites.
```

GOOD
```text
Apollo is Personal and not shared with Remy.
The owner still sees Apollo next to Cloud in that thread’s computer picker.
Other members do not.
```

BAD
```text
Fly.io is shared from Personal, where OpenRouter is on.
Organization → Computers shows a Codex toggle under Fly.io Sprites.
```

GOOD
```text
Fly.io is shared from Personal, where OpenRouter is on.
Organization → Computers shows OpenRouter under Fly.io Sprites.
Codex stays off the row unless that account actually configured Codex.
```

Named integration keys belong to that account’s Computers settings. Management APIs return names and configured state, never values. Values stay encrypted at rest and out of logs, prompts, and snapshots. Agent capabilities cannot create, read, or replace them.

BAD
```text
GET /hosted returns the Fly.io token. A thread can add an OpenRouter key.
```

GOOD
```text
Computers lists Production and Preview Fly.io keys, and Primary and Team OpenRouter keys.
GET returns those names. A computer session cannot add or read a key.
```
- Repository behavior belongs to the workspace or repository identity it follows.
- Personal behavior and instructions belong to an agent.
- One conversation's presentation or execution state belongs to that thread.

Put the control where someone looks for the capability. Do not put it on the current implementation of that capability merely because the code already has that object in hand.

## Scope overrides

A broad owner supplies the default and a narrower owner may override it. The most specific explicit choice wins: Remy-wide → workspace → one pull request or thread.

Keep the same capability and state model at every scope, but use the choices the current context makes possible. Show which broader scope is being inherited and provide a way back to that default after an override. A lower scope starts from the effective values above it rather than from unrelated hard-coded defaults.

Treat useful context as a first-class option. A pull request shown inside a thread can be monitored in that thread, assigned to an agent, turned off, or returned to its inherited default. A machine or workspace setting cannot offer “this thread” because no thread is present there.

The surface that exposes a control is not automatically the setting's owner. A pull request tool inside a thread edits that pull request's policy, keyed by the pull request identity, so opening the same pull request in another thread does not create a second conflicting policy.

## Presets are templates

An agent preset supplies creation-time defaults. After creation, the agent is an ordinary editable and deletable agent; runtime behavior never branches on its preset, handle, name, or seeded id.

When a capability needs an agent, store an explicit agent id and let any eligible agent be selected. Define deletion in the same design: a missing selected agent disables the capability and asks for another selection rather than silently choosing a special preset.

Automation that starts work without a direct action is off by default. Enabling the automation and choosing who performs it remain explicit, inspectable choices.

## Pull request monitoring

BAD
```text
Settings → Agents → GitHub agent
Monitor pull requests  [on/off]
```

This makes a machine integration look intrinsic to one deletable preset, prevents an arbitrary agent from taking over, and makes deletion or duplication ambiguous. Code shaped as `agent.preset === "github"` or `agentByHandle("github")` is the same product mistake below the UI.

GOOD
```text
Settings → Version control
Monitor pull requests  [off]          Remy-wide default
Handled by             [Agent picker]

Workspace settings
Monitor pull requests  [default]      Workspace override
Handled by             [default]

Thread → Pull request tool → Monitor
Use workspace default
Off
In this thread
With an agent
  Builder
  QA
```

The machine setting owns the default. A workspace can override every pull request it contains, and one pull request can override its workspace from the tool already showing it. The pull request override may target its current thread or an explicit agent id. Deleting the target thread or agent turns that policy off until another destination is chosen. The GitHub preset remains an optional starting point with no privileged runtime behavior.

## Review the lifecycle

Before implementation, check the proposal against creation, rename, duplication, deletion, synchronization across devices, unavailable actors, and a fresh install. A design is incomplete when one of those states changes who owns the behavior or leaves work running without a visible controlling setting.
