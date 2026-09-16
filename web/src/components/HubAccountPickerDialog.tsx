import type { Organization } from "@remy/contract";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldLabel } from "./ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function HubAccountPickerDialog({
  open,
  onOpenChange,
  organizations,
  title,
  description,
  action,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizations: Organization[];
  title: string;
  description: string;
  action: string;
  onSelect: (organizationId: string) => void;
}) {
  const available = organizations;
  const availableKey = available.map((organization) => organization.id).join(",");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (open) setSelected(available[0]?.id ?? "");
  }, [open, availableKey]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Account</FieldLabel>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger aria-label="Account">
              <SelectValue placeholder="Choose an account" />
            </SelectTrigger>
            <SelectContent>
              {available.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.personal ? "Personal" : organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!selected} onClick={() => onSelect(selected)}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
