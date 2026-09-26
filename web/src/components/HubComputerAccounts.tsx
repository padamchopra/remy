import { AccessMark } from "./AccessMark";
import { HubClaudeAccount } from "./HubClaudeAccount";
import { HubCodexAccount } from "./HubCodexAccount";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";

export function HubComputerAccounts({ organizationId, computerId }: { organizationId: string; computerId: string }) {
  return (
    <section aria-label="Provider accounts" className="mt-2 min-w-0 space-y-3">
      <Field>
        <FieldLabel>Provider accounts</FieldLabel>
        <FieldDescription>Connect Claude Code or Codex with the account on this computer.</FieldDescription>
      </Field>
      <ItemGroup className="min-w-0 gap-2">
        <Item variant="outline" className="min-w-0 flex-col items-stretch">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <ItemMedia variant="icon"><AccessMark id="claude-code" /></ItemMedia>
            <ItemContent className="min-w-0 grow basis-[8rem]">
              <ItemTitle className="w-full whitespace-normal break-words">Claude Code</ItemTitle>
            </ItemContent>
          </div>
          <HubClaudeAccount organizationId={organizationId} computerId={computerId} />
        </Item>
        <Item variant="outline" className="min-w-0 flex-col items-stretch">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <ItemMedia variant="icon"><AccessMark id="codex" /></ItemMedia>
            <ItemContent className="min-w-0 grow basis-[8rem]">
              <ItemTitle className="w-full whitespace-normal break-words">Codex</ItemTitle>
            </ItemContent>
          </div>
          <HubCodexAccount organizationId={organizationId} computerId={computerId} />
        </Item>
      </ItemGroup>
    </section>
  );
}
