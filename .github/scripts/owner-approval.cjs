const OWNER_ID = 19776024;
const CHECK_CONTEXT = "Owner approval";

function approvalFor(pull, reviews) {
  if (pull.user?.id === OWNER_ID) {
    return { state: "success", description: "PR authored by padamchopra." };
  }
  const decision = reviews
    .filter((review) => review.user?.id === OWNER_ID && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))
    .sort((a, b) => (Date.parse(b.submitted_at) || 0) - (Date.parse(a.submitted_at) || 0) || b.id - a.id)[0];
  if (decision?.state === "APPROVED" && decision.commit_id === pull.head.sha) {
    return { state: "success", description: "padamchopra approved the latest commit." };
  }
  return { state: "failure", description: "Requires padamchopra's approval on the latest commit." };
}

async function publishApproval({ github, context, core }) {
  const { owner, repo } = context.repo;
  const target_url = `https://github.com/${owner}/${repo}/actions/runs/${context.runId}`;
  const pulls = await github.paginate(github.rest.pulls.list, {
    owner, repo, state: "open", base: "main", per_page: 100,
  });
  const byCommit = new Map();
  for (const pull of pulls) {
    const group = byCommit.get(pull.head.sha) ?? [];
    group.push(pull);
    byCommit.set(pull.head.sha, group);
  }
  let failed = false;
  for (const [sha, group] of byCommit) {
    const status = { owner, repo, sha, context: CHECK_CONTEXT, target_url };
    try {
      await github.rest.repos.createCommitStatus({
        ...status, state: "pending", description: "Checking current PR authors and reviews.",
      });
      const decisions = [];
      for (const listed of group) {
        const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: listed.number });
        if (pull.state !== "open" || pull.base.ref !== "main" || pull.head.sha !== sha) continue;
        const reviews = pull.user?.id === OWNER_ID ? [] : await github.paginate(github.rest.pulls.listReviews, {
          owner, repo, pull_number: pull.number, per_page: 100,
        });
        decisions.push(approvalFor(pull, reviews));
      }
      // A commit status is shared by all PRs with this head, so none may lend another its approval.
      const decision = decisions.find((value) => value.state !== "success") ?? decisions[0];
      await github.rest.repos.createCommitStatus({
        ...status,
        ...(decision ?? { state: "pending", description: "PR head changed; waiting for the next evaluation." }),
      });
    } catch (error) {
      failed = true;
      core.error(`Approval evaluation failed for ${sha}: ${error.message}`);
      await github.rest.repos.createCommitStatus({
        ...status, state: "error", description: "Approval could not be verified; rerun the approval workflow.",
      });
    }
  }
  if (failed) core.setFailed("One or more PR approvals could not be verified.");
}

module.exports = { OWNER_ID, CHECK_CONTEXT, approvalFor, publishApproval };
