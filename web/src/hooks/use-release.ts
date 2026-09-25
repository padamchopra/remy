import { useCallback, useEffect, useRef, useState } from "react";
import { REMY_VERSION, fetchReleasesSince, isLocalBuild, isNewer, type RemyRelease } from "@/lib/release";

/// How often the window asks GitHub what has shipped.
///
/// Remy is a window that stays open — a login item on a machine that holds the
/// repositories, often for days — so a single check at launch meant a release
/// that shipped afterwards was never noticed. An hour is frequent enough to
/// hear about one the day it lands, and 24 requests a day against GitHub's 60
/// an hour for a machine that is not signed in.
const POLL_MS = 60 * 60_000;

/// The soonest a window coming back to the front will ask again.
///
/// A timer does not run while the machine is asleep, so a laptop opened after a
/// night away would otherwise wait out the rest of the hour. Sitting back down
/// is the moment to know, and the floor keeps switching windows from turning
/// into a request each time.
const FOCUS_FLOOR_MS = 5 * 60_000;

export function useRelease() {
  const [current] = useState(REMY_VERSION);
  // The check reads this rather than closing over `current`, so a rebuilt
  // callback is not part of asking again.
  const currentRef = useRef(current);
  currentRef.current = current;
  const [pending, setPending] = useState<RemyRelease[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const checkedAt = useRef(0);

  // Everything newer than this build, not just the newest of them: what you
  // would be getting is the whole run of releases in between.
  //
  // `asked` is whether a person is waiting for the answer. Only then does the
  // pane say it is checking or hear about a failure — a poll that says either
  // would be a window that looks busy on its own, and a toast for a machine
  // that happened to be offline on the hour.
  const run = useCallback(async (asked: boolean) => {
    if (asked) {
      setChecking(true);
      setError(undefined);
    }
    try {
      const releases = await fetchReleasesSince(currentRef.current);
      checkedAt.current = Date.now();
      setPending(releases);
      return releases[0];
    } catch (caught) {
      if (asked) setError(caught instanceof Error ? caught.message : "Couldn't check for updates.");
      throw caught;
    } finally {
      if (asked) setChecking(false);
    }
  }, []);

  /// The check behind the button, which is the one that reports what it found.
  const check = useCallback(() => run(true), [run]);

  const local = isLocalBuild(current);

  useEffect(() => {
    // A build made here has no release to be behind, so nothing is asked of
    // GitHub either — not at launch, and not on the hour.
    if (local) return;
    const poll = () => void run(false).catch(() => {});
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    const onFocus = () => {
      if (Date.now() - checkedAt.current >= FOCUS_FLOOR_MS) poll();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [run, local]);

  const latest = pending[0];
  const available = !local && Boolean(latest) && isNewer(latest.version, current);

  return { current, latest, pending, available, local, checking, error, check };
}
