import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";

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
  canGoBack?: boolean;
  canGoForward?: boolean;
  zoomFactor?: number;
  download?: { filename: string; state: "started" | "completed" | "failed" };
  screenshot?: string;
  error?: string;
}

function browserPath(chatId: string, browserId: string, action?: string): string {
  const base = `/chats/${encodeURIComponent(chatId)}/browser${action ? `/${action}` : ""}`;
  return `${base}?instance=${encodeURIComponent(browserId)}`;
}

export function browserKey(chatId: string, browserId: string): string {
  return `${chatId}:${browserId}`;
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

/// The shared browsers of one thread collection: their views, the frames that
/// keep them current, and the calls that drive them. Which of them is open as a
/// tab is the workbench's business; this only knows which browsers exist, and
/// tells the workbench when the agent opens one it has not seen.
export function useSharedBrowsers(
  serverId: string,
  chatIds: string[],
  browsers: { chatId: string; browserId: string }[],
  enabled: boolean,
  onBrowserOpened: (chatId: string, browserId: string) => void,
) {
  const [views, setViews] = useState<Record<string, SharedBrowserView | undefined>>({});
  const [supportsInstances, setSupportsInstances] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const chatSet = useRef(new Set(chatIds));
  chatSet.current = new Set(chatIds);
  const opened = useRef(onBrowserOpened);
  opened.current = onBrowserOpened;
  const browserList = browsers.map((browser) => browserKey(browser.chatId, browser.browserId)).join("\u0000");
  const threadTopics = chatIds.map((chatId) => `thread:${chatId}`).sort().join("\u0000");

  const refresh = useCallback(async (chatId: string, browserId: string) => {
    if (!enabled) return;
    const key = browserKey(chatId, browserId);
    try {
      const next = await transport.request<SharedBrowserView>(serverId, browserPath(chatId, browserId));
      if (typeof next.browserId === "string") setSupportsInstances(true);
      setViews((current) => ({ ...current, [key]: next }));
    } catch {
      setViews((current) => ({ ...current, [key]: undefined }));
    }
  }, [serverId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    for (const key of browserList.split("\u0000").filter(Boolean)) {
      const [chatId, browserId] = key.split(":") as [string, string];
      void refresh(chatId, browserId);
    }
  }, [enabled, refresh, browserList]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = transport.subscribe((_source, payload) => {
      const frame = payload as Partial<SharedBrowserView> & { type?: string; chatId?: string; browserId?: string };
      if (frame.type !== "browser" || !frame.chatId || !chatSet.current.has(frame.chatId)) return;
      const chatId = frame.chatId;
      if (typeof frame.browserId === "string") setSupportsInstances(true);
      const browserId = frame.browserId || "default";
      const key = browserKey(chatId, browserId);
      if (frame.active !== false) opened.current(chatId, browserId);
      setViews((current) => ({
        ...current,
        [key]: {
          active: frame.active !== false,
          width: current[key]?.width ?? 1280,
          height: current[key]?.height ?? 800,
          revision: frame.revision ?? current[key]?.revision ?? 0,
          ...current[key],
          ...frame,
        },
      }));
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(chatId, browserId), 80);
    }, threadTopics.split("\u0000").filter(Boolean));
    return () => {
      clearTimeout(refreshTimer.current);
      unsubscribe();
    };
  }, [enabled, refresh, threadTopics]);

  const open = useCallback(async (chatId: string, browserId: string, url: string) => {
    try {
      const next = await transport.request<SharedBrowserView>(
        serverId,
        browserPath(chatId, browserId, "open"),
        { method: "POST", body: { url } },
      );
      if (typeof next.browserId === "string") setSupportsInstances(true);
      setViews((current) => ({ ...current, [browserKey(chatId, browserId)]: next }));
    } catch (caught) {
      toast.error("The browser action failed", { description: apiError(caught) });
    }
  }, [serverId]);

  const close = useCallback(async (chatId: string, browserId: string) => {
    setViews((current) => {
      const next = { ...current };
      delete next[browserKey(chatId, browserId)];
      return next;
    });
    try {
      await transport.request(serverId, browserPath(chatId, browserId, "close"), { method: "POST", body: {} });
    } catch (caught) {
      toast.error("Couldn't close that browser", { description: apiError(caught) });
    }
  }, [serverId]);

  return {
    views,
    setView: (chatId: string, browserId: string, view: SharedBrowserView) =>
      setViews((current) => ({ ...current, [browserKey(chatId, browserId)]: view })),
    supportsInstances,
    open,
    close,
  };
}
