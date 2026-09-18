import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Loader2Icon } from "lucide-react";
import { threadStartProgressLabel } from "@/lib/thread-start-progress";

/// Pending new-thread wait: spinner in the marker icon, shimmer on the current phase.
export function ThreadStartMarker({ progress }: { progress?: string }) {
  const text = threadStartProgressLabel(progress);
  return (
    <Marker role="status" aria-live="polite" aria-label={text} className="min-w-0 py-0.5">
      <MarkerIcon>
        <Loader2Icon className="animate-spin" />
      </MarkerIcon>
      <MarkerContent className="shimmer">{text}</MarkerContent>
    </Marker>
  );
}
