import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";

const WIDE_THREAD_TOOLS = "(min-width: 1024px)";

/// One shared browser: what the agent and the person are both looking at.
export interface SharedBrowserView {
  browserId?: string;
  active: boolean;
  url?: string;
  title?: string;
  viewport?: "fullscreen" | "desktop" | "mobile";
  width: number;
  height: number;
  revision: number;
  controller?: "agent" | "you";
  cursor?: { x: number; y: number; pressed?: boolean };
  screenshot?: string;
  error?: string;
}

export interface ThreadToolTab {
  id: string;
  type: "browser" | "analytics" | "performance" | "pull-request" | "activity";
  repository?: string;
  pullRequestNumber?: number;
}

function browserPath(chatId: string, browserId: string, action?: string): string {
  const base = `/chats/${encodeURIComponent(chatId)}/browser${action ? `/${action}` : ""}`;
  return `${base}?instance=${encodeURIComponent(browserId)}`;
}

export function githubPullRequestTarget(href: string): { repository: string; number: number } | undefined {
  try {
    const url = new URL(href);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
    const [owner, repository, kind, rawNumber] = url.pathname.split("/").filter(Boolean);
    const number = Number(rawNumber);
    if (!owner || !repository || kind !== "pull" || !Number.isSafeInteger(number) || number <= 0) return undefined;
    return { repository: `${decodeURIComponent(owner)}/${decodeURIComponent(repository)}`, number };
  } catch {
    return undefined;
  }
}

/// Which tools a thread has open, and their shared state. It stays in the
/// thread so the header's dot and the tab bar work before any tool is loaded.
export function useThreadTools(
  chatId: string,
  serverId: string,
  shown: boolean,
  setShown: (shown: boolean) => void,
  enabled = true,
) {
  const [tabs, setTabs] = useState<ThreadToolTab[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [views, setViews] = useState<Record<string, SharedBrowserView | undefined>>({});
  const [supportsInstances, setSupportsInstances] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nextBrowser = useRef(2);
  const nextInsight = useRef(2);

  useEffect(() => {
    const media = window.matchMedia(WIDE_THREAD_TOOLS);
    const closeOnNarrow = () => {
      if (!media.matches) setShown(false);
    };
    media.addEventListener("change", closeOnNarrow);
    return () => media.removeEventListener("change", closeOnNarrow);
  }, [setShown]);

  const refresh = useCallback(async (browserId = "default") => {
    if (!enabled) return;
    try {
      const next = await transport.request<SharedBrowserView>(
        serverId,
        browserPath(chatId, browserId),
      );
      if (typeof next.browserId === "string") setSupportsInstances(true);
      setViews((current) => ({ ...current, [browserId]: next }));
    } catch {
      setViews((current) => ({ ...current, [browserId]: undefined }));
    }
  }, [chatId, serverId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    for (const tab of tabs) {
      if (tab.type === "browser") void refresh(tab.id);
    }
  }, [enabled, refresh, tabs]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = transport.subscribe((_source, payload) => {
      const frame = payload as Partial<SharedBrowserView> & { type?: string; chatId?: string; browserId?: string };
      if (frame.type !== "browser" || frame.chatId !== chatId) return;
      if (typeof frame.browserId === "string") setSupportsInstances(true);
      const browserId = frame.browserId || "default";
      setTabs((current) => current.some((tab) => tab.id === browserId) || frame.active === false
        ? current
        : [...current, { id: browserId, type: "browser" }]);
      setViews((current) => ({
        ...current,
        [browserId]: {
          active: frame.active !== false,
          width: current[browserId]?.width ?? 1280,
          height: current[browserId]?.height ?? 800,
          revision: frame.revision ?? current[browserId]?.revision ?? 0,
          ...current[browserId],
          ...frame,
        },
      }));
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(browserId), 80);
    });
    return () => {
      clearTimeout(refreshTimer.current);
      unsubscribe();
    };
  }, [chatId, enabled, refresh]);

  const addBrowser = () => {
    if (!supportsInstances && tabs.length > 0) return;
    const id = tabs.length === 0
      ? "default"
      : `browser-${Date.now().toString(36)}-${nextBrowser.current++}`;
    setTabs((current) => [...current, { id, type: "browser" }]);
    setActiveTab(id);
    setShown(true);
  };

  const addInsight = (type: "analytics" | "performance") => {
    const id = tabs.some((tab) => tab.type === type)
      ? `${type}-${Date.now().toString(36)}-${nextInsight.current++}`
      : type;
    setTabs((current) => [...current, { id, type }]);
    setActiveTab(id);
    setShown(true);
  };

  const showPullRequest = useCallback((target?: { repository: string; number: number }) => {
    setTabs((current) => {
      const tab: ThreadToolTab = {
        id: "pull-request",
        type: "pull-request",
        ...(target ? { repository: target.repository, pullRequestNumber: target.number } : {}),
      };
      return current.some((candidate) => candidate.type === "pull-request")
        ? current.map((candidate) => candidate.type === "pull-request" ? tab : candidate)
        : [...current, tab];
    });
    setActiveTab("pull-request");
    setShown(true);
  }, [setShown]);

  const openBrowserLink = useCallback(async (url: string) => {
    const existing = tabs.find((tab) => tab.type === "browser" && tab.id === activeTab)
      ?? tabs.find((tab) => tab.type === "browser");
    const browserId = existing?.id ?? "default";
    if (!existing) {
      setTabs((current) => current.some((tab) => tab.id === browserId)
        ? current
        : [...current, { id: browserId, type: "browser" }]);
    }
    setActiveTab(browserId);
    setShown(true);
    try {
      const next = await transport.request<SharedBrowserView>(
        serverId,
        browserPath(chatId, browserId, "open"),
        { method: "POST", body: { url } },
      );
      if (typeof next.browserId === "string") setSupportsInstances(true);
      setViews((current) => ({ ...current, [browserId]: next }));
    } catch (caught) {
      toast.error("The browser action failed", { description: apiError(caught) });
    }
  }, [activeTab, chatId, serverId, setShown, tabs]);

  const openLink = useCallback((href: string) => {
    const pullRequest = githubPullRequestTarget(href);
    if (pullRequest) {
      showPullRequest(pullRequest);
      return;
    }
    void openBrowserLink(href);
  }, [openBrowserLink, showPullRequest]);

  const closeTab = async (tab: ThreadToolTab) => {
    const browserId = tab.id;
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== browserId);
      if (activeTab === browserId) setActiveTab(next.at(-1)?.id ?? "");
      return next;
    });
    setViews((current) => {
      const next = { ...current };
      delete next[browserId];
      return next;
    });
    if (tab.type !== "browser") return;
    try {
      await transport.request(serverId, browserPath(chatId, browserId, "close"), { method: "POST", body: {} });
    } catch (caught) {
      toast.error("Couldn't close that tool", { description: apiError(caught) });
    }
  };

  return {
    tabs,
    activeTab,
    setActiveTab,
    views,
    setView: (browserId: string, view: SharedBrowserView) =>
      setViews((current) => ({ ...current, [browserId]: view })),
    addBrowser,
    addAnalytics: () => addInsight("analytics"),
    addPerformance: () => addInsight("performance"),
    addPullRequest: () => showPullRequest(),
    addActivity: () => {
      setTabs((current) => current.some((tab) => tab.type === "activity") ? current : [...current, { id: "activity", type: "activity" }]);
      setActiveTab("activity");
      setShown(true);
    },
    openLink,
    canAddBrowser: supportsInstances || !tabs.some((tab) => tab.type === "browser"),
    closeTab,
    shown,
    setShown,
    active: Object.values(views).some((view) => view?.active),
  };
}

