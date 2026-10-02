---
name: product-design
description: Product structure, platform parity, and ownership in Remy. Use before making ANY product decision that changes a screen, control, setting, default, integration, automation, agent behavior, entity relationship, or deletion behavior.
---

# Product design

`ui` owns layout and interaction. `content` owns the words. `qa` owns proving the result. This skill owns the product model they express. Redesigns and new capabilities' UI use Base UI; see `ui`.

## The web app is the only client

The web app is the only client; the daemon and CLI connect computers to it. The Mac app, the phone app and the web UI's local mode are gone. A capability a person uses belongs in the hosted web app and reaches a computer through the hub; the daemon and the `remy` CLI exist to sign a computer in, keep it connected and run its threads.

Do not add a window, a browser shell against a daemon's `/api`, or a daemon-only settings screen. A setting that lives on a computer is edited from the web app through that computer's hub connection. Pairing, peers, `board_log` sync between daemons, Tailscale exposure and the device consent flows are gone; shape multi-computer work on hub computers, organizations and grants.

BAD
```text
Add a toggle to the daemon's local settings page, and pair a second Mac over the tailnet to share it.
```

GOOD
```text
Add the toggle to the computer's page in Settings → Computers. The hub carries it to the computer.
Each computer signs in with remy login and appears in the same account.
```

## Shared components

The centre view holds app tabs for threads, pull requests, workspaces, and settings. A split shows at most two tabs, with a draggable divider that remembers its ratio on this device. The sidebar and address follow the focused pane, while the other open tabs keep their state. The app strip owns work-surface tabs: panes cannot create another app-tab collection, and a thread has no inner tab strip, Add tab control, or tab-navigation back button. Thread details and running work belong beside the reply controls.

The website's product preview draws the same components as the web app with sample state. Reuse shared components and interaction patterns rather than forking a second one for a surface; a missing endpoint, separate implementation, or unfinished integration is work to complete. Missing credentials or an unavailable computer calls for a connection or availability state, not removal of a capability the web app can support.

Sidebar thread rows are one of those shared surfaces. Hosted `HubThreadSidebar` and `AppSidebar` (the website preview) both render `ThreadMenu` — the same right-click `ContextMenu` and hover ⋯ `DropdownMenu`. Item order and enablement come from `threadMenuGroups` in `web/src/lib/thread-menu.ts`. A missing hosted endpoint is work to complete, not a reason to drop the item or fork the menu. Allow a difference only when the platform cannot support the action: hosted threads cannot start a subthread.

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

Hosted menu enablement follows hub ownership, not daemon reachability. Pin, rename, archive, and delete stay usable when a cloud computer is idle, missing from the computers list, or marked stale. The hub can wake that computer. Disable an item only when the person cannot write or the thread is still pending. Copying a link does not need write access.

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

Do not divide a screen into organization sections or repeat its heading, add button, composer, or empty state per organization. Use one list or context area for the selected view across threads, workspaces, and settings. Show ownership on an item only where it helps the user make a decision.

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

Linear is always personal, including inside an organization. Each person chooses which of their Linear workspaces they use there. Another member, including an administrator, cannot see, use, or change that choice. Personal may supply that same person's fallback, but there is no organization-wide Linear connection.

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

- A machine integration belongs to that machine's settings. Compute placement and model credentials are independent choices. Enrolling a cloud key in an organization lets members run there, but never carries the key owner's model access into the organization. Each thread uses a model credential its starter owns or an exact model key enrolled for everyone in that organization.
- Computers is one account-wide inventory of everything the person can use. Show each cloud provider once and Model access once; put named keys and organization availability inside that row's detail page instead of repeating the row for each account. Resources they own are editable. Resources another member enrolled in an organization are read-only and name their owner and organization. Do not narrow this inventory with the account switcher or repeat the same resource for each organization that grants it.
- A Personal computer or cloud connection enrolled in an organization is a start grant. The member who owns that computer or connection can enroll it, remove it, choose specific named cloud keys, and choose which of its advertised providers other members may use to start a new thread. Administrators can revoke the grant; they cannot configure someone else's machine or credential. The owner always sees their own computer and cloud connections in the picker for every organization they belong to, even when they are not enrolled. Turning enrollment off hides it from other members, not from the owner. Other members can still reply, approve, and otherwise contribute on threads that already exist.
- A cloud placement advertises compute only. The model picker independently lists the starter's personal credentials and exact model keys enrolled in the organization. Never infer model access from who owns the cloud key.
- A model-access subscription or key belongs to the person, like any Personal connection. The owner may use it for their own threads in every organization they belong to without enrolling it. Enrolling a specific named key in an organization lets every member use that credential. The model picker shows the credential owner and key name and stores that exact grant on the thread. Administrators can revoke an enrollment; they cannot read or configure another member's credential. Cloud Codex signs in with ChatGPT once in Personal model access; the hub holds the tokens under that Personal scope, and cloud task computers borrow short-lived access tokens. Claude Code account login stays on computers you own, because Anthropic's terms do not allow Claude subscriptions in third-party products; cloud Claude uses an Anthropic API key.

BAD
```text
An organization admin connects ChatGPT for a workspace, and every member's cloud thread runs on it.
Cloud Model access offers Connect Claude Code, then injects that session onto a sprite.
```

GOOD
```text
Computers → Model access: Codex → Connect Codex with a ChatGPT device code.
Organizations → Computers and models: enroll Production OpenAI for everyone, or leave it Personal for only your threads.
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
Production Fly.io is enrolled in Remy, so every member can use its owner's OpenRouter key.
```

GOOD
```text
Production Fly.io is enrolled in Remy, so every member can choose it as compute placement.
Each member chooses their own model key, or an exact model key separately enrolled in Remy.
```

Named integration keys belong to the person’s Computers settings. Organization grants reference their stable key ids; they never copy a secret. Management APIs return names and configured state, never values. Values stay encrypted at rest and out of logs, prompts, and snapshots. Agent capabilities cannot create, read, or replace them.

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

A new thread's model default lives on the computer, never on the workspace, the account or in Settings → General. The composer resolves it as: your pick → your default for that computer → the provider's own default. A workspace has no access list either: everyone who can use its owner can use it. A thread started from the composer starts on Ask unless the person chooses another permission mode. An agent-created thread inherits the sending thread’s effective permission mode, alongside its computer, folder, provider, model, reasoning level, and visibility. The person remains the owner; messages sent by an agent identify its provider and link to its source thread. Review agents can delegate too. A child has its own conversation and does not inherit the parent’s review attachment.

Keep the same capability and state model at every scope, but use the choices the current context makes possible. Show which broader scope is being inherited and provide a way back to that default after an override. A lower scope starts from the effective values above it rather than from unrelated hard-coded defaults.

Treat useful context as a first-class option. A pull request shown inside a thread can be monitored in that thread, assigned to an agent, turned off, or returned to its inherited default. A machine or workspace setting cannot offer “this thread” because no thread is present there.

The surface that exposes a control is not automatically the setting's owner. A pull request tool inside a thread edits that pull request's policy, keyed by the pull request identity, so opening the same pull request in another thread does not create a second conflicting policy.

## Presets are templates

An agent preset supplies creation-time defaults. After creation, the agent is an ordinary editable and deletable agent; runtime behavior never branches on its preset, handle, name, or seeded id.

When a capability needs an agent, store an explicit agent id and let any eligible agent be selected. Define deletion in the same design: a missing selected agent disables the capability and asks for another selection rather than silently choosing a special preset.

Automation that starts work without a direct action is off by default. Enabling the automation and choosing who performs it remain explicit, inspectable choices.

## Pull request monitoring was removed

Remy does not watch pull requests. There is no Watched by, no follow table, no webhook that becomes a thread message, and no poller on a computer. A pull request's Activity tab reads GitHub when you open it, and anything a thread should act on reaches it because a person sent it: Send to thread, Ask the thread to fix them, or a message in the thread.

Do not bring monitoring back as a setting, a switch on the pull request, or an agent preset. If it returns, it is a product decision made again from here, not a restoration of the old model.

BAD
```text
Summary → Watched by  [on]
New reviews and failing checks reach the linked thread on their own.
```

GOOD
```text
Summary → Checks · 2 failing  [Ask the thread to fix them]
The person decides what reaches the thread.
```

## Review agent

A review is a thread with a pull request attached, started by a person from that pull request. Nothing starts one on push, on a schedule, or because a webhook arrived. It runs where any thread in that workspace could, chosen the same way. Its cloud picker uses the same personal model access as a regular thread, including inside an organization; shared organization keys are not a prerequisite.
The person chooses its permission mode at launch. Open its pending thread immediately as an app tab on the right, with the pull request tab on the left. Review threads stay out of the sidebar and remain reachable through their pull request or an open tab. The review tab owns findings, proposed rules and personal review rules, and supports full-screen and split layouts.

The review agent never posts to GitHub. It reports findings to Remy; the person turns a finding into a draft in their own pending review and submits that review themselves.

Review rules are personal. They belong to the person who saved them, never to an organization, and no other member reads them, even in an organization workspace. A rule applies to one repository or to all their workspaces. The agent only proposes rules; nothing is saved until the person saves it, and a saved rule applies from the agent's next turn.

BAD
```text
Organization settings → Review rules, shared by everyone.
The agent saves "Don't flag fixtures" after you correct it, and posts its findings as a review.
```

GOOD
```text
Review agent → Rules: yours, per repository or all workspaces, with where each was learned.
The agent proposes "Don't flag fixtures"; you edit it and press Save rule.
Its findings stay in Remy until you choose Add to GitHub review.
```

## Review the lifecycle

Before implementation, check the proposal against creation, rename, duplication, deletion, synchronization across devices, unavailable actors, and a fresh install. A design is incomplete when one of those states changes who owns the behavior or leaves work running without a visible controlling setting.
