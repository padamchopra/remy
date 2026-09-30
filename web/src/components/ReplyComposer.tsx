import type { ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton } from "./ui/input-group";

export const replyComposerFrame = "min-w-0 shrink-0 bg-linear-to-t from-background via-background to-transparent px-3 pt-2 pb-4 sm:px-6";
export const replyComposerForm = "@container mx-auto min-w-0 w-full max-w-[44rem]";

export function ReplyComposer({children, controls, context, working, canSend, disabled, onStop}: {
  children: ReactNode; controls?: ReactNode; context?: ReactNode;
  working: boolean; canSend: boolean; disabled?: boolean; onStop:()=>void;
}) {
  return <InputGroup className="@container/reply compose-box compose-box-reply items-stretch">
    {children}
    <InputGroupAddon data-composer-toolbar="" align="block-end" className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1 @max-[280px]/reply:grid-cols-1">
      <div className="flex min-w-0 items-center gap-1 [&_[data-model-picker]]:min-w-0 [&_[data-model-picker]]:shrink [&_[data-model-picker]]:overflow-hidden @max-[420px]/reply:[&_[data-permission-label]]:sr-only @max-[420px]/reply:[&_[data-permission-picker]>svg:last-child]:hidden">{controls}</div>
      <div className="flex min-w-0 items-center justify-end gap-1 @max-[280px]/reply:grid @max-[280px]/reply:justify-items-end @max-[540px]/reply:[&_[data-branch-label]]:sr-only">
        <div className="flex min-w-0 items-center gap-1">{context}</div>
        <div className="flex shrink-0 items-center gap-1">
          {working && <InputGroupButton type="button" disabled={disabled} onClick={onStop} aria-label="Stop" title="Stop"><Square /><span className="@max-[540px]/reply:sr-only">Stop</span></InputGroupButton>}
          <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" disabled={!canSend} aria-label="Send"><ArrowUp /></InputGroupButton>
        </div>
      </div>
    </InputGroupAddon>
  </InputGroup>;
}
