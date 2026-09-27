import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewRule, ReviewState } from "@remy/contract";
import { HubRequestError } from "./hub-threads";
import { shareSubscription } from "./shared-subscription";
import { listReviewRules, readPullRequestReview, reviewLivePath } from "./review-agent";
import { apiError } from "./api-error";

/// What the review socket says. Frames carry no content: each names what to
/// read again. `reset` arrives on every (re)connect, so a reconnect reads
/// everything open again instead of resuming.
export type ReviewLiveFrame =
  | { kind: "reset" }
  | { kind: "review"; computerId: string; threadId: string }
  | { kind: "rules" };

function startReviewLive(organizationId: string, changed: (frame: ReviewLiveFrame) => void): () => void {
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let attempt = 0;
  // The first socket's reset says nothing its listeners' own first reads did
  // not; a reconnect's reset means frames may have been missed.
  let reconnecting = false;
  const connect = () => {
    if (stopped) return;
    const again = reconnecting;
    reconnecting = true;
    const url = new URL(reviewLivePath(organizationId), window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => { if (socket === ws) attempt = 0; };
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      try {
        const frame = JSON.parse(String(event.data)) as ReviewLiveFrame;
        if (frame.kind === "reset" && !again) return;
        if (frame.kind === "reset" || frame.kind === "rules" || (frame.kind === "review" && frame.computerId && frame.threadId)) changed(frame);
      } catch {
        // Not a frame this window understands.
      }
    };
    ws.onclose = (event) => {
      if (stopped || socket !== ws) return;
      socket = undefined;
      // Signed out: nothing to reconnect to.
      if (event.code === 1008) return;
      retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, 30_000));
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
    socket = undefined;
  };
}

/// One review socket per account, however many views listen. A frame is an
/// event, so a late listener is not handed an old one.
const watchReviewLive = shareSubscription<[ReviewLiveFrame]>(
  (organizationId, changed) => startReviewLive(organizationId, changed),
  () => false,
);

export function useReviewLive(organizationId: string, onFrame: (frame: ReviewLiveFrame) => void) {
  const latest = useRef(onFrame);
  latest.current = onFrame;
  useEffect(() => {
    if (!organizationId) return;
    return watchReviewLive(organizationId, (frame) => latest.current(frame), () => undefined);
  }, [organizationId]);
}

/// Your latest review of a pull request, kept current by the socket: read
/// when the pull request opens, again on every reconnect, and whenever the
/// hub says that review (or, before there is one, any review of yours)
/// changed. `undefined` until the first read answers; `null` for none.
export function usePullRequestReview(organizationId: string, repository: string, number: number) {
  const [review, setReview] = useState<ReviewState | null>();
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const current = useRef<ReviewState | null | undefined>(undefined);
  current.current = review;
  const read = useCallback(async () => {
    const id = ++request.current;
    try {
      const value = await readPullRequestReview(organizationId, repository, number);
      if (id !== request.current) return;
      setReview(value);
      setError(undefined);
    } catch (caught) {
      if (id !== request.current) return;
      // A hub without review routes has no reviews; the pull request still works.
      if (caught instanceof HubRequestError && caught.status === 404) { setReview(null); return; }
      setError(apiError(caught));
      setReview((value) => value ?? null);
    }
  }, [organizationId, repository, number]);
  useEffect(() => {
    setReview(undefined);
    setError(undefined);
    if (organizationId) void read();
  }, [organizationId, read]);
  useReviewLive(organizationId, (frame) => {
    if (frame.kind === "reset") { void read(); return; }
    if (frame.kind !== "review") return;
    const open = current.current;
    // A review of this pull request started elsewhere arrives as a frame for
    // a thread this view does not know yet.
    if (!open || (open.computerId === frame.computerId && open.threadId === frame.threadId)) void read();
  });
  return { review, error, reload: read, setReview };
}

/// Your rules that can apply to this repository (its own and all
/// workspaces), read again when they change anywhere.
export function useReviewRules(organizationId: string, repository: string, enabled = true) {
  const [rules, setRules] = useState<ReviewRule[]>();
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const read = useCallback(async () => {
    const id = ++request.current;
    try {
      const value = await listReviewRules(repository);
      if (id === request.current) { setRules(value); setError(undefined); }
    } catch (caught) {
      if (id !== request.current) return;
      if (caught instanceof HubRequestError && caught.status === 404) { setRules([]); return; }
      setError(apiError(caught));
    }
  }, [repository]);
  useEffect(() => { if (enabled) void read(); }, [enabled, read]);
  useReviewLive(enabled ? organizationId : "", (frame) => {
    if (frame.kind === "reset" || frame.kind === "rules") void read();
  });
  return { rules, error, reload: read, setRules };
}
