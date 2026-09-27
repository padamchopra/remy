import { Item, ItemGroup } from "./ui/item";
import { Skeleton } from "./ui/skeleton";

/// First-load stand-in for the workspace list: the search row and the same
/// 52px rows, mark well and two text lines as the real list, so nothing jumps
/// when the catalogue lands. Only used when this device has never saved a list.
export function WorkspaceListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading workspaces" className="flex flex-col gap-4">
      <div className="flex h-8 items-center" aria-hidden="true">
        <Skeleton className="h-8 w-full max-w-[360px] rounded-md" />
      </div>
      <ItemGroup className="overflow-clip rounded-[10px] border border-border">
        {Array.from({ length: count }, (_, index) => (
          <Item key={index} aria-hidden="true" className="h-[52px] flex-nowrap gap-3 rounded-none border-0 border-b border-border px-3.5 py-0 last:border-b-0">
            <Skeleton className="size-7 shrink-0 rounded-[7px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}
