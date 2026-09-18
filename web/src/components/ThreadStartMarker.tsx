import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { threadStartProgressLabel } from "@/lib/thread-start-progress";

/// Pending new-thread wait: spinner in the marker icon, shimmer on the current phase.
export function ThreadStartMarker({ progress }: { progress?: string }) {
  const text = threadStartProgressLabel(progress);
  return (
    <Marker role="status" aria-live="polite" aria-label={text} className="min-w-0 py-0.5">
      <MarkerIcon><Spinner aria-hidden="true" /></MarkerIcon>
      <MarkerContent className="shimmer">{text}</MarkerContent>
    </Marker>
  );
}
