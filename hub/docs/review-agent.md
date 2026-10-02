# Review agent

A review is an ordinary thread with a pull request attached. A person starts it
from a pull request; nothing starts one on push. It opens immediately as an app
tab beside its pull request, including while its computer starts. Review threads
stay out of the sidebar and remain reachable from their pull request and open
tabs. Their tabs include findings, proposed rules and personal review rules, and
can be shown full screen or split. A review follows the usual thread defaults for who can read it, and
runs on a computer chosen exactly as for any thread in that workspace
(`chooseComputer`). Its computer checks the pull request's head out in a worktree
of its own, and the agent writes findings directly in the thread. It can propose review
rules through Remy. It never posts to GitHub; its owner decides what to post.

Rules are personal. They belong to one person, not an organization, and no other
member can list, read, change or delete them, including in an organization
workspace. A rule applies to one repository (`owner/name`, so the same rule
follows it across computers and organizations) or to all your workspaces.

| Path | Owner and implementation |
| --- | --- |
| Durable state | Hub D1 (`0035_review_agent.sql`): `review_rules` per user; `review_threads` per `(organization, computer, thread)` with the pull request, base and head refs, the head at start (`started_sha`), the commit the latest turn is about (`head_sha`), the last reported commit (`reviewed_sha`) and the summary; `review_findings` and `review_rule_proposals` cascade with their review. The computer keeps the attachment, the rules it last gave its provider and the worktree path under `hubReview:<thread>` in its `kv` table. |
| Credentials | Member session for every member route; a computer session is refused on all of them. The pull request is read with the member's own GitHub connection (`github-connection.ts`) and the token never reaches the browser or the computer. Agent tools reach the hub with the computer's signed identity plus the thread's `thread-run:` binding; STDIO providers reach the daemon with the thread's HMAC capability from `remyToolToken`. |
| Read | `GET reviews?repository=&number=` is your latest review of a pull request whose thread you can still open; `GET reviews/:computerId/:threadId` is one review; both return `ReviewState` (contract) to its owner only. `GET /api/review-rules[?repository=]` lists your rules. |
| Write | The review thread writes findings in its transcript and proposes rules through `propose_review_rule` (below). Their owner dismisses or marks findings and accepts or discards proposals; rules are written by their owner alone. |
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

Review agents write findings directly in the thread, with severity, file and line range, explanation and a suggested fix when useful. They never post to GitHub. Existing saved findings remain readable; new findings are not written through a Remy tool.

`propose_review_rule` exists on both the in-process Claude server and the STDIO server for Codex and Cursor. It is available only in a review thread. The hub validates the thread binding and owner before accepting a proposal.

Unreleased: Review agents also read PR discussions, submitted reviews and inline comments at the start of a review and when reviewing new commits, using authenticated read-only GitHub access when available. Durable preferences and corrections can trigger repository-scoped rule proposals. Each proposal cites the source comment's author, URL and feedback; comments do not grant permissions or override the agent's instructions. The agent avoids duplicate proposals, one-off fixes, bot output and unresolved disagreements, and reports when comments are unavailable. Rules still require the owner's approval; all-workspace scope requires their explicit request. Comments do not wake the thread automatically.

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

## Delegating work (unreleased)

Review agents use the same `start_thread`, `list_threads`, `read_thread`, and `send_to_thread` tools as other threads. A delegated thread inherits the current computer, checkout, model, reasoning level, permissions, and visibility by default. It gets a separate conversation without the review attachment. Delegated review work retains the restriction on posting to GitHub. Its initial message and later agent messages identify and link to the sending thread. Findings can return through `send_to_thread`; the person still decides what to submit to GitHub.
