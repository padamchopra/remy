import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Animated, Easing, Keyboard, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { PanelLeft, PanelLeftClose, Plus, SlidersHorizontal } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, space, type } from "../theme";
import { agentConversation } from "../lib/inbox";
import { useDevicePreferenceOrder, useStore } from "../state/store";
import { AppSidebar, type AppSection } from "./AppSidebar";
import { ThreadMenu } from "./ThreadMenu";
import { GlassButton } from "./GlassButton";
import { InboxScreen } from "../screens/InboxScreen";
import { ThreadScreen } from "../screens/ThreadScreen";
import { ComposeScreen } from "../screens/ComposeScreen";
import { BoardScreen } from "../screens/BoardScreen";
import { TicketScreen } from "../screens/TicketScreen";
import { NewTicketScreen } from "../screens/NewTicketScreen";
import { DevicesScreen } from "../screens/DevicesScreen";
import { WorkspacesScreen } from "../screens/WorkspacesScreen";
import { WorkspaceScreen } from "../screens/WorkspaceScreen";
import { PullRequestsScreen } from "../screens/PullRequestsScreen";
import { PullRequestScreen } from "../screens/PullRequestScreen";
import { ThreadToolScreen } from "../screens/ThreadToolScreen";
import type { AuthoredPullRequest, ConvArtifact, PullRequestSummary } from "../state/types";
import { workspaceForPath } from "../lib/projects";
import { type NavigationDestination, type PrimarySection } from "../lib/navigation-destination";
import { saveLastDestination } from "../lib/session";

const DRAWER_EASING = Easing.bezier(0.32, 0.72, 0, 1);

export function PairedShell({
  openDestinationRef,
  initialDestination,
  onPairAnother,
  onOpenAgent,
  onUnpair,
}: {
  openDestinationRef: MutableRefObject<(destination: NavigationDestination) => void>;
  initialDestination?: NavigationDestination;
  onPairAnother: () => void;
  /// An agent's own screen, pushed on top: a long form gets the whole width and
  /// the thread list stays one back-tap away.
  onOpenAgent: (agentId: string) => void;
  onUnpair: (url: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const drawerWidth = Math.min(360, Math.max(280, window.width * 0.78));
  const chats = useStore((s) => s.chats);
  const dms = useStore((s) => s.dms);
  const agents = useStore((s) => s.agents);
  const servers = useStore((s) => s.servers);
  const tickets = useStore((s) => s.tickets);
  const workspaces = useStore((s) => s.workspaces);
  const deviceOrder = useDevicePreferenceOrder();
  const loading = useStore((s) => s.loading);
  const openDm = useStore((s) => s.openDm);
  const readChat = useStore((s) => s.readChat);
  const connected = useStore((s) => s.connected);
  const connectionError = useStore((s) => s.error);
  const refresh = useStore((s) => s.refresh);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const sidebarProgress = useRef(new Animated.Value(0)).current;
  const sidebarMounted = useRef(true);
  const [section, setSection] = useState<AppSection>("threads");
  const [threadId, setThreadId] = useState<string>();
  const [ticketKey, setTicketKey] = useState<string>();
  const [composingTicket, setComposingTicket] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [inboxAgentId, setInboxAgentId] = useState<string>();
  const [pullRequest, setPullRequest] = useState<AuthoredPullRequest>();
  const [pullRequestThreadId, setPullRequestThreadId] = useState<string>();
  const [threadTool, setThreadTool] = useState<"browser" | "terminal">();
  const [settingsServerId, setSettingsServerId] = useState<string>();
  const pendingDestination = useRef<NavigationDestination | undefined>(undefined);
  const restoredDestination = useRef(false);

  const thread = threadId ? chats.find((chat) => chat.id === threadId) : undefined;
  const ticket = ticketKey ? tickets.find((entry) => entry.key === ticketKey) : undefined;
  const inboxAgent = inboxAgentId ? agents.find((agent) => agent.id === inboxAgentId) : undefined;
  const inboxDm = inboxAgent
    ? agentConversation(inboxAgent.id, dms, servers, deviceOrder)
    : undefined;

  // The conversation is made the first time you open the agent, and reading it
  // is opening it.
  useEffect(() => {
    if (!inboxAgent) return;
    void openDm(inboxAgent).catch(() => {
      // The screen says so; a toast on top of it would say it twice.
    });
  }, [inboxAgent?.id, inboxAgent?.serverId, openDm]);

  useEffect(() => {
    if (inboxDm?.unread) void readChat(inboxDm.id);
  }, [inboxDm?.id, inboxDm?.unread, readChat]);

  useEffect(() => {
    if (!threadId || loading) return;
    if (chats.some((chat) => chat.id === threadId)) return;
    setThreadId(undefined);
  }, [threadId, loading, chats]);

  /// Where a conversation opens, whichever list it is in. A notification only
  /// carries an id, and an inbox conversation opened as a thread would land on
  /// a screen that cannot find it.
  const openThread = (id: string, serverId?: string) => {
    const dm = dms.find((chat) => chat.id === id && (!serverId || chat.serverId === serverId));
    setTicketKey(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setPullRequest(undefined);
    setPullRequestThreadId(undefined);
    setThreadTool(undefined);
    setSettingsServerId(undefined);
    setSidebarOpen(false);
    if (dm?.agentId) {
      setSection("inbox");
      setThreadId(undefined);
      setInboxAgentId(dm.agentId);
      return;
    }
    setSection("threads");
    setThreadId(chats.some((chat) => chat.id === id && (!serverId || chat.serverId === serverId)) ? id : undefined);
    setInboxAgentId(undefined);
  };

  /// What a Remy tool made, opened where it lives. A thing this phone cannot
  /// see — a ticket on a Mac that is not answering, a workspace that was never
  /// registered here — is left where it is rather than sent to an empty pane.
  const openArtifact = (artifact: ConvArtifact) => {
    if (artifact.kind === "ticket" && artifact.key) {
      if (!tickets.some((entry) => entry.key === artifact.key)) return;
      setSection("board");
      setThreadId(undefined);
      setInboxAgentId(undefined);
      setComposingTicket(false);
      setWorkspaceId(undefined);
      setPullRequest(undefined);
      setTicketKey(artifact.key);
      setSettingsServerId(undefined);
      return;
    }
    if (artifact.kind === "thread" && artifact.id) {
      if (!chats.some((entry) => entry.id === artifact.id) && !dms.some((entry) => entry.id === artifact.id)) return;
      openThread(artifact.id);
      return;
    }
    if (artifact.kind === "workspace" && artifact.id) {
      if (!workspaces.some((entry) => entry.id === artifact.id)) return;
      setSection("workspaces");
      setThreadId(undefined);
      setInboxAgentId(undefined);
      setTicketKey(undefined);
      setComposingTicket(false);
      setWorkspaceId(artifact.id);
      setPullRequest(undefined);
      setPullRequestThreadId(undefined);
      setSettingsServerId(undefined);
    }
  };

  const newThread = () => {
    setSection("threads");
    setThreadId(undefined);
    setTicketKey(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setPullRequest(undefined);
    setPullRequestThreadId(undefined);
    setThreadTool(undefined);
    setSettingsServerId(undefined);
    setInboxAgentId(undefined);
    setSidebarOpen(false);
  };

  const openTicket = (key: string) => {
    setSection("board");
    setThreadId(undefined);
    setInboxAgentId(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setPullRequest(undefined);
    setPullRequestThreadId(undefined);
    setThreadTool(undefined);
    setSettingsServerId(undefined);
    setTicketKey(key);
    setSidebarOpen(false);
  };

  const goSection = (next: AppSection) => {
    setSection(next);
    setTicketKey(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setPullRequest(undefined);
    setPullRequestThreadId(undefined);
    setThreadTool(undefined);
    setSettingsServerId(undefined);
    setThreadId(undefined);
    setInboxAgentId(undefined);
    setSidebarOpen(false);
  };

  const openPullRequest = (summary: PullRequestSummary, fromThreadId?: string) => {
    const sourceThread = fromThreadId ? chats.find((chat) => chat.id === fromThreadId) : undefined;
    const sourceWorkspaces = sourceThread ? workspaces.filter((entry) => entry.serverId === sourceThread.serverId) : [];
    const workspaceIndex = sourceThread ? workspaceForPath(sourceThread.cwd, sourceWorkspaces) : -1;
    const workspace = workspaceIndex >= 0 ? sourceWorkspaces[workspaceIndex] : undefined;
    const match = summary.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/);
    setSection("prs");
    setThreadId(undefined);
    setInboxAgentId(undefined);
    setTicketKey(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setSettingsServerId(undefined);
    setPullRequestThreadId(fromThreadId);
    setPullRequest({
      ...summary,
      body: "",
      repository: match?.[1] ?? workspace?.origin?.replace(/^.*github\.com[/:]/, "").replace(/\.git$/, "") ?? "",
      baseRefName: "",
      isDraft: summary.state.toUpperCase() === "DRAFT",
      reviewDecision: "",
      authorLogin: "",
      updatedAt: new Date(0).toISOString(),
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      checks: [], comments: [], unreadComments: [], hasUnreadActivity: false,
      workspaceId: workspace?.id ?? "",
      workspaceName: workspace?.name ?? "Workspace",
      workspacePath: workspace?.path ?? sourceThread?.cwd ?? "",
      worktreePath: sourceThread?.cwd ?? null,
      serverId: sourceThread?.serverId ?? workspace?.serverId ?? "",
    });
  };

  const openDestination = (destination: NavigationDestination) => {
    if (destination.kind === "thread") {
      openThread(destination.id, destination.serverId);
      return;
    }
    if (destination.kind === "agent") {
      const agent = agents.find((entry) => entry.id === destination.id);
      goSection("inbox");
      setInboxAgentId(agent?.id);
      return;
    }
    if (destination.kind === "workspace") {
      const workspace = workspaces.find((entry) => entry.id === destination.id && (!destination.serverId || entry.serverId === destination.serverId));
      goSection("workspaces");
      setWorkspaceId(workspace?.id);
      return;
    }
    if (destination.kind === "ticket") {
      const found = tickets.find((entry) => entry.key === destination.key);
      goSection("board");
      setTicketKey(found?.key);
      return;
    }
    if (destination.kind === "pull-request") {
      const targetServer = servers.find((entry) => entry.id === destination.serverId)
        ?? servers.find((entry) => entry.online && !entry.cloud);
      const workspace = workspaces.find((entry) => entry.serverId === targetServer?.id
        && entry.origin?.toLowerCase().includes(destination.repository.toLowerCase()));
      goSection("prs");
      setPullRequest({
        url: `https://github.com/${destination.repository}/pull/${destination.number}`,
        number: destination.number,
        title: `Pull request #${destination.number}`,
        headRefName: "",
        state: "OPEN",
        body: "",
        repository: destination.repository,
        baseRefName: "",
        isDraft: false,
        reviewDecision: "",
        authorLogin: "",
        updatedAt: new Date(0).toISOString(),
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        checks: [], comments: [], unreadComments: [], hasUnreadActivity: false,
        workspaceId: workspace?.id ?? "",
        workspaceName: workspace?.name ?? "Workspace",
        workspacePath: workspace?.path ?? "",
        worktreePath: null,
        serverId: targetServer?.id ?? "",
      });
      return;
    }
    if (destination.kind === "settings") {
      goSection("devices");
      setSettingsServerId(servers.some((entry) => entry.id === destination.serverId) ? destination.serverId : undefined);
      return;
    }
    goSection(destination.section as AppSection);
  };

  openDestinationRef.current = (destination) => {
    if (loading) pendingDestination.current = destination;
    else openDestination(destination);
  };

  useEffect(() => {
    if (loading || restoredDestination.current) return;
    restoredDestination.current = true;
    const destination = pendingDestination.current ?? initialDestination;
    pendingDestination.current = undefined;
    if (destination) openDestination(destination);
  }, [loading]);

  useEffect(() => {
    if (loading || !restoredDestination.current) return;
    let destination: NavigationDestination;
    if (thread) destination = { kind: "thread", id: thread.id, serverId: thread.serverId };
    else if (section === "inbox" && inboxAgent) destination = { kind: "agent", id: inboxAgent.id };
    else if (section === "workspaces" && workspaceId) destination = { kind: "workspace", id: workspaceId, serverId: workspaces.find((entry) => entry.id === workspaceId)?.serverId };
    else if (section === "board" && ticket) destination = { kind: "ticket", key: ticket.key };
    else if (section === "prs" && pullRequest) destination = { kind: "pull-request", repository: pullRequest.repository, number: pullRequest.number, serverId: pullRequest.serverId };
    else if (section === "devices" && settingsServerId) destination = { kind: "settings", serverId: settingsServerId };
    else destination = { kind: "section", section: section as PrimarySection };
    void saveLastDestination(destination).catch(() => {});
  }, [inboxAgent?.id, loading, pullRequest?.number, pullRequest?.repository, pullRequest?.serverId, section, settingsServerId, thread?.id, thread?.serverId, ticket?.key, workspaceId]);

  useEffect(() => {
    if (sidebarMounted.current) {
      sidebarMounted.current = false;
      return;
    }
    if (sidebarOpen) setSidebarVisible(true);
    Animated.timing(sidebarProgress, {
      toValue: sidebarOpen ? 1 : 0,
      duration: 280,
      easing: DRAWER_EASING,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !sidebarOpen) setSidebarVisible(false);
    });
  }, [sidebarOpen, sidebarProgress]);

  const title =
    composingTicket ? "New ticket"
    : ticket ? ticket.key
    : workspaceId ? "Workspace"
    : section === "threads" && thread ? thread.title
    : section === "threads" ? "New thread"
    : section === "inbox" && inboxAgent ? inboxAgent.name
    : section === "inbox" ? "Inbox"
    : section === "board" ? "Tasks"
    : section === "prs" ? "Pull requests"
    : section === "workspaces" ? "Workspaces"
    : "Devices";

  return (
    <View style={styles.root}>
      <View style={[styles.chrome, { paddingTop: insets.top + 6 }]}>
        <GlassButton
          onPress={() => {
            Keyboard.dismiss();
            setSidebarOpen((open) => !open);
          }}
          accessibilityLabel={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={20} color={color.foreground} />
          ) : (
            <PanelLeft size={20} color={color.foreground} />
          )}
        </GlassButton>
        <Text style={[type.heading, styles.title]} numberOfLines={1}>
          {title}
        </Text>
        {section === "board" && !ticket && !composingTicket ? (
          <Pressable onPress={() => setComposingTicket(true)} accessibilityLabel="New ticket" style={styles.plus}>
            <Plus size={18} color={color.foreground} />
          </Pressable>
        ) : section === "threads" && thread ? (
          <View style={styles.actions}>
            <ThreadMenu
              chat={thread}
              onGone={newThread}
              onOpenThread={openThread}
              onOpenTicket={openTicket}
              onOpenPullRequest={(next) => openPullRequest(next, thread.id)}
              onOpenBrowser={() => setThreadTool("browser")}
              onOpenTerminal={() => setThreadTool("terminal")}
            />
            <Pressable onPress={newThread} accessibilityLabel="New thread" style={styles.plus}>
              <Plus size={18} color={color.foreground} />
            </Pressable>
          </View>
        ) : section === "inbox" && inboxAgent ? (
          <Pressable
            onPress={() => onOpenAgent(inboxAgent.id)}
            accessibilityLabel={`${inboxAgent.name} settings`}
            style={styles.plus}
          >
            <SlidersHorizontal size={18} color={color.foreground} />
          </Pressable>
        ) : (
          <View style={styles.plus} />
        )}
      </View>

      {!connected && !loading ? (
        <View style={styles.offline} accessibilityRole="alert">
          <Text style={[type.caption, { flex: 1 }]} numberOfLines={2}>{connectionError ? `Offline · ${connectionError}` : "Reconnecting… Cached content stays available."}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button" accessibilityLabel="Retry connection" style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : null}

      <View style={styles.body}>
        {section === "inbox" && inboxDm ? (
          <ThreadScreen
            key={inboxDm.id}
            id={inboxDm.id}
            onOpenArtifact={openArtifact}
            onOpenThread={openThread}
            onOpenPullRequest={(next) => openPullRequest(next, inboxDm.id)}
          />
        ) : section === "inbox" ? (
          <InboxScreen onOpen={setInboxAgentId} onSettings={onOpenAgent} />
        ) : section === "board" && composingTicket ? (
          <NewTicketScreen
            onCreated={(key) => {
              setComposingTicket(false);
              setTicketKey(key);
            }}
          />
        ) : section === "board" && ticket ? (
          <TicketScreen
            ticketKey={ticket.key}
            onOpenThread={openThread}
            onOpenTicket={openTicket}
            onDeleted={() => setTicketKey(undefined)}
          />
        ) : section === "board" ? (
          <BoardScreen onOpen={(key) => setTicketKey(key)} onCompose={() => setComposingTicket(true)} />
        ) : section === "workspaces" && workspaceId ? (
          <WorkspaceScreen id={workspaceId} onGone={() => setWorkspaceId(undefined)} />
        ) : section === "workspaces" ? (
          <WorkspacesScreen onWorkspace={setWorkspaceId} />
        ) : section === "prs" && pullRequest ? (
          <PullRequestScreen pullRequest={pullRequest} threadId={pullRequestThreadId} onBack={() => setPullRequest(undefined)} onOpenThread={openThread} />
        ) : section === "prs" ? (
          <PullRequestsScreen onOpen={(next) => { setPullRequest(next); setPullRequestThreadId(undefined); }} />
        ) : section === "devices" ? (
          <DevicesScreen initialServerId={settingsServerId} onSettingsChange={setSettingsServerId} onPairAnother={onPairAnother} onUnpair={onUnpair} />
        ) : thread ? (
          <View style={{ flex: 1 }}>
            <ThreadScreen
              key={thread.id}
              id={thread.id}
              onOpenArtifact={openArtifact}
              onOpenThread={openThread}
              onOpenPullRequest={(next) => openPullRequest(next, thread.id)}
            />
            {threadTool ? <ThreadToolScreen chat={thread} tool={threadTool} onClose={() => setThreadTool(undefined)} /> : null}
          </View>
        ) : (
          <ComposeScreen onCreated={openThread} />
        )}

        {sidebarVisible ? (
          <>
            <Animated.View
              pointerEvents={sidebarOpen ? "auto" : "none"}
              style={[styles.dim, { opacity: sidebarProgress }]}
            >
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setSidebarOpen(false)}
                accessibilityLabel="Hide sidebar"
              />
            </Animated.View>
            <Animated.View
              style={[
                styles.drawer,
                {
                  width: drawerWidth,
                  transform: [
                    {
                      translateX: sidebarProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-drawerWidth, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <AppSidebar
                section={section}
                threadId={threadId}
                onSection={goSection}
                onSelectThread={openThread}
                onNewThread={newThread}
              />
            </Animated.View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  chrome: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: color.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  title: { flex: 1 },
  plus: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", alignItems: "center" },
  body: { flex: 1, overflow: "hidden" },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  offline: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: color.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  retry: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  retryText: { color: color.primary, fontSize: 13, fontWeight: "600" },
});
