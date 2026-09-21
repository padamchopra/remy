import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { ArchivedThread, Chat, ChatState } from "@/state/types";
import type { HostedThreadMenuSource } from "@/components/ThreadMenu";
import type { DeviceIconId } from "@/lib/devices";

/// Someone who can read and write a thread.
export interface ThreadPerson {
  id: string;
  label: string;
  image?: string | null;
}

/// What `AppSidebar` needs to draw itself, with nothing in it that says where
/// the data came from. The Mac shell reads the local daemon and the hosted
/// shell reads the hub; both hand over the same shapes, so there is one
/// sidebar rather than one per shell.

/// One account the header's picker can switch to. The Mac shell has no
/// organizations yet and passes an empty list, which leaves the picker showing
/// this machine with nothing to choose.
export interface SidebarAccountView {
  id: string;
  label: string;
  icon: LucideIcon;
  /// Organizations are listed under their own heading; everything else sits
  /// above the separator.
  organization?: boolean;
  selected: boolean;
  onSelect: () => void;
  /// The gear beside an organization. Absent means the row is not settable.
  onSettings?: () => void;
}

export interface SidebarAccount {
  label: string;
  icon: LucideIcon;
  views: SidebarAccountView[];
  onCreate?: () => void;
}

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /// A plain number, never a state: it reads as muted mono text, not a pill.
  count?: number;
  selected: boolean;
  onSelect: () => void;
}

/// The two places a row's menu gets its actions, passed straight to
/// `ThreadMenu`, which already knows both.
export interface SidebarThreadMenu {
  chat: Chat;
  archive?: ArchivedThread;
  hosted?: HostedThreadMenuSource;
  onOpenThread?: (id: string) => void;
  onOpenBeside?: (id: string) => void;
  onOpenWorkspace?: (id: string) => void;
}

/// A thread as the sidebar draws it. The row shows the first half as icons and
/// the hover card spells the same lane out in words, so everything here is
/// needed for one of the two.
export interface SidebarThread {
  key: string;
  id: string;
  /// Everything the row and its hover card draw, flattened to a string. The
  /// row is memoized on it, so a change anywhere in the catalogue re-renders
  /// only the rows that actually moved. A field the card shows but the row
  /// does not still belongs here, or an open card goes stale.
  signature: string;
  title: string;
  time: string;
  state: ChatState;
  pinned?: boolean;
  /// Shared draws the people glyph and private draws the lock. Undefined on a
  /// shell that has no sharing, which draws neither.
  shared?: boolean;
  preview?: string;
  branch?: string;
  provider?: string;
  model?: string;
  people: ThreadPerson[];
  /// The mark is a node because each shell paints it from its own icon
  /// source — a local file on the Mac, an uploaded one on the hub.
  workspace?: { name: string; mark: ReactNode; onOpen?: () => void };
  computer?: { name: string; icon?: DeviceIconId };
  ticket?: { key: string; title?: string; onOpen: () => void };
  children?: SidebarThread[];
  menu: SidebarThreadMenu;
  onSelect: () => void;
}

export interface SidebarThreadGroup {
  key: string;
  label: string;
  /// A glyph before the label, where the name alone does not say enough.
  icon?: LucideIcon;
  threads: SidebarThread[];
  hidden?: number;
  onRevealMore?: () => void;
}

export interface SidebarFooterItem {
  label: string;
  icon: LucideIcon;
  selected?: boolean;
  onSelect: () => void;
}

export interface SidebarAccountMenu {
  name: string;
  email?: string;
  image?: string | null;
  items: SidebarFooterItem[];
}

export type { ChatState };
