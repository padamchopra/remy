---
name: product-design
description: Product structure and ownership in Remy. Use before making ANY product decision that adds or changes a setting, default, integration, automation, agent behavior, entity relationship, or deletion behavior.
---

# Product design

`ui` owns layout and interaction. `content` owns the words. `qa` owns proving the result. This skill owns the product model they express.

## Model the capability first

Name the capability, its durable owner, the actor that performs it, the event that triggers it, and what happens when either owner or actor disappears before choosing a screen or schema.

A setting lives with the thing whose behavior it controls. The actor that carries out that behavior is a reference, not the owner, when another actor could reasonably take its place.

- A machine integration belongs to that machine's settings.
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
Inbox → GitHub agent → Agent settings
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
