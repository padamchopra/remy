import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  WebContentsView,
  type Rectangle,
  type KeyboardInputEvent,
  type Session,
  type WebContents,
} from "electron";

type BrowserController = "agent" | "you";
type BrowserViewport = "fullscreen" | "desktop" | "mobile";

interface BrowserTarget {
  selector?: string;
  role?: string;
  name?: string;
  text?: string;
  x?: number;
  y?: number;
}

interface BrowserHostCommand {
  requestId: string;
  action: string;
  chatId: string;
  browserId: string;
  controller?: BrowserController;
  screenshot?: boolean;
  url?: string;
  viewport?: BrowserViewport;
  requestedSize?: { width?: number; height?: number };
  target?: BrowserTarget;
  text?: string;
  key?: string;
  navigation?: "back" | "forward" | "reload";
  deltaX?: number;
  deltaY?: number;
  milliseconds?: number;
  factor?: number;
}

export interface BrowserPresentation {
  serverId: string;
  chatId: string;
  browserId: string;
  visible: boolean;
  focused: boolean;
  bounds: Rectangle;
}

interface DownloadState {
  filename: string;
  state: "started" | "completed" | "failed";
}

interface NativeBrowserSession {
  chatId: string;
  browserId: string;
  view: WebContentsView;
  viewport: BrowserViewport;
  size: { width: number; height: number };
  revision: number;
  controller?: BrowserController;
  cursor?: { x: number; y: number; pressed?: boolean };
  error?: string;
  download?: DownloadState;
  attached: boolean;
  panelBounds?: Rectangle;
  recoveries: number[];
  activityTimer?: ReturnType<typeof setTimeout>;
  console: string[];
  queue: Promise<unknown>;
}

export interface NativeBrowserHostResult {
  type: "browser-host-result";
  requestId: string;
  ok: boolean;
  view?: unknown;
  error?: string;
}

const VIEWPORTS: Record<BrowserViewport, { width: number; height: number }> = {
  fullscreen: { width: 1920, height: 1080 },
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};
const RECOVERY_LIMIT = 2;
const RECOVERY_WINDOW_MS = 60_000;

function sessionKey(chatId: string, browserId: string): string {
  return `${chatId}\0${browserId}`;
}

function persistentPartition(chatId: string): string {
  const digest = createHash("sha256").update(chatId).digest("hex").slice(0, 24);
  return `persist:remy-browser-${digest}`;
}

function browserSize(viewport: BrowserViewport, requested?: { width?: number; height?: number }): { width: number; height: number } {
  if (viewport !== "fullscreen" || !requested) return VIEWPORTS[viewport];
  return {
    width: Math.round(Math.min(3840, Math.max(240, Number(requested.width) || VIEWPORTS.fullscreen.width))),
    height: Math.round(Math.min(2160, Math.max(200, Number(requested.height) || VIEWPORTS.fullscreen.height))),
  };
}

function fitBounds(panel: Rectangle, viewport: BrowserViewport, size: { width: number; height: number }): Rectangle {
  if (viewport === "fullscreen") return panel;
  const scale = Math.min(panel.width / size.width, panel.height / size.height);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  return {
    x: panel.x + Math.round((panel.width - width) / 2),
    y: panel.y + Math.round((panel.height - height) / 2),
    width,
    height,
  };
}

function safeHttpUrl(value: unknown): string {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The shared browser can open HTTP and HTTPS pages only.");
  }
  return url.toString();
}

function cleanError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function locatorScript(target: BrowserTarget): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const visible = (node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const roleOf = (node) => node.getAttribute("role") || ({ A: "link", BUTTON: "button", INPUT: "textbox", TEXTAREA: "textbox", SELECT: "combobox" })[node.tagName] || node.tagName.toLowerCase();
    const nameOf = (node) => (node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("placeholder") || node.innerText || node.value || "").trim();
    let nodes = [];
    if (target.selector) nodes = [...document.querySelectorAll(target.selector)];
    else nodes = [...document.querySelectorAll("a,button,input,textarea,select,[role],[contenteditable=true]")];
    const node = nodes.find((candidate) => visible(candidate)
      && (!target.role || roleOf(candidate) === target.role)
      && (!target.name || nameOf(candidate).toLowerCase().includes(target.name.toLowerCase()))
      && (!target.text || (candidate.innerText || "").toLowerCase().includes(target.text.toLowerCase())))
      || (!target.selector && target.name ? [...document.querySelectorAll("label")].find((label) => label.innerText.toLowerCase().includes(target.name.toLowerCase()))?.control : undefined);
    if (!node || !visible(node)) throw new Error("That element is not visible.");
    const box = node.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`;
}

function snapshotScript(): string {
  return `(() => {
    const visible = (node) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
    const roleOf = (node) => node.getAttribute("role") || ({ A: "link", BUTTON: "button", INPUT: "textbox", TEXTAREA: "textbox", SELECT: "combobox" })[node.tagName] || node.tagName.toLowerCase();
    const nameOf = (node) => (node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("placeholder") || node.innerText || node.value || "").trim().slice(0, 160);
    return {
      body: document.body?.innerText?.slice(0, 20000) || "",
      interactive: [...document.querySelectorAll("a,button,input,textarea,select,[role],[contenteditable=true]")].filter(visible).slice(0, 200).map((node) => ({ role: roleOf(node), name: nameOf(node) })),
    };
  })()`;
}

export class NativeBrowserHost {
  private sessions = new Map<string, NativeBrowserSession>();
  private downloadsWired = new WeakSet<Session>();

  constructor(
    private window: BrowserWindow,
    private browserPreload: string,
    private emit: (chatId: string, browserId: string, view: Record<string, unknown>) => void,
    private isLocalServer: (serverId: string) => boolean,
  ) {
    ipcMain.on("browser-host:activity", (event) => {
      const state = [...this.sessions.values()].find((candidate) => candidate.view.webContents.id === event.sender.id);
      if (state) this.activity(state);
    });
  }

  async command(command: BrowserHostCommand): Promise<NativeBrowserHostResult> {
    try {
      const view = await this.dispatch(command);
      return { type: "browser-host-result", requestId: command.requestId, ok: true, view };
    } catch (error) {
      return { type: "browser-host-result", requestId: command.requestId, ok: false, error: cleanError(error) };
    }
  }

  async present(input: BrowserPresentation): Promise<boolean> {
    if (!this.isLocalServer(input.serverId)) return false;
    const state = this.sessions.get(sessionKey(input.chatId, input.browserId));
    if (!state) return false;
    state.panelBounds = input.bounds;
    if (!input.visible) {
      if (state.attached) this.window.contentView.removeChildView(state.view);
      state.attached = false;
      return true;
    }
    state.view.setBounds(fitBounds(input.bounds, state.viewport, state.size));
    this.applyEmulation(state);
    if (!state.attached) this.window.contentView.addChildView(state.view);
    state.attached = true;
    if (input.focused) state.view.webContents.focus();
    return true;
  }

  hideAll(): void {
    for (const state of this.sessions.values()) {
      if (state.attached) this.window.contentView.removeChildView(state.view);
      state.attached = false;
    }
  }

  closeAll(): void {
    for (const state of [...this.sessions.values()]) this.close(state);
  }

  private async dispatch(command: BrowserHostCommand): Promise<unknown> {
    if (command.action === "closeChat") {
      for (const state of [...this.sessions.values()]) {
        if (state.chatId === command.chatId) this.close(state);
      }
      return { ok: true };
    }
    const key = sessionKey(command.chatId, command.browserId);
    const existing = this.sessions.get(key);
    if (command.action === "view") return existing ? this.browserView(existing, command.screenshot === true) : this.inactive(command.browserId);
    if (command.action === "close") {
      if (existing) this.close(existing);
      return { ok: true };
    }
    const state = existing ?? this.create(command.chatId, command.browserId);
    const pending = state.queue.catch(() => undefined).then(() => this.run(state, command));
    state.queue = pending;
    return pending;
  }

  private async run(state: NativeBrowserSession, command: BrowserHostCommand): Promise<unknown> {
    state.controller = command.controller ?? state.controller;
    state.error = undefined;
    const contents = state.view.webContents;
    if (command.action === "open") await contents.loadURL(safeHttpUrl(command.url));
    if (command.action === "viewport") {
      const viewport = command.viewport === "fullscreen" || command.viewport === "mobile" ? command.viewport : "desktop";
      state.viewport = viewport;
      state.size = browserSize(viewport, command.requestedSize);
      state.cursor = undefined;
      if (state.panelBounds) {
        state.view.setBounds(fitBounds(state.panelBounds, state.viewport, state.size));
        this.applyEmulation(state);
      }
    }
    if (command.action === "navigate") {
      if (command.navigation === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      if (command.navigation === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      if (command.navigation === "reload") contents.reload();
      await this.loaded(contents);
    }
    if (command.action === "click") {
      const point = await this.point(contents, state, command.target ?? {});
      const input = this.inputPoint(state, point);
      state.cursor = point;
      contents.sendInputEvent({ type: "mouseMove", ...input });
      if (command.controller === "agent") await this.pause(160);
      state.cursor = { ...point, pressed: true };
      contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...input });
      contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...input });
      state.cursor = point;
      await this.pause(100);
    }
    if (command.action === "type") {
      const target = command.target ?? {};
      await contents.executeJavaScript(`(() => {
        const point = ${locatorScript(target)};
        const node = document.elementFromPoint(point.x, point.y);
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || node instanceof HTMLElement && node.isContentEditable)) throw new Error("That element cannot receive text.");
        node.focus();
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")?.set;
          setter?.call(node, ${JSON.stringify(command.text ?? "")});
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (node instanceof HTMLElement) {
          node.textContent = ${JSON.stringify(command.text ?? "")};
          node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(command.text ?? "")} }));
        }
        return point;
      })()`, true);
      await this.pause(50);
    }
    if (command.action === "insert") {
      await contents.insertText(command.text ?? "");
      await this.pause(50);
    }
    if (command.action === "press") {
      this.press(contents, command.key ?? "");
      await this.pause(100);
    }
    if (command.action === "scroll") {
      const input = this.inputPoint(state, state.cursor ?? {
        x: Math.round(state.size.width / 2),
        y: Math.round(state.size.height / 2),
      });
      contents.sendInputEvent({
        type: "mouseWheel",
        ...input,
        deltaX: Math.round(command.deltaX ?? 0),
        deltaY: Math.round(command.deltaY ?? 0),
        hasPreciseScrollingDeltas: true,
        canScroll: true,
      });
      await this.pause(100);
    }
    if (command.action === "wait") await this.pause(Math.max(0, Math.min(10_000, command.milliseconds ?? 500)));
    if (command.action === "zoom") {
      contents.setZoomFactor(Math.min(2, Math.max(0.5, Number(command.factor) || 1)));
      await this.pause(50);
    }
    if (command.action === "snapshot") return { text: await this.snapshot(state) };
    state.revision += 1;
    this.push(state);
    return this.browserView(state, command.screenshot === true);
  }

  private create(chatId: string, browserId: string): NativeBrowserSession {
    const view = new WebContentsView({
      webPreferences: {
        partition: persistentPartition(chatId),
        preload: this.browserPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor("#ffffff");
    const state: NativeBrowserSession = {
      chatId,
      browserId,
      view,
      viewport: "desktop",
      size: VIEWPORTS.desktop,
      revision: 0,
      attached: false,
      recoveries: [],
      console: [],
      queue: Promise.resolve(),
    };
    this.sessions.set(sessionKey(chatId, browserId), state);
    this.wire(state);
    this.wireDownloads(view.webContents.session);
    return state;
  }

  private wire(state: NativeBrowserSession): void {
    const contents = state.view.webContents;
    const changed = () => this.activity(state, 80);
    contents.on("did-navigate", changed);
    contents.on("did-navigate-in-page", changed);
    contents.on("page-title-updated", changed);
    contents.on("did-stop-loading", changed);
    contents.on("did-finish-load", () => {
      if (state.error?.startsWith("The browser stopped")) state.error = undefined;
      changed();
    });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      state.error = `The page couldn't load: ${description}`;
      state.revision += 1;
      this.push(state);
    });
    contents.on("console-message", (_event, level, message) => {
      if (level < 2) return;
      state.console = [...state.console, message].slice(-50);
    });
    contents.on("before-input-event", (event, input) => {
      if (!input.meta || input.type !== "keyDown" || !["+", "=", "-", "0"].includes(input.key)) {
        changed();
        return;
      }
      event.preventDefault();
      const current = contents.getZoomFactor();
      contents.setZoomFactor(input.key === "0" ? 1 : input.key === "-" ? Math.max(0.5, current - 0.1) : Math.min(2, current + 0.1));
      changed();
    });
    contents.on("render-process-gone", (_event, details) => this.recover(state, details.reason));
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void contents.loadURL(url);
      else if (/^mailto:/i.test(url)) void shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    });
    void contents.setVisualZoomLevelLimits(0.5, 2);
  }

  private wireDownloads(browserSession: Session): void {
    if (this.downloadsWired.has(browserSession)) return;
    this.downloadsWired.add(browserSession);
    browserSession.on("will-download", (_event, item, contents) => {
      const state = [...this.sessions.values()].find((candidate) => candidate.view.webContents.id === contents.id);
      if (!state) return;
      const filename = item.getFilename();
      const directory = app.getPath("downloads");
      const extension = filename.includes(".") ? `.${filename.split(".").pop()}` : "";
      const stem = extension ? filename.slice(0, -extension.length) : filename;
      let target = join(directory, filename);
      for (let index = 2; existsSync(target); index += 1) target = join(directory, `${stem} ${index}${extension}`);
      item.setSavePath(target);
      state.download = { filename, state: "started" };
      state.revision += 1;
      this.push(state);
      item.once("done", (_done, status) => {
        state.download = { filename, state: status === "completed" ? "completed" : "failed" };
        state.revision += 1;
        this.push(state);
      });
    });
  }

  private async point(contents: WebContents, state: NativeBrowserSession, target: BrowserTarget): Promise<{ x: number; y: number }> {
    if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
      return {
        x: Math.max(0, Math.min(state.size.width, Number(target.x))),
        y: Math.max(0, Math.min(state.size.height, Number(target.y))),
      };
    }
    return contents.executeJavaScript(locatorScript(target)) as Promise<{ x: number; y: number }>;
  }

  private inputPoint(state: NativeBrowserSession, point: { x: number; y: number }): { x: number; y: number } {
    if (state.viewport === "fullscreen" || !state.panelBounds) return point;
    const scale = Math.min(state.panelBounds.width / state.size.width, state.panelBounds.height / state.size.height);
    return { x: Math.round(point.x * scale), y: Math.round(point.y * scale) };
  }

  private press(contents: WebContents, shortcut: string): void {
    const pieces = shortcut.split("+").filter(Boolean);
    const keyCode = pieces.pop() || shortcut;
    const modifiers: NonNullable<KeyboardInputEvent["modifiers"]> = [];
    for (const piece of pieces) {
      const modifier = piece.toLowerCase();
      if (modifier === "shift" || modifier === "control" || modifier === "ctrl" || modifier === "alt"
        || modifier === "meta" || modifier === "command" || modifier === "cmd") modifiers.push(modifier);
    }
    contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  }

  private applyEmulation(state: NativeBrowserSession): void {
    const contents = state.view.webContents;
    if (state.viewport === "fullscreen") {
      contents.disableDeviceEmulation();
      return;
    }
    contents.enableDeviceEmulation({
      screenPosition: state.viewport === "mobile" ? "mobile" : "desktop",
      screenSize: state.size,
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 2,
      viewSize: state.size,
      scale: state.panelBounds ? Math.min(state.panelBounds.width / state.size.width, state.panelBounds.height / state.size.height) : 1,
    });
  }

  private async browserView(state: NativeBrowserSession, screenshot: boolean): Promise<Record<string, unknown>> {
    const contents = state.view.webContents;
    const answer: Record<string, unknown> = {
      browserId: state.browserId,
      active: !contents.isDestroyed() && !contents.isCrashed(),
      url: contents.getURL(),
      title: contents.getTitle(),
      viewport: state.viewport,
      width: state.size.width,
      height: state.size.height,
      revision: state.revision,
      controller: state.controller,
      cursor: state.cursor,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      zoomFactor: contents.getZoomFactor(),
      error: state.error,
      download: state.download,
    };
    if (screenshot && !contents.isDestroyed() && !contents.isCrashed()) {
      const image = await contents.capturePage();
      answer.screenshot = image.toDataURL();
    }
    return answer;
  }

  private inactive(browserId: string): Record<string, unknown> {
    return { browserId, active: false, viewport: "desktop", ...VIEWPORTS.desktop, revision: 0 };
  }

  private async snapshot(state: NativeBrowserSession): Promise<string> {
    const contents = state.view.webContents;
    const result = await contents.executeJavaScript(snapshotScript()) as {
      body?: string;
      interactive?: { role: string; name: string }[];
    };
    const logs = state.console;
    return [
      `Page: ${contents.getTitle() || "Untitled"}`,
      `URL: ${contents.getURL()}`,
      `Viewport: ${state.viewport} (${state.size.width} × ${state.size.height})`,
      result.interactive?.length ? `\nInteractive elements:\n${result.interactive.map((item) => `- ${item.role}: ${item.name || "Unnamed"}`).join("\n")}` : "",
      result.body ? `\nVisible text:\n${result.body}` : "",
      logs.length ? `\nRecent console:\n${logs.join("\n")}` : "",
    ].filter(Boolean).join("\n");
  }

  private activity(state: NativeBrowserSession, delay = 120): void {
    state.controller = "you";
    clearTimeout(state.activityTimer);
    state.activityTimer = setTimeout(() => {
      state.revision += 1;
      this.push(state);
    }, delay);
  }

  private push(state: NativeBrowserSession): void {
    void this.browserView(state, false).then((view) => this.emit(state.chatId, state.browserId, view));
  }

  private recover(state: NativeBrowserSession, reason: string): void {
    if (reason === "clean-exit" || this.sessions.get(sessionKey(state.chatId, state.browserId)) !== state) return;
    const now = Date.now();
    state.recoveries = state.recoveries.filter((at) => now - at <= RECOVERY_WINDOW_MS);
    state.error = state.recoveries.length >= RECOVERY_LIMIT
      ? "The browser keeps stopping. Close this tab and open it again."
      : "The browser stopped and is reopening.";
    state.revision += 1;
    this.push(state);
    if (state.recoveries.length >= RECOVERY_LIMIT) return;
    state.recoveries.push(now);
    console.warn("remy: recovering native browser", reason, state.chatId, state.browserId);
    state.view.webContents.reload();
  }

  private close(state: NativeBrowserSession): void {
    clearTimeout(state.activityTimer);
    if (state.attached) this.window.contentView.removeChildView(state.view);
    this.sessions.delete(sessionKey(state.chatId, state.browserId));
    if (!state.view.webContents.isDestroyed()) state.view.webContents.close();
  }

  private loaded(contents: WebContents): Promise<void> {
    if (!contents.isLoading()) return Promise.resolve();
    return new Promise((resolve) => contents.once("did-stop-loading", () => resolve()));
  }

  private pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

export function isBrowserHostCommand(value: unknown): value is BrowserHostCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<BrowserHostCommand> & { type?: unknown };
  return command.type === "browser-host-command"
    && typeof command.requestId === "string"
    && typeof command.action === "string"
    && typeof command.chatId === "string"
    && typeof command.browserId === "string";
}
