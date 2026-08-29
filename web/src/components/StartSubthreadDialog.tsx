import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "@/lib/api-error";
import { useStore } from "@/state/store";
import type { Chat } from "@/state/types";

export function StartSubthreadDialog({
  parent,
  open,
  onOpenChange,
  onStarted,
}: {
  parent: Chat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (child: Chat, beside: boolean) => void;
}) {
  const createSubthread = useStore((state) => state.createSubthread);
  const [text, setText] = useState("");
  const [includeParent, setIncludeParent] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const start = async (beside: boolean) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const child = await createSubthread({ parentId: parent.id, text, includeParent });
      setText("");
      setIncludeParent(false);
      onOpenChange(false);
      onStarted(child, beside);
    } catch (caught) {
      toast.error("Couldn't start that subthread", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start subthread</DialogTitle>
          <DialogDescription>Run another agent in this thread's checkout.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="subthread-task">Task</Label>
            <Textarea
              ref={inputRef}
              id="subthread-task"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Describe the work for this session."
              rows={5}
              disabled={busy}
            />
          </div>

          <label className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              checked={includeParent}
              onCheckedChange={(checked) => setIncludeParent(checked === true)}
              disabled={busy}
              aria-label="Include parent thread"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Include parent thread</span>
              <span className="block text-xs text-muted-foreground">
                Give the new session a snapshot of this conversation.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter className="sm:justify-between">
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={busy}>Cancel</Button>
          </DialogClose>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={!text.trim() || busy} onClick={() => void start(false)}>
              Open thread
            </Button>
            <Button type="button" disabled={!text.trim() || busy} onClick={() => void start(true)}>
              Open beside
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
