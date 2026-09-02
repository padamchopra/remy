import { useEffect, useRef } from "react";
import { transport } from "@/lib/transport";
import {
  notifyPermission,
  shouldNotify,
  threadIdFrom,
  type NotifyFrame,
} from "@/lib/notify";

/// Raises a banner for each `notification` frame the server pushes, and opens
/// the thread when one is clicked.
///
/// `openThreadId` and `onOpen` are read through refs: the subscription is to a
/// long-lived socket, and re-subscribing on every selection change would drop
/// frames in the gap.
export function useNotifications(input: {
  enabled: boolean;
  openThreadId: string | null;
  onOpen: (id: string) => void;
}): void {
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    const live: Notification[] = [];

    const off = transport.subscribe((_serverId, payload) => {
      const frame = payload as NotifyFrame;
      if (frame.type !== "notification") return;

      const threadId = threadIdFrom(frame);
      const { enabled, openThreadId, onOpen } = latest.current;
      if (
        !shouldNotify({
          enabled,
          permission: notifyPermission(),
          documentHidden: document.hidden,
          openThreadId: openThreadId ?? undefined,
          threadId,
        })
      ) {
        return;
      }

      try {
        const banner = new Notification(frame.title ?? "Remy", {
          body: frame.message || undefined,
          // One banner per thread: a thread that asks twice replaces its own
          // notification rather than stacking.
          tag: threadId,
          icon: "./favicon.png",
        });
        banner.onclick = () => {
          window.focus();
          void window.remy?.focus?.();
          if (threadId) onOpen(threadId);
          banner.close();
        };
        live.push(banner);
      } catch {
        // Some browsers refuse to construct one outside a service worker.
      }
    }, ["sidebar"]);

    return () => {
      off();
      // A banner outliving the page it would navigate is just litter.
      for (const banner of live) banner.close();
    };
  }, []);
}
