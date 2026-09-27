import { useCallback, useEffect, useState } from "react";
import { hubRequest, hubThreadBase } from "./hub-threads";
import type { PullRequestActivity } from "./pull-request-activity";

/// These reads stay out of the Activity surface itself: the tab's badge is
/// drawn before anyone opens it, and the Summary's rail reads the rest.

function query(repository: string, number: number) {
  return new URLSearchParams({ repository, number: String(number) }).toString();
}

/// The pull request's timeline, read when it opens and again whenever the
/// list says it changed. `failed` means this hub cannot answer it, and the
/// tab falls back to the comments the list already carries.
export function usePullRequestActivity(organizationId: string, repository: string, number: number, revision: string) {
  const [activity, setActivity] = useState<PullRequestActivity>();
  const [failed, setFailed] = useState(false);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let current = true;
    if (!organizationId) return;
    hubRequest<PullRequestActivity>(`${hubThreadBase(organizationId)}/github/pull-request-activity?${query(repository, number)}`)
      .then((response) => {
        if (!current) return;
        setActivity(response);
        setFailed(false);
      })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [organizationId, repository, number, revision, reads]);
  useEffect(() => { setActivity(undefined); setFailed(false); }, [organizationId, repository, number]);
  const reload = useCallback(() => setReads((value) => value + 1), []);
  /// You opened Activity. The badge clears at once; the hub keeps the mark.
  const markSeen = useCallback(() => {
    setActivity((current) => (current ? { ...current, seenAt: Date.now() } : current));
    void hubRequest(`${hubThreadBase(organizationId)}/github/pull-request-seen`, "PUT", { repository, number }).catch(() => undefined);
  }, [organizationId, repository, number]);
  return { activity, failed, reload, markSeen };
}

export interface LinkedTicket {
  identifier: string;
  title: string;
  url: string;
  state: "backlog" | "unstarted" | "started" | "completed" | "canceled" | "triage" | "";
}

/// The Linear issue this pull request belongs to, found with your own Linear
/// account. Nothing when Linear is not connected, nothing matches, or this hub
/// cannot look.
export function usePullRequestTicket(organizationId: string, repository: string, number: number) {
  const [ticket, setTicket] = useState<LinkedTicket | null>(null);
  useEffect(() => {
    let current = true;
    setTicket(null);
    if (!organizationId) return;
    hubRequest<{ ticket: LinkedTicket | null }>(`${hubThreadBase(organizationId)}/github/pull-request-ticket?${query(repository, number)}`)
      .then((response) => { if (current) setTicket(response.ticket ?? null); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [organizationId, repository, number]);
  return ticket;
}
