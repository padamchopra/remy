---
name: pr-author
description: Remy pull request writing and reviewer evidence. Use when creating, updating, or publishing ANY pull request, including every PR in a stack.
---

# Authoring a pull request

Media is required when a PR changes behavior a reviewer can exercise or judge in a running Remy surface, including UI, user-visible interaction, and app behavior with an observable in-app result.

Media is not required for changes with no in-app behavior to show, such as CI, release or build configuration, documentation, tests, and internal refactors. Record the relevant commands and results under `## Testing` instead.

`qa` owns proving changes against the running app and may use real state. When media is required, PR evidence is a separate capture pass with safe state.

## Body format

Lead with required media, then use `## Summary`, `## Changes`, `## Review notes`, and `## Testing`, in that order. These are writing conventions, not an automated check.

- **Media:** Put media tables at the very top of the body, before any heading, introduction, badge, or status note. Every image and video thumbnail belongs in a Markdown table with descriptive column headers, such as `Code review` and `Guided review`, or `Before` and `After` for a comparison. Use readable alt text and keep the table narrow enough to judge the media. Use the linked thumbnail Markdown that `agent-cli upload` returns for a video, so its preview can share a table with images and opens the original recording when clicked. Never collapse required media or add empty media placeholders.
- **Summary:** A short paragraph explaining the problem and the outcome, not an inventory of the implementation.
- **Changes:** A few themed bullets describing what changes for the user or reviewer. Group related work rather than listing each file, commit, follow-up, or test.
- **Review notes:** Only what could reverse an approval — a decision a reviewer might disagree with, a limitation, a missing verification, a breaking change, a migration, a rollout requirement. Why the code works is not a review note. Omit the section when there is nothing material to call out.
- **Testing:** A brief statement of what was verified and the relevant limits of that verification. Keep failures and important untested behavior visible; move commands, individual scenarios, and supporting results into a collapsed `Detailed validation` section.

Optional implementation context goes in a separate collapsed `Implementation details` section after Testing. Use `<details>` with a descriptive `<summary>` and blank lines around its Markdown content. Omit empty or unhelpful collapsible sections.

On follow-up updates, rewrite the body into this shape instead of appending a work log. Preserve relevant authored notes, links, and attribution without repeating them. Do not include terminal transcripts, exhaustive test-name lists, or routine progress updates.

A PR-specific request to omit media overrides the media requirement for that PR, not future PRs. Without media, start directly with `## Summary`.

Example for guided reviews when media is explicitly waived:

BAD
```markdown
## Summary
- Add a Guide tab.
- Add a model picker.
- Add commit selection.
- Store guides.
- Add peer lookup.
- Add question persistence.

## Testing
- Tested saving, loading, selecting, asking, reconnecting, retrying, and every file control.
```

GOOD
```markdown
## Summary

Make large pull requests easier to understand with a guided review beside the existing diff.

## Changes

- Generate digestible change groups for selected commits, using the model you choose.
- Reuse saved guides across paired devices and ask questions inline.
- Keep the same file-viewing and change-comment controls in Code and Guide.

## Review notes

- Diff coverage is checked programmatically; changes omitted by the model stay visible below the guide.
- Change comments require an open thread; standalone PRs support questions.

## Testing

Tests and isolated interaction checks pass; model responses use a disposable provider fixture.

<details>
<summary>Detailed validation</summary>

- Server tests cover saved guides, authenticated device discovery, and diff coverage.
- Isolated interaction checks cover file controls, inline questions, and retry behavior.

</details>
```

## Length

A reviewer reads the body once, before the diff, and everything above the first collapsed section fits on one screen.

Each bullet is one line. A bullet that needs two is two bullets, or a cut.

Mechanism goes in `Implementation details`, collapsed. If a sentence explains how the change works rather than what a reviewer should decide, it belongs there or nowhere.

Numbers earn their place by changing a decision. One measurement that shows the outcome beats four that corroborate it.

BAD
```
## Review notes

- **Every bound applies reading as well as writing**, and a stored value over the character bound is discarded before it is parsed, so opening a window never means reading an unbounded amount of anything. A snapshot that cannot fit even with no transcripts leaves nothing behind, because one that can never be updated is worse than opening cold.
- **The default fixture cannot show this win, by construction.** It answers in 4 ms, where a warm reopen has almost nothing to skip and both sides pay the same rendering cost; before and after are a wash there (697 ms against 727 ms). `warm-latency` exists because a real daemon reads SQLite over IPC and a paired machine is on the other side of a tailnet. Its comparison is relative and measured cold-then-warm in one browser context, so it says the same thing on a loaded machine as an idle one.
- Tickets, routines and archived threads are deliberately not cached: a board has no natural size, and nothing opens on an archive.
- Settings are not cached either. They are read on demand through the shared-read path, and a stale default model in the composer would be a worse lie than a brief absence.
```

GOOD
```
## Review notes

- The parent's 150 ms warm figure is still missed. What remains is first render rather than the request waterfall — REMY-35 and REMY-36.
- The default fixture answers in 4 ms, where a warm reopen has nothing to skip. `warm-latency` asks at 150 ms instead: 744 ms warm against 1270 ms cold.
- No completed run across both targets yet; this machine is shared with an Android build. A two-target run is queued.
```

## Evidence state

- Exercise the same production code and the same realistic interaction sequence used in QA.
- Capture from a temporary Remy state, such as a temporary `MC_CONFIG_DIR`, seeded through the app or its public API.
- Replace only values that would expose personal or sensitive information: names, email addresses, device and host names, tailnet addresses, local paths, private repository names, thread content, tokens, secrets, and pairing codes or QR codes.
- Keep non-sensitive behavior real. Do not mock the result under review, bypass the changed code, or edit a capture to manufacture success.
- Use plausible Remy state rather than placeholder text that makes the flow look artificial.
- Never publish a capture containing a credential, secret value, pairing link, QR code, notification, or unrelated private window.

For a stacked change that requires media, capture the behavior introduced by that PR relative to its direct base and attach the artifact to that PR. Evidence on the top PR does not cover the PRs below it.

## Screenshot or recording

Use a screenshot when a reviewer can judge the change in one settled state: layout, copy, an empty or error state, a selected value, a static transcript, or a final result.

Use a video recording when order or time matters: opening and selecting from a control, keyboard and focus behavior, a dialog flow, loading or streaming, animation, interruption, or a multi-screen task.

Use both when the recording proves the interaction but a still image makes the final state or a before-and-after comparison easier to inspect.

Do not turn terminal output, test results, configuration diffs, or API responses into media only to satisfy PR evidence. Put that validation in the PR description as text.

## Capture quality

- Frame the smallest surface that still gives the reviewer context.
- Keep text readable at GitHub's inline size.
- Show the control label and resulting state; do not submit a context-free crop.
- Keep the pointer away from the changed content in still images.
- Inspect every image and play every recording before upload.
- Keep artifacts in `/tmp/remy-pr-artifacts/<branch>/`; never commit them to the repository.

## Publish

Create the draft PR first. When media is required, upload the inspected files:

```sh
agent-cli upload /tmp/remy-pr-artifacts/branch/change.png
```

If `agent-cli` is unavailable, install it globally, then run the upload again:

```sh
npm -g i @choprapadam/agent-cli
```

Embed the returned image URLs in labeled tables at the top of the body. Append `?w=640` to raster image URLs for inline embeds.

Upload video evidence in its original recorded format:

```sh
agent-cli upload /tmp/remy-pr-artifacts/branch/change.mp4
```

For a video, `agent-cli upload` also uploads a poster image and prints linked-image Markdown:

```markdown
[![Play change.mp4](https://agent-cli.padamchopra.me/media/{poster-token}?w=640)](https://agent-cli.padamchopra.me/media/{video-token})
```

Inspect the video and poster, then put that returned Markdown in the appropriate media-table cell. The thumbnail opens the original recording; never replace it with a text-only link or convert the video to GIF.

Do not wrap an external `agent-cli` URL in a `<video>` tag because GitHub strips the tag from PR Markdown.

Read the PR description back and confirm the section order, topmost media tables, linked video thumbnails, and collapsed supporting detail. Confirm that every media URL is present and resolves successfully, and that required review notes remain visible.

When media is not required or explicitly waived, omit the media block; `## Testing` carries the reviewer-visible verification.

Do not substitute a written QA claim for required media. If a safe, representative artifact cannot be produced for a change that requires it, keep the PR in draft and report the concrete blocker.
