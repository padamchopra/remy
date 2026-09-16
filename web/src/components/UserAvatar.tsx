import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AVATAR_PRESETS, presetFor, type AvatarPreset } from "@/lib/avatars";
import { useStore } from "@/state/store";

/// Your face, wherever the app shows one.
///
/// Reads the setting rather than taking a prop, so a change in Settings lands
/// everywhere at once.
export function UserAvatar({ className }: { className?: string }) {
  const avatar = useStore((s) => s.settings?.avatar) ?? "";
  return <AvatarFrom avatar={avatar} className={className} />;
}

/// The same face, from a value rather than the setting — for previewing one you
/// have not chosen yet.
export function AvatarFrom({ avatar, className, label }: { avatar: string; className?: string; label?: string }) {
  const preset = presetFor(avatar);
  const src = preset?.src ?? ((avatar.startsWith("data:image/") || /^https?:\/\//.test(avatar)) ? avatar : undefined);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback className="bg-primary/15 text-primary">
        {label ? <span className="text-[0.55em] font-medium">{label.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span> : <User className="size-4" />}
      </AvatarFallback>
    </Avatar>
  );
}

/// One of the built-in faces, or the plain default when there is none.
export function PresetAvatar({ preset, className }: { preset?: AvatarPreset; className?: string }) {
  return <AvatarFrom avatar={preset ? `preset:${preset.id}` : ""} className={className} />;
}

export { AVATAR_PRESETS };
