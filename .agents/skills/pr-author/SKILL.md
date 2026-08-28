---
name: pr-author
description: Create, update, or publish Remy pull requests with proportional reviewer evidence. Use for ANY pull request, including every PR in a stack.
---

# Authoring a pull request

Media is required when a PR changes behavior a reviewer can exercise or judge in a running Remy surface, including UI, user-visible interaction, and app behavior with an observable in-app result.

Media is not required for changes with no in-app behavior to show, such as CI, release or build configuration, documentation, tests, and internal refactors. Record the relevant commands and results under `## Testing` instead.

`qa` owns proving changes against the running app and may use real state. When media is required, PR evidence is a separate capture pass with safe state.

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

Create the draft PR first. When media is required, preserve its existing description, add a short `## Evidence` caption that says what the artifact demonstrates, then upload the inspected files:

```sh
agent-cli upload /tmp/remy-pr-artifacts/branch/change.png
```

If `agent-cli` is unavailable, install it globally, then run the upload again:

```sh
npm -g i @choprapadam/agent-cli
```

Add the returned URLs under the evidence caption. Append `?w=640` to raster image URLs for inline embeds.

Upload video evidence in its original recorded format:

```sh
agent-cli upload /tmp/remy-pr-artifacts/branch/change.mp4
```

Inspect the video, then add its returned URL as a normal Markdown link. Never convert a video to GIF.

Do not wrap an external `agent-cli` URL in a `<video>` tag because GitHub strips the tag from PR Markdown.

Read the PR description back and confirm that every URL is present and resolves successfully.

When media is not required, omit `## Evidence`; `## Testing` carries the reviewer-visible verification.

Do not substitute a written QA claim for required media. If a safe, representative artifact cannot be produced for a change that requires it, keep the PR in draft and report the concrete blocker.
