---
name: skill-capture
description: Capture durable agent conventions from user feedback. Use when the user highlights a pattern, correction, or house rule that belongs in `.agents/skills/`, or when adding, splitting, or rewriting a skill.
---

# Skill capture

`AGENTS.md` lists the skills and the durable product conventions. This skill owns when and how to write those skills down.

When the user highlights something that belongs in an existing skill, or that needs a new skill file, capture it in the same change as the rest of the work. Do not defer it to a follow-up. This request is itself an example: the highlight became this skill.

## Where skills live

Add each skill only under `.agents/skills/<name>/SKILL.md`. `.claude/skills` is a symlink to that directory. Do not add per-skill Claude links, and do not put skills anywhere else.

List a new house skill in the Skills section of `AGENTS.md`. Leave `shadcn` and `migrate-radix-to-base` to `skills-lock.json`; do not hand-edit them.

## Update an existing skill

Prefer adding to the skill that already owns the domain:

| Domain | Skill |
|---|---|
| Layout and keyboard | `ui` |
| User-facing words | `content` |
| Ownership, defaults, deletion | `product-design` |
| Read, write, live-update across devices | `distributed-state` |
| Measuring waits and stale UI | `performance-diagnosis` |
| Proving it in the running app | `qa` |
| Pull request evidence | `pr-author` |
| Capturing house rules | this skill |

A one-line durable rule, a BAD/GOOD pair, or a missing case in an existing section is an edit, not a new file.

## Create a new skill

Create a skill when the convention is durable, will recur, and no existing skill owns it. A new skill is a domain, not a ticket: layout, copy, product rules, QA, loading behavior. Match the density of the neighbouring skills: frontmatter `name` and `description`, a short ownership sentence, then practical rules with BAD/GOOD examples.

Do not create a skill for a one-off bug, a single-line fix, or a workaround that will not apply to the next similar change. Fix the bug; leave the skills alone unless the miss was a missing convention.

BAD
```
The model picker shimmered on first paint. Add `.agents/skills/model-picker-shimmer/SKILL.md` describing this bug.
```

GOOD
```
The model picker shimmered on first paint. Fix the picker in this change, and add one sentence to `ui`: composer, model, computer, and branch controls must not shimmer, jump layout, or swap labels after first paint.
```

## Same change

The skill edit lands with the code or copy it governs. A reviewer should see the convention next to the work that made it necessary. Do not open a follow-up just to write the skill down.

If the highlight is the only work, the skill file — and the `AGENTS.md` list if it is new — is the whole change.
