import { useEffect, useRef, useState } from "react";
import { FileText, Folder, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { displayPath } from "@/lib/path";
import { useStore } from "@/state/store";
import type { PathSuggestion } from "@/state/types";

/// Choosing a path on the machine, by typing a bit and arrowing through what is
/// there. Nobody should have to type a full path from memory, so this is the one
/// picker every path setting uses. Pass `ext` to list files of that extension
/// alongside the folders; choosing one of those finishes rather than drills in.

export function PathPicker({
  value,
  onChange,
  onSubmit,
  autoFocus,
  serverId,
  ext,
}: {
  value: string;
  onChange: (path: string) => void;
  /// ⌘↵ takes the highlighted folder, or whatever is typed.
  onSubmit: (path: string) => void;
  autoFocus?: boolean;
  serverId?: string;
  ext?: string;
}) {
  const suggestPaths = useStore((s) => s.suggestPaths);
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const highlighted = useRef("");

  useEffect(() => {
    let cancelled = false;
    // Typing walks the tree, so the ask is debounced rather than sent per key.
    const timer = setTimeout(() => {
      void suggestPaths(value, serverId, ext).then((next) => {
        if (!cancelled) setSuggestions(next);
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, serverId, ext, suggestPaths]);

  const highlightedPath = () =>
    suggestions.find((item) => item.path.toLowerCase() === highlighted.current.toLowerCase())?.path;

  return (
    <Command
      shouldFilter={false}
      className="rounded-none bg-transparent"
      onValueChange={(next) => {
        highlighted.current = next;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onSubmit(highlightedPath() ?? value);
        }
      }}
    >
      <CommandInput
        value={value}
        onValueChange={onChange}
        placeholder={ext ? `~/notes/how-we-build.${ext}` : "~/code/my-project"}
        autoFocus={autoFocus}
        className="font-mono text-[13px]"
      />
      <CommandList className="max-h-[240px]">
        <CommandEmpty>{ext ? `No folders or .${ext} files match.` : "No folders match."}</CommandEmpty>
        {suggestions.length > 0 && (
          <CommandGroup>
            {suggestions.map((item) => (
              <CommandItem
                key={item.path}
                value={item.path}
                // Selecting a folder drills in rather than finishing: one you
                // can open is usually on the way to the one you want. A file is
                // the answer itself.
                onSelect={() => (item.file
                  ? onSubmit(displayPath(item.path))
                  : onChange(`${displayPath(item.path).replace(/\/+$/, "")}/`))}
                className="font-mono text-[12px]"
              >
                {item.file ? (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                ) : item.repo ? (
                  <FolderGit2 className="size-3.5 shrink-0 text-primary" />
                ) : (
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{displayPath(item.path)}</span>
                {item.repo && <span className="shrink-0 font-sans text-[11px] text-muted-foreground">git</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

export function PathPickerHints({ confirm }: { confirm: string }) {
  return (
    <span className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <KbdGroup>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </KbdGroup>
        Navigate
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd> Open
      </span>
      <span className="flex items-center gap-1">
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
        </KbdGroup>
        {confirm}
      </span>
      <span className="flex items-center gap-1">
        <Kbd>esc</Kbd> Close
      </span>
    </span>
  );
}

/// The picker as a dialog, for a setting that holds one folder.
export function PathPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  initialPath,
  confirmLabel,
  onConfirm,
  footerStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialPath: string;
  confirmLabel: string;
  onConfirm: (path: string) => void;
  footerStart?: React.ReactNode;
}) {
  const [path, setPath] = useState(initialPath || "~/");

  useEffect(() => {
    if (open) setPath(initialPath || "~/");
  }, [open, initialPath]);

  const confirm = (value: string) => {
    onConfirm(value.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 p-0 sm:max-w-[520px]" showCloseButton>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <PathPicker value={path} onChange={setPath} onSubmit={confirm} autoFocus />
        <DialogFooter className="border-t border-border bg-muted px-4 py-2 sm:justify-between">
          {footerStart ?? <PathPickerHints confirm={confirmLabel} />}
          <Button size="sm" disabled={!path.trim()} onClick={() => confirm(path)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
