import { useEffect, useState } from "react";
import { GitBranch, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "./ui/command";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { InputGroupButton } from "./ui/input-group";
import { Skeleton } from "./ui/skeleton";
import { apiError } from "@/lib/api-error";
import { useStore } from "@/state/store";
import type { GitBranch as Branch } from "@/state/types";

export function BranchPicker({
  workspaceId,
  branch,
  busy,
  onPick,
  loadBranches,
  pending = false,
}: {
  loadBranches?: (workspaceId: string) => Promise<Branch[]>;
  workspaceId: string;
  branch: string;
  pending?: boolean;
  busy: boolean;
  onPick: (value: string) => Promise<boolean>;
}) {
  const localBranches = useStore((s) => s.listBranches);
  const listBranches = loadBranches ?? localBranches;
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void listBranches(workspaceId)
      .then((next) => {
        if (!cancelled) setBranches(next);
      })
      .catch((caught) => {
        if (!cancelled) {
          setBranches([]);
          toast.error("Couldn't load branches", { description: apiError(caught) });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, listBranches]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <InputGroupButton aria-label="Branch" className="min-w-0" disabled={busy}>
          <GitBranch />
          {pending ? <Skeleton className="h-3 w-16" /> : <span className="max-w-40 truncate">{branch}</span>}
          <ChevronDown />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search branches" />
          <CommandList>
            {loading ? (
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                <CommandEmpty>No matching branch.</CommandEmpty>
                <CommandGroup>
                  {branches.map((entry) => (
                    <CommandItem
                      key={entry.name}
                      value={entry.name}
                      disabled={busy}
                      onSelect={() => {
                        void onPick(entry.name).then((picked) => {
                          if (picked) setOpen(false);
                        });
                      }}
                    >
                      <GitBranch />
                      <span className="min-w-0 truncate">{entry.name}</span>
                      <span className="ml-auto flex items-center gap-2">
                        {entry.checkout === "main" ? (
                          <span className="text-muted-foreground">Main checkout</span>
                        ) : null}
                        {entry.checkout === "worktree" ? (
                          <span className="text-muted-foreground">Worktree</span>
                        ) : null}
                        {entry.name === branch ? <Check /> : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

