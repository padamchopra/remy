import { useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Folder, Inbox, MessagesSquare, SquareKanban, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { AgentRoutines } from "@/components/AgentRoutines";
import { AgentMark } from "@/components/AgentAvatar";
import { ThreadDiff } from "@/components/ThreadDiff";
import { WorkspaceWorktrees } from "@/components/WorkspaceWorktrees";
import { useWorkspaceWorktrees } from "@/hooks/use-workspace-worktrees";
import { ChatView } from "@/components/ChatView";
import { ThreadWorkbench } from "@/components/ThreadWorkbench";
import { AppActionsProvider } from "@/actions/context";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/state/store";
import { resetDemo, scenes, workspace, sampleDiff, reviewDiff, sampleAgent } from "./state";
import "../ui.css";
import "./style.css";

const sections = [{ id: "inbox", label: "Inbox", icon: Inbox }, { id: "chats", label: "Threads", icon: MessagesSquare }, { id: "workspaces", label: "Workspaces", icon: Folder }, { id: "tasks", label: "Tasks", icon: SquareKanban }];
const explain = () => toast("Explore more in the installed app.");
function WorkspacePreview() {
  const state = useWorkspaceWorktrees(workspace);
  return <div className="workspace-preview"><WorkspaceWorktrees state={state} /></div>;
}
function AgentPreview() {
  return <div className="agent-preview"><div className="agent-preview-heading"><AgentMark agent={sampleAgent} /><div><h2>{sampleAgent.name}</h2><p>{sampleAgent.role}</p></div></div><AgentRoutines agent={sampleAgent} /></div>;
}
function DiffPreview({ review = false }: { review?: boolean }) {
  const lines = review ? reviewDiff : sampleDiff;
  return <aside className="diff-preview"><div className="diff-heading">{review ? "src/navigation.ts" : "src/pairing.ts"} <span>+{lines.filter((line) => line.kind === "add").length} −{lines.filter((line) => line.kind === "del").length}</span></div><ThreadDiff lines={lines} /></aside>;
}
function Demo() {
  const requested = new URLSearchParams(location.search).get("scene") ?? "threads";
  const [scene, setScene] = useState(scenes.includes(requested as typeof scenes[number]) ? requested : "threads");
  const initial = `demo-${scene}`;
  const [selected, select] = useState(initial);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== location.origin || event.data?.type !== "remy-preview-scene" || !scenes.includes(event.data.scene)) return;
      setScene(event.data.scene);
      select(`demo-${event.data.scene}`);
    };
    window.addEventListener("message", receive);
    parent.postMessage({ type: "remy-preview-ready" }, location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { document.documentElement.dataset.previewScene = scene; }, [scene]);
  const chats = useStore((state) => state.chats);
  const servers = useStore((state) => state.servers);
  const workspaces = useStore((state) => state.workspaces);
  const chat = chats.find((entry) => entry.id === selected) ?? chats[0];
  const mobile = useIsMobile();
  const surface = new URLSearchParams(location.search).has("surface");
  const compact = new URLSearchParams(location.search).has("compact") || mobile;
  return <TooltipProvider><AppActionsProvider context={{ hasProjects: true, addTicket: explain, registerWorkspace: explain, startThread: explain }}>
    <div className="demo-banner"><span>Remy · Sample workspace</span><Button variant="ghost" size="sm" onClick={() => { resetDemo(); select(initial); }}><RotateCcw />Reset</Button></div>
    {surface ? (scene === "worktrees" ? <WorkspacePreview /> : scene === "review" ? <DiffPreview review /> : scene === "agents" ? <AgentPreview /> : <ChatView chat={chat} focused={false} />) : <SidebarProvider className="demo-app" style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      {!compact && <AppSidebar view="app" settingsTab="general" section="chats" selected={chat.id} servers={servers}
        threadStructure={chats.map((row) => [row.id, row.parentChatId ?? "", row.serverId, row.cwd, row.pinned ? "1" : "", row.state].join("\u0000"))}
        archived={[]} workspaces={workspaces} sections={sections} onSection={explain} onSelectChat={select} onOpenBeside={select}
        onOpenTicket={explain} onOpenWorkspace={explain} onNewThread={explain} openSettings={explain} closeSettings={explain} />}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {compact && <div className="px-3 py-2"><Select value={chat.id} onValueChange={select}><SelectTrigger className="w-full" aria-label="Sample thread"><SelectValue /></SelectTrigger><SelectContent>{chats.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>)}</SelectContent></Select></div>}
        {compact ? <ChatView chat={chat} focused={false} /> : <ThreadWorkbench autoFocus={false} routeThread={chat} onOpenThread={select} onOpenTicket={explain} onOpenWorkspace={explain} onFocusThread={(_parent, id) => select(id)} />}
      </main>
      {!compact && <div className="demo-support">{selected === "demo-worktrees" ? <WorkspacePreview /> : selected === "demo-agents" ? <AgentPreview /> : <DiffPreview review={selected === "demo-review"} />}</div>}
    </SidebarProvider>}<Toaster />
  </AppActionsProvider></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
