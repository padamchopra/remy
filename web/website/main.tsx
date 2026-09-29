import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpRight, Check, GitBranch, Github, Globe, Laptop, Menu, MessagesSquare, Plug, ShieldCheck, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProviderMark } from "@/components/ProviderMark";
import { CHANGELOG } from "./changelog";
import "./ui.css";
import "./style.css";

if (location.pathname === "/" && location.hash.startsWith("#/")) {
  const app = new URL(location.hash.slice(1), "https://app.tryremy.dev");
  for (const [key, value] of new URLSearchParams(location.search)) app.searchParams.set(key, value);
  location.replace(app.href);
}

const repo = "https://github.com/padamchopra/remy";
const webApp = "https://app.tryremy.dev/";
const features = [
  { id: "threads", tab: "Threads", title: "Keep every thread in view.", text: "Keep your threads in one view, see which ones need you, and pick up a conversation without losing your place.", icon: MessagesSquare },
  { id: "worktrees", tab: "Worktrees", title: "One change. One worktree.", text: "Start a thread in its own git worktree so independent changes can move forward side by side.", icon: GitBranch },
  { id: "review", tab: "Review", title: "Stay close to the change.", text: "Read tool output, inspect edits, and keep your terminal and pull request beside the thread that made them.", icon: Check },
];
const faqs = [
  ["What do I need to run Remy?", "Use Remy in your browser with a configured cloud computer and your provider credentials. To use your own machine, install the Remy CLI with npm i -g @padamchopra/remy and a coding provider on a computer that stays awake while your threads run."],
  ["Do I have to install anything?", "No. Open Remy in your browser, sign in, and use a cloud computer. Choose Cloud in Computers to enable one and configure your provider credentials; cloud availability depends on your Remy service."],
  ["Does Remy upload my repositories?", "On a computer you connect, your repositories stay on that computer. When you choose a hosted computer, your repository runs in the cloud. Remy on the web shows your threads, and your coding provider receives the context it needs in either setup."],
  ["Can I use more than one computer?", "Yes. Connect each one to your Remy account with the Remy CLI. Each thread runs on the computer that holds its workspace, and you follow them all from Remy on the web."],
  ["Is Remy free?", "Yes, Remy is completely free. You bring your own paid pieces: your Claude, Codex or Cursor subscription, model API keys such as OpenRouter, and cloud provider keys such as Fly.io."],
  ["Does it run on Windows or Linux?", "The Remy CLI runs on macOS and Linux. Use the web app from any of them, and from Windows with a cloud computer or a computer you connected."],
];
function OpenRemy({ large = false }: { large?: boolean }) {
  return <Button asChild size={large ? "lg" : "default"}><a href={webApp}><Globe data-icon="inline-start" />Open Remy</a></Button>;
}
function SetUpComputer({ large = false }: { large?: boolean }) {
  return <Button asChild variant="outline" size={large ? "lg" : "default"}><a href="/docs/#installation"><Terminal data-icon="inline-start" />Set up a computer</a></Button>;
}
function Navigation() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="site-header"><nav aria-label="Main navigation" className="site-nav">
    <a className="wordmark" href="/">Remy<span className="brand-dot" /></a>
    <div className="nav-links"><a href="/docs/">Docs</a><a href="/changelog/">Changelog</a><a href="/#features">Features</a></div>
    <div className="nav-actions"><a className="github-link" href={repo} aria-label="Remy on GitHub"><Github /></a><OpenRemy /></div>
    <Collapsible className="mobile-navigation" open={menuOpen} onOpenChange={setMenuOpen}><CollapsibleTrigger asChild><Button variant="outline" size="icon" aria-label="Open navigation"><Menu /></Button></CollapsibleTrigger><CollapsibleContent className="mobile-links" onClick={() => setMenuOpen(false)}><a href={webApp}>Open Remy</a><a href="/docs/">Docs</a><a href="/changelog/">Changelog</a><a href="/#features">Features</a><a href="/docs/#installation">Set up a computer</a></CollapsibleContent></Collapsible>
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
    <section className="hero" aria-labelledby="hero-title"><p className="eyebrow"><span />Your computers or the cloud. Your choice.</p><h1 id="hero-title">Your coding threads,<br className="mobile-break" /> within reach.</h1><p className="hero-description">Bring your coding threads together, on your computers or in the cloud.<br className="desktop-break" /> Keep every thread, worktree, and review together. Pick up from anywhere.</p><div className="hero-actions"><OpenRemy large /><SetUpComputer large /></div><p className="fine-print">Use Remy in your browser, on the computers you choose</p></section>
    <section className="hero-preview" aria-label="Try Remy"><FeatureTabs value={scene} onChange={setScene}><DemoFrame scene={scene} eager /></FeatureTabs><div className="demo-caption"><span>Real Remy interface. Sample workspace.</span><Button asChild variant="ghost" size="sm"><a href={`/demo/?scene=${scene}`}>Try the live demo<ArrowUpRight data-icon="inline-end" /></a></Button></div></section>
    <section className="site-section explorer" id="features"><h2>From first prompt to finished work.</h2><FeatureTabs value={feature} onChange={setFeature} label="Explore the workbench"><div className="explorer-layout"><div><selected.icon className="feature-icon" /><h3>{selected.title}</h3><p>{selected.text}</p><a className="text-link" href={`/docs/#${selected.id}`}>Explore {selected.id}<ArrowUpRight /></a></div><DemoFrame scene={feature} surface /></div></FeatureTabs></section>
    <section className="site-section providers"><h2>Your providers. Your existing setup.</h2><p>Connect your providers for hosted work or use your local setup.<br />Pick the provider and model for each thread.</p><div className="provider-list">{[["claude", "Claude Code"], ["codex", "Codex"], ["cursor", "Cursor"]].map(([id, label]) => <a key={id} href="/docs/#providers"><ProviderMark provider={id} className="size-7" /><span>{label}</span></a>)}</div></section>
    <section className="site-section mobile-section"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Step away.<br />Stay in the loop.</h2><p>Your computer keeps working, whether it’s on your desk or in the cloud. Open Remy in your browser to follow a thread, answer a question, or send the next prompt.</p><p>Use a cloud computer entirely from the web, or connect a computer of your own with the Remy CLI.</p><Button asChild variant="outline"><a href="/docs/#installation">Set up a computer<ArrowUpRight data-icon="inline-end" /></a></Button><p className="fine-print">Remy’s browser interface, on a smaller screen.</p></div><DemoFrame compact /></section>
    <section className="site-section"><h2>Everything around the conversation.</h2><p>Give the work space, and review what comes back.</p><div className="feature-grid">{[
      { icon: GitBranch, title: "Worktrees for parallel work", text: "Give each change its own branch and working folder.", link: "worktrees", preview: "worktrees" },
      { icon: MessagesSquare, title: "A workbench for every thread", text: "Keep your terminal, browser, and pull request beside the conversation.", link: "review", preview: "review" },
      { icon: Plug, title: "Linear in your threads", text: "Connect your Linear account and your threads use it.", link: "linear" },
      { icon: Laptop, title: "Your computers, connected", text: "Run each thread on the computer that holds the repo.", link: "installation" },
      { icon: Globe, title: "Your work, within reach", text: "Pick up the same thread from any browser you open.", link: "threads" },
    ].map((item) => <a className={item.preview ? "feature-card feature-card-with-preview" : "feature-card"} key={item.title} href={`/docs/#${item.link}`}>{item.preview && <div className="feature-card-visual"><DemoFrame scene={item.preview} surface /></div>}<item.icon /><h3>{item.title}<ArrowUpRight /></h3><p>{item.text}</p></a>)}</div></section>
    <section className="site-section trust"><div><ShieldCheck className="feature-icon" /><h2>Your code.<br />Your choice of computer.</h2><p>On a computer you connect, your repositories stay on that computer. Hosted computers run your repositories in the cloud. Your chosen coding provider receives the context it needs in either setup.</p><a className="text-link" href={`${repo}/blob/main/SECURITY.md`}>Read about security<ArrowUpRight /></a></div><ul><li><Check />Your computer connects out to Remy and listens only on 127.0.0.1</li><li><Check />Your repositories stay on the computers you connect</li><li><Check />Source on GitHub</li></ul></section>
    <section className="site-section faq"><h2>Frequently asked<br />questions.</h2><div>{faqs.map(([question, answer]) => <Collapsible key={question}><CollapsibleTrigger className="faq-question">{question}<span aria-hidden="true">＋</span></CollapsibleTrigger><CollapsibleContent><p>{answer}</p></CollapsibleContent></Collapsible>)}</div></section>
    <section className="site-section closing"><h2>Open Remy.</h2><p>Choose your computer. Pick your model. Start a thread.</p><div className="hero-actions"><OpenRemy large /><SetUpComputer large /></div><p className="fine-print">In your browser, on the computers you choose</p></section>
  </main>;
}
const guides = [
  ["web", "Use Remy on the web", "Open Remy in your browser and create an account with your email and password, or sign in with that password or a link we email you. Google and GitHub are optional. A sign-in link works for five minutes. An organization is optional. In Threads, use Set up a computer to connect your Mac or configure cloud execution, then add a repository workspace. Open Settings at the bottom of the sidebar to open General; Back returns to your work. Computers is one list: Cloud first, with each cloud provider and Model access, then the Mac and Linux machines you connected, across Personal and every organization you belong to. Open a row for its page. On a cloud provider's page, save named Fly.io Sprites, Modal, or Cursor Cloud keys; saving the first one turns it on, and each has its own switch. To sign a Mac or Linux machine in from its terminal, choose Connect a computer and run the commands it shows on that machine: remy login with the key it makes, then remy start to keep it available. Return to Threads and describe what you want done; Remy sends that request when the thread opens. Fly Sprites manages resources automatically; Modal offers Light, Standard, and Heavy sizes with rough hourly compute estimates and custom settings available. Cursor Cloud runs on Cursor-hosted VMs and clones the workspace from its git remote. For Codex on a cloud computer, sign in with ChatGPT once in Computers → Model access, or save an OpenAI, Router, or OpenRouter API key. For Claude on a cloud computer, save an Anthropic API key. On a computer you own, open its page and sign Claude Code or Codex in, or give it an Anthropic, OpenAI, or Cursor key. Create or join an organization when you want to work with other people."],
  ["installation", "Install Remy on a computer", "Use a Mac or Linux machine that stays awake, with Node 22.5 or newer and at least one coding provider. Install the CLI with npm i -g @padamchopra/remy. In Remy on the web, open Settings → Computers, choose Connect a computer, and run the command it gives you on that machine: remy login <key>. Then run remy start to keep the computer available; remy status says what it is connected to, remy logout disconnects it, and remy update installs the latest CLI. Remy listens on 127.0.0.1 only and connects out to your Remy account, so you reach it from Remy on the web."],
  ["environments", "Give a workspace its environment", "Open a workspace and add its variables and secrets under Environment, or paste a .env file. A Workspace value reaches every thread in that workspace, whoever starts it. A Personal value is only yours and reaches every thread you start, in any workspace, on any computer; a Workspace value wins over a Personal one with the same key. Secrets are encrypted and never shown again, but providers and commands can read the values their thread receives. Exact redaction cannot recognise encoded or transformed values. Automatic cloud execution gives each thread a separate computer, up to your configured concurrency limit; sleeping computers restore their state when work resumes."],
  ["providers", "Bring your provider", "On a computer you connected, install Claude Code, Codex, or Cursor Agent. Sign Claude Code or Codex in from that computer's page in Computers, or give it an Anthropic, OpenAI, or Cursor key there. For cloud Codex, sign in with your ChatGPT account once in Computers → Model access by entering a device code. Your subscription and Personal model keys follow you into every organization thread you start. In Organizations → Computers and models, any member can enroll an exact named model key, cloud key, or connected computer for everyone. Placement and model access stay separate, and both pickers name the owner and key. Claude Code account sign-in stays on computers you connect. Cursor Cloud uses a Cursor API key and runs on Cursor-hosted VMs; Cursor threads on a computer you connected still use Cursor Agent there. Provider subscriptions and usage charges are separate from Remy."],
  ["threads", "Start a thread", "Open a workspace folder, choose your model and permission mode, and describe what you want done. New threads start on Ask unless you choose another mode. Change permissions in the reply composer for your next message; a pending approval still needs your decision. On the web, choose Private or Shared in the composer. Messages and approval explanations support Markdown. Follow the response, inspect tool output, and send another message to continue."],
  ["worktrees", "Give a change its own space", "For a git workspace, choose a new worktree when starting a thread. Remy creates a separate checkout so independent changes can run beside one another. Existing worktrees stay where they are."],
  ["review", "Review in context", "Open the terminal, browser, or pull request from your thread’s workbench. Arrange tabs side by side to keep the conversation and its work together."],
  ["linear", "Use Linear in a thread", "Open Settings → Connections and connect your Linear account. Threads you start use that account, in Personal or in each organization you choose it for."],
];
function Docs() {
  return <main className="site-section docs-page"><p className="eyebrow">REMY GUIDES</p><h1>From your first thread<br />to any computer.</h1><p>Use Remy in the cloud or on your own computers.</p><div className="docs-layout"><nav aria-label="Guide topics">{guides.map(([id, title]) => <a key={id} href={`#${id}`}>{title}</a>)}</nav><div>{guides.map(([id, title, text]) => <section key={id} id={id}><h2>{title}</h2><p>{text}</p>{id === "web" && <OpenRemy large />}{id === "installation" && <SetUpComputer large />}{id === "providers" && <div className="guide-links"><a href="https://claude.com/claude-code">Claude Code ↗</a><a href="https://developers.openai.com/codex/cli/">Codex ↗</a><a href="https://cursor.com/docs/cli/installation">Cursor Agent ↗</a></div>}</section>)}</div></div></main>;
}
const CHANGELOG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
function changelogDate(date: string) {
  return CHANGELOG_DATE.format(new Date(`${date}T00:00:00Z`));
}
function inlineCode(text: string): ReactNode[] {
  return text.split("`").map((part, index) => index % 2 ? <code key={index}>{part}</code> : part);
}
function Changelog() {
  return <main className="site-section changelog-page"><p className="eyebrow">CHANGELOG</p><h1>Remy keeps moving.</h1><p>New capabilities, useful improvements, and fixes worth knowing about.</p>{CHANGELOG.map(({ date, entries }) => <article key={date}><h2><time dateTime={date}>{changelogDate(date)}</time></h2><ul>{entries.map((entry) => <li key={entry}>{inlineCode(entry)}</li>)}</ul></article>)}<a className="text-link" href={`${repo}/releases`}>View released app versions on GitHub<ArrowUpRight /></a></main>;

}
function Footer() {
  return <footer className="site-footer"><div><a className="wordmark" href="/">Remy</a><p>Your coding threads, within reach.</p><small>© {new Date().getFullYear()} Remy</small></div><nav aria-label="Product links"><strong>Product</strong><a href={webApp}>Open Remy</a><a href="/docs/#installation">Set up a computer</a><a href="/#features">Features</a><a href="/changelog/">Changelog</a></nav><nav aria-label="Learn links"><strong>Learn</strong><a href="/docs/#web">Use the web app</a><a href="/docs/#installation">Installation</a><a href="/docs/#providers">Provider setup</a></nav><nav aria-label="Community links"><strong>In the open</strong><a href={repo}>GitHub ↗</a><a href={`${repo}/issues`}>Report an issue ↗</a><a href={`${repo}/blob/main/SECURITY.md`}>Security ↗</a></nav></footer>;
}
const Page = location.pathname.startsWith("/docs") ? Docs : location.pathname.startsWith("/changelog") ? Changelog : Home;
createRoot(document.getElementById("root")!).render(<TooltipProvider><a className="skip-link" href="#content">Skip to content</a><Navigation /><div id="content"><Page /></div><Footer /></TooltipProvider>);
