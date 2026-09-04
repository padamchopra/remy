# D7: Charge for seats and hosted computer time

## Decision

Remy charges per seat plus metered hosted-computer time and storage. Organisations bring their own Anthropic and OpenAI API keys.

## Consequences

Hosted computers receive org keys from the secret store. Vendors bill the org directly; Remy meters model usage only for display and soft caps. No member subscription credential reaches a computer they do not own.

## Rejected alternatives

- Reselling tokens or placing a model gateway in the request path.
- Using members' Claude or Codex subscription credentials on hosted computers.
- Bundling unmetered hosted compute into the seat price.
