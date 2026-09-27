import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function EditableName({
  value,
  onCommit,
  label,
  // The type this name is set in. The same control appears at more than one
  // size, so the size is the caller's to say.
  className = "text-sm font-medium",
}: {
  value: string;
  onCommit: (name: string) => void;
  label: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      setEditing(false);
      return;
    }
    const next = draft.trim();
    setEditing(false);
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) onCommit(next);
  };

  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className={cn("truncate", className)}>{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Rename ${label}`}
          onClick={() => {
            cancelled.current = false;
            setDraft(value);
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
      </span>
    );
  }

  return (
    <Input
      autoFocus
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          setEditing(false);
        }
      }}
      // Height follows the type rather than a fixed step, so the same control
      // fits a sidebar row and a page title without two variants.
      className={cn("h-auto px-1.5 py-0.5", className)}
    />
  );
}
