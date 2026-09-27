import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";

/// The web app is the hosted app. Without its runtime there is nothing else to
/// fall back to, so say so and offer another try.
export default function AppUnreachable() {
  return (
    <main className="flex h-svh items-center justify-center bg-background p-4">
      <EmptyState title="Remy isn’t responding" description="Check your connection, then try again.">
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </EmptyState>
    </main>
  );
}
