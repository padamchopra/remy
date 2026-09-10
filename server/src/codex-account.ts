import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { HostedCodexAccount } from "@remy/contract";

export type CodexAccountState = HostedCodexAccount;
type Rpc = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
};

/// Codex owns credentials and refresh; Remy exposes only account status and the device-code ceremony.
export class CodexAccount {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private nextId = 0;
  private requests = new Map<
    number,
    {
      resolve: (result: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private loginId?: string;
  private revision = 0;
  private expiry?: ReturnType<typeof setTimeout>;
  private state: CodexAccountState;
  private mutation?: Promise<CodexAccountState>;
  constructor(
    private readonly options: {
      command: string;
      args?: string[];
      env: NodeJS.ProcessEnv;
      cwd: string;
      changed: () => void;
      connected: (connected: boolean) => void | Promise<void>;
      timeoutMs?: number;
      loginTimeoutMs?: number;
    },
  ) {
    this.state = {
      phase: "signedOut",
      apiKeyConfigured: !!options.env.OPENAI_API_KEY,
    };
  }
  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const child = spawn(
      this.options.command,
      this.options.args ?? [
        "app-server",
        "--stdio",
        "-c",
        'model_provider="openai"',
        "-c",
        'cli_auth_credentials_store="file"',
      ],
      {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    child.stderr.resume();
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
      "line",
      (line) => {
        if (this.child !== child) return;
        let message: Rpc;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.id !== undefined) {
          const pending = this.requests.get(message.id);
          if (!pending) return;
          this.requests.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error)
            pending.reject(
              new Error(
                "Codex could not complete sign-in; enable device code login in ChatGPT settings and try again.",
              ),
            );
          else pending.resolve(message.result ?? {});
        } else if (
          message.method === "account/login/completed" &&
          message.params?.loginId === this.loginId &&
          this.loginId
        ) {
          this.loginId = undefined;
          clearTimeout(this.expiry);
          if (message.params?.success === true)
            void this.readAccount().catch(() => this.failed());
          else this.failed();
        } else if (message.method === "account/updated" && !this.loginId &&
          (message.params?.authMode === "chatgpt") !== (this.state.phase === "connected")) {
          void this.readAccount().catch(() => this.failed());
        }
      },
    );
    const failed = () => {
      if (this.child === child) {
        this.close();
        this.failed();
      }
    };
    child.once("error", failed);
    child.once("exit", failed);
    this.ready = this.request("initialize", {
      clientInfo: { name: "remy", version: "0.1.0" },
      capabilities: {},
    }).then(() => {
      child.stdin.write(
        JSON.stringify({ method: "initialized", params: {} }) + "\n",
      );
    }).catch(error => {
      if (this.child === child) this.close();
      throw error;
    });
    return this.ready;
  }
  private request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin.writable) {
        reject(new Error("Codex is unavailable; try again."));
        return;
      }
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("Codex did not answer; try again."));
      }, this.options.timeoutMs ?? 20_000);
      timer.unref();
      this.requests.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  private failed() {
    this.publish({
      phase: "error",
      apiKeyConfigured: this.state.apiKeyConfigured,
      error: "Codex sign-in ended; try connecting again.",
    });
  }
  private publish(state: CodexAccountState) {
    const changed = JSON.stringify(this.state) !== JSON.stringify(state);
    this.state = state;
    if (changed) this.options.changed();
  }
  private async readAccount(): Promise<CodexAccountState> {
    const revision = this.revision;
    const result = await this.request("account/read", { refreshToken: true });
    if (revision !== this.revision || this.loginId) return { ...this.state };
    const account = result.account as { type?: string; email?: string } | null;
    const connected = account?.type === "chatgpt";
    await this.options.connected(connected);
    this.publish({
      phase: connected ? "connected" : "signedOut",
      apiKeyConfigured: this.state.apiKeyConfigured,
      ...(connected && typeof account?.email === "string"
        ? { email: account.email.slice(0, 160) }
        : {}),
    });
    return { ...this.state };
  }
  async status(): Promise<CodexAccountState> {
    const restarting = !this.ready;
    await this.start();
    await this.mutation?.catch(() => undefined);
    if (this.loginId || (!restarting && this.state.phase === "error")) return { ...this.state };
    return this.readAccount();
  }
  async change(
    action: "start" | "cancel" | "logout",
  ): Promise<CodexAccountState> {
    const previous = this.mutation;
    const work = (async () => {
      await previous?.catch(() => undefined);
      try { return await this.perform(action); }
      catch (error) { this.close(); this.failed(); throw error; }
    })();
    this.mutation = work;
    try {
      return await work;
    } finally {
      if (this.mutation === work) this.mutation = undefined;
    }
  }
  private async perform(
    action: "start" | "cancel" | "logout",
  ): Promise<CodexAccountState> {
    this.revision++;
    await this.start();
    if (action === "start" && this.loginId) return { ...this.state };
    if (this.loginId) {
      await this.request("account/login/cancel", { loginId: this.loginId });
      this.loginId = undefined;
      clearTimeout(this.expiry);
    }
    if (action === "logout") await this.request("account/logout");
    if (action !== "start") return this.readAccount();
    const result = await this.request("account/login/start", {
      type: "chatgptDeviceCode",
    });
    if (
      result.type !== "chatgptDeviceCode" ||
      typeof result.loginId !== "string" ||
      typeof result.userCode !== "string" ||
      result.userCode.length > 64 ||
      result.verificationUrl !== "https://auth.openai.com/codex/device"
    ) {
      this.close();
      throw new Error("Update Codex to use device code sign-in.");
    }
    this.loginId = result.loginId;
    this.state = {
      phase: "pending",
      apiKeyConfigured: this.state.apiKeyConfigured,
      userCode: result.userCode,
      verificationUrl: result.verificationUrl,
    };
    this.expiry = setTimeout(
      () => {
        void this.change("cancel")
          .then(() => this.failed())
          .catch(() => {
            this.close();
            this.failed();
          });
      },
      this.options.loginTimeoutMs ?? 15 * 60_000,
    );
    this.expiry.unref();
    this.options.changed();
    return { ...this.state };
  }
  close() {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    this.loginId = undefined;
    clearTimeout(this.expiry);
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex disconnected; try again."));
    }
    this.requests.clear();
    child?.kill();
  }
}
