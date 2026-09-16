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
    <InputGroupAddon align="block-end">
      {controls}
      <InputGroupButton type="submit" variant="default" size="icon-sm" className="ml-auto rounded-full" disabled={!canSend} aria-label={sendLabel}>
        {busy ? <Spinner /> : <ArrowUp />}
      </InputGroupButton>
    </InputGroupAddon>
    <InputGroupAddon align="block-end" className="border-t">
      {context}
      {contextEnd && <div className="ml-auto flex min-w-0 items-center gap-1">{contextEnd}</div>}
    </InputGroupAddon>
  </InputGroup>;
}
