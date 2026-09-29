import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { ThreadCheckpoint } from "@/lib/hub-transcript";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/// The marks beside a transcript. Each one is a message you sent. Hovering
/// names it; choosing it scrolls that message into view.
export function ThreadCheckpointRail({
  checkpoints,
  activeCheckpoint,
  onJump,
}: {
  checkpoints: ThreadCheckpoint[];
  activeCheckpoint?: string;
  onJump: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  if (checkpoints.length === 0) return null;
  const resolved = hovered !== undefined && hovered < checkpoints.length ? hovered : undefined;
  const hoveredItem = resolved === undefined ? undefined : checkpoints[resolved];
  const activeIndex = checkpoints.findIndex((checkpoint) => checkpoint.id === activeCheckpoint);
  const top = (index: number) => checkpoints.length <= 1 ? 0 : (index / (checkpoints.length - 1)) * 100;
  const fromPointer = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (checkpoints.length <= 1 || rect.height <= 0) return 0;
    const progress = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    return Math.round(progress * (checkpoints.length - 1));
  };
  const move = (event: KeyboardEvent<HTMLElement>, delta: number) => {
    event.preventDefault();
    setHovered((current) => Math.max(0, Math.min(checkpoints.length - 1, (current ?? 0) + delta)));
  };
  return (
    <nav
      aria-label="Your messages"
      className="pointer-events-none absolute inset-y-0 left-0 z-30 w-14"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-link
        aria-label={`Go to message ${(resolved ?? Math.max(0, activeIndex)) + 1}`}
        className="pointer-events-auto absolute top-1/2 left-3 h-auto w-10 -translate-y-1/2 rounded-sm bg-transparent p-0 hover:bg-transparent dark:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/70"
        style={{
          height: `min(${Math.max(1, (checkpoints.length - 1) * 8)}px, calc(100vh - 18rem))`,
          width: hoveredItem ? "22rem" : 40,
        }}
        onBlur={() => setHovered(undefined)}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-checkpoint-preview]")) return;
          const checkpoint = checkpoints[fromPointer(event)];
          if (checkpoint) onJump(checkpoint.id);
        }}
        onFocus={() => {
          setHovered((current) => current ?? Math.max(0, activeIndex));
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") move(event, 1);
          else if (event.key === "ArrowUp") move(event, -1);
          else if (event.key === "Home") {
            event.preventDefault();
            setHovered(0);
          } else if (event.key === "End") {
            event.preventDefault();
            setHovered(checkpoints.length - 1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (hoveredItem) onJump(hoveredItem.id);
          }
        }}
        onMouseLeave={() => setHovered(undefined)}
        onMouseMove={(event) => setHovered(fromPointer(event))}
      >
        {checkpoints.map((checkpoint, index) => {
          const active = checkpoint.id === activeCheckpoint;
          const hoverDistance = resolved === undefined ? undefined : Math.abs(index - resolved);
          return (
            <span
              key={checkpoint.id}
              aria-hidden="true"
              data-active={active ? "true" : "false"}
              data-checkpoint-index={index}
              className={cn(
                "pointer-events-none absolute left-0 h-0.5 w-2 -translate-y-1/2 rounded-full bg-foreground/25 transition-[background-color,width] duration-150 motion-reduce:transition-none",
                hoverDistance === 0 && "bg-foreground/65",
                active && "bg-foreground/85",
              )}
              style={{
                top: `${top(index)}%`,
                width: hoverDistance === 0 ? 24 : hoverDistance === 1 ? 16 : hoverDistance === 2 ? 10 : 8,
              }}
            />
          );
        })}
        {hoveredItem && resolved !== undefined && (
          <Card
            data-checkpoint-preview
            className="pointer-events-auto absolute left-8 z-10 w-80 cursor-text select-text gap-1 rounded-xl border-border/60 bg-popover/95 p-3 text-left text-popover-foreground shadow-xl shadow-black/20 backdrop-blur-md"
            onMouseMove={(event) => event.stopPropagation()}
            style={{
              top: `${top(resolved)}%`,
              transform: resolved === 0
                ? "translateY(0)"
                : resolved === checkpoints.length - 1
                  ? "translateY(-100%)"
                  : "translateY(-50%)",
            }}
          >
            <span className="block max-w-full truncate text-sm font-medium leading-5">
              {hoveredItem.userText}
            </span>
            {hoveredItem.assistantText && (
              <span className="line-clamp-3 whitespace-normal text-sm leading-5 text-muted-foreground">
                {hoveredItem.assistantText}
              </span>
            )}
          </Card>
        )}
      </Button>
    </nav>
  );
}
