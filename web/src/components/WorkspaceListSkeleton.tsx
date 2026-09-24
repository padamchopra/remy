import { Item, ItemContent, ItemGroup, ItemMedia } from "./ui/item";

/// First-load stand-in for a workspace tile. Same outline, mark well, and two
/// text lines as the real row, so the list does not jump when the catalogue
/// lands. Only used when this device has never saved a list.
export function WorkspaceListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading workspaces">
      <ItemGroup>
        {Array.from({ length: count }, (_, index) => (
          <Item key={index} variant="outline" aria-hidden="true">
            <ItemMedia>
              <span className="shimmer size-10 rounded-lg" />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-2">
              <span className="shimmer h-4 w-32 rounded" />
              <span className="shimmer h-3 w-48 rounded" />
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}
