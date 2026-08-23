import { spawn } from "node:child_process";
import { query, type ModelInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  PROVIDERS,
  rememberProviderModels,
  type Provider,
  type ProviderEffort,
  type ProviderId,
  type ProviderModel,
} from "./providers.js";

const DISCOVERY_TIMEOUT_MS = 10_000;
let cached: Promise<Provider[]> | undefined;

function titlePart(part: string): string {
  if (/^gpt$/i.test(part)) return "GPT";
  return part ? part[0].toUpperCase() + part.slice(1) : part;
}

function effortLabel(value: string): string {
  if (value === "xhigh") return "Extra high";
  return titlePart(value);
}

function efforts(values: readonly string[], descriptions?: Map<string, string>): ProviderEffort[] {
  return values.map((value) => ({
    value,
    label: effortLabel(value),
    ...(descriptions?.get(value) ? { detail: descriptions.get(value) } : {}),
  }));
}

function claudeName(model: ModelInfo): string {
  const raw = model.resolvedModel || model.value;
  const clean = raw
    .replace(/\[.*\]$/, "")
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-(\d+)-(\d+)$/, "-$1.$2");
  return clean.split("-").map(titlePart).join(" ");
}

function claudeContext(model: ModelInfo): string | undefined {
  const text = `${model.value} ${model.resolvedModel ?? ""} ${model.displayName} ${model.description}`;
  if (/\b1m\b|1M context/i.test(text)) return "1M";
  if (/\b200k\b|200K context/i.test(text)) return "200K";
  if (/fable-5|opus-5/i.test(text)) return "1M";
  if (/sonnet-5|haiku-4-5/i.test(text)) return "200K";
  return undefined;
}

function claudeValue(model: ModelInfo): string {
  if (model.value === "default") return "";
  // Preserve Remy's existing alias while the SDK advertises its explicit 1M
  // spelling. Both resolve to the same installed model.
  if (model.value === "opus[1m]") return "opus";
  return model.value;
}

export function claudeModels(models: ModelInfo[]): ProviderModel[] {
  return models.map((model) => {
    const name = claudeName(model);
    const context = claudeContext(model);
    const supported = efforts(model.supportedEffortLevels ?? []);
    if (model.value === "default") {
      return {
        value: "",
        label: "Default",
        resolvedLabel: context ? `${name} (${context})` : name,
        ...(supported.length ? { efforts: supported } : {}),
      };
    }
    return {
      value: claudeValue(model),
      label: name,
      ...(context ? { context } : {}),
      detail: model.description,
      ...(supported.length ? { efforts: supported } : {}),
    };
  });
}

async function discoverClaude(): Promise<ProviderModel[]> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), DISCOVERY_TIMEOUT_MS);
  timer.unref?.();
  const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>((resolve) => abortController.signal.addEventListener("abort", () => resolve(), { once: true }));
  })();
  const handle = query({
    prompt,
    options: {
      abortController,
      cwd: process.cwd(),
      settingSources: ["user", "project", "local"],
    },
  });
  try {
    return claudeModels(await handle.supportedModels());
  } finally {
    clearTimeout(timer);
    abortController.abort();
    handle.close();
  }
}

interface CodexModel {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  description?: unknown;
  hidden?: unknown;
  isDefault?: unknown;
  defaultReasoningEffort?: unknown;
  supportedReasoningEfforts?: unknown;
}

function codexEfforts(value: unknown): ProviderEffort[] {
  if (!Array.isArray(value)) return [];
  const descriptions = new Map<string, string>();
  const values = value.flatMap((row): string[] => {
    if (!row || typeof row !== "object") return [];
    const effort = (row as { reasoningEffort?: unknown }).reasoningEffort;
    if (typeof effort !== "string" || !effort) return [];
    const description = (row as { description?: unknown }).description;
    if (typeof description === "string" && description) descriptions.set(effort, description);
    return [effort];
  });
  return efforts(values, descriptions);
}

function codexLabel(value: string, displayName: unknown): string {
  const raw = typeof displayName === "string" && displayName.trim() ? displayName : value;
  return raw
    .replace(/GPT-(\d+(?:\.\d+)?)-(Sol|Terra|Luna)/i, "GPT-$1 $2")
    .replace(/GPT-(\d+(?:\.\d+)?)-Mini/i, "GPT-$1 Mini")
    .replace(/GPT-(\d+(?:\.\d+)?)-Codex-Spark/i, "GPT-$1 Codex Spark");
}

export function codexModels(input: unknown): ProviderModel[] {
  const rows = Array.isArray(input) ? input as CodexModel[] : [];
  const models = rows.flatMap((row): ProviderModel[] => {
    const value = typeof row.model === "string" ? row.model : typeof row.id === "string" ? row.id : "";
    if (!value || row.hidden === true) return [];
    const supported = codexEfforts(row.supportedReasoningEfforts);
    return [{
      value,
      label: codexLabel(value, row.displayName),
      ...(typeof row.description === "string" ? { detail: row.description } : {}),
      ...(supported.length ? { efforts: supported } : {}),
      ...(typeof row.defaultReasoningEffort === "string" ? { defaultEffort: row.defaultReasoningEffort } : {}),
    }];
  });
  const defaultModel = rows.find((row) => row.isDefault === true);
  const defaultValue = typeof defaultModel?.model === "string" ? defaultModel.model : undefined;
  const defaultSupported = codexEfforts(defaultModel?.supportedReasoningEfforts);
  return [
    {
      value: "",
      label: "Default",
      ...(defaultValue ? { resolvedLabel: codexLabel(defaultValue, defaultModel?.displayName) } : {}),
      ...(defaultSupported.length ? { efforts: defaultSupported } : {}),
      ...(typeof defaultModel?.defaultReasoningEffort === "string"
        ? { defaultEffort: defaultModel.defaultReasoningEffort }
        : {}),
    },
    ...models,
  ];
}

async function discoverCodex(): Promise<ProviderModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let settled = false;
    const finish = (error?: Error, models?: ProviderModel[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(models ?? []);
    };
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timer = setTimeout(() => finish(new Error("Codex model discovery timed out.")), DISCOVERY_TIMEOUT_MS);
    timer.unref?.();
    child.on("error", (error) => finish(error));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      let newline = stdout.indexOf("\n");
      while (newline >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        try {
          const message = JSON.parse(line) as { id?: number; result?: { data?: unknown } };
          if (message.id === 1) {
            send({ method: "initialized" });
            send({ id: 2, method: "model/list", params: {} });
          } else if (message.id === 2) {
            finish(undefined, codexModels(message.result?.data));
          }
        } catch {
          // App-server notifications not belonging to this request are ignored.
        }
        newline = stdout.indexOf("\n");
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "remy", title: "Remy", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function cursorContext(label: string): string | undefined {
  return /\b(\d+(?:\.\d+)?[KM])\b/i.exec(label)?.[1]?.toUpperCase();
}

export function cursorModels(listOutput: string, aboutOutput = ""): ProviderModel[] {
  const resolvedLabel = /^Model\s+(.+)$/im.exec(aboutOutput)?.[1]?.trim();
  const models = listOutput.split("\n").flatMap((line): ProviderModel[] => {
    const match = /^\s*(\S+)\s+-\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    const [, value, rawLabel] = match;
    const raw = rawLabel.replace(/\s*\((?:current,\s*)?default\)\s*$/i, "").trim();
    const context = cursorContext(raw);
    const label = context ? raw.replace(new RegExp(`\\s+${context}\\b`, "i"), "").trim() : raw;
    return [{ value, label, ...(context ? { context } : {}) }];
  });
  return [
    { value: "", label: "Default", ...(resolvedLabel ? { resolvedLabel } : {}) },
    ...models,
  ];
}

function cursorOutput(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("agent", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), DISCOVERY_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Cursor exited ${code ?? "before discovery completed"}.`));
    });
  });
}

async function discoverCursor(): Promise<ProviderModel[]> {
  const [list, about] = await Promise.all([
    cursorOutput(["--list-models"]),
    cursorOutput(["about"]).catch(() => ""),
  ]);
  return cursorModels(list, about);
}

function mergeModels(discovered: ProviderModel[], fallback: ProviderModel[]): ProviderModel[] {
  const seen = new Set(discovered.map((model) => model.value));
  return [...discovered, ...fallback.filter((model) => !seen.has(model.value))];
}

async function discover(): Promise<Provider[]> {
  const runtime = await Promise.allSettled([discoverClaude(), discoverCodex(), discoverCursor()]);
  return PROVIDERS.map((provider) => {
    const index = provider.id === "claude" ? 0 : provider.id === "codex" ? 1 : 2;
    const result = runtime[index];
    const discovered = result?.status === "fulfilled" ? result.value : [];
    const models = mergeModels(discovered, provider.models);
    rememberProviderModels(provider.id, models);
    return { ...provider, models };
  });
}

/// The installed CLIs are the model authority. The promise is cached because
/// both probes start a local subprocess and their answer changes only when the
/// daemon restarts after a CLI update.
export function discoveredProviders(): Promise<Provider[]> {
  cached ??= discover();
  return cached;
}
