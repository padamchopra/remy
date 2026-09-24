import { useCallback, useEffect, useState } from "react";
import { formatLocation, normalizeLocation, parseLocation, type AppLocation } from "@/lib/route";

/// The window's location, as app state.
///
/// `hashchange` covers the back button and anything else that moves the hash;
/// writing goes through `location.hash` so each navigation is a history entry
/// you can go back from. `replace` is for corrections — normalising a bare hash,
/// or dropping a thread that no longer exists — which nobody should have to
/// press back through.
export function useAppLocation(): [AppLocation, (next: AppLocation, replace?: boolean) => void] {
  const [location, setLocation] = useState<AppLocation>(() => normalizeLocation());

  useEffect(() => {
    const onChange = () => setLocation(normalizeLocation());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: AppLocation, replace = false) => {
    const hash = formatLocation(next);
    if (hash === window.location.hash) return;
    if (replace) {
      history.replaceState(null, "", hash);
      setLocation(parseLocation(hash));
      return;
    }
    // Assigning fires `hashchange`, which is what updates the state.
    window.location.hash = hash;
  }, []);

  return [location, navigate];
}
