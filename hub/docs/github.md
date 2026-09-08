# GitHub connection

An administrator installs the GitHub App in GitHub, connects their own GitHub account in Remy, then chooses that installation and its repositories under Connections. The user token must belong to the same app as `GITHUB_APP_ID`. Selected repositories reuse workspaces by canonical origin; deselection preserves the workspace and its work but stops monitoring and hosted Git access.

Configure the existing `GITHUB_APP_ID` and private-key secret, plus the GitHub connection OAuth credentials and webhook secret described in `connections.md`. Grant repository metadata read, contents read/write, pull requests read/write, issues read/write and checks read. Subscribe to installation, installation_repositories, issue_comment, pull_request, pull_request_review, pull_request_review_comment, check_run and check_suite updates. Deliver to `/api/connections/github/webhook`.

Each member authorizes their own GitHub account. PR creation, reviews and comments use that member's token in the hub. Tokens never reach a computer or the browser. Personal computers retain their own `gh` login; hosted Git continues through the scoped installation proxy and now also requires current repository selection.

Monitoring is off by default, belongs to the workspace and may be overridden for an individual PR. An administrator explicitly selects a shared agent. Deleted agents disable monitoring. Only a verified GitHub sender mapped to a current Remy member with workspace access can start work. A mention opens a thread using normal routing and the member's authority. External text is the request, never an authority claim. Final replies use that same member's account.

Signed receipts are durable and deduplicated before processing. A durable start claim prevents duplicate threads after redelivery; an interrupted or uncertain start is shown as unavailable rather than silently starting a second thread. Replies have stable markers and reconcile against GitHub comments after uncertain network outcomes. Completed threads retry replies on the hub alarm. Revoking access prevents further actions.

The isolated QA provider replaces only vendor endpoints. The production OAuth broker, signature verification, queue, organization access, routing, computer connection and thread execution remain active. A live private-repository acceptance run still requires an installed app and a disposable repository authorized by its owner.

API references: [GitHub App installations](https://docs.github.com/en/rest/apps/installations), [webhook payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [pull requests](https://docs.github.com/en/rest/pulls/pulls), [reviews](https://docs.github.com/en/rest/pulls/reviews), [issue comments](https://docs.github.com/en/rest/issues/comments).
