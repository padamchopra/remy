import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useStore } from "@/state/store";
import type { WorkspaceIconMatch } from "@/state/types";

export function ProjectIconSearch({
  active,
  workspaceId,
  onPick,
  search,
  loadPreview,
}: {
  active: boolean;
  workspaceId: string;
  onPick: (path: string) => void;
  loadPreview?: (path: string) => Promise<string>;
  search?: (workspaceId: string, query: string) => Promise<WorkspaceIconMatch[]>;
}) {
  const suggestWorkspaceIcons = useStore((s) => s.suggestWorkspaceIcons);
  const suggest = search ?? suggestWorkspaceIcons;
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [icons, setIcons] = useState<WorkspaceIconMatch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    setQuery("");
    setIcons([]);
    setLoading(true);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void suggest(workspaceId, query).then((next) => {
        if (cancelled) return;
        setIcons(next);
        setLoading(false);
      }).catch((cause) => { if (!cancelled) { setError(cause instanceof Error ? cause.message : "Could not load images."); setIcons([]); setLoading(false); } });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query, suggest, workspaceId]);

  return (
    <Command shouldFilter={false} className="min-w-0 rounded-none bg-transparent">
      <CommandInput value={query} onValueChange={setQuery} placeholder="icon.png" autoFocus />
      <CommandList className="max-h-[240px]">
        <CommandEmpty>
          {loading ? <span className="shimmer">Looking for images…</span> : error || "No images match. Try icon or logo."}
        </CommandEmpty>
        {icons.length > 0 && (
          <CommandGroup>
            {icons.map((item) => (
              <CommandItem key={item.path} value={item.path} onSelect={() => onPick(item.path)} className="min-w-0">
                <ImagePreview item={item} loadPreview={loadPreview} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function ImagePreview({ item, loadPreview }: { item: WorkspaceIconMatch; loadPreview?: (path: string) => Promise<string> }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState(item.preview);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(item.preview);
    setFailed(false);
    if (item.preview || !loadPreview || !ref.current) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void loadPreview(item.path).then(value => { if (active) setSrc(value); }).catch(() => { if (active) setFailed(true); });
    });
    observer.observe(ref.current);
    return () => { active = false; observer.disconnect(); };
  }, [item.path, item.preview, loadPreview]);
  return <Avatar ref={ref} size="sm" className="rounded-md" title={failed ? "Image preview unavailable" : undefined}>
    {src && <AvatarImage src={src} alt="" className="object-contain" />}
    <AvatarFallback className="rounded-md"><ImageIcon /></AvatarFallback>
  </Avatar>;
}
