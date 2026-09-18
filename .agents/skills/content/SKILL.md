---
name: content
description: Copywriting for Remy's app, website, and design mockups. Use when writing or reviewing ANY user-facing heading, description, label, button, message, or product tagline.
---

# Content

`ui` owns layout and keyboard. This skill owns the words.

Remy is a remote for coding agents on your own machines. Copy speaks to the person in front of the window: second person, present tense, one short sentence.

A conversation is a **thread**. The API, the database, and the code still say chat; nothing a person reads does.

The same goes for **workspace**: the code has a `project` — the repository, keyed on its origin so two machines share one board — but nobody adds a project, they add a folder. No label, menu, empty state or error says project. `AGENTS.md` has the rest of the table.

Do not explain how the UI works, and do not mention servers or daemons unless someone has to pair a machine.

## Natural copy in context

Read the surrounding heading, controls, and destination before writing supporting text. Name the action or benefit the person cares about; do not assemble a sentence from the product's entity names.

Reuse established product language when it fits the surface. The tagline in `web/website/main.tsx` is a reference for Remy's voice, not mandatory copy for every screen.

For the sign-in form:

BAD
```
Continue to your threads and your team.
```

GOOD
```
Your coding agents, within reach.
```

Read the complete sentence as something you would say to a person. Check that its verb makes sense with every noun it governs; familiar product words do not make an unnatural phrase clear.

Supporting copy adds a useful benefit or expectation beyond the heading. Remove it when it adds neither. Keep account instructions accurate for both new and returning people, and mention Teams only when the distinction affects their choice.

Apply the same copy review to Paper designs and other mockups as to shipped UI. Review the words in the rendered layout for awkward wrapping, repetition, and competing instructions. These are editorial conventions, not automated checks.

## Empty states

An empty state is a next action, not a caption for a blank panel. The title names the state, the detail says what to do, and the button is that action.

When a prerequisite is missing, send them to it. A thread does not need a workspace — with none, the composer runs in `~` on this machine — so an empty thread list never points at Add workspace.

BAD
```
title: "No threads yet"
detail: "Start a thread on a connected device and it shows up here."
```

GOOD
```
title: "No agents yet"
detail: "Write one to hand work to, then talk to it here."
```

Never: "shows up here", "this page", "this list", "get started", "simply", "just".

## Labels and descriptions

A label names the setting. Its description adds what the label cannot say, in one sentence — never a second reading of the label.

BAD
```
label: "Worktree location"
description: "Remy keeps worktrees in a .remy folder here. Leave it empty to keep each workspace's worktrees inside the workspace. Git ignores the folder without any change to the repo's .gitignore."
```

GOOD
```
label: "Worktree location"
description: "A .remy folder here, hidden from git without touching any .gitignore."
```

## Buttons and dialogs

Verb plus noun, matching the words that sent them there.

BAD
```
Pick a git repo on this machine.
```

GOOD
```
Pick a folder on this machine.
```

`AddWorkspace.tsx` is the reference for a short dialog: title, one-line description, primary button.

## Confirmations

A confirmation of an action is a toast, not a line of status text under the form. Keep the same second-person present sentence; only the surface changes.

BAD
```
{invited && <p role="status">Your invitation is sent.</p>}
```

GOOD
```
toast.success("Your invitation is sent.");
```

## Errors

What failed, then what to do about it. No stack traces, no raw JSON.

A toast says the thing that failed in its title and the reason underneath, from `apiError` in `web/src/lib/api-error.ts` so the server's own sentence survives.
