import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { broadcast } from "./notify.js";

export type BrowserController = "agent" | "you";
export type BrowserViewport = "fullscreen" | "desktop" | "mobile";
export type BrowserNavigation = "back" | "forward" | "reload";

export const BROWSER_DEVICE_SCALE_FACTOR = 2;

const BROWSER_VIEWPORTS: Record<BrowserViewport, { width: number; height: number }> = {
  fullscreen: { width: 1920, height: 1080 },
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

export interface BrowserTarget {
  selector?: string;
  role?: string;
  name?: string;
  text?: string;
  x?: number;
  y?: number;
}

export interface BrowserView {
  browserId: string;
  active: boolean;
  url?: string;
  title?: string;
  viewport: BrowserViewport;
  width: number;
  height: number;
  revision: number;
  controller?: BrowserController;
  cursor?: { x: number; y: number; pressed?: boolean };
  screenshot?: string;
  error?: string;
}

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  viewport: BrowserViewport;
  size: { width: number; height: number };
  revision: number;
  controller?: BrowserController;
  cursor?: { x: number; y: number; pressed?: boolean };
  error?: string;
  humanEpoch: number;
  queue: Promise<unknown>;
  console: string[];
  network: string[];
  unavailable: boolean;
}

const sessions = new Map<string, BrowserSession>();
const contexts = new Map<string, { browser: Browser; context: BrowserContext }>();
let sharedBrowser: Browser | undefined;
let browserLaunch: Promise<Browser> | undefined;

export function browserViewportSize(
  viewport: BrowserViewport,
  size?: { width?: number; height?: number },
): { width: number; height: number } {
  if (viewport !== "fullscreen" || !size) return BROWSER_VIEWPORTS[viewport];
  return {
    width: Math.round(Math.min(3840, Math.max(240, Number(size.width) || BROWSER_VIEWPORTS.fullscreen.width))),
    height: Math.round(Math.min(2160, Math.max(200, Number(size.height) || BROWSER_VIEWPORTS.fullscreen.height))),
  };
}

function sessionKey(chatId: string, browserId: string): string {
  return `${chatId}\0${browserId}`;
}

function cachedChromium(): string | undefined {
  const root = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    for (const arch of ["chrome-mac-arm64", "chrome-mac-x64"]) {
      for (const app of ["Google Chrome for Testing", "Chromium"]) {
        const candidate = join(root, build, arch, `${app}.app`, "Contents/MacOS", app);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

function browserExecutable(): string | undefined {
  const configured = process.env.REMY_BROWSER_EXECUTABLE?.trim();
  if (configured && existsSync(configured)) return configured;
  const candidates = process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        cachedChromium(),
      ]
    : process.platform === "win32"
      ? [
          join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
          join(process.env["PROGRAMFILES(X86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function normaliseUrl(input: string): string {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input.trim()) ? input.trim() : `http://${input.trim()}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The shared browser can open HTTP and HTTPS pages only.");
  }
  return url.toString();
}

async function createSession(chatId: string, browserId: string): Promise<BrowserSession> {
  const held = await contextFor(chatId);
  const viewport: BrowserViewport = "desktop";
  const size = browserViewportSize(viewport);
  const page = await held.context.newPage();
  await page.setViewportSize(size);
  const session: BrowserSession = {
    browser: held.browser,
    context: held.context,
    page,
    viewport,
    size,
    revision: 0,
    humanEpoch: 0,
    queue: Promise.resolve(),
    console: [],
    network: [],
    unavailable: false,
  };
  page.on("console", (message) => {
    session.console.push(`${message.type()}: ${message.text()}`);
    session.console = session.console.slice(-50);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    session.network.push(`${response.status()} ${response.url()}`);
    session.network = session.network.slice(-50);
  });
  page.on("dialog", (dialog) => void dialog.dismiss());
  page.on("crash", () => browserUnavailable(chatId, browserId, session));
  page.on("close", () => browserUnavailable(chatId, browserId, session));
  sessions.set(sessionKey(chatId, browserId), session);
  return session;
}

async function browserProcess(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  if (browserLaunch) return browserLaunch;
  const executablePath = browserExecutable();
  if (!executablePath) {
    throw new Error("Remy could not find Chrome or Chromium on this device.");
  }
  browserLaunch = chromium.launch({ executablePath, headless: true }).then((browser) => {
    sharedBrowser = browser;
    browser.on("disconnected", () => {
      if (sharedBrowser === browser) sharedBrowser = undefined;
      browserLaunch = undefined;
      for (const [chatId, held] of contexts) {
        if (held.browser === browser) contexts.delete(chatId);
      }
      for (const [key, session] of sessions) {
        if (session.browser !== browser) continue;
        const separator = key.indexOf("\0");
        browserUnavailable(key.slice(0, separator), key.slice(separator + 1), session);
      }
    });
    return browser;
  }).finally(() => {
    browserLaunch = undefined;
  });
  return browserLaunch;
}

async function contextFor(chatId: string): Promise<{ browser: Browser; context: BrowserContext }> {
  const existing = contexts.get(chatId);
  if (existing?.browser.isConnected()) return existing;
  if (existing) contexts.delete(chatId);
  const browser = await browserProcess();
  const context = await browser.newContext({
    viewport: browserViewportSize("desktop"),
    deviceScaleFactor: BROWSER_DEVICE_SCALE_FACTOR,
    colorScheme: "dark",
  });
  const held = { browser, context };
  contexts.set(chatId, held);
  context.on("close", () => {
    if (contexts.get(chatId) === held) contexts.delete(chatId);
  });
  return held;
}

function browserUnavailable(chatId: string, browserId: string, session: BrowserSession): void {
  if (sessions.get(sessionKey(chatId, browserId)) !== session || session.unavailable) return;
  session.unavailable = true;
  session.error = "The browser stopped unexpectedly. Your next action will reopen it.";
  session.revision += 1;
  broadcast({
    type: "browser",
    chatId,
    browserId,
    revision: session.revision,
    active: false,
    error: session.error,
  });
}

async function sessionFor(chatId: string, browserId: string): Promise<BrowserSession> {
  const key = sessionKey(chatId, browserId);
  const existing = sessions.get(key);
  if (existing && !existing.unavailable && existing.browser.isConnected() && !existing.page.isClosed()) {
    return existing;
  }
  const url = existing?.page.url();
  const viewport = existing?.viewport;
  const size = existing?.size;
  if (existing) {
    sessions.delete(key);
    await existing.page.close().catch(() => undefined);
  }
  const session = await createSession(chatId, browserId);
  if (viewport && size) {
    session.viewport = viewport;
    session.size = size;
    await session.page.setViewportSize(size);
  }
  if (url && url !== "about:blank") {
    await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  }
  return session;
}

function changed(chatId: string, browserId: string, session: BrowserSession): void {
  session.revision += 1;
  broadcast({
    type: "browser",
    chatId,
    browserId,
    viewport: session.viewport,
    width: session.size.width,
    height: session.size.height,
    revision: session.revision,
    active: true,
    controller: session.controller,
    cursor: session.cursor,
  });
}

function assertAgentStillControls(session: BrowserSession, epoch: number): void {
  if (session.humanEpoch !== epoch) throw new Error("You took control of the shared browser.");
}

async function queued<T>(
  chatId: string,
  browserId: string,
  controller: BrowserController,
  action: (session: BrowserSession, epoch: number) => Promise<T>,
): Promise<T> {
  const session = await sessionFor(chatId, browserId);
  if (controller === "you") {
    session.humanEpoch += 1;
    session.controller = "you";
    changed(chatId, browserId, session);
    // Stop a slow navigation before the person's action waits behind it. The
    // epoch check then rejects whatever agent action was in flight.
    void session.page.evaluate(() => window.stop()).catch(() => undefined);
  }
  const epoch = session.humanEpoch;
  const pending = session.queue.catch(() => undefined).then(async () => {
    session.controller = controller;
    session.error = undefined;
    changed(chatId, browserId, session);
    try {
      const result = await action(session, epoch);
      if (controller === "agent") assertAgentStillControls(session, epoch);
      changed(chatId, browserId, session);
      return result;
    } catch (error) {
      session.error = error instanceof Error ? error.message : String(error);
      changed(chatId, browserId, session);
      throw error;
    }
  });
  session.queue = pending;
  return pending;
}

function locatorFor(page: Page, target: BrowserTarget): Locator {
  if (target.selector) return page.locator(target.selector).first();
  if (target.role) {
    return page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
      ...(target.name ? { name: target.name } : {}),
    }).first();
  }
  if (target.text) return page.getByText(target.text, { exact: false }).first();
  if (target.name) return page.getByLabel(target.name, { exact: false }).first();
  throw new Error("Choose an element by role and name, text, selector, or coordinates.");
}

async function cursorFor(session: BrowserSession, target: BrowserTarget): Promise<{ x: number; y: number }> {
  const size = session.size;
  if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
    return {
      x: Math.max(0, Math.min(size.width, Number(target.x))),
      y: Math.max(0, Math.min(size.height, Number(target.y))),
    };
  }
  const box = await locatorFor(session.page, target).boundingBox();
  if (!box) throw new Error("That element is not visible.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function openBrowser(chatId: string, url: string, controller: BrowserController, browserId = "default"): Promise<BrowserView> {
  return queued(chatId, browserId, controller, async (session, epoch) => {
    await session.page.goto(normaliseUrl(url), { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (controller === "agent") assertAgentStillControls(session, epoch);
    return browserView(chatId, true, browserId);
  });
}

export async function setBrowserViewport(
  chatId: string,
  viewport: BrowserViewport,
  controller: BrowserController,
  browserId = "default",
  requestedSize?: { width?: number; height?: number },
): Promise<BrowserView> {
  if (!sessions.has(sessionKey(chatId, browserId))) {
    throw new Error("Open a page before changing its viewport.");
  }
  return queued(chatId, browserId, controller, async (session, epoch) => {
    const size = browserViewportSize(viewport, requestedSize);
    session.viewport = viewport;
    session.size = size;
    session.cursor = undefined;
    await session.page.setViewportSize(size);
    if (controller === "agent") assertAgentStillControls(session, epoch);
    await session.page.waitForTimeout(100);
    return browserView(chatId, true, browserId);
  });
}

export async function clickBrowser(chatId: string, target: BrowserTarget, controller: BrowserController, browserId = "default"): Promise<BrowserView> {
  return queued(chatId, browserId, controller, async (session, epoch) => {
    const cursor = await cursorFor(session, target);
    session.cursor = cursor;
    await session.page.mouse.move(cursor.x, cursor.y);
    changed(chatId, browserId, session);
    if (controller === "agent") {
      await new Promise((resolve) => setTimeout(resolve, 160));
      assertAgentStillControls(session, epoch);
    }
    session.cursor = { ...cursor, pressed: true };
    changed(chatId, browserId, session);
    if (controller === "agent") await new Promise((resolve) => setTimeout(resolve, 40));
    await session.page.mouse.click(cursor.x, cursor.y);
    session.cursor = cursor;
    await session.page.waitForTimeout(100);
    return browserView(chatId, true, browserId);
  });
}

export async function typeBrowser(
  chatId: string,
  target: BrowserTarget,
  text: string,
  controller: BrowserController,
  browserId = "default",
): Promise<BrowserView> {
  return queued(chatId, browserId, controller, async (session, epoch) => {
    const locator = locatorFor(session.page, target);
    const cursor = await cursorFor(session, target);
    session.cursor = cursor;
    changed(chatId, browserId, session);
    await locator.fill(text);
    if (controller === "agent") assertAgentStillControls(session, epoch);
    return browserView(chatId, true, browserId);
  });
}

export async function pressBrowser(chatId: string, key: string, controller: BrowserController, browserId = "default"): Promise<BrowserView> {
  return queued(chatId, browserId, controller, async (session, epoch) => {
    await session.page.keyboard.press(key);
    if (controller === "agent") assertAgentStillControls(session, epoch);
    await session.page.waitForTimeout(100);
    return browserView(chatId, true, browserId);
  });
}

export async function navigateBrowser(
  chatId: string,
  navigation: BrowserNavigation,
  controller: BrowserController,
  browserId = "default",
): Promise<BrowserView> {
  if (!sessions.has(sessionKey(chatId, browserId))) {
    throw new Error("Open a page before navigating it.");
  }
  return queued(chatId, browserId, controller, async (session, epoch) => {
    if (navigation === "back") await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
    if (navigation === "forward") await session.page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 });
    if (navigation === "reload") await session.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    if (controller === "agent") assertAgentStillControls(session, epoch);
    return browserView(chatId, true, browserId);
  });
}

export async function insertBrowser(chatId: string, text: string, controller: BrowserController, browserId = "default"): Promise<BrowserView> {
  return queued(chatId, browserId, controller, async (session, epoch) => {
    await session.page.keyboard.insertText(text);
    if (controller === "agent") assertAgentStillControls(session, epoch);
    await session.page.waitForTimeout(50);
    return browserView(chatId, true, browserId);
  });
}

export async function scrollBrowser(
  chatId: string,
  deltaX: number,
  deltaY: number,
  controller: BrowserController,
  browserId = "default",
): Promise<BrowserView> {
  return queued(chatId, browserId, controller, async (session, epoch) => {
    await session.page.mouse.wheel(deltaX, deltaY);
    if (controller === "agent") assertAgentStillControls(session, epoch);
    await session.page.waitForTimeout(100);
    return browserView(chatId, true, browserId);
  });
}

export async function waitInBrowser(chatId: string, milliseconds: number, controller: BrowserController, browserId = "default"): Promise<BrowserView> {
  return queued(chatId, browserId, controller, async (session, epoch) => {
    await session.page.waitForTimeout(Math.max(0, Math.min(10_000, milliseconds)));
    if (controller === "agent") assertAgentStillControls(session, epoch);
    return browserView(chatId, true, browserId);
  });
}

export async function browserSnapshotText(chatId: string, browserId = "default"): Promise<string> {
  const session = await sessionFor(chatId, browserId);
  const [title, body, interactive] = await Promise.all([
    session.page.title(),
    session.page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
    session.page.locator("a,button,input,textarea,select,[role],[contenteditable=true]").evaluateAll((nodes) =>
      nodes.slice(0, 200).map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return undefined;
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute("role") || ({
          a: "link",
          button: "button",
          input: "textbox",
          textarea: "textbox",
          select: "combobox",
        } as Record<string, string>)[tag] || tag;
        const name = element.getAttribute("aria-label")
          || element.getAttribute("title")
          || element.getAttribute("placeholder")
          || element.innerText
          || (element as HTMLInputElement).value
          || "";
        return { role, name: name.trim().slice(0, 160) };
      }).filter(Boolean),
    ).catch(() => []),
  ]);
  return [
    `Page: ${title || "Untitled"}`,
    `URL: ${session.page.url()}`,
    `Viewport: ${session.viewport} (${session.size.width} × ${session.size.height})`,
    interactive.length ? `\nInteractive elements:\n${interactive.map((item) => `- ${item?.role}: ${item?.name || "Unnamed"}`).join("\n")}` : "",
    body ? `\nVisible text:\n${body.slice(0, 20_000)}` : "",
    session.console.length ? `\nRecent console:\n${session.console.join("\n")}` : "",
    session.network.length ? `\nFailed requests:\n${session.network.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export async function browserView(chatId: string, screenshot = false, browserId = "default"): Promise<BrowserView> {
  const session = sessions.get(sessionKey(chatId, browserId));
  if (!session) {
    const viewport: BrowserViewport = "desktop";
    return { browserId, active: false, viewport, ...browserViewportSize(viewport), revision: 0 };
  }
  if (session.unavailable || session.page.isClosed() || !session.browser.isConnected()) {
    return {
      browserId,
      active: false,
      url: session.page.url(),
      viewport: session.viewport,
      width: session.size.width,
      height: session.size.height,
      revision: session.revision,
      controller: session.controller,
      cursor: session.cursor,
      error: session.error,
    };
  }
  const view: BrowserView = {
    browserId,
    active: true,
    url: session.page.url(),
    title: await session.page.title().catch(() => ""),
    viewport: session.viewport,
    width: session.size.width,
    height: session.size.height,
    revision: session.revision,
    controller: session.controller,
    cursor: session.cursor,
    error: session.error,
  };
  if (screenshot) {
    const image = await session.page.screenshot({ type: "png", scale: "device" });
    view.screenshot = `data:image/png;base64,${image.toString("base64")}`;
  }
  return view;
}

export async function closeBrowser(chatId: string, browserId?: string): Promise<void> {
  if (!browserId) {
    await Promise.all(Array.from(sessions.entries())
      .filter(([key]) => key.startsWith(`${chatId}\0`))
      .map(([key, session]) => closeSession(chatId, key.slice(chatId.length + 1), session)));
    const held = contexts.get(chatId);
    contexts.delete(chatId);
    await held?.context.close().catch(() => undefined);
    return;
  }
  const session = sessions.get(sessionKey(chatId, browserId));
  if (session) await closeSession(chatId, browserId, session);
}

async function closeSession(chatId: string, browserId: string, session: BrowserSession): Promise<void> {
  sessions.delete(sessionKey(chatId, browserId));
  await session.page.close().catch(() => undefined);
  broadcast({ type: "browser", chatId, browserId, revision: session.revision + 1, active: false });
}
