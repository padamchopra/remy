import type { ReactNode } from "react";
import { tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";

export function WorkspaceMarkFrame({size, tint, children}: {size: "sm" | "lg"; tint?: string | null; children: ReactNode}) {
  const colors = tintOf(tint);
  return <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md leading-none", size === "lg" ? "size-[1em]" : "size-4", colors.well, colors.fg)}>{children}</span>;
}
