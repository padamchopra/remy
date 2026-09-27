/// Desktop banners for the things worth interrupting someone about: a thread
/// that has stopped to ask them something, and a thread that has finished.
///
/// The server already decides what is worth a banner and pushes it down the
/// notify socket as a `notification` frame. This turns one into a real
/// notification and routes the click back to the thread it came from.

export interface NotifyFrame {
  type?: string;
  session?: string;
  title?: string;
  message?: string;
  /// A `remy://chat/<id>` deep link.
  click?: string;
  highPriority?: boolean;
}

/// The thread a banner belongs to. The deep link is authoritative; `session`
/// carries the same id for chats and is the fallback.
export function threadIdFrom(frame: NotifyFrame): string | undefined {
  const fromClick = /^remy:\/\/chat\/(.+)$/.exec(frame.click ?? "")?.[1];
  const id = fromClick ? decodeURIComponent(fromClick) : frame.session;
  return id?.trim() || undefined;
}

export type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

export function notifyPermission(): NotifyPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/// Asks the browser, once. A browser that has already refused never prompts
/// again, so the answer is returned rather than assumed.
export async function askToNotify(): Promise<NotifyPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

const STORAGE_KEY = "remy.notifications";

/// Whether banners are wanted here. Permission belongs to the browser, but
/// wanting them belongs to this device, so it is not a server setting.
export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // A browser with storage blocked simply forgets between reloads.
  }
}

/// Whether this particular banner should be shown.
///
/// A thread you are already watching, in a window you are already looking at,
/// has nothing to tell you that the screen is not already saying.
export function shouldNotify(input: {
  enabled: boolean;
  permission: NotifyPermission;
  documentHidden: boolean;
  openThreadId?: string;
  threadId?: string;
}): boolean {
  if (!input.enabled || input.permission !== "granted" || !input.threadId) return false;
  if (!input.documentHidden && input.openThreadId === input.threadId) return false;
  return true;
}
