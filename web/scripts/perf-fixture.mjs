export const PERFORMANCE_BUDGETS = Object.freeze({
  warmUsefulMs: 150,
  coldUsefulMs: 500,
  cachedThreadMs: 100,
  livePaintP95Ms: 50,
  minimumFrameRate: 60,
  idleCpuPercent: 1,
  unavailableDelayMs: 50,
});

const DEFAULT_SETTINGS = Object.freeze({
  preventSleep: "off",
  defaultCheckout: "worktree",
  worktreeBase: "remote",
  worktreeRoot: "",
  defaultProvider: "claude",
  defaultModel: "",
  defaultEffort: "",
  defaultPermissionMode: "auto",
  remyProvider: "claude",
  remyModel: "off",
  remyEffort: "",
  favoriteModels: [],
  repoUpdate: "off",
  pullRequestMonitoringEnabled: false,
  pullRequestMonitoringAgentId: "",
  worktreeBranchPrefix: "",
  avatar: "",
  deviceName: "Performance fixture",
  deviceIcon: "laptop",
  deviceTint: "",
  devicePreferenceOrder: [],
  tailscaleServeEnabled: false,
  defaultGitIdentity: "off",
});

function entries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index === count - 1 ? "live-entry" : `entry-${index + 1}`,
    kind: index % 2 === 0 ? "user" : "assistant",
    at: 1_700_000_000_000 + index,
    text: index === count - 1
      ? `Fixture entry ${index + 1}. Initial live response.`
      : `Fixture entry ${index + 1}. This deterministic text gives every transcript row a realistic line length.`,
  }));
}

function chats(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `thread-${index + 1}`,
    title: `Performance thread ${index + 1}`,
    cwd: "/tmp/remy-performance",
    state: "idle",
    provider: "claude",
    model: "fixture-model",
    preview: `Fixture entry for thread ${index + 1}`,
    updatedAt: 1_700_000_000_000 - index,
  }));
}

function agents(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `agent-${index + 1}`,
    name: `Performance agent ${index + 1}`,
    handle: `performance-${index + 1}`,
    role: `Fixture agent ${index + 1}`,
    instructions: "Exercise Inbox rendering.",
    provider: "claude",
    model: "fixture-model",
    permissionMode: "auto",
    autoStart: false,
    handoffTo: [],
    gitIdentity: "off",
  }));
}

function dms(roster) {
  return roster.map((agent, index) => ({
    id: `dm-${index + 1}`,
    title: agent.name,
    cwd: "~",
    state: "idle",
    provider: "claude",
    agentId: agent.id,
    model: "fixture-model",
    preview: `Fixture conversation ${index + 1}`,
    updatedAt: 1_700_000_000_000 - index,
    dm: true,
  }));
}

export function createFixture({
  threadCount = 25,
  entryCount = 100,
  agentCount = 0,
  unavailableDevice = false,
  serverId = "local",
} = {}) {
  const listedChats = chats(threadCount);
  const listedAgents = agents(agentCount);
  const listedDms = dms(listedAgents);
  const primary = listedChats[0];
  const detail = {
    ...primary,
    permissionMode: "auto",
    entries: entries(entryCount),
    todos: [],
    live: true,
  };
  const workspace = {
    id: "workspace-1",
    name: "Performance workspace",
    path: "/tmp/remy-performance",
    origin: "github.com/example/remy-performance",
    worktrees: [{
      path: "/tmp/remy-performance",
      branch: "main",
      isMain: true,
      dirty: false,
    }],
  };
  const peer = {
    id: "unavailable-device",
    name: "Unavailable device",
    url: "https://unavailable-device.invalid",
    icon: "laptop",
    online: false,
  };

  return {
    threadCount,
    entryCount,
    unavailableDevice,
    serverId,
    primaryThreadId: primary.id,
    primaryTitle: primary.title,
    lastEntryText: detail.entries.at(-1).text,
    primaryDmId: listedDms[0]?.id,
    primaryAgentHandle: listedAgents[0]?.handle,
    servers: [{ id: serverId, name: "Performance fixture", url: "fixture://local", builtin: serverId === "local" }],
    responses: {
      "/peers": { name: "Performance fixture", peers: unavailableDevice ? [peer] : [] },
      "/cursor-cloud/status": {},
      "/chats": { chats: listedChats, dms: listedDms },
      "/archives": { archives: [] },
      "/workspaces": { workspaces: [workspace] },
      "/board": {
        deviceId: "local",
        projects: [{
          id: "project-1",
          name: "Performance workspace",
          keyPrefix: "PERF",
          workspaceIds: [workspace.id],
        }],
        agents: listedAgents,
        tickets: [],
        routines: [],
      },
      "/server/settings": DEFAULT_SETTINGS,
      "/server/identity": {
        deviceId: "local",
        name: "Performance fixture",
        icon: "laptop",
        configured: { name: true, icon: true, tint: true },
        url: "https://performance-fixture.invalid",
        token: "fixture-token",
        exposed: false,
        tailnet: "running",
        tailnetHost: "performance-fixture",
      },
      "/server/providers": { providers: [] },
      "/pair/pending": { requests: [] },
      "/pull-requests": { pullRequests: [] },
      [`/chats/${primary.id}`]: detail,
      ...Object.fromEntries(listedDms.map((dm) => [`/chats/${dm.id}`, {
        ...dm,
        permissionMode: "auto",
        entries: entries(entryCount),
        todos: [],
        live: true,
      }])),
    },
  };
}

/// Installed before the app module runs so a file-loaded web bundle exercises
/// the same Electron transport without opening a daemon or touching its data.
export function installPerformanceBridge(fixture) {
  const requests = [];
  const pushHandlers = new Set();
  const statusHandlers = new Set();
  const encoder = new TextEncoder();
  const longTasks = [];
  const renders = [];
  let connected = true;

  window.__remyRenderProbe = (surface, id) => {
    renders.push({ surface, id, at: performance.now() });
  };

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Chromium versions without Long Tasks still report an empty collection.
    }
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function measured(method, path, response, options = {}) {
    const start = performance.now();
    const delay = options.delay ?? 4;
    if (delay > 0) await wait(delay);
    const end = performance.now();
    const bytes = response === undefined ? 0 : encoder.encode(JSON.stringify(response)).byteLength;
    requests.push({ method, path, start, end, duration: end - start, bytes, ok: options.ok !== false });
    return options.ok === false
      ? { ok: false, error: options.error ?? "Unavailable device" }
      : { ok: true, data: response };
  }

  const fixtureResponse = (path) => {
    if (path.startsWith("/pull-requests?")) return fixture.responses["/pull-requests"];
    return fixture.responses[path] ?? {};
  };

  window.__remyPerf = {
    requests,
    longTasks,
    renders,
    fixture,
    resetMeasurements() {
      requests.length = 0;
      longTasks.length = 0;
      renders.length = 0;
    },
    emit(payload, serverId = fixture.serverId) {
      if (!connected) return false;
      for (const handler of pushHandlers) handler(serverId, payload);
      return true;
    },
    disconnect(serverId = fixture.serverId) {
      connected = false;
      for (const handler of statusHandlers) handler(serverId, false, "Performance fixture disconnected");
    },
    reconnect(serverId = fixture.serverId) {
      connected = true;
      for (const handler of statusHandlers) handler(serverId, true);
      for (const handler of pushHandlers) handler(serverId, { type: "hello" });
    },
  };

  window.remy = {
    platform: "darwin",
    arch: "arm64",
    version: "0.1.0",
    info: async () => ({ version: "0.1.0", name: "Performance fixture", packaged: true }),
    servers: async () => {
      const answer = await measured("GET", "electron://servers", fixture.servers);
      return answer.data;
    },
    async request(serverId, path, init = {}) {
      const method = init.method ?? "GET";
      if (serverId === "local" && path.startsWith("/peers/unavailable-device/api/")) {
        return measured(method, path, undefined, {
          delay: 1_200,
          ok: false,
          error: "Unavailable device",
        });
      }
      return measured(method, path, fixtureResponse(path));
    },
    async upload(_serverId, path) {
      return measured("POST", path, undefined, { ok: false, error: "The performance harness is read-only." });
    },
    onPush(handler) {
      pushHandlers.add(handler);
      queueMicrotask(() => handler(fixture.serverId, { type: "hello" }));
      return () => pushHandlers.delete(handler);
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      queueMicrotask(() => handler(fixture.serverId, connected));
      return () => statusHandlers.delete(handler);
    },
    async removeServer() {
      throw new Error("The performance harness is read-only.");
    },
    async updateServer() {
      throw new Error("The performance harness is read-only.");
    },
  };
}

export function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1);
  return ordered[index];
}

export function groupRequests(requests) {
  const grouped = new Map();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    const current = grouped.get(key) ?? { method: request.method, path: request.path, count: 0, durationMs: 0, bytes: 0 };
    current.count += 1;
    current.durationMs += request.duration;
    current.bytes += request.bytes;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function budgetFailures(result, budgets = PERFORMANCE_BUDGETS) {
  const failures = [];
  const over = (value, limit, label) => {
    if (value > limit) failures.push(`${label}: ${value.toFixed(1)} ms > ${limit} ms`);
  };
  const under = (value, limit, label) => {
    if (value < limit) failures.push(`${label}: ${value.toFixed(1)} fps < ${limit} fps`);
  };

  if (result.scenario === "cold-open" && result.entryCount === 100 && !result.unavailableDevice) {
    over(result.firstUsefulPaintMs, budgets.coldUsefulMs, "cold useful paint");
  }
  if (result.scenario === "warm-open") {
    over(result.firstUsefulPaintMs, budgets.warmUsefulMs, "warm useful paint");
  }
  if (result.scenario === "cached-thread") {
    over(result.firstUsefulPaintMs, budgets.cachedThreadMs, "cached thread");
  }
  if (result.scenario === "live-update") {
    over(result.firstLivePaintP95Ms, budgets.livePaintP95Ms, "live update p95");
  }
  if (result.scenario?.startsWith("render-isolation-")) {
    if (result.affectedRowRenders < 1) failures.push("affected row did not render");
    if (result.unrelatedRowRenders > 0) {
      failures.push(`render isolation: ${result.unrelatedRowRenders} unrelated row renders`);
    }
    if (result.orderChanged) failures.push("live update changed thread order");
  }
  if (result.scenario === "reconnect") {
    over(result.firstLivePaintP95Ms, budgets.livePaintP95Ms, "reconnect live paint");
  }
  if (result.scenario === "sidebar" && result.threadCount === 250) {
    if (result.frameRate + 0.5 < budgets.minimumFrameRate) {
      under(result.frameRate, budgets.minimumFrameRate, "250-thread sidebar");
    }
  }
  if (result.scenario === "thread-scroll" && result.entryCount === 500) {
    if (result.frameRate + 0.5 < budgets.minimumFrameRate) {
      under(result.frameRate, budgets.minimumFrameRate, "500-entry thread");
    }
  }
  if (result.scenario === "idle") {
    if (result.idleCpuPercent > budgets.idleCpuPercent) {
      failures.push(`idle CPU: ${result.idleCpuPercent.toFixed(2)}% > ${budgets.idleCpuPercent}%`);
    }
  }
  if (result.scenario === "unavailable-device") {
    over(result.firstUsefulPaintMs, budgets.coldUsefulMs, "unavailable-device useful paint");
    if (result.delayFromLocalMs > budgets.unavailableDelayMs) {
      failures.push(`unavailable-device delay: ${result.delayFromLocalMs.toFixed(1)} ms > ${budgets.unavailableDelayMs} ms`);
    }
  }
  if (result.neverPainted) failures.push("useful content never painted");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join("; ")}`);
  if (result.mutatingRequests?.length) failures.push(`read-only guard: ${result.mutatingRequests.join(", ")}`);
  return failures;
}
