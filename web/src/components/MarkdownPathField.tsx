import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PathPicker, PathPickerHints } from "@/components/PathPicker";
import { displayPath } from "@/lib/path";

/// Picking the markdown file behind an instruction or a set of directives. The
/// button reads as the current choice; the picker behind it is the same one
/// every other path setting uses, narrowed to markdown.
export function MarkdownPathField({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const choose = (path: string) => {
    const picked = path.trim();
    if (!picked) return;
    onChange(picked);
    setOpen(false);
  };

  return (
    <>
      <Button
        id={id}
        type="button"
        variant="outline"
        className="w-full justify-start font-mono text-[13px] font-normal"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        <FileText className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">
          {value ? displayPath(value) : <span className="text-muted-foreground">{placeholder}</span>}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Pick a markdown file</DialogTitle>
            <DialogDescription>It is read on every run, so editing it changes what happens next.</DialogDescription>
          </DialogHeader>
          <PathPicker value={draft} onChange={setDraft} onSubmit={choose} ext="md" autoFocus />
          <DialogFooter className="border-t border-border bg-muted px-4 py-2 sm:justify-between">
            <PathPickerHints confirm="Choose" />
            <Button size="sm" disabled={!draft.trim().toLowerCase().endsWith(".md")} onClick={() => choose(draft)}>
              Choose file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
