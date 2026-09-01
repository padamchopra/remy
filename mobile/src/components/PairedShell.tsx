import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Animated, Easing, Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { PanelLeft, PanelLeftClose, Plus } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, space, type } from "../theme";
import { agentConversation } from "../lib/inbox";
import { useDevicePreferenceOrder, useStore } from "../state/store";
import { AppSidebar, type AppSection } from "./AppSidebar";
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
import type { ConvArtifact } from "../state/types";

const DRAWER_WIDTH = 300;
const DRAWER_EASING = Easing.bezier(0.32, 0.72, 0, 1);

export function PairedShell({
  openThreadRef,
  onPairAnother,
  onUnpair,
}: {
  openThreadRef: MutableRefObject<(id: string) => void>;
  onPairAnother: () => void;
  onUnpair: (url: string) => void;
}) {
  const insets = useSafeAreaInsets();
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
  const openThread = (id: string) => {
    const dm = dms.find((chat) => chat.id === id);
    setTicketKey(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setSidebarOpen(false);
    if (dm?.agentId) {
      setSection("inbox");
      setThreadId(undefined);
      setInboxAgentId(dm.agentId);
      return;
    }
    setSection("threads");
    setThreadId(id);
    setInboxAgentId(undefined);
  };

  openThreadRef.current = openThread;

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
      setTicketKey(artifact.key);
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
    }
  };

  const newThread = () => {
    setSection("threads");
    setThreadId(undefined);
    setTicketKey(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setInboxAgentId(undefined);
    setSidebarOpen(false);
  };

  const goSection = (next: AppSection) => {
    setSection(next);
    setTicketKey(undefined);
    setComposingTicket(false);
    setWorkspaceId(undefined);
    setThreadId(undefined);
    setInboxAgentId(undefined);
    setSidebarOpen(false);
  };

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
    : section === "board" ? "Board"
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
          <Pressable onPress={newThread} accessibilityLabel="New thread" style={styles.plus}>
            <Plus size={18} color={color.foreground} />
          </Pressable>
        ) : (
          <View style={styles.plus} />
        )}
      </View>

      <View style={styles.body}>
        {section === "inbox" && inboxDm ? (
          <ThreadScreen key={inboxDm.id} id={inboxDm.id} onOpenArtifact={openArtifact} />
        ) : section === "inbox" ? (
          <InboxScreen onOpen={setInboxAgentId} />
        ) : section === "board" && composingTicket ? (
          <NewTicketScreen
            onCreated={(key) => {
              setComposingTicket(false);
              setTicketKey(key);
            }}
          />
        ) : section === "board" && ticket ? (
          <TicketScreen ticketKey={ticket.key} onOpenThread={openThread} />
        ) : section === "board" ? (
          <BoardScreen onOpen={(key) => setTicketKey(key)} onCompose={() => setComposingTicket(true)} />
        ) : section === "workspaces" && workspaceId ? (
          <WorkspaceScreen id={workspaceId} />
        ) : section === "workspaces" ? (
          <WorkspacesScreen onWorkspace={setWorkspaceId} />
        ) : section === "devices" ? (
          <DevicesScreen onPairAnother={onPairAnother} onUnpair={onUnpair} />
        ) : thread ? (
          <ThreadScreen key={thread.id} id={thread.id} onOpenArtifact={openArtifact} />
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
                  transform: [
                    {
                      translateX: sidebarProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-DRAWER_WIDTH, 0],
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
    width: DRAWER_WIDTH,
  },
});
