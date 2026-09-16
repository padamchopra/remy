import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton, InputGroupText } from "@/components/ui/input-group";

/// One setting on a composer toolbar. Read-only when there is nothing to
/// choose — a thread's device and branch are fixed once it starts, and a
/// disabled-looking menu that never opens is worse than plain text.
export function ComposerMenu({
  icon: Icon,
  label,
  value,
  onChange,
  options,
  align = "start",
  disabled,
  pending,
  title,
  ariaLabel,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string; icon?: LucideIcon }[];
  align?: "start" | "end";
  disabled?: boolean;
  pending?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  if (disabled) {
    return (
      <InputGroupText aria-label={ariaLabel} title={title} className="max-w-40 truncate">
        <Icon />
        {label}
      </InputGroupText>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton aria-label={ariaLabel} title={title} disabled={pending} aria-busy={pending || undefined} className="disabled:opacity-100">
          <Icon />
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuGroup>
          {options.map((option) => {
            const OptionIcon = option.icon;
            return (
              <DropdownMenuItem key={option.value || option.label} onSelect={() => onChange(option.value)}>
                {OptionIcon ? <OptionIcon /> : null}
                {option.label}
                {value === option.value ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
