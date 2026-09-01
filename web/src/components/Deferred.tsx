import { Suspense, useRef, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/// True from the first time `open` is true, and true from then on.
///
/// A tool that has been opened keeps its browser session, terminal, or review
/// in progress while the pane holding it is hidden, so closing a pane must not
/// unmount what is inside it. Latching in a ref is safe because a render React
/// throws away can only make the surface arrive sooner, never later.
export function useOpenedOnce(open: boolean): boolean {
  const opened = useRef(false);
  if (open) opened.current = true;
  return opened.current;
}

/// What a surface still on the network shows. It fills the box the real surface
/// will fill, so nothing around it moves when the code arrives.
export function SurfaceLoading({ className }: { className?: string }) {
  return (
    <div
      data-slot="surface-loading"
      className={cn(
        "flex size-full min-h-0 min-w-0 flex-1 items-center justify-center bg-background",
        className,
      )}
    >
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

/// A surface whose code is fetched the first time it opens and kept from then
/// on. Hiding the pane leaves it mounted; reopening it costs nothing.
export function Deferred({
  open,
  fallback,
  children,
}: {
  open: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const opened = useOpenedOnce(open);
  if (!opened) return null;
  return <Suspense fallback={fallback ?? <SurfaceLoading />}>{children}</Suspense>;
}
