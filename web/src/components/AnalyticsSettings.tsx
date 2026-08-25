import { ProviderMark } from "@/components/ProviderMark";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { deviceIcon } from "@/lib/devices";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";
import type { Server } from "@/state/types";
import { Activity, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

export type AnalyticsTab = "general" | "usage";
type UsageMetric = "tokens" | "money";

interface AnalyticsUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  pricedTokens: number;
  costUsd: number;
  currentContextTokens: number;
  peakContextTokens: number;
  contextLimitTokens: number;
  contextSessions: number;
}

interface AnalyticsSource {
  provider: string;
  status: "ok" | "missing" | "unsupported" | "partial" | "limited";
  scannedFiles: number;
  skippedFiles: number;
  sessions: number;
  message?: string;
}

interface AnalyticsReport {
  from: number;
  to: number;
  timeZone: string;
  totals: AnalyticsUsage & {
    threads: number;
    turns: number;
    toolCalls: number;
    skillInvocations: number;
    usageSessions: number;
  };
  daily: Array<AnalyticsUsage & { date: string; toolCalls: number; skillInvocations: number }>;
  tools: Array<{ name: string; count: number }>;
  skills: Array<{ name: string; count: number }>;
  providers: Array<AnalyticsUsage & { provider: string; sessions: number }>;
  models: Array<AnalyticsUsage & { provider: string; model: string; sessions: number }>;
  sources: AnalyticsSource[];
  pricing: { status: "fresh" | "cached" | "unavailable"; knownModels: number; fetchedAt?: number };
  scanDurationMs: number;
}

interface DeviceAnalytics {
  server: Server;
  report?: AnalyticsReport;
  error?: string;
}

const generalChart = {
  toolCalls: { label: "Tool calls", color: "var(--chart-1)" },
  skillInvocations: { label: "Skill invocations", color: "var(--chart-2)" },
} satisfies ChartConfig;

const usageChart = {
  totalTokens: { label: "Processed tokens", color: "var(--chart-1)" },
  costUsd: { label: "API-equivalent cost", color: "var(--chart-2)" },
} satisfies ChartConfig;

const RANGE_OPTIONS = [7, 30, 90] as const;

export function AnalyticsSettings({ tab, onTab }: { tab: AnalyticsTab; onTab: (tab: AnalyticsTab) => void }) {
  const servers = useStore((state) => state.servers);
  const analyticsServers = useMemo(() => servers.filter((server) => !server.workspaceOnly), [servers]);
  const [days, setDays] = useState(30);
  const [deviceId, setDeviceId] = useState("all");
  const [answers, setAnswers] = useState<DeviceAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const serverKey = analyticsServers.map((server) => `${server.id}:${server.online}`).join("|");

  const load = useCallback(async () => {
    setLoading(true);
    const next = await Promise.all(analyticsServers.map(async (server): Promise<DeviceAnalytics> => {
      if (!server.online) return { server, error: "This device is unavailable." };
      try {
        const report = await transport.request<AnalyticsReport>(
          server.id,
          `/analytics?days=${days}&timeZone=${encodeURIComponent(timeZone)}`,
        );
        return { server, report: normalizeReport(report) };
      } catch {
        return { server, error: "This device couldn't report analytics." };
      }
    }));
    setAnswers(next);
    setLoading(false);
  }, [analyticsServers, days, timeZone]);

  useEffect(() => {
    void load();
  }, [load, serverKey]);

  useEffect(() => {
    if (deviceId !== "all" && !analyticsServers.some((server) => server.id === deviceId)) setDeviceId("all");
  }, [analyticsServers, deviceId]);

  const visible = deviceId === "all" ? answers : answers.filter((answer) => answer.server.id === deviceId);
  const reports = visible.flatMap((answer) => answer.report ? [answer.report] : []);
  const unavailable = visible.filter((answer) => answer.error);
  const report = reports.length > 0 ? mergeReports(reports) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(value) => onTab(value as AnalyticsTab)}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger size="sm" aria-label="Analytics range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {RANGE_OPTIONS.map((range) => (
                  <SelectItem key={range} value={String(range)}>{range} days</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={deviceId} onValueChange={setDeviceId}>
            <SelectTrigger size="sm" aria-label="Analytics device" className="max-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All devices</SelectItem>
                {analyticsServers.map((server) => {
                  const Icon = deviceIcon(server.icon);
                  return (
                    <SelectItem key={server.id} value={server.id}>
                      <Icon className="size-4" />
                      {server.name}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button size="icon-sm" variant="outline" aria-label="Refresh analytics" onClick={() => void load()}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>

      {unavailable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="size-3.5 text-amber-500" />
          {unavailable.map(({ server }) => (
            <span key={server.id}>{server.name} is unavailable.</span>
          ))}
        </div>
      ) : null}

      {loading && reports.length === 0 ? (
        <AnalyticsSkeleton />
      ) : !report ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Activity /></EmptyMedia>
            <EmptyTitle>No analytics yet</EmptyTitle>
            <EmptyDescription>Run a thread and Remy will show its activity here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : tab === "general" ? (
        <GeneralAnalytics report={report} deviceCount={reports.length} />
      ) : (
        <UsageAnalytics report={report} />
      )}
    </div>
  );
}

function GeneralAnalytics({ report, deviceCount }: { report: AnalyticsReport; deviceCount: number }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Tool calls" value={formatNumber(report.totals.toolCalls)} detail={threadCount(report.totals.threads)} />
        <MetricCard label="Skill invocations" value={formatNumber(report.totals.skillInvocations)} detail={`${formatNumber(report.skills.length)} skills`} />
        <MetricCard label="Turns" value={formatNumber(report.totals.turns)} detail="Across this period" />
        <MetricCard label="Devices" value={formatNumber(deviceCount)} detail="Reporting together" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>Activity over time</CardTitle>
            <CardDescription>Tool calls and skill invocations by day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={generalChart} className="h-64 w-full">
              <BarChart accessibilityLayer data={report.daily}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} tickFormatter={formatDay} />
                <YAxis width={34} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="toolCalls" fill="var(--color-toolCalls)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="skillInvocations" fill="var(--color-skillInvocations)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Most used</CardTitle>
            <CardDescription>Your most frequent tools and skills.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <RankedList title="Tools" rows={report.tools.slice(0, 5)} empty="No tool calls" />
            <RankedList title="Skills" rows={report.skills.slice(0, 5)} empty="No skill invocations" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UsageAnalytics({ report }: { report: AnalyticsReport }) {
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  const totalInput = report.totals.inputTokens + report.totals.cachedInputTokens + report.totals.cacheCreationTokens;
  const cachedShare = totalInput > 0 ? report.totals.cachedInputTokens / totalInput : 0;
  const pricedShare = report.totals.totalTokens > 0 ? report.totals.pricedTokens / report.totals.totalTokens : 0;
  const money = metric === "money";
  const metricTotal = money ? report.totals.costUsd : report.totals.totalTokens;
  const dataKey = money ? "costUsd" : "totalTokens";
  const metricColor = money ? "var(--color-costUsd)" : "var(--color-totalTokens)";
  const gradientId = `usage-fill-${metric}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Processed tokens" value={formatCompact(report.totals.totalTokens)} detail={`${sessionCount(report.totals.usageSessions)} measured`} />
        <MetricCard label="Reported or estimated cost" value={formatMoney(report.totals.costUsd)} detail={`${formatPercent(pricedShare)} of processed tokens priced`} />
        <MetricCard label="Cached input" value={formatPercent(cachedShare)} detail={`${formatCompact(report.totals.cachedInputTokens)} tokens`} />
        <MetricCard
          label="Cursor context"
          value={report.totals.contextSessions ? `${formatCompact(report.totals.currentContextTokens)} / ${formatCompact(report.totals.contextLimitTokens)}` : "—"}
          detail={report.totals.contextSessions ? `${formatCompact(report.totals.peakContextTokens)} peak across ${sessionCount(report.totals.contextSessions)}` : "Starts with a Cursor thread"}
        />
      </div>

      <ProviderHistory sources={report.sources} />

      <Card>
        <CardHeader>
          <CardTitle>Usage over time</CardTitle>
          <CardDescription>{money ? "API-equivalent cost by day." : "Processed tokens by day."}</CardDescription>
          <CardAction>
            <ToggleGroup
              type="single"
              value={metric}
              onValueChange={(value) => { if (value) setMetric(value as UsageMetric); }}
              variant="outline"
              size="sm"
              aria-label="Usage metric"
            >
              <ToggleGroupItem value="tokens">Tokens</ToggleGroupItem>
              <ToggleGroupItem value="money">Money</ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <p className="text-4xl font-semibold tabular-nums">{money ? formatMoney(metricTotal) : formatCompact(metricTotal)}</p>
            <div className="flex flex-col gap-4">
              {report.providers.map((provider) => (
                <ProviderShare key={provider.provider} provider={provider} total={metricTotal} metric={metric} />
              ))}
            </div>
          </div>
          <ChartContainer config={usageChart} className="h-64 w-full">
            <AreaChart accessibilityLayer data={report.daily}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColor} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={metricColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} tickFormatter={formatDay} />
              <YAxis width={money ? 54 : 48} tickLine={false} axisLine={false} tickFormatter={money ? formatMoneyAxis : formatCompact} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => money ? formatMoney(Number(value)) : formatNumber(Number(value))} />} />
              <Area key={metric} type="monotone" dataKey={dataKey} stroke={metricColor} fill={`url(#${gradientId})`} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Cached input" value={formatCompact(report.totals.cachedInputTokens)} detail={`${formatPercent(cachedShare)} of input`} />
        <MetricCard label="Uncached input" value={formatCompact(report.totals.inputTokens)} detail={`${formatCompact(report.totals.cacheCreationTokens)} cache writes`} />
        <MetricCard label="Output" value={formatCompact(report.totals.outputTokens)} detail={`${formatCompact(report.totals.reasoningTokens)} reasoning`} />
        <MetricCard label="Sessions" value={formatNumber(report.totals.usageSessions)} detail="Across provider history" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Breakdown</CardTitle>
          <CardDescription>Usage by provider and model.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-normal">Model</th>
                <th className="py-2 text-right font-normal">Cost</th>
                <th className="py-2 text-right font-normal">Sessions</th>
                <th className="py-2 text-right font-normal">Tokens</th>
                <th className="py-2 text-right font-normal">Context</th>
              </tr>
            </thead>
            <tbody>
              {report.models.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">No measured usage in this period.</td>
                </tr>
              ) : report.models.map((model) => (
                <tr key={`${model.provider}:${model.model}`} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5">
                    <span className="flex items-center gap-2"><ProviderMark provider={model.provider} className="size-4" />{model.model}</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{formatMoney(model.costUsd)}</td>
                  <td className="py-2.5 text-right text-muted-foreground tabular-nums">{formatNumber(model.sessions)}</td>
                  <td className="py-2.5 text-right text-muted-foreground tabular-nums">{formatCompact(model.totalTokens)}</td>
                  <td className="py-2.5 text-right text-muted-foreground tabular-nums">
                    {model.contextSessions ? `${formatCompact(model.currentContextTokens)} / ${formatCompact(model.contextLimitTokens)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="gap-3 py-4 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
        <CardDescription className="text-2xl font-semibold text-foreground tabular-nums">{value}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function ProviderHistory({ sources }: { sources: AnalyticsSource[] }) {
  const limited = sources.some((source) => source.status === "limited");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider history</CardTitle>
        <CardDescription>
          {limited ? "Update every selected device to include all provider sessions." : "Usage includes sessions started anywhere on each selected device."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup className="grid gap-2 sm:grid-cols-3">
          {sources.map((source) => (
            <Item key={source.provider} variant="outline" size="sm">
              <ItemMedia variant="icon"><ProviderMark provider={source.provider} className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{providerLabel(source.provider)}</ItemTitle>
                <ItemDescription>{sourceDescription(source)}</ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

function ProviderShare({ provider, total, metric }: { provider: AnalyticsReport["providers"][number]; total: number; metric: UsageMetric }) {
  const money = metric === "money";
  const contextOnly = !money && provider.totalTokens === 0 && provider.contextSessions > 0;
  const value = money ? provider.costUsd : provider.totalTokens;
  const share = contextOnly
    ? provider.currentContextTokens / Math.max(provider.contextLimitTokens, 1)
    : total > 0 ? value / total : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2"><ProviderMark provider={provider.provider} className="size-4" />{providerLabel(provider.provider)}</span>
        <span className="tabular-nums">
          {contextOnly
            ? `${formatCompact(provider.currentContextTokens)} / ${formatCompact(provider.contextLimitTokens)}`
            : money ? formatMoney(value) : formatCompact(value)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${share > 0 ? Math.max(2, share * 100) : 0}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {contextOnly
          ? `${formatPercent(share)} full · ${formatCompact(provider.peakContextTokens)} peak context`
          : money
            ? `${formatPercent(share)} of cost · ${provider.contextSessions ? `${formatCompact(provider.currentContextTokens)} current context` : `${formatCompact(provider.totalTokens)} tokens`}`
            : `${formatPercent(share)} of tokens · ${formatMoney(provider.costUsd)}`}
      </p>
    </div>
  );
}

function RankedList({ title, rows, empty }: { title: string; rows: Array<{ name: string; count: number }>; empty: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {rows.length > 0 ? rows.map((row) => (
        <div key={row.name} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-mono text-xs">{row.name}</span>
          <span className="text-muted-foreground tabular-nums">{formatNumber(row.count)}</span>
        </div>
      )) : <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((value) => <Skeleton key={value} className="h-28" />)}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

function mergeReports(reports: AnalyticsReport[]): AnalyticsReport {
  const first = reports[0]!;
  const daily = new Map<string, AnalyticsReport["daily"][number]>();
  const tools = new Map<string, number>();
  const skills = new Map<string, number>();
  const providers = new Map<string, AnalyticsReport["providers"][number]>();
  const models = new Map<string, AnalyticsReport["models"][number]>();
  const sources = new Map<string, AnalyticsSource>();
  const totals = { ...emptyUsage(), threads: 0, turns: 0, toolCalls: 0, skillInvocations: 0, usageSessions: 0 };

  for (const report of reports) {
    addUsage(totals, report.totals);
    totals.threads += report.totals.threads;
    totals.turns += report.totals.turns;
    totals.toolCalls += report.totals.toolCalls;
    totals.skillInvocations += report.totals.skillInvocations;
    totals.usageSessions += report.totals.usageSessions;
    for (const row of report.daily) {
      const target = daily.get(row.date) ?? { ...emptyUsage(), date: row.date, toolCalls: 0, skillInvocations: 0 };
      addUsage(target, row);
      target.toolCalls += row.toolCalls;
      target.skillInvocations += row.skillInvocations;
      daily.set(row.date, target);
    }
    for (const row of report.tools) tools.set(row.name, (tools.get(row.name) ?? 0) + row.count);
    for (const row of report.skills) skills.set(row.name, (skills.get(row.name) ?? 0) + row.count);
    for (const row of report.providers) {
      const target = providers.get(row.provider) ?? { ...emptyUsage(), provider: row.provider, sessions: 0 };
      addUsage(target, row);
      target.sessions += row.sessions;
      providers.set(row.provider, target);
    }
    for (const row of report.models) {
      const key = `${row.provider}:${row.model}`;
      const target = models.get(key) ?? { ...emptyUsage(), provider: row.provider, model: row.model, sessions: 0 };
      addUsage(target, row);
      target.sessions += row.sessions;
      models.set(key, target);
    }
    for (const row of report.sources) {
      const target = sources.get(row.provider) ?? { ...row, scannedFiles: 0, skippedFiles: 0, sessions: 0 };
      target.scannedFiles += row.scannedFiles;
      target.skippedFiles += row.skippedFiles;
      target.sessions += row.sessions;
      if (row.status === "limited" || target.status === "limited") target.status = "limited";
      else if (row.status === "partial" || target.status === "partial") target.status = "partial";
      else if (row.status === "ok" || (row.status === "unsupported" && target.status === "missing")) target.status = row.status;
      target.message ??= row.message;
      sources.set(row.provider, target);
    }
  }

  return {
    from: Math.min(...reports.map((report) => report.from)),
    to: Math.max(...reports.map((report) => report.to)),
    timeZone: first.timeZone,
    totals,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    tools: ranked(tools),
    skills: ranked(skills),
    providers: [...providers.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    sources: [...sources.values()].sort((a, b) => providerOrder(a.provider) - providerOrder(b.provider)),
    pricing: {
      status: reports.some((report) => report.pricing.status === "fresh")
        ? "fresh"
        : reports.some((report) => report.pricing.status === "cached") ? "cached" : "unavailable",
      knownModels: Math.max(...reports.map((report) => report.pricing.knownModels)),
      fetchedAt: Math.max(0, ...reports.map((report) => report.pricing.fetchedAt ?? 0)) || undefined,
    },
    scanDurationMs: Math.max(...reports.map((report) => report.scanDurationMs)),
  };
}

function normalizeReport(report: AnalyticsReport): AnalyticsReport {
  const legacyTotals = report.totals as AnalyticsReport["totals"] & { usageThreads?: number };
  const legacyProviders = report.providers as Array<AnalyticsReport["providers"][number] & { threads?: number }>;
  const legacyModels = report.models as Array<AnalyticsReport["models"][number] & { threads?: number }>;
  const providers = legacyProviders.map((row) => ({
    ...emptyUsage(),
    ...row,
    pricedTokens: row.pricedTokens ?? (row.costUsd > 0 ? row.totalTokens : 0),
    sessions: row.sessions ?? row.threads ?? 0,
  }));
  const models = legacyModels.map((row) => ({
    ...emptyUsage(),
    ...row,
    pricedTokens: row.pricedTokens ?? (row.costUsd > 0 ? row.totalTokens : 0),
    sessions: row.sessions ?? row.threads ?? 0,
  }));
  const sources = report.sources?.length ? report.sources : ["claude", "codex", "cursor"].map((provider): AnalyticsSource => ({
    provider,
    status: "limited",
    scannedFiles: 0,
    skippedFiles: 0,
    sessions: providers.find((row) => row.provider === provider)?.sessions ?? 0,
    message: "This device reports only Remy threads until its server is updated.",
  }));
  return {
    ...report,
    totals: {
      ...emptyUsage(),
      ...report.totals,
      pricedTokens: report.totals.pricedTokens ?? providers.reduce((total, row) => total + row.pricedTokens, 0),
      usageSessions: report.totals.usageSessions ?? legacyTotals.usageThreads ?? 0,
    },
    daily: report.daily.map((row) => ({ ...emptyUsage(), ...row, pricedTokens: row.pricedTokens ?? 0 })),
    providers,
    models,
    sources,
    pricing: report.pricing ?? { status: "unavailable", knownModels: 0 },
    scanDurationMs: report.scanDurationMs ?? 0,
  };
}

function emptyUsage(): AnalyticsUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    pricedTokens: 0,
    costUsd: 0,
    currentContextTokens: 0,
    peakContextTokens: 0,
    contextLimitTokens: 0,
    contextSessions: 0,
  };
}

function addUsage(target: AnalyticsUsage, value: AnalyticsUsage): void {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationTokens += value.cacheCreationTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningTokens += value.reasoningTokens;
  target.totalTokens += value.totalTokens;
  target.pricedTokens += value.pricedTokens;
  target.costUsd += value.costUsd;
  target.currentContextTokens += value.currentContextTokens;
  target.peakContextTokens += value.peakContextTokens;
  target.contextLimitTokens += value.contextLimitTokens;
  target.contextSessions += value.contextSessions;
}

function ranked(rows: Map<string, number>): Array<{ name: string; count: number }> {
  return [...rows].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: value < 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value);
}

function formatMoneyAxis(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function providerLabel(provider: string): string {
  if (provider === "codex") return "Codex";
  if (provider === "cursor") return "Cursor";
  return "Claude";
}

function threadCount(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? "thread" : "threads"}`;
}

function sessionCount(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? "session" : "sessions"}`;
}

function sourceDescription(source: AnalyticsSource): string {
  if (source.status === "limited") return source.message ?? "Only Remy thread usage is available.";
  if (source.status === "partial") return source.message ?? "Only live provider usage is available.";
  if (source.status === "unsupported") return source.message ?? "Token history is unavailable.";
  if (source.status === "missing") return "No provider history on this device.";
  return `${sessionCount(source.sessions)} across ${formatNumber(source.scannedFiles)} files.`;
}

function providerOrder(provider: string): number {
  return provider === "claude" ? 0 : provider === "codex" ? 1 : 2;
}
