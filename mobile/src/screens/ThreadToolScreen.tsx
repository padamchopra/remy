import { useCallback, useEffect, useRef, useState } from "react";
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, RefreshCw, X } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { transport } from "../lib/transport";
import type { Chat } from "../state/types";
import { Button } from "../components/Button";

interface BrowserView {
  browserId?: string;
  active: boolean;
  url?: string;
  title?: string;
  width: number;
  height: number;
  revision: number;
  canGoBack?: boolean;
  canGoForward?: boolean;
  screenshot?: string;
  error?: string;
}

interface TerminalView {
  terminalId: string;
  active: boolean;
  cwd: string;
  output: string;
  revision: number;
  exitCode?: number;
}

interface TerminalFrame extends Partial<TerminalView> {
  type?: string;
  data?: string;
}

export function ThreadToolScreen({ chat, tool, onClose }: { chat: Chat; tool: "browser" | "terminal"; onClose: () => void }) {
  return <View style={styles.overlay}>{tool === "browser" ? <ThreadBrowser chat={chat} onClose={onClose} /> : <ThreadTerminal chat={chat} onClose={onClose} />}</View>;
}

function ThreadBrowser({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [view, setView] = useState<BrowserView>();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [imageWidth, setImageWidth] = useState(1);
  const base = `/chats/${encodeURIComponent(chat.id)}/browser?instance=default`;
  const action = (name: string) => `/chats/${encodeURIComponent(chat.id)}/browser/${name}?instance=default`;

  const read = useCallback(async () => {
    try {
      const next = await transport.request<BrowserView>(chat.serverId, base);
      setView(next); setUrl((current) => next.url ?? current); setError(next.error);
      if (next.active) await transport.request(chat.serverId, action("viewport"), { method: "POST", body: { viewport: "mobile" } }).then((value) => setView(value as BrowserView));
    } catch (caught) { setError(apiError(caught)); }
  }, [base, chat.serverId]);

  useEffect(() => { void read(); }, [read]);
  useEffect(() => transport.subscribe((source, payload) => {
    if (source !== chat.serverId || !payload || typeof payload !== "object") return;
    const frame = payload as BrowserView & { type?: string; chatId?: string };
    if (frame.type !== "browser" || frame.chatId !== chat.id || (frame.browserId && frame.browserId !== "default")) return;
    setView((current) => ({
      ...current,
      ...frame,
      active: frame.active !== false,
      width: frame.width ?? current?.width ?? 390,
      height: frame.height ?? current?.height ?? 700,
      revision: frame.revision ?? current?.revision ?? 0,
    }));
    setError(frame.error);
    setTimeout(() => void read(), 80);
  }, [`thread:${chat.id}`]), [chat.id, chat.serverId, read]);

  const run = async (name: string, body: Record<string, unknown> = {}) => {
    setError(undefined);
    try { setView(await transport.request<BrowserView>(chat.serverId, action(name), { method: "POST", body })); }
    catch (caught) { setError(apiError(caught)); }
  };
  const close = async () => {
    try { await transport.request(chat.serverId, action("close"), { method: "POST", body: {} }); onClose(); }
    catch (caught) { setError(apiError(caught)); }
  };
  const ratio = view?.width ? imageWidth / view.width : 1;

  return <View style={styles.surface}>
    <View style={styles.toolbar}><Text style={[type.callout, { flex: 1 }]} numberOfLines={1}>{view?.title || "Shared browser"}</Text><Pressable onPress={() => void close()} accessibilityLabel="Close browser" style={styles.icon}><X size={18} color={color.mutedForeground} /></Pressable></View>
    <View style={styles.address}><TextInput value={url} onChangeText={setUrl} onSubmitEditing={() => void run("open", { url })} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" placeholderTextColor={color.mutedForeground} style={styles.addressInput} /><Button label="Open" disabled={!url.trim()} onPress={() => void run("open", { url })} /></View>
    <View style={styles.browserActions}>
      <IconButton icon={ArrowLeft} label="Back" disabled={!view?.canGoBack} onPress={() => void run("back")} />
      <IconButton icon={ArrowRight} label="Forward" disabled={!view?.canGoForward} onPress={() => void run("forward")} />
      <IconButton icon={RefreshCw} label="Reload" disabled={!view?.active} onPress={() => void run("reload")} />
      <IconButton icon={ArrowUp} label="Scroll up" disabled={!view?.active} onPress={() => void run("scroll", { deltaY: -500 })} />
      <IconButton icon={ArrowDown} label="Scroll down" disabled={!view?.active} onPress={() => void run("scroll", { deltaY: 500 })} />
    </View>
    {view?.active && view.screenshot ? <ScrollView style={styles.browserScroll} contentContainerStyle={styles.browserCanvas}><Pressable onLayout={(event) => setImageWidth(event.nativeEvent.layout.width)} onPress={(event) => void run("click", { x: event.nativeEvent.locationX / ratio, y: event.nativeEvent.locationY / ratio })}><Image source={{ uri: view.screenshot }} resizeMode="contain" style={{ width: "100%", aspectRatio: view.width / view.height }} accessibilityLabel="Shared browser page" /></Pressable></ScrollView>
      : <View style={styles.empty}><Text style={type.heading}>{view?.active === false ? "No browser is open" : "The browser is unavailable"}</Text><Text style={type.caption}>{error ?? "Enter an address to open the shared browser on this thread's computer."}</Text>{error ? <Button label="Reconnect" variant="outline" onPress={() => void read()} /> : null}</View>}
    {view?.active ? <View style={styles.typebar}><TextInput value={text} onChangeText={setText} placeholder="Type into the selected page control" placeholderTextColor={color.mutedForeground} style={styles.typeInput} /><Button label="Type" disabled={!text} onPress={() => void run("insert", { value: text }).then(() => setText(""))} /></View> : null}
    {error && view?.active ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

function ThreadTerminal({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const terminalId = `thread-${chat.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 140)}`;
  const [terminal, setTerminal] = useState<TerminalView>();
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string>();
  const [size, setSize] = useState({ cols: 48, rows: 28 });
  const revision = useRef(-1);
  const output = useRef<ScrollView>(null);
  const path = (action: string) => `/terminals/${encodeURIComponent(terminalId)}/${action}`;

  const open = useCallback(async () => {
    setError(undefined);
    try {
      const next = await transport.request<TerminalView>(chat.serverId, path("open"), { method: "POST", body: { cwd: chat.cwd, ...size } });
      revision.current = next.revision; setTerminal(next);
    } catch (caught) { setError(apiError(caught)); setTerminal(undefined); }
  }, [chat.cwd, chat.serverId, size.cols, size.rows, terminalId]);
  useEffect(() => { void open(); }, [open]);
  useEffect(() => transport.subscribe((source, payload) => {
    const frame = payload as TerminalFrame;
    if (source !== chat.serverId || frame.type !== "terminal" || frame.terminalId !== terminalId) return;
    if (typeof frame.revision !== "number" || frame.revision !== revision.current + 1) return void open();
    revision.current = frame.revision;
    setTerminal((current) => current ? { ...current, active: frame.active ?? current.active, exitCode: frame.exitCode, revision: frame.revision!, output: `${current.output}${frame.data ?? ""}`.slice(-100_000) } : current);
  }, [`terminal:${terminalId}`]), [chat.serverId, open, terminalId]);

  const write = async (data: string) => {
    try { await transport.request(chat.serverId, path("write"), { method: "POST", body: { data } }); }
    catch (caught) { setError(apiError(caught)); }
  };
  const submit = () => { if (!command) return; void write(`${command}\r`); setCommand(""); };
  const resize = (event: LayoutChangeEvent) => {
    const next = { cols: Math.max(24, Math.floor(event.nativeEvent.layout.width / 7.2)), rows: Math.max(8, Math.floor(event.nativeEvent.layout.height / 16)) };
    if (next.cols === size.cols && next.rows === size.rows) return;
    setSize(next);
    if (terminal?.active) void transport.request(chat.serverId, path("resize"), { method: "POST", body: next }).catch(() => {});
  };
  const close = async () => {
    try { await transport.request(chat.serverId, path("close"), { method: "POST", body: {} }); onClose(); }
    catch (caught) { setError(apiError(caught)); }
  };

  return <View style={styles.surface}>
    <View style={styles.toolbar}><Text style={[type.callout, { flex: 1 }]}>Terminal</Text><Text style={type.caption}>{terminal?.active ? "Connected" : terminal?.exitCode === undefined ? "Disconnected" : `Stopped · ${terminal.exitCode}`}</Text><Pressable onPress={() => void close()} accessibilityLabel="Close terminal" style={styles.icon}><X size={18} color={color.mutedForeground} /></Pressable></View>
    <View style={styles.terminal} onLayout={resize}>
      {terminal ? <ScrollView ref={output} onContentSizeChange={() => output.current?.scrollToEnd({ animated: false })} contentContainerStyle={styles.terminalContent}><Text selectable style={styles.terminalText}>{terminal.output || "The terminal is ready."}</Text></ScrollView>
        : <View style={styles.empty}><Text style={type.heading}>The terminal is unavailable</Text><Text style={type.caption}>{error ?? "Reconnect to this thread's computer and try again."}</Text><Button label="Reconnect" variant="outline" onPress={() => void open()} /></View>}
    </View>
    <View style={styles.keys}><Button label="Ctrl-C" variant="ghost" onPress={() => void write("\u0003")} /><Button label="Tab" variant="ghost" onPress={() => void write("\t")} /><IconButton icon={ArrowUp} label="Previous command" onPress={() => void write("\u001b[A")} /><IconButton icon={ArrowDown} label="Next command" onPress={() => void write("\u001b[B")} /></View>
    <View style={styles.typebar}><TextInput value={command} onChangeText={setCommand} onSubmitEditing={submit} autoCapitalize="none" autoCorrect={false} placeholder="Command" placeholderTextColor={color.mutedForeground} style={styles.typeInput} /><Pressable onPress={submit} accessibilityLabel="Run command" style={styles.icon}><CornerDownLeft size={18} color={color.foreground} /></Pressable></View>
    {!terminal?.active ? <View style={styles.recovery}><Text style={type.caption}>{terminal ? "This shell stopped. Restart it to keep working here." : "The last output stays readable while you reconnect."}</Text><Button label="Restart terminal" variant="outline" onPress={() => void open()} /></View> : null}
    {error && terminal ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

function IconButton({ icon: Icon, label, disabled, onPress }: { icon: typeof ArrowLeft; label: string; disabled?: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.icon, disabled && { opacity: 0.25 }]}><Icon size={18} color={color.mutedForeground} /></Pressable>; }

const styles = StyleSheet.create({
  overlay: { position: "absolute", inset: 0, backgroundColor: color.background },
  surface: { flex: 1, backgroundColor: color.background },
  toolbar: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  address: { flexDirection: "row", alignItems: "center", gap: 6, padding: 7 }, addressInput: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, color: color.foreground, paddingHorizontal: 10 },
  browserActions: { flexDirection: "row", justifyContent: "space-around", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  browserScroll: { flex: 1, backgroundColor: "#fff" }, browserCanvas: { width: "100%" },
  typebar: { flexDirection: "row", alignItems: "center", gap: 6, padding: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border }, typeInput: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, color: color.foreground, paddingHorizontal: 10 },
  terminal: { flex: 1, backgroundColor: "#09090b" }, terminalContent: { padding: 10 }, terminalText: { color: "#d4d4d8", fontFamily: "Menlo", fontSize: 11, lineHeight: 16 },
  keys: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", backgroundColor: color.card },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }, error: { color: color.destructive, fontSize: 12, paddingHorizontal: 10, paddingVertical: 5 }, recovery: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
});
