import type { ComponentProps, ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./ui/input-group";
import { Spinner } from "./ui/spinner";

export function ThreadComposerEditor({ textarea, controls, context, contextEnd, canSend, busy, sendLabel = "Send" }: {
  textarea: ComponentProps<typeof InputGroupTextarea>;
  controls: ReactNode;
  context: ReactNode;
  contextEnd?: ReactNode;
  canSend: boolean;
  busy?: boolean;
  sendLabel?: string;
}) {
  return <InputGroup className="compose-box items-stretch">
    <InputGroupTextarea aria-label="Message" placeholder="Ask a question or describe a change." className="min-h-28" {...textarea}
      onKeyDown={event => {
        textarea.onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (canSend) event.currentTarget.form?.requestSubmit();
      }} />
    <InputGroupAddon align="block-end" className="min-w-0 flex-wrap">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {controls}
      </div>
      <InputGroupButton type="submit" variant="default" size="icon-sm" className="ml-auto shrink-0 rounded-full" disabled={!canSend} aria-label={sendLabel}>
        {busy ? <Spinner /> : <ArrowUp />}
      </InputGroupButton>
    </InputGroupAddon>
    <InputGroupAddon align="block-end" className="min-w-0 flex-wrap border-t">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {context}
      </div>
      {contextEnd ? <div className="flex min-w-0 flex-wrap items-center gap-1 sm:ml-auto">{contextEnd}</div> : null}
    </InputGroupAddon>
  </InputGroup>;
}
