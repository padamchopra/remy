import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export function AppLoading() {
  return (
    <div className="app-loading flex h-svh overflow-hidden bg-background" role="status" aria-label="Loading Remy" aria-busy="true">
      <aside aria-hidden="true" className="hidden w-60 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <div className="flex h-9 items-center gap-3">
          <Skeleton className="size-8 shrink-0" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex flex-col gap-4">
          {["w-24", "w-20", "w-28", "w-24"].map((width, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-4 shrink-0" />
              <Skeleton className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-5 pt-4">
          <Skeleton className="h-2 w-14" />
          {["w-36", "w-28", "w-40", "w-32", "w-36"].map((width, index) => (
            <Skeleton key={index} className={`h-3 ${width}`} />
          ))}
        </div>
        <div className="mt-auto flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
      </aside>
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Skeleton className="size-5" />
          <Skeleton className="h-3 w-28" />
          <Spinner className="ml-auto text-muted-foreground motion-reduce:animate-none" />
        </div>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 pt-12 sm:p-10">
          <Skeleton className="mb-2 h-5 w-36" />
          {["w-3/4", "w-1/2", "w-2/3", "w-3/5", "w-1/2"].map((width, index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className={`h-3 ${width}`} />
                <Skeleton className="h-2 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
