import { useStore } from "@/state/store";
import { PROVIDERS } from "@/lib/providers";
import type { Chat, ChatDetail, ConvEntry, ConvDiffLine, Server, Workspace, Agent, Routine } from "@/state/types";

export const scenes = ["threads", "worktrees", "review", "agents"] as const;
export type Scene = typeof scenes[number];
const timestamp = Date.now() - 180_000;
const servers: Server[] = [
  { id: "demo-mac", name: "MacBook Pro", code: "MAC", url: "", online: true, local: true, icon: "laptop" },
  { id: "demo-studio", name: "Mac mini", code: "MINI", url: "", online: true, icon: "monitor" },
];
export const workspace: Workspace = { id: "demo-workspace", serverId: "demo-mac", name: "acme", path: "/workspace/acme", worktrees: [
  { path: "/workspace/acme", branch: "main", isMain: true, dirty: false },
  { path: "/workspace/acme/.remy/onboarding", branch: "improve-onboarding", isMain: false, dirty: true },
] };
export const sampleAgent: Agent = {
  id: "demo-agent", serverId: "demo-mac", name: "Review agent", handle: "review", role: "A second pair of eyes on your changes.",
  instructions: "Review changes for correctness and clear, maintainable code.", provider: "claude", permissionMode: "auto", autoStart: false, handoffTo: [], gitIdentity: "default",
};
const sampleRoutines: Routine[] = [
  { id: "demo-morning", name: "Morning pull request review", cadence: "weekdays", hour: 9, minute: 0 },
  { id: "demo-weekly", name: "Weekly dependency check", cadence: "weekly", hour: 10, minute: 0, weekday: 1 },
].map((routine) => ({ ...routine, cadence: routine.cadence as Routine["cadence"], serverId: "demo-mac", agentId: sampleAgent.id, prompt: routine.name, enabled: true, schedulerDeviceId: "demo-mac", runs: 0, nextRunAt: Date.now() + 86_400_000, createdAt: timestamp, updatedAt: timestamp }));
export const sampleDiff: ConvDiffLine[] = [
  { kind: "ctx", text: "export async function pairComputer(request) {" },
  { kind: "ctx", text: "  const identity = await verifyIdentity(request);" },
  { kind: "ctx", text: "  const owner = await tailscaleOwner(identity);" },
  { kind: "del", text: "  return requestConfirmation(identity);" },
  { kind: "add", text: "  if (owner.matches && identity.verified) {" },
  { kind: "add", text: "    return approvePairing(identity);" },
  { kind: "add", text: "  }" },
  { kind: "add", text: "  return requestConfirmation(identity);" },
  { kind: "ctx", text: "}" },
  { kind: "ctx", text: "" },
  { kind: "ctx", text: "describe('computer pairing', () => {" },
  { kind: "add", text: "  it('connects your verified Mac', async () => {" },
  { kind: "add", text: "    const result = await pairComputer(sameOwner);" },
  { kind: "add", text: "    expect(result.status).toBe('approved');" },
  { kind: "add", text: "  });" },
  { kind: "ctx", text: "" },
  { kind: "add", text: "  it('confirms a different owner', async () => {" },
  { kind: "add", text: "    const result = await pairComputer(otherOwner);" },
  { kind: "add", text: "    expect(result.status).toBe('pending');" },
  { kind: "add", text: "  });" },
  { kind: "ctx", text: "});" },
];
export const reviewDiff: ConvDiffLine[] = [
  { kind: "ctx", text: "function finishMenuAction(selectedThread) {" },
  { kind: "ctx", text: "  closeMenu();" },
  { kind: "add", text: "  selectedThread.focus();" },
  { kind: "ctx", text: "}" },
  { kind: "ctx", text: "" },
  { kind: "ctx", text: "describe('thread menu', () => {" },
  { kind: "add", text: "  it('returns focus to the thread', async () => {" },
  { kind: "add", text: "    await menu.open();" },
  { kind: "add", text: "    await keyboard.press('Escape');" },
  { kind: "add", text: "    expect(selectedThread).toHaveFocus();" },
  { kind: "add", text: "  });" },
  { kind: "ctx", text: "});" },
];
const examples: { title: string; prompt: string; reply: string; tool: string; output: string }[] = [
  { title: "Improve the pairing flow", prompt: "Make it easier to connect my other Mac. Keep the confirmation for computers with a different owner.", reply: "Both pairing paths are covered.\n\n- Your verified Mac connects directly.\n- A different owner still confirms the six-digit code.\n- The connection stays on your private network.\n\n**Validation**\n\nAll 18 pairing checks pass. The change is ready for review.", tool: "Read", output: "Checked the ownership and confirmation paths." },
  { title: "Build the onboarding screen", prompt: "Build a clearer welcome screen in a separate worktree so the other changes can keep moving.", reply: "The welcome screen is ready on **improve-onboarding**. Your main checkout is untouched, and the new flow explains how to open your first workspace.", tool: "Bash", output: "Created branch improve-onboarding\nWorking in /workspace/acme/.remy/onboarding\nAll checks passed." },
  { title: "Review the keyboard fix", prompt: "Review this change and check that keyboard users can still reach every action.", reply: "The fix keeps focus on the selected thread when the menu closes. Tab, Enter, and Escape all work, and the regression test passes.", tool: "Edit", output: "Updated keyboard navigation and its regression test." },
  { title: "Plan the morning review", prompt: "Help me set up a weekday review of the open pull requests.", reply: "You can give your review agent this routine in **Inbox**: “Review open pull requests every weekday at 9:00.” Pick the computers it can use in your preferred device order.", tool: "Read", output: "Reviewed the repository contribution guide." },
];
const baseChats: Chat[] = examples.map((example, index) => ({
  id: `demo-${scenes[index]}`, title: example.title, serverId: index === 2 ? "demo-studio" : "demo-mac",
  cwd: index === 1 ? "/workspace/acme/.remy/onboarding" : workspace.path,
  provider: ["claude", "codex", "cursor", "claude"][index], model: "", state: "idle", pinned: index === 0,
  createdAt: timestamp, updatedAt: timestamp + index * 20_000, preview: example.reply,
}));
function initialDetails(): Record<string, ChatDetail> {
  return Object.fromEntries(baseChats.map((chat, index) => {
    const example = examples[index];
    const entries: ConvEntry[] = [
      { id: `${chat.id}-user`, kind: "user", text: example.prompt, at: timestamp },
      { id: `${chat.id}-tool`, kind: "tool", tool: example.tool, arg: index === 2 ? "src/navigation.ts" : "src/pairing.ts", status: "ok", output: example.output, at: timestamp + 1000, completedAt: timestamp + 2000,
        ...(index === 2 ? { adds: 2, dels: 1, diff: [{ kind: "del" as const, text: "closeMenu();" }, { kind: "add" as const, text: "closeMenu();" }, { kind: "add" as const, text: "selectedThread.focus();" }] } : {}),
      },
      { id: `${chat.id}-reply`, kind: "assistant", text: example.reply, at: timestamp + 3000 },
    ];
    return [chat.id, { ...chat, entries, todos: [], permissionMode: "default" }];
  }));
}
const replyTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function resetDemo() {
  for (const timer of replyTimers.values()) clearTimeout(timer);
  replyTimers.clear();
  useStore.setState({ servers, chats: structuredClone(baseChats), workspaces: [workspace], details: initialDetails(),
    agents: [sampleAgent], routines: structuredClone(sampleRoutines),
    catalogLoading: false, loading: false, connected: true, openIds: [], detailLoading: {}, historyLoading: {},
    providers: PROVIDERS.map((provider) => ({ ...provider, installed: true })),
    openChat: async () => {}, closeChat: () => {}, readChat: async () => {}, loadBoard: async () => {},
    async loadWorkspaceWorktrees() { return structuredClone(workspace.worktrees); },
    async sendMessage(id, text) {
      const detail = useStore.getState().details[id];
      if (!detail || detail.state === "working") return;
      const at = Date.now();
      useStore.setState((state) => ({ details: { ...state.details, [id]: { ...detail, state: "working", entries: [...detail.entries, { id: `user-${at}`, kind: "user", text, at }] } } }));
      replyTimers.set(id, setTimeout(() => {
        replyTimers.delete(id);
        const current = useStore.getState().details[id];
        if (!current) return;
        useStore.setState((state) => ({ details: { ...state.details, [id]: { ...current, state: "idle", entries: [...current.entries, { id: `reply-${at}`, kind: "assistant", text: "This is a sample reply in the website demo. In Remy, your chosen provider runs this thread on your computer.", at: at + 700 }] } } }));
      }, 700));
    },
    async interrupt(id) {
      clearTimeout(replyTimers.get(id));
      replyTimers.delete(id);
      const detail = useStore.getState().details[id];
      if (detail) useStore.setState((state) => ({ details: { ...state.details, [id]: { ...detail, state: "idle" } } }));
    },
    async setChatOptions(id, patch) {
      const detail = useStore.getState().details[id];
      if (detail) useStore.setState((state) => ({ details: { ...state.details, [id]: { ...detail, ...patch, model: patch.model ?? detail.model, effort: patch.effort ?? detail.effort } } }));
    },
    async pinThread(id, pinned) { useStore.setState((state) => ({ chats: state.chats.map((chat) => chat.id === id ? { ...chat, pinned } : chat) })); },
  });
}
resetDemo();
