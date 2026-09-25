/// Cloud computers must not receive a Claude Code account session.
/// Drop any leftover injection rather than writing credentials onto the sprite.
export function configureHostedClaude(_home: string, _credentialsJson?: string) {
  delete process.env.CLAUDE_CREDENTIALS_JSON;
}
