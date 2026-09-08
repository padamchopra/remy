import type { HostedComputerState, HostedSettings } from "@remy/contract";
import type { BoardStorage } from "./organization-board.js";
import type {
  ComputerRuntime,
  ComputerRuntimeProvider,
  ProvisionComputerInput,
} from "./computer-runtime.js";
type State = HostedComputerState & {
  runtime?: ComputerRuntime;
  settings: HostedSettings;
  meteredAt: number;
  active: boolean;
  promptAt?: number;
  sources: {
    at: number;
    provider: string;
    reference: string;
    phase: string;
    elapsedMs: number;
    snapshotBytes: number;
  }[];
};
export class HostedLifecycle {
  private readonly running = new Map<string, Promise<unknown>>();
  constructor(
    private readonly storage: BoardStorage,
    private readonly provider: (id: string) => ComputerRuntimeProvider,
    private readonly prepare: (state: State) => Promise<ProvisionComputerInput>,
    private readonly ready: (computerId: string) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly connected: (id: string) => boolean = () => true,
  ) {}
  private key(workspace: string) {
    return `hosted:${workspace}`;
  }
  async list() {
    return [
      ...(await this.storage.list<State>({ prefix: "hosted:" })).values(),
    ];
  }
  async get(workspace: string) {
    return this.storage.get<State>(this.key(workspace));
  }
  private async save(state: State) {
    await this.storage.put(this.key(state.workspaceId), state);
    return state;
  }
  private async meter(state: State) {
    const at = this.now(),
      elapsed = Math.max(0, at - state.meteredAt);
    if (state.phase === "ready" || state.phase === "checkpointing")
      state.usage[state.active ? "activeMs" : "warmIdleMs"] += elapsed;
    state.usage.snapshotByteMs += (state.runtime?.snapshotBytes ?? 0) * elapsed;
    if (elapsed) {
      const source = {
        at,
        provider: state.provider,
        reference: state.runtime?.providerReference ?? state.computerId,
        phase: state.phase,
        elapsedMs: elapsed,
        snapshotBytes: state.runtime?.snapshotBytes ?? 0,
      };
      state.sources.push(source);
      await this.storage.put(
        `hosted-usage:${state.computerId}:${at}:${crypto.randomUUID()}`,
        source,
      );
    }
    state.sources = state.sources.slice(-1000);
    state.meteredAt = at;
  }
  private async serial<T>(
    workspace: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.running.get(workspace);
    const work = (async () => {
      await previous?.catch(() => undefined);
      return action();
    })();
    this.running.set(workspace, work);
    try {
      return await work;
    } finally {
      if (this.running.get(workspace) === work) this.running.delete(workspace);
    }
  }
  async ensure(workspaceId: string, settings: HostedSettings): Promise<State> {
    return this.serial(workspaceId, () => this.wake(workspaceId, settings));
  }
  private async wake(
    workspaceId: string,
    settings: HostedSettings,
  ): Promise<State> {
    if (!settings.enabled)
      throw new Error("Enable hosted computers for this workspace.");
    const started = this.now();
    const state =
      (await this.get(workspaceId)) ??
      ({
        workspaceId,
        computerId: crypto.randomUUID(),
        provider: settings.provider,
        phase: "allocating",
        lastUsedAt: started,
        meteredAt: started,
        active: false,
        settings,
        usage: { activeMs: 0, warmIdleMs: 0, snapshotByteMs: 0 },
        timing: {},
        sources: [],
      } satisfies State);
    await this.meter(state);
    state.lastUsedAt = started;
    if (state.provider !== settings.provider)
      throw new Error(
        "Remove the hosted computer before changing its provider.",
      );
    state.settings = settings;
    if (state.phase === "ready" && this.connected(state.computerId)) {
      state.timing.warmRequestMs = this.now() - started;
      return this.save(state);
    }
    state.phase = state.runtime?.snapshot ? "restoring" : "allocating";
    delete state.error;
    await this.save(state);
    try {
      const input = await this.prepare(state),
        provider = this.provider(state.provider),
        allocating = this.now();
      state.runtime = state.runtime
        ? await provider.start(state.runtime, input)
        : await provider.provision(input);
      state.timing[state.phase === "restoring" ? "restoreMs" : "allocationMs"] =
        this.now() - allocating;
      await this.save(state);
      const waiting = this.now();
      await this.ready(state.computerId);
      state.timing.readyMs = this.now() - waiting;
      state.phase = "ready";
      state.meteredAt = this.now();
      return await this.save(state);
    } catch {
      state.phase = "failed";
      state.error = "This hosted computer could not start; try again.";
      await this.save(state);
      throw new Error(state.error);
    }
  }
  async activity(computerId: string, active: boolean, usefulResponse = false) {
    let state = (await this.list()).find((s) => s.computerId === computerId);
    if (!state) return;
    return this.serial(state.workspaceId, async () => {
      state = await this.get(state!.workspaceId);
      if (!state) return;
      await this.meter(state);
      if (active && !state.active) state.promptAt = this.now();
      state.active = active;
      if (active) state.lastUsedAt = this.now();
      if (usefulResponse && state.timing.firstResponseMs === undefined)
        state.timing.firstResponseMs =
          this.now() - (state.promptAt ?? state.lastUsedAt);
      await this.save(state);
    });
  }
  async remove(computerId: string) {
    let state = (await this.list()).find((s) => s.computerId === computerId);
    if (!state) return;
    return this.serial(state.workspaceId, async () => {
      state = await this.get(state!.workspaceId);
      if (!state) return;
      await this.provider(state.provider).destroy(
        state.runtime ?? {
          id: computerId,
          provider: state.provider,
          providerReference: "",
        },
      );
      await this.storage.delete(this.key(state.workspaceId));
      await this.storage.delete(`hosted-key:${computerId}`);
    });
  }
  async idle() {
    for (const entry of await this.list()) {
      await this.serial(entry.workspaceId, async () => {
        const state = await this.get(entry.workspaceId);
        if (!state) return;
        await this.meter(state);
        const rotate =
          state.provider === "modal" &&
          !!state.runtime &&
          this.now() - (state.runtime.startedAt ?? 0) >= 23 * 60 * 60_000;
        if (
          state.phase !== "ready" ||
          !state.runtime ||
          (!rotate &&
            (state.active ||
              this.now() - state.lastUsedAt <
                state.settings.idleMinutes * 60_000))
        ) {
          await this.save(state);
          return;
        }
        {
          state.phase = "checkpointing";
          await this.save(state);
          try {
            const provider = this.provider(state.provider);
            const previous = state.runtime!.snapshot;
            state.runtime = await provider.checkpoint(state.runtime!);
            await this.save(state);
            if (previous && previous !== state.runtime.snapshot) {
              await this.storage.put(
                `hosted-gc:${state.computerId}:${previous}`,
                { ...state.runtime, snapshot: previous },
              );
            }
            await provider.stop(state.runtime);
            await this.meter(state);
            state.phase = "asleep";
            state.meteredAt = this.now();
          } catch {
            state.phase = "failed";
            state.error =
              "This computer could not save its checkpoint; try restoring it.";
          }
          await this.save(state);
          if (rotate && state.phase === "asleep") {
            try {
              return await this.wake(state.workspaceId, state.settings);
            } catch {
              return;
            }
          }
          return state;
        }
      });
    }
    for (const [key, runtime] of await this.storage.list<ComputerRuntime>({
      prefix: "hosted-gc:",
    })) {
      try {
        const provider = this.provider(runtime.provider);
        if (provider.prune) {
          await provider.prune(runtime);
          await this.storage.delete(key);
        }
      } catch {}
    }
  }
}
