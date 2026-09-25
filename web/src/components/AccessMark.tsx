import { Network } from "lucide-react";
import { ClaudeMark } from "@/components/ClaudeMark";
import { CodexMark } from "@/components/CodexMark";
import { cn } from "@/lib/utils";

const marks: Record<string, { well: string; glyph: "claude" | "codex" | "network" }> = {
  "claude-code": { well: "bg-claude/20 text-claude", glyph: "claude" },
  claude: { well: "bg-claude/20 text-claude", glyph: "claude" },
  anthropic: { well: "bg-orange-500/20 text-orange-400", glyph: "claude" },
  codex: { well: "bg-zinc-500/20 text-foreground", glyph: "codex" },
  openai: { well: "bg-green-500/20 text-green-400", glyph: "codex" },
  router: { well: "bg-teal-500/20 text-teal-400", glyph: "network" },
  openrouter: { well: "bg-violet-500/20 text-violet-400", glyph: "network" },
};

/// Model Access wears each provider's mark in a tinted well so Claude Code,
/// Codex, and the API-key rows stay distinct at a glance.
export function AccessMark({ id, className }: { id: string; className?: string }) {
  const mark = marks[id] ?? { well: "bg-muted text-muted-foreground", glyph: "network" as const };
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
        mark.well,
        className,
      )}
    >
      {mark.glyph === "claude" ? (
        <ClaudeMark className="size-4" />
      ) : mark.glyph === "codex" ? (
        <CodexMark className="size-4" />
      ) : (
        <Network className="size-4" />
      )}
    </span>
  );
}
