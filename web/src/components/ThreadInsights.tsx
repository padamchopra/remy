import { ProviderMark } from "@/components/ProviderMark";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { transport } from "@/lib/transport";
import { ChartNoAxesCombined, Gauge, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

interface ThreadUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

interface ThreadAnalyticsReport {
  chatId: string;
  provider: string;
  model?: string;
  usage: ThreadUsage;
  turns: number;
  toolCalls: number;
  skillInvocations: number;
  skills?: Array<{ name: string; count: number }>;
  sessionSpanMs: number;
  measuredActiveMs: number;
  currentRunMs: number;
  measuredTurns: number;
  context?: {
    tokens: number;
    peakTokens?: number;
    limit: number;
    limitEstimated: boolean;
    compactions: number;
    droppedTokens: number;
  };
  models: Array<ThreadUsage & { provider: string; model: string }>;
}

interface TimingSummary {
  samples: number;
  medianMs: number;
  p95Ms: number;
  latestMs: number;
}

interface ThreadPerformanceReport {
  chatId: string;
  state: "idle" | "working" | "needs_input" | "error";
  live: boolean;
  sessionSpanMs: number;
  measuredActiveMs: number;
  currentRunMs: number;
  turns: number;
  measuredTurns: number;
  firstOutput: TimingSummary;
  turnDuration: TimingSummary;
  toolDuration: TimingSummary;
  tools: {
    total: number;
    succeeded: number;
    failed: number;
    stopped: number;
    running: number;
  };
  failures: number;
  context?: {
    tokens: number;
    peakTokens?: number;
    limit: number;
    limitEstimated: boolean;
    compactions: number;
    droppedTokens: number;
  };
  slowestTools: Array<{
    id: string;
    label: string;
    durationMs: number;
    status: "ok" | "error" | "stopped";
  }>;
}

function useThreadReport<T>(serverId: string, chatId: string, kind: "analytics" | "performance", enabled: boolean) {
  const [report, setReport] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await transport.request<T>(serverId, `/chats/${encodeURIComponent(chatId)}/${kind}`);
      setReport(next);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatId, kind, serverId]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  return { report, loading, error, load };
}

export function ThreadAnalyticsTool({ chatId, serverId, enabled }: { chatId: string; serverId: string; enabled: boolean }) {
  const { report, loading, error, load } = useThreadReport<ThreadAnalyticsReport>(serverId, chatId, "analytics", enabled);
  if (loading && !report) return <InsightsSkeleton />;
  if (error && !report) return <InsightsError kind="analytics" onRetry={load} />;
  if (!report) return null;

  const totalInput = report.usage.inputTokens + report.usage.cachedInputTokens + report.usage.cacheCreationTokens;
  return (
    <InsightsScroll>
      <ToolContext
        provider={report.provider}
        model={report.model}
        loading={loading}
        onRefresh={load}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-3">
        <MetricCard
          label="Processed tokens"
          value={report.usage.totalTokens ? formatCompact(report.usage.totalTokens) : "—"}
          detail={report.usage.totalTokens ? `${formatNumber(report.turns)} turns` : "This provider does not report them"}
        />
        <MetricCard label="Reported spend" value={formatMoney(report.usage.costUsd)} detail="What providers report" />
        <MetricCard label="Session span" value={formatDuration(report.sessionSpanMs)} detail="First activity to latest" />
        <MetricCard
          label="Measured work"
          value={report.measuredTurns ? formatDuration(report.measuredActiveMs) : "—"}
          detail={report.measuredTurns ? `${formatNumber(report.measuredTurns)} timed turns` : "Starts with new activity"}
        />
      </div>

      {report.currentRunMs > 0 ? (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Current run</CardTitle>
            <CardAction><Badge variant="info">{formatDuration(report.currentRunMs)}</Badge></CardAction>
            <CardDescription>The thread is adding to its measured work time.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {report.context ? (
        <StatListCard
          title="Context"
          description="Cursor reports the live context window, not processed-token history."
          rows={[
            { label: "Used", value: `${formatCompact(report.context.tokens)} / ${formatCompact(report.context.limit)}` },
            { label: "Full", value: formatPercent(report.context.tokens / Math.max(report.context.limit, 1)) },
            { label: "Peak", value: formatCompact(Math.max(report.context.peakTokens ?? 0, report.context.tokens)) },
            { label: "Compactions", value: formatNumber(report.context.compactions) },
          ]}
        />
      ) : null}

      {report.usage.totalTokens > 0 ? (
        <StatListCard
          title="Token breakdown"
          description={`${formatCompact(totalInput)} input tokens in this thread.`}
          rows={[
            { label: "Uncached input", value: formatCompact(report.usage.inputTokens) },
            { label: "Cached input", value: formatCompact(report.usage.cachedInputTokens) },
            { label: "Cache creation", value: formatCompact(report.usage.cacheCreationTokens) },
            { label: "Output", value: formatCompact(report.usage.outputTokens) },
            { label: "Reasoning", value: formatCompact(report.usage.reasoningTokens) },
          ]}
        />
      ) : null}

      <ActivityCard
        toolCalls={report.toolCalls}
        skillInvocations={report.skillInvocations}
        turns={report.turns}
        skills={report.skills}
      />

      {report.models.length > 0 ? (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Models</CardTitle>
            <CardDescription>Tokens processed by each provider session.</CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            <ItemGroup>
              {report.models.map((model, index) => (
                <div key={`${model.provider}:${model.model}`}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item size="sm">
                    <ProviderMark provider={model.provider} className="size-4" />
                    <ItemContent className="min-w-0">
                      <ItemTitle className="truncate">{model.model}</ItemTitle>
                      <ItemDescription>{formatCompact(model.totalTokens)} tokens</ItemDescription>
                    </ItemContent>
                  </Item>
                </div>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      ) : null}
    </InsightsScroll>
  );
}

export function ThreadPerformanceTool({ chatId, serverId, enabled }: { chatId: string; serverId: string; enabled: boolean }) {
  const { report, loading, error, load } = useThreadReport<ThreadPerformanceReport>(serverId, chatId, "performance", enabled);
  if (loading && !report) return <InsightsSkeleton />;
  if (error && !report) return <InsightsError kind="performance" onRetry={load} />;
  if (!report) return null;

  return (
    <InsightsScroll>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={statusVariant(report.state)}>{statusLabel(report.state)}</Badge>
          <span className="truncate text-xs text-muted-foreground">{report.live ? "Provider ready" : "Resumes on the next message"}</span>
        </div>
        <RefreshButton loading={loading} onRefresh={load} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-3">
        <MetricCard
          label="First output"
          value={timingValue(report.firstOutput, "median")}
          detail={timingDetail(report.firstOutput, "Median")}
        />
        <MetricCard
          label="Turn duration"
          value={timingValue(report.turnDuration, "p95")}
          detail={timingDetail(report.turnDuration, "P95")}
        />
        <MetricCard
          label="Tool duration"
          value={timingValue(report.toolDuration, "p95")}
          detail={timingDetail(report.toolDuration, "P95")}
        />
        <MetricCard
          label="Failures"
          value={formatNumber(report.failures)}
          detail={report.failures === 1 ? "Recorded failure" : "Recorded failures"}
        />
      </div>

      {report.measuredTurns === 0 ? (
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Timing begins with new activity</CardTitle>
            <CardDescription>Older transcript items remain visible but do not have reliable timestamps.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <StatListCard
          title="Turn timing"
          description={`${formatNumber(report.measuredTurns)} of ${formatNumber(report.turns)} turns have timing data.`}
          rows={[
            { label: "Measured work", value: formatDuration(report.measuredActiveMs) },
            { label: "Latest first output", value: formatDuration(report.firstOutput.latestMs) },
            { label: "Latest turn", value: formatDuration(report.turnDuration.latestMs) },
            ...(report.currentRunMs ? [{ label: "Current run", value: formatDuration(report.currentRunMs) }] : []),
          ]}
        />
      )}

      <StatListCard
        title="Tool outcomes"
        description={`${formatNumber(report.tools.total)} calls recorded in this thread.`}
        rows={[
          { label: "Succeeded", value: formatNumber(report.tools.succeeded) },
          { label: "Failed", value: formatNumber(report.tools.failed), tone: report.tools.failed ? "destructive" as const : undefined },
          { label: "Stopped", value: formatNumber(report.tools.stopped) },
          { label: "Running", value: formatNumber(report.tools.running) },
        ]}
      />

      {report.context ? (
        <StatListCard
          title="Context"
          description={report.context.limitEstimated ? "The provider has not confirmed this context limit." : "The provider confirmed this context limit."}
          rows={[
            { label: "Used", value: formatPercent(report.context.tokens / Math.max(report.context.limit, 1)) },
            { label: "Tokens", value: `${formatCompact(report.context.tokens)} / ${formatCompact(report.context.limit)}` },
            { label: "Peak", value: formatCompact(Math.max(report.context.peakTokens ?? 0, report.context.tokens)) },
            { label: "Compactions", value: formatNumber(report.context.compactions) },
            { label: "Dropped tokens", value: formatCompact(report.context.droppedTokens) },
          ]}
        />
      ) : null}

      {report.slowestTools.length > 0 ? (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Slowest tools</CardTitle>
            <CardDescription>Completed calls with measured durations.</CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            <ItemGroup>
              {report.slowestTools.map((tool, index) => (
                <div key={tool.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item size="sm">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="truncate">{tool.label}</ItemTitle>
                      <ItemDescription>{tool.status === "error" ? "Failed" : tool.status === "stopped" ? "Stopped" : "Succeeded"}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={tool.status === "error" ? "destructive" : "outline"}>{formatDuration(tool.durationMs)}</Badge>
                    </ItemActions>
                  </Item>
                </div>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      ) : null}
    </InsightsScroll>
  );
}

function InsightsScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="size-full">
      <div className="flex min-w-0 flex-col gap-4 p-4">{children}</div>
    </ScrollArea>
  );
}

function ToolContext({
  provider,
  model,
  loading,
  onRefresh,
}: {
  provider: string;
  model?: string;
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ProviderMark provider={provider} className="size-4" />
        <span className="truncate">{model || "Provider default"}</span>
      </div>
      <RefreshButton loading={loading} onRefresh={onRefresh} />
    </div>
  );
}

function RefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh: () => Promise<void> }) {
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label="Refresh thread metrics" onClick={() => void onRefresh()}>
      <RefreshCw className={loading ? "animate-spin" : undefined} />
    </Button>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="gap-2 py-4 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
        <CardDescription className="text-xs">{detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function StatListCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<{ label: string; value: string; tone?: "destructive" }>;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <ItemGroup>
          {rows.map((row, index) => (
            <div key={row.label}>
              {index > 0 ? <ItemSeparator /> : null}
              <Item size="sm">
                <ItemContent><ItemTitle className="font-normal">{row.label}</ItemTitle></ItemContent>
                <ItemActions>
                  <span className={row.tone === "destructive" ? "tabular-nums text-destructive" : "tabular-nums text-muted-foreground"}>{row.value}</span>
                </ItemActions>
              </Item>
            </div>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

function ActivityCard({
  toolCalls,
  skillInvocations,
  turns,
  skills,
}: {
  toolCalls: number;
  skillInvocations: number;
  turns: number;
  skills?: Array<{ name: string; count: number }>;
}) {
  const rows = [
    { label: "Tool calls", value: formatNumber(toolCalls) },
    { label: "Skill invocations", value: formatNumber(skillInvocations) },
    { label: "Turns", value: formatNumber(turns) },
  ];
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Activity</CardTitle>
        <CardDescription>Only work recorded in this thread.</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <ItemGroup>
          {rows.map((row, index) => (
            <div key={row.label}>
              {index > 0 ? <ItemSeparator /> : null}
              <Item size="sm">
                <ItemContent><ItemTitle className="font-normal">{row.label}</ItemTitle></ItemContent>
                <ItemActions><span className="tabular-nums text-muted-foreground">{row.value}</span></ItemActions>
              </Item>
            </div>
          ))}
        </ItemGroup>
        <div className="mx-2 mt-3 border-t pt-3">
          <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">Skills</p>
          {skills === undefined ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Update this device to see skill names.</p>
          ) : skills.length > 0 ? (
            <ItemGroup>
              {skills.map((skill) => (
                <Item key={skill.name} size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="truncate font-mono text-xs font-normal">{skill.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <span className="tabular-nums text-muted-foreground">{formatNumber(skill.count)}</span>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">No skills were invoked.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid size-full auto-rows-min grid-cols-2 gap-3 p-4">
      <Skeleton className="col-span-2 h-8" />
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
      <Skeleton className="col-span-2 h-52" />
    </div>
  );
}

function InsightsError({ kind, onRetry }: { kind: "analytics" | "performance"; onRetry: () => Promise<void> }) {
  const Icon = kind === "analytics" ? ChartNoAxesCombined : Gauge;
  return (
    <Empty className="size-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle>Couldn&apos;t load thread {kind}</EmptyTitle>
        <EmptyDescription>Check this device, then try again.</EmptyDescription>
        <Button type="button" size="sm" onClick={() => void onRetry()}>
          <RefreshCw data-icon="inline-start" />
          Try again
        </Button>
      </EmptyHeader>
    </Empty>
  );
}

function timingValue(summary: TimingSummary, kind: "median" | "p95") {
  if (!summary.samples) return "—";
  return formatDuration(kind === "median" ? summary.medianMs : summary.p95Ms);
}

function timingDetail(summary: TimingSummary, label: string) {
  return summary.samples ? `${label} across ${formatNumber(summary.samples)} samples` : "Starts with new activity";
}

function statusLabel(state: ThreadPerformanceReport["state"]) {
  if (state === "needs_input") return "Needs input";
  if (state === "working") return "Working";
  if (state === "error") return "Error";
  return "Done";
}

function statusVariant(state: ThreadPerformanceReport["state"]): "info" | "warning" | "destructive" | "secondary" {
  if (state === "working") return "info";
  if (state === "needs_input") return "warning";
  if (state === "error") return "destructive";
  return "secondary";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 3 : 2 }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(Math.max(0, Math.min(1, value)));
}

function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0s";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const totalSeconds = Math.round(milliseconds / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
