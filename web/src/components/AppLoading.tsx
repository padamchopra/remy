import { Skeleton } from "@/components/ui/skeleton";
import { PaneLoading } from "@/components/PaneLoading";

export function AppLoading() {
  return (
    <div className="app-loading flex h-svh overflow-hidden bg-background" aria-busy="true">
      <aside aria-hidden="true" className="hidden w-60 shrink-0 border-r bg-sidebar md:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div aria-hidden="true" className="flex h-[49px] shrink-0 items-center border-b px-3">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="p-4"><PaneLoading label="Loading Remy" /></div>
      </div>
    </div>
  );
}
