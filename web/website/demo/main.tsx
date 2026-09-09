import { useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Folder, Inbox, MessagesSquare, SquareKanban, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
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
import { resetDemo, scenes } from "./state";
import "../ui.css";
import "./style.css";

const sections = [{ id: "inbox", label: "Inbox", icon: Inbox }, { id: "chats", label: "Threads", icon: MessagesSquare }, { id: "workspaces", label: "Workspaces", icon: Folder }, { id: "tasks", label: "Tasks", icon: SquareKanban }];
const explain = () => toast("Explore more in the installed app.");
function Demo() {
  const scene = new URLSearchParams(location.search).get("scene") ?? "threads";
  const initial = scenes.includes(scene as typeof scenes[number]) ? `demo-${scene}` : "demo-threads";
  const [selected, select] = useState(initial);
  const chats = useStore((state) => state.chats);
  const servers = useStore((state) => state.servers);
  const workspaces = useStore((state) => state.workspaces);
  const chat = chats.find((entry) => entry.id === selected) ?? chats[0];
  const mobile = useIsMobile();
  const compact = new URLSearchParams(location.search).has("compact") || mobile;
  return <TooltipProvider><AppActionsProvider context={{ hasProjects: true, addTicket: explain, registerWorkspace: explain, startThread: explain }}>
    <div className="demo-banner"><span>Interactive demo · sample data</span><Button variant="ghost" size="sm" onClick={() => { resetDemo(); select(initial); }}><RotateCcw />Reset</Button></div>
    <SidebarProvider className="demo-app" style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      {!compact && <AppSidebar view="app" settingsTab="general" section="chats" selected={chat.id} servers={servers}
        threadStructure={chats.map((row) => [row.id, row.parentChatId ?? "", row.serverId, row.cwd, row.pinned ? "1" : "", row.state].join("\u0000"))}
        archived={[]} workspaces={workspaces} sections={sections} onSection={explain} onSelectChat={select} onOpenBeside={select}
        onOpenTicket={explain} onOpenWorkspace={explain} onNewThread={explain} openSettings={explain} closeSettings={explain} />}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {compact && <div className="px-3 py-2"><Select value={chat.id} onValueChange={select}><SelectTrigger className="w-full" aria-label="Sample thread"><SelectValue /></SelectTrigger><SelectContent>{chats.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>)}</SelectContent></Select></div>}
        {compact ? <ChatView chat={chat} focused={false} /> : <ThreadWorkbench autoFocus={false} routeThread={chat} onOpenThread={select} onOpenTicket={explain} onOpenWorkspace={explain} onFocusThread={(_parent, id) => select(id)} />}
      </main>
    </SidebarProvider><Toaster />
  </AppActionsProvider></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
