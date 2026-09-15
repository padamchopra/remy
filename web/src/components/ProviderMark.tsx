import { Network } from "lucide-react";
import { ClaudeMark } from "@/components/ClaudeMark";
import { CodexMark } from "@/components/CodexMark";
import { CursorMark } from "@/components/CursorMark";
import { cn } from "@/lib/utils";

/// The mark a provider wears, wherever Remy names one.
///
/// Each is its own brand glyph, so a row is recognised rather than read. Claude
/// wears the clay it wears on claude.ai; Codex is a monochrome mark and takes
/// the foreground.
export function ProviderMark({ provider, className }: { provider?: string; className?: string }) {
  if (provider === "codex") return <CodexMark className={cn("text-foreground", className)} />;
  if (provider === "cursor") return <CursorMark className={cn("text-foreground", className)} />;
  if (provider === "router" || provider === "openrouter" || provider === "openai") return <Network className={className} />;
  return <ClaudeMark className={cn("text-claude", className)} />;
}
