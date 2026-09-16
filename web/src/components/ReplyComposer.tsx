import type { ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton } from "./ui/input-group";

export const replyComposerFrame = "min-w-0 shrink-0 bg-linear-to-t from-background via-background to-transparent px-6 pt-2 pb-4";
export const replyComposerForm = "@container mx-auto min-w-0 w-full max-w-[44rem]";

export function ReplyComposer({children, controls, context, working, canSend, disabled, onStop}: {
  children: ReactNode; controls?: ReactNode; context?: ReactNode;
  working: boolean; canSend: boolean; disabled?: boolean; onStop:()=>void;
}) {
  return <InputGroup className="compose-box compose-box-reply items-stretch">
    {children}
    <InputGroupAddon align="block-end" className="min-w-0 flex-wrap gap-1">
      {controls}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {context}
        {working && <InputGroupButton type="button" disabled={disabled} onClick={onStop}><Square />Stop</InputGroupButton>}
        <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" disabled={!canSend} aria-label="Send"><ArrowUp /></InputGroupButton>
      </div>
    </InputGroupAddon>
  </InputGroup>;
}
