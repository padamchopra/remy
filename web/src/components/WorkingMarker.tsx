import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { ProviderMark } from "@/components/ProviderMark";
import { elapsedSince, useTicker } from "@/lib/elapsed";

/// Keep the ticking clock local so the transcript does not repaint every second.
export function WorkingMarker({ provider, label, workingSince }: {
  provider: string;
  label: string;
  workingSince?: number;
}) {
  const now = useTicker(Boolean(workingSince));
  return (
    <Marker role="status" aria-label={`${label} is working`} className="min-w-0 py-0.5">
      <MarkerIcon><ProviderMark provider={provider} /></MarkerIcon>
      <MarkerContent className="shimmer">
        {label} is working
        {workingSince && <span aria-hidden="true" className="tabular-nums"> ({elapsedSince(workingSince, now)})</span>}
      </MarkerContent>
    </Marker>
  );
}
