import { useStore } from "@/state/store";
import { PROVIDERS } from "@/lib/providers";
import type { Chat, ChatDetail, ConvEntry, Server, Workspace } from "@/state/types";

export const scenes = ["threads", "worktrees", "review", "agents"] as const;
export type Scene = typeof scenes[number];
const timestamp = Date.now() - 180_000;
const servers: Server[] = [
  { id: "demo-mac", name: "MacBook Pro", code: "MAC", url: "", online: true, local: true, icon: "laptop" },
  { id: "demo-studio", name: "Mac mini", code: "MINI", url: "", online: true, icon: "monitor" },
];
const workspace: Workspace = { id: "demo-workspace", serverId: "demo-mac", name: "acme", path: "/workspace/acme", worktrees: [
  { path: "/workspace/acme", branch: "main", isMain: true, dirty: false },
  { path: "/workspace/acme/.remy/onboarding", branch: "improve-onboarding", isMain: false, dirty: true },
] };
const examples: { title: string; prompt: string; reply: string; tool: string; output: string }[] = [
  { title: "Improve the pairing flow", prompt: "Make it easier to connect my other Mac. Keep the confirmation for computers with a different owner.", reply: "Both paths are covered. Your other Mac can connect directly; a computer with a different owner still asks you to confirm the code.", tool: "Read", output: "Checked the ownership and confirmation paths." },
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
    catalogLoading: false, loading: false, connected: true, openIds: [], detailLoading: {}, historyLoading: {},
    providers: PROVIDERS.map((provider) => ({ ...provider, installed: true })),
    openChat: async () => {}, closeChat: () => {}, readChat: async () => {}, loadBoard: async () => {},
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
