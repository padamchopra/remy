import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { PERMISSIONS, CLOUD_MODES, permissionOf, type PermissionValue } from "@/lib/chat-options";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "./ui/popover-base";
import { Command, CommandGroup, CommandItem, CommandList } from "./ui/command";
import { InputGroupButton } from "./ui/input-group";

export function PermissionPicker({ value, onChange, disabled, cloud = false, description = "Applies to your next message.", className }: {
  value: string;
  onChange: (value: PermissionValue) => void;
  disabled?: boolean;
  cloud?: boolean;
  description?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const options = cloud ? CLOUD_MODES : PERMISSIONS;
  const selected = options.find(option => option.value === value) ?? permissionOf(value);
  const Icon = selected.icon;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<InputGroupButton className={className} />} disabled={disabled} aria-label={`Permission mode: ${selected.label}`}>
      <Icon /><span>{selected.label}</span><ChevronDown />
    </PopoverTrigger>
    <PopoverContent>
      <PopoverTitle className="sr-only">Permission mode</PopoverTitle>
      <PopoverDescription className="px-3 pt-2 text-xs">{description}</PopoverDescription>
      <Command tabIndex={0} defaultValue={selected.value}><CommandList><CommandGroup>
        {options.map(option => <CommandItem key={option.value} value={option.value} onSelect={() => {
          onChange(option.value);
          setOpen(false);
        }}>
          <option.icon />{option.label}{value === option.value && <Check className="ml-auto" />}
        </CommandItem>)}
      </CommandGroup></CommandList></Command>
    </PopoverContent>
  </Popover>;
}
