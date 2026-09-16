import type { ReactNode } from "react";
import remyMark from "@/assets/remy-mark.png";
import { PERMISSIONS } from "@/lib/chat-options";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "./ui/select";
import { useRef, useState } from "react";
import { Github, ImagePlus, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "./ui/field";
import { Switch } from "./ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { AvatarFrom, PresetAvatar } from "./UserAvatar";
import { AVATAR_PRESETS, isImageAvatar, readAvatarFile } from "@/lib/avatars";
import { apiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { askToNotify, notificationsEnabled, notifyPermission, setNotificationsEnabled, type NotifyPermission } from "@/lib/notify";
/// The face on your messages. Presets are drawn in the app; a picture is
/// resized and cropped square here before it is stored, so a settings row never
/// holds a photo straight off a phone.
export function AvatarField({ avatar, onSave, onGithub }: { avatar: string; onSave: (avatar: string) => Promise<unknown>; onGithub: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);


  const choose = async (next: string) => {
    setBusy(true);
    try { await onSave(next); setOpen(false); }
    catch (caught) { toast.error("Couldn't save your avatar", { description: apiError(caught) }); }
    finally { setBusy(false); }
  };

  const fromGithub = async () => {
    setBusy(true);
    try {
      await onGithub();
      setOpen(false);
    } catch (caught) {
      toast.error("Couldn't get your GitHub picture", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      await choose(await readAvatarFile(picked));
    } catch (caught) {
      toast.error("Couldn't use that image", {
        description: caught instanceof Error ? caught.message : "Try a different one.",
      });
    }
  };

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldContent>
        <FieldLabel>Your avatar</FieldLabel>
        <FieldDescription className="text-xs">
          Shown on your messages in a thread.
        </FieldDescription>
      </FieldContent>
      <div className="flex shrink-0 items-center gap-2">
        <AvatarFrom avatar={avatar} />
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Change
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Your avatar</DialogTitle>
            <DialogDescription>Pick one, or use a picture of your own.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-4 gap-3">
            <Button variant="ghost" disabled={busy}
              type="button"
              aria-label="Default"
              onClick={() => choose("")}
              className={cn(
                "flex h-auto items-center justify-center rounded-xl border p-2",
                avatar ? "border-transparent hover:bg-accent" : "border-primary",
              )}
            >
              <PresetAvatar className="size-12" />
            </Button>
            {AVATAR_PRESETS.map((preset) => (
              <Button variant="ghost" disabled={busy}
                key={preset.id}
                type="button"
                aria-label={preset.label}
                title={preset.label}
                onClick={() => choose(`preset:${preset.id}`)}
                className={cn(
                  "flex h-auto items-center justify-center rounded-xl border p-2",
                  avatar === `preset:${preset.id}` ? "border-primary" : "border-transparent hover:bg-accent",
                )}
              >
                <PresetAvatar preset={preset} className="size-12" />
              </Button>
            ))}
          </div>

          <DialogFooter className="flex-col sm:flex-col sm:justify-start">
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="min-w-0 px-2" disabled={busy} onClick={() => file.current?.click()}>
                <ImagePlus />
                Use a picture
              </Button>
              <Button type="button" variant="outline" size="sm" className="min-w-0 px-2" disabled={busy} onClick={() => void fromGithub()}>
                <Github />
                {busy ? "Fetching…" : "From GitHub"}
              </Button>
            </div>
            {(isImageAvatar(avatar) || /^https?:\/\//.test(avatar)) && (
              <Button type="button" variant="ghost" size="sm" className="self-center" disabled={busy} onClick={() => choose("")}>
                Remove picture
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Field>
  );
}

/// Banners for a thread that needs you or has finished. Permission belongs to
/// the browser and the answer sticks, so the switch says what the browser
/// decided rather than pretending it can ask again.
export function NotificationsField() {
  const [on, setOn] = useState(() => notificationsEnabled());
  const [permission, setPermission] = useState<NotifyPermission>(() => notifyPermission());

  const toggle = async (next: boolean) => {
    if (!next) {
      setNotificationsEnabled(false);
      setOn(false);
      return;
    }
    const answer = await askToNotify();
    setPermission(answer);
    if (answer !== "granted") {
      setNotificationsEnabled(false);
      setOn(false);
      toast.error(
        answer === "unsupported"
          ? "This browser can't show notifications"
          : "Your browser is blocking notifications",
        { description: "Allow them for this site, then turn this back on." },
      );
      return;
    }
    setNotificationsEnabled(true);
    setOn(true);
  };

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldContent>
        <FieldLabel htmlFor="notifications">Notify me</FieldLabel>
        <FieldDescription className="text-xs">
          {permission === "denied"
            ? "Your browser is blocking notifications for this site."
            : "When a thread needs you or finishes. Clicking it opens the thread."}
        </FieldDescription>
      </FieldContent>
      <Switch
        id="notifications"
        checked={on && permission === "granted"}
        disabled={permission === "unsupported"}
        onCheckedChange={(next) => void toggle(next)}
      />
    </Field>
  );
}


export function AppearanceField() { return (
      <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
        <Monitor className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Appearance</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Dark is the only theme wired up today.</p>
        </div>
      </div>
); }

export function PermissionField({value, disabled, onChange}: {value:string; disabled?:boolean; onChange:(value:string)=>void}) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger aria-label="Default permission level" size="sm" className="w-36 min-w-0"><SelectValue /></SelectTrigger>
    <SelectContent align="end"><SelectGroup>{PERMISSIONS.map(option => <SelectItem key={option.value} value={option.value}><option.icon className="size-4 opacity-70" />{option.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}

export function AppInfo({detail, children}: {detail:ReactNode; children:ReactNode}) {
  return <div className="flex items-center gap-3">
    <img src={remyMark} alt="" className="size-10 rounded-[10px]" />
    <div className="min-w-0 flex-1"><p className="text-sm font-medium">Remy</p>{detail}</div>
    {children}
  </div>;
}
