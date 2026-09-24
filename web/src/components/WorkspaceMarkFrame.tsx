import type { ReactNode } from "react";
import { tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";

export function WorkspaceMarkFrame({
  size,
  tint,
  children,
}: {
  size: "sm" | "md" | "lg";
  tint?: string | null;
  children: ReactNode;
}) {
  const colors = tintOf(tint);
  return (
    <span
      data-slot="workspace-mark"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden leading-none",
        size === "lg" ? "size-[1em] rounded-md" : size === "md" ? "size-10 rounded-lg" : "size-4 rounded-md",
        colors.well,
        colors.fg,
      )}
    >
      {children}
    </span>
  );
}
