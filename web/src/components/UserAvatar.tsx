import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar-base";
import { AVATAR_PRESETS, presetFor, type AvatarPreset } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";

/// Your face, wherever the app shows one.
///
/// Reads the setting rather than taking a prop, so a change in Settings lands
/// everywhere at once.
export function UserAvatar({ className }: { className?: string }) {
  const avatar = useStore((s) => s.settings?.avatar) ?? "";
  return <PersonAvatar avatar={avatar} className={className} />;
}

/// A person's face everywhere Remy names them. A saved picture wins; initials
/// keep the same space while it loads or when the person has no picture.
export function PersonAvatar({ avatar, className, fallbackClassName, name, ...props }: {
  avatar?: string | null;
  className?: string;
  fallbackClassName?: string;
  name?: string;
} & Omit<React.ComponentProps<typeof Avatar>, "children">) {
  const preset = presetFor(avatar ?? undefined);
  const src = preset?.src ?? ((avatar?.startsWith("data:image/") || /^https?:\/\//.test(avatar ?? "")) ? avatar ?? undefined : undefined);
  return (
    <Avatar className={className} {...props}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className={cn("bg-primary/15 text-primary", fallbackClassName)}>
        {name ? <span className="text-[0.55em] font-medium">{name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span> : <User className="size-4" />}
      </AvatarFallback>
    </Avatar>
  );
}

/// One of the built-in faces, or the plain default when there is none.
export function PresetAvatar({ preset, className }: { preset?: AvatarPreset; className?: string }) {
  return <PersonAvatar avatar={preset ? `preset:${preset.id}` : ""} className={className} />;
}

export { AVATAR_PRESETS };
