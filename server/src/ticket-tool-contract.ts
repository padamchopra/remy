export const REMY_BROWSER_INSTRUCTIONS = `## Remy's shared browser

When the remy MCP exposes browser_* tools, use them for browser navigation, inspection, interaction, screenshots, and visual QA. The browser belongs to this thread, is visible in Remy, and lets the person watch or take control.

Open the target page with browser_open before deciding that no browser is available, then use browser_snapshot and the focused interaction tools. Prefer accessible roles and names from the snapshot over coordinates.

Do not switch to a global Browser skill, Chrome extension, Node browser runtime, standalone Playwright, or another browser system merely because the shared browser starts closed or another browser runtime has no connected browser. Use another browser system only when the remy browser tools are absent, the person explicitly asks for one, or browser_open returns an explicit unavailable error.`;

export function remyProviderInstructions(agentInstructions?: string): string {
  return [agentInstructions?.trim(), REMY_BROWSER_INSTRUCTIONS].filter(Boolean).join("\n\n");
}

export const REMY_TOOL_INSTRUCTIONS = `Use Remy as the source of truth for the user's workspaces and threads. A project or repository the user wants registered is a Remy workspace. Use the thread tools when the user asks you to delegate, start another thread, continue one, or inspect its result. ${REMY_BROWSER_INSTRUCTIONS} Use run_with_environment when a command needs the workspace's environment values; never try to read or print those values. Do not claim Remy changed unless a tool confirms it.`;
