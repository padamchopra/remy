# Owner approval

`Owner approval` is the required commit status for PRs targeting `main`. PRs authored by GitHub user ID `19776024` (`padamchopra`) pass automatically. Other authors need that user's latest approval on the current head SHA. Comments preserve an approval; changes requested, dismissal, and a new head invalidate it. Changing a login does not change identity.

The publisher runs on PR open, push, and reopen, and on completed Approval policy tests runs that were started by a review. It checks out only `main`, ignores contributor artifacts and workflow conclusions, and reads current PRs and paginated reviews from GitHub. Approval policy tests have no write permission. This separation also supports reviews on fork PRs, whose workflow tokens cannot publish statuses. Each run reevaluates all open PRs because concurrent events may coalesce and a commit status can be shared by multiple PRs. Every open PR sharing a SHA must satisfy the policy. Title, body, and ready-for-review edits do not start a second evaluation of the same head.

The status is attached to the PR head, not the base or test-merge commit. API failures block the status. `workflow_dispatch` allows a maintainer to reevaluate after a transient failure. Do not rename the status without updating its required-check rule.

## Activate

1. Merge the workflow and tests while the existing review rules still protect `main`.
2. Run `Owner approval` from Actions and confirm statuses on current owner and contributor PRs.
3. Replace the `Contributor changes require approval` ruleset's required-review rule with a required-status-check rule for `Owner approval`, restricted to GitHub Actions (integration ID `15368`). Keep its `main` target and active enforcement; the author policy needs no bypass actor.
4. Preserve `Main changes require a pull request` and the existing `Build computer` required check. Confirm a contributor PR remains blocked while an owner PR with passing builds can merge normally from the phone.

Do not remove the review requirement before the replacement status is published and required. This policy governs who may approve; it does not auto-merge PRs or skip build checks. Repository collaborators who can alter trusted workflows or repository settings remain trusted administrators of this mechanism.

## Tests

Run `node --test .github/scripts/owner-approval.test.cjs`. CI exercises the same tests when approval policy files change. They cover author identity, exact-commit approval, revocation, live API reads, shared heads, API failure, and a head changing during evaluation.
