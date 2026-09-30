import { Button } from "@/components/ui/button";

/// Resizes the two app panes without moving their mounted content into new containers.
export function AppSplitDivider({ direction, ratio, onResize }: {
  direction: "horizontal" | "vertical";
  ratio: number;
  onResize: (ratio: number) => void;
}) {
  const horizontal = direction === "horizontal";
  const resize = (value: number) => onResize(Math.max(0.05, Math.min(0.95, value)));
  return <Button
    type="button"
    variant="ghost"
    role="separator"
    aria-label="Resize panes"
    aria-orientation={horizontal ? "vertical" : "horizontal"}
    aria-valuemin={5}
    aria-valuemax={95}
    aria-valuenow={Math.round(ratio * 100)}
    className={`relative z-10 hidden shrink-0 touch-none rounded-none bg-border p-0 hover:bg-ring focus-visible:bg-ring md:flex before:absolute ${horizontal ? "h-full w-1 cursor-col-resize before:inset-y-0 before:-inset-x-1" : "h-1 w-full cursor-row-resize before:inset-x-0 before:-inset-y-1"}`}
    onPointerDown={(event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const box = event.currentTarget.parentElement!.getBoundingClientRect();
      resize(horizontal ? (event.clientX - box.left) / box.width : (event.clientY - box.top) / box.height);
    }}
    onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onDoubleClick={() => resize(0.5)}
    onKeyDown={(event) => {
      const decrement = horizontal ? "ArrowLeft" : "ArrowUp";
      const increment = horizontal ? "ArrowRight" : "ArrowDown";
      if (![decrement, increment, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      resize(event.key === "Home" ? 0.05 : event.key === "End" ? 0.95 : ratio + (event.key === decrement ? -0.02 : 0.02));
    }}
  />;
}
