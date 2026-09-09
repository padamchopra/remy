import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownToLine, ArrowUpRight, Check, GitBranch, Github, Globe, Laptop, Menu, MessagesSquare, Repeat2, ShieldCheck, SquareKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProviderMark } from "@/components/ProviderMark";
import "./ui.css";
import "./style.css";

const repo = "https://github.com/padamchopra/remy";
const download = `${repo}/releases/latest`;
const features = [
  { id: "threads", tab: "Threads", title: "Keep every thread in view.", text: "Keep your threads in one view, see which ones need you, and pick up a conversation without losing your place.", icon: MessagesSquare },
  { id: "worktrees", tab: "Worktrees", title: "One change. One worktree.", text: "Start a thread in its own git worktree so independent changes can move forward side by side.", icon: GitBranch },
  { id: "review", tab: "Review", title: "Stay close to the change.", text: "Read tool output, inspect edits, and keep your terminal and pull request beside the thread that made them.", icon: Check },
  { id: "agents", tab: "Agents", title: "Give repeated work a home.", text: "Give an agent its own instructions and model in Inbox, then ask it to take on repeated work with a routine.", icon: Repeat2 },
];
const faqs = [
  ["What do I need to run Remy?", "A Mac with Claude Code, Codex, or Cursor Agent installed. Keep it awake while your threads run. Add Tailscale when you want to connect from another device."],
  ["Does Remy upload my repositories?", "Local Remy keeps your repositories on your computers. Your chosen coding provider still receives the context it needs, just as it does when you use it in a terminal."],
  ["Can I use more than one Mac?", "Yes. Pair your computers over Tailscale. Your planning board is shared, while each thread runs on the computer that holds its workspace."],
  ["Does the iPhone app run agents itself?", "No. The iPhone app connects to a Mac running Remy. You can follow your threads and send messages from your phone."],
  ["Is Remy free?", "Local Remy is free and needs no Remy account. Your coding provider’s own subscription or usage charges still apply."],
  ["Does it run on Windows or Linux?", "The desktop app currently targets macOS. You can reach your Mac from a browser on another device."],
];
function Download({ large = false }: { large?: boolean }) {
  return <Button asChild size={large ? "lg" : "default"}><a href={download}><ArrowDownToLine data-icon="inline-start" />Download{large ? " for Mac" : ""}</a></Button>;
}
function Navigation() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="site-header"><nav aria-label="Main navigation" className="site-nav">
    <a className="wordmark" href="/">Remy<span className="brand-dot" /></a>
    <div className="nav-links"><a href="/docs/">Docs</a><a href="/changelog/">Changelog</a><a href="/#features">Features</a></div>
    <div className="nav-actions"><a className="github-link" href={repo} aria-label="Remy on GitHub"><Github /></a><Download /></div>
    <Collapsible className="mobile-navigation" open={menuOpen} onOpenChange={setMenuOpen}><CollapsibleTrigger asChild><Button variant="outline" size="icon" aria-label="Open navigation"><Menu /></Button></CollapsibleTrigger><CollapsibleContent className="mobile-links" onClick={() => setMenuOpen(false)}><a href="/docs/">Docs</a><a href="/changelog/">Changelog</a><a href="/#features">Features</a><a href={download}>Download for Mac</a></CollapsibleContent></Collapsible>
  </nav></header>;
}
function DemoFrame({ scene = "threads", compact = false, surface = false, eager = false }: { scene?: string; compact?: boolean; surface?: boolean; eager?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(eager);
  const frame = useRef<HTMLIFrameElement>(null);
  const latestScene = useRef(scene);
  latestScene.current = scene;
  const [initialScene] = useState(scene);
  const [width, setWidth] = useState(0);
  const canvasWidth = compact ? 390 : surface ? 760 : 1360;
  const canvasHeight = compact ? 680 : surface ? 500 : 720;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    resize.observe(element);
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setReady(true); observer.disconnect(); } }, { rootMargin: "400px" });
    observer.observe(element);
    return () => { resize.disconnect(); observer.disconnect(); };
  }, []);
  const sendScene = () => frame.current?.contentWindow?.postMessage({ type: "remy-preview-scene", scene: latestScene.current }, location.origin);
  useEffect(() => { sendScene(); }, [scene]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === "remy-preview-ready") sendScene();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  const src = `/demo/index.html?scene=${initialScene}${compact ? "&compact=1" : ""}${surface ? "&surface=1" : ""}`;
  return <div className={compact ? "phone-demo" : "desktop-demo"}>
    <div ref={host} className="demo-viewport" inert style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}`, "--demo-scale": width / canvasWidth } as CSSProperties}>
      {ready && width > 0 ? <iframe ref={frame} onLoad={sendScene} src={src} title={compact ? "Remy browser demo in a narrow viewport" : surface ? "Remy feature preview" : "Remy workspace preview"} style={{ width: canvasWidth, height: canvasHeight }} sandbox="allow-scripts allow-same-origin allow-forms" tabIndex={-1} /> : <div className="demo-placeholder" aria-hidden="true"><div className="preview-shell-sidebar" /><div className="preview-shell-content"><span /><span /><span /><span /></div></div>}
    </div>
  </div>;
}
function FeatureTabs({ value, onChange, children, label = "Explore Remy features" }: { value: string; onChange: (value: string) => void; children: ReactNode; label?: string }) {
  return <Tabs className="feature-tabs" value={value} onValueChange={onChange}><TabsList variant="line" aria-label={label}>{features.map((feature) => <TabsTrigger key={feature.id} value={feature.id}><feature.icon aria-hidden="true" /><span>{feature.tab}</span></TabsTrigger>)}</TabsList><TabsContent value={value} forceMount>{children}</TabsContent></Tabs>;
}
function Home() {
  const [scene, setScene] = useState("threads");
  const [feature, setFeature] = useState("worktrees");
  const selected = features.find((item) => item.id === feature)!;
  return <main>
    <section className="hero" aria-labelledby="hero-title"><p className="eyebrow"><span />Free. Local. Built around your agents.</p><h1 id="hero-title">Your agents,<br className="mobile-break" /> within reach.</h1><p className="hero-description">Run Claude Code, Codex, and Cursor on your own machines.<br className="desktop-break" /> Keep every thread, worktree, and review together. Pick up from anywhere.</p><div className="hero-actions"><Download large /><Button asChild variant="outline" size="lg"><a href={repo}><Github data-icon="inline-start" />View on GitHub</a></Button></div><p className="fine-print">Also in your browser and on iPhone</p></section>
    <section className="hero-preview" aria-label="Try Remy"><FeatureTabs value={scene} onChange={setScene}><DemoFrame scene={scene} eager /></FeatureTabs><div className="demo-caption"><span>Real Remy interface. Sample workspace.</span><Button asChild variant="ghost" size="sm"><a href={`/demo/?scene=${scene}`}>Try the live demo<ArrowUpRight data-icon="inline-end" /></a></Button></div></section>
    <section className="site-section explorer" id="features"><h2>From first prompt to finished work.</h2><FeatureTabs value={feature} onChange={setFeature} label="Explore the workbench"><div className="explorer-layout"><div><selected.icon className="feature-icon" /><h3>{selected.title}</h3><p>{selected.text}</p><a className="text-link" href={`/docs/#${selected.id}`}>Explore {selected.id}<ArrowUpRight /></a></div><DemoFrame scene={feature} surface /></div></FeatureTabs></section>
    <section className="site-section providers"><h2>Your agents. Your existing setup.</h2><p>Use the providers already installed on your Mac.<br />Pick the provider and model for each thread.</p><div className="provider-list">{[["claude", "Claude Code"], ["codex", "Codex"], ["cursor", "Cursor"]].map(([id, label]) => <a key={id} href="/docs/#providers"><ProviderMark provider={id} className="size-7" /><span>{label}</span></a>)}</div></section>
    <section className="site-section mobile-section"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Step away.<br />Stay in the loop.</h2><p>Your Mac keeps working. Open Remy on your iPhone or in a browser to follow a thread, answer a question, or send the next prompt.</p><p>Pair your devices over your private Tailscale network.</p><Button asChild variant="outline"><a href="/docs/#pairing">Set up remote access<ArrowUpRight data-icon="inline-end" /></a></Button><p className="fine-print">Remy’s browser interface, on a smaller screen.<br />The native iPhone app also connects to your Mac.</p></div><DemoFrame compact /></section>
    <section className="site-section"><h2>Everything around the conversation.</h2><p>Plan the work, give it space, and review what comes back.</p><div className="feature-grid">{[
      { icon: GitBranch, title: "Worktrees for parallel work", text: "Give each change its own branch and working folder.", link: "worktrees", preview: "worktrees" },
      { icon: MessagesSquare, title: "A workbench for every thread", text: "Keep your terminal, browser, and pull request beside the conversation.", link: "review", preview: "review" },
      { icon: Repeat2, title: "Agents you can come back to", text: "Give an agent instructions, then ask it for recurring work in Inbox.", link: "agents", preview: "agents" },
      { icon: SquareKanban, title: "Tickets that follow the work", text: "Plan on a shared board and hand a ticket to an agent.", link: "tasks" },
      { icon: Laptop, title: "Your computers, connected", text: "Reach the Mac that holds the repo and keep your planning in sync.", link: "pairing" },
      { icon: Globe, title: "Your work, within reach", text: "Pick up the same thread from the desktop app or your browser.", link: "threads" },
    ].map((item) => <a className={item.preview ? "feature-card feature-card-with-preview" : "feature-card"} key={item.title} href={`/docs/#${item.link}`}>{item.preview && <div className="feature-card-visual"><DemoFrame scene={item.preview} surface /></div>}<item.icon /><h3>{item.title}<ArrowUpRight /></h3><p>{item.text}</p></a>)}</div></section>
    <section className="site-section trust"><div><ShieldCheck className="feature-icon" /><h2>Your repos stay<br />on your machines.</h2><p>Remy runs where your code lives. Your chosen coding provider still receives the context it needs, just as it does in your terminal.</p><a className="text-link" href={`${repo}/blob/main/SECURITY.md`}>Read about security<ArrowUpRight /></a></div><ul><li><Check />No Remy account to create</li><li><Check />Remote access over your Tailscale network</li><li><Check />Free local app, with source on GitHub</li></ul></section>
    <section className="site-section faq"><h2>Frequently asked<br />questions.</h2><div>{faqs.map(([question, answer]) => <Collapsible key={question}><CollapsibleTrigger className="faq-question">{question}<span aria-hidden="true">＋</span></CollapsibleTrigger><CollapsibleContent><p>{answer}</p></CollapsibleContent></Collapsible>)}</div></section>
    <section className="site-section closing"><h2>Get Remy.</h2><p>Open a folder. Pick an agent. Start a thread.</p><Download large /><p className="fine-print">Free · macOS · Your own machines</p></section>
  </main>;
}
const guides = [
  ["installation", "Install Remy", "Download the latest DMG from GitHub Releases and drag Remy to Applications. Install at least one coding provider on your Mac, then open Remy. Keep your Mac awake while your threads run."],
  ["providers", "Bring your provider", "Install and sign in to Claude Code, Codex, or Cursor Agent using that provider’s own instructions. In Remy, choose the provider and model when you start a thread. Provider subscriptions and usage charges are separate from Remy."],
  ["threads", "Start a thread", "Open a workspace folder, choose your model and permission mode, and describe what you want done. Follow the response, inspect tool output, and send another message to continue."],
  ["worktrees", "Give a change its own space", "For a git workspace, choose a new worktree when starting a thread. Remy creates a separate checkout so independent changes can run beside one another. Existing worktrees stay where they are."],
  ["review", "Review in context", "Open the terminal, browser, or pull request from your thread’s workbench. Arrange tabs side by side to keep the conversation and its work together."],
  ["agents", "Talk to your agents", "Open Inbox to create an agent with its own instructions and model. Ask that agent for repeated work to create a routine, then manage the routine in its settings."],
  ["tasks", "Plan with tickets", "Use Tasks to plan work and assign tickets to yourself, an agent, or the workspace agent. Your paired computers share the planning board; the thread runs on the computer holding the workspace."],
  ["pairing", "Connect your devices", "Install Tailscale on your devices and sign in to your tailnet. On each Mac, open Settings → Devices and enable remote reachability. Select the other computer to pair; confirm the matching code when asked. Pair the iPhone app from Devices. Your Mac must remain awake and reachable."],
];
function Docs() {
  return <main className="site-section docs-page"><p className="eyebrow">REMY GUIDES</p><h1>From your first thread<br />to your other Mac.</h1><p>Everything you need to put your own computers to work.</p><div className="docs-layout"><nav aria-label="Guide topics">{guides.map(([id, title]) => <a key={id} href={`#${id}`}>{title}</a>)}</nav><div>{guides.map(([id, title, text]) => <section key={id} id={id}><h2>{title}</h2><p>{text}</p>{id === "installation" && <Download large />}{id === "providers" && <div className="guide-links"><a href="https://claude.com/claude-code">Claude Code ↗</a><a href="https://developers.openai.com/codex/cli/">Codex ↗</a><a href="https://cursor.com/docs/cli/installation">Cursor Agent ↗</a></div>}{id === "pairing" && <a className="text-link" href={`${repo}#on-the-iphone`}>iPhone setup and source<ArrowUpRight /></a>}</section>)}</div></div></main>;
}
function Changelog() {
  return <main className="site-section changelog-page"><p className="eyebrow">CHANGELOG</p><h1>Remy keeps moving.</h1><p>New capabilities, useful improvements, and fixes worth knowing about.</p><article><span className="release-label">Unreleased</span><h2>A closer look at Remy.</h2><p>Explore the website’s interactive demo, powered by the same interface components as the app. Browse setup guides and find the latest Mac download.</p><ul><li>Select sample threads and try the composer.</li><li>Explore worktrees, agents, and reviewing changes.</li><li>Find setup instructions for your Mac and other devices.</li></ul></article><a className="text-link" href={`${repo}/releases`}>View released app versions on GitHub<ArrowUpRight /></a></main>;
}
function Footer() {
  return <footer className="site-footer"><div><a className="wordmark" href="/">Remy</a><p>Your coding agents, within reach.</p><small>© {new Date().getFullYear()} Remy</small></div><nav aria-label="Product links"><strong>Product</strong><a href={download}>Download</a><a href="/#features">Features</a><a href="/changelog/">Changelog</a></nav><nav aria-label="Learn links"><strong>Learn</strong><a href="/docs/#installation">Installation</a><a href="/docs/#pairing">Pair your devices</a><a href="/docs/#providers">Provider setup</a></nav><nav aria-label="Community links"><strong>In the open</strong><a href={repo}>GitHub ↗</a><a href={`${repo}/issues`}>Report an issue ↗</a><a href={`${repo}/blob/main/SECURITY.md`}>Security ↗</a></nav></footer>;
}
const Page = location.pathname.startsWith("/docs") ? Docs : location.pathname.startsWith("/changelog") ? Changelog : Home;
createRoot(document.getElementById("root")!).render(<TooltipProvider><a className="skip-link" href="#content">Skip to content</a><Navigation /><div id="content"><Page /></div><Footer /></TooltipProvider>);
