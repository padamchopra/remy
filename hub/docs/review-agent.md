# Review agent

A review is an ordinary thread with a pull request attached. A person starts it
from a pull request; nothing starts one on push. It appears in the sidebar as
"Review #n: title", follows the usual thread defaults for who can read it, and
runs on a computer chosen exactly as for any thread in that workspace
(`chooseComputer`). Its computer checks the pull request's head out in a worktree
of its own, and the agent reports findings and proposes rules through two Remy
tools. It never posts to GitHub: its owner adds findings to their own pending
review from Remy.

Rules are personal. They belong to one person, not an organization, and no other
member can list, read, change or delete them, including in an organization
workspace. A rule applies to one repository (`owner/name`, so the same rule
follows it across computers and organizations) or to all your workspaces.

| Path | Owner and implementation |
| --- | --- |
| Durable state | Hub D1 (`0034_review_agent.sql`): `review_rules` per user; `review_threads` per `(organization, computer, thread)` with the pull request, base and head refs, the head at start (`started_sha`), the commit the latest turn is about (`head_sha`), the last reported commit (`reviewed_sha`) and the summary; `review_findings` and `review_rule_proposals` cascade with their review. The computer keeps the attachment, the rules it last gave its provider and the worktree path under `hubReview:<thread>` in its `kv` table. |
| Credentials | Member session for every member route; a computer session is refused on all of them. The pull request is read with the member's own GitHub connection (`github-connection.ts`) and the token never reaches the browser or the computer. Agent tools reach the hub with the computer's signed identity plus the thread's `thread-run:` binding; STDIO providers reach the daemon with the thread's HMAC capability from `remyToolToken`. |
| Read | `GET reviews?repository=&number=` is your latest review of a pull request whose thread you can still open; `GET reviews/:computerId/:threadId` is one review; both return `ReviewState` (contract) to its owner only. `GET /api/review-rules[?repository=]` lists your rules. |
| Write | Findings and proposals are written only by the review's own thread, through `report_review_findings` and `propose_review_rule` (below). Their owner dismisses or marks findings and accepts or discards proposals; rules are written by their owner alone. |
| Live update | `GET reviews/live` (WebSocket) sends `{ kind: "reset" }` on connect, then `{ kind: "review", computerId, threadId }` to the owner's sockets when that review's findings, proposals or head change, and `{ kind: "rules" }` in every organization you belong to when your rules change. Read the named entity again; the frames carry no content. The transcript itself streams through the thread relay as for any thread (`threads.md`). |
| Reconnect | A reconnected socket gets `reset` and reads the open review and rules again. Rules and a moved head reach a running provider on its next message, because each message to a review thread carries them. |
| Unavailable computer | Findings, proposals and rules stay readable and decidable on the hub. Review new changes needs the computer, as any message does, and fails with the thread's usual offline error. |

## Starting a review

The web starts a review through the ordinary hosted start
(`web/src/lib/hub-thread-start.ts`) with one more field:

```http
POST /api/organizations/:org/threads
{ "workspaceId", "requestId", "computerId", "provider", "model", "visibility",
  "review": { "repository": "owner/name", "number": 162 } }
```

The coordinator reads the pull request with your GitHub connection and refuses it
unless it is open and belongs to that workspace's repository
(`GitHubConnection.reviewTarget`). It takes the base and head refs, the head
commit, and GitHub's stack when there is one, names the thread
`Review #n: title`, and adds your enabled rules (`enabledRules`: repository and
all-workspace rules, up to 100). A branch cannot be combined with a review.
Cursor Cloud threads run without Remy's tools, so a review there is refused with
a message to choose another computer. The rest is the usual start:
`taskComputer`, then `POST /hub/threads` on the computer with `hubReview`, which
members cannot send themselves (the hub refuses `hubReview` from a member on both
thread creation and messages).

The web then sends the first message, `reviewStartMessage` in
`web/src/lib/review-agent.ts`: "Review pull request #n title (head → base)" and
anything you asked it to focus on. `GET reviews/last?workspaceId=` returns the
computer, provider and model of your last review in a workspace, for the Start
popover's default.

On the computer (`server/src/hub-threads.ts`, `checkoutReviewWorktree` in
`server/src/workspaces.ts`), every git call is an argument array:

1. `git fetch origin +refs/pull/<n>/head:refs/remotes/remy/pr-<n> +refs/heads/<base>:refs/remotes/origin/<base>`, with `--depth=500` on a shallow clone. A cloud computer fetches through the hub's read-only Git capability (`hosted-git.md`); reads are not limited by ref, so the pull request ref needs no change to the grant.
2. `git worktree add --detach .remy/review-<n>-<id> <headSha>`. Detached, so it never claims a branch checked out elsewhere; under `.remy`, hidden by `info/exclude` (AGENTS.md, Worktrees). The thread keeps its given name and never gets a branch.
3. Delete or archive the thread and the worktree is removed with it.

A stacked pull request's base is the branch below it; the agent compares with
`git diff origin/<base>...HEAD` and says so in its first message.

The provider's developer instructions are Remy's own plus the review block and
your rules with their ids (`reviewInstructions` in `server/src/review-agent.ts`):
Claude appends them to the `claude_code` preset, Codex receives them as
`developerInstructions`, and Cursor has them prepended to its first prompt. A
live session cannot change its instructions, so each message to a review thread
carries your rules as they are now and the commit the turn is about. When the
rules differ from what the provider last saw, the message gets an "Your review
rules changed" block; when the head moved, the computer checks the new head out
first and says so.

## Agent tools

Both exist on the in-process Claude server (`ticket-tools.ts`) and the STDIO
server Codex and Cursor use (`ticket-mcp.ts`), share their input shapes
(`server/src/review-tools.ts`), are offered only in a review thread, and replace
`github_action` there. `isRemyToolRoute` allows exactly
`POST /organization-tools/report_review_findings` and
`POST /organization-tools/propose_review_rule`. The daemon refuses them for a
thread that is not a review and refuses `github_action` for one that is; the hub
checks both again against `review_threads` and the thread's binding.

`report_review_findings`

```json
{ "commit": "a4f91c2", "summary": "I read all 14 files and ran the web tests.",
  "findings": [{ "id": "optional earlier id", "path": "web/src/RepositorySearch.tsx",
    "startLine": 41, "endLine": 44, "side": "RIGHT", "severity": "must",
    "title": "Searches on every keystroke", "body": "…", "suggestion": "…",
    "ruleIds": ["…"], "dependsOn": 161 }],
  "resolvedIds": ["…"] }
```

Every finding must sit inside one hunk of the pull request's diff on the side it
names, read from GitHub's files API with the owner's connection; a file GitHub
sends without a patch accepts any line. One finding off the diff rejects the whole
report with the locations that missed, so the agent can fix and retry. A finding
without `id` is appended with a new stable id; one with an earlier id is updated
in place and keeps your decision (dismissed stays dismissed; `resolved` returns to
`open`). `resolvedIds` marks open findings the new commits fixed. `ruleIds` keeps
only your enabled rules for that repository. Up to 50 per report and 200 per
review. The reported commit becomes `reviewedSha` and the summary replaces the
earlier one. The tool returns the ids and a `review-findings` artifact naming the
thread.

`propose_review_rule` with `{ text, scope: "repository" | "all", reason,
findingId? }` stores a pending proposal on that review, up to 20 pending, and
returns a `review-rule` artifact naming the proposal. It is not a rule.

## Member routes

All under `/api/organizations/:org/reviews`, owner only, 404 for anyone else:

- `PATCH findings/:id` with `{ status: "open" | "dismissed" | "added-to-github", githubCommentId? }`. Add to GitHub review is the web's own `pending-comment` action (`github.md`); this records the pending comment it became. `resolved` is the agent's to set.
- `POST proposals/:id/accept` with optional `{ text, scope }` saves it as your rule, with its source (`repository`, `number`, `findingId`), and returns `{ proposal, rule }`. `POST proposals/:id/discard` drops it. Nothing becomes a rule any other way.
- `POST :computerId/:threadId/new-changes` reads the pull request's head; with nothing new it answers 409. Otherwise it moves `head_sha` and sends the thread "Review the commits after <reviewed> up to <head>…" through the same checks as your own message, and returns `{ from, to, review }`. The web shows new commits when the pull request's head differs from `reviewedSha ?? headSha` (`hasNewCommits`).
- Flag is a message you send to the thread (`flagFindingMessage`), which asks the agent to propose a rule. Lines from the diff reach it as code references (`threads.md`).

Your rules, at `/api/review-rules`: `GET`, `POST { text, repository | null, enabled? }`,
`PATCH /:id { text?, repository?, enabled? }`, `DELETE /:id`. Text is at most 500
characters, and at most 100 rules can be on. A computer session is refused.
