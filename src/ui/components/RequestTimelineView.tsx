import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type {
  NormalizedRequest,
  NormalizedUCTask,
  ParsedEvent,
  ScheduleBatch,
  SchedulerEvent
} from "../../types/models";
import {
  deriveRequestTimeline,
  taskEnd,
  taskStart,
  bandwidthMBps,
  type RequestPhaseMetrics
} from "../requestTimeline";
import { formatDuration } from "../../utils/time";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface RequestTimelineViewProps {
  requests: NormalizedRequest[];
  scheduleBatches: ScheduleBatch[];
  tasks: NormalizedUCTask[];
  events: ParsedEvent[];
  initialZoom?: number;
  keyboardPanStepMs?: number;
  selectedRequestId?: string;
  onSelectRequest: (requestId: string) => void;
}

const DETAIL_EXPAND_THRESHOLD = 40;
const REQUEST_COLORS = {
  receive: "#1d4ed8",
  waiting: "#0f766e",
  schedule: "#f59e0b",
  lookup: "#7c3aed",
  cacheLoad: "#14b8a6",
  modelCompute: "#ef4444",
  cacheDump: "#b45309",
  kvTransfer: "#8b5cf6"
} as const;

const phaseChartConfig: Array<{ key: keyof RequestPhaseMetrics; label: string; color: string }> = [
  { key: "queueWaitMs", label: "Queue wait", color: REQUEST_COLORS.waiting },
  { key: "lookupMs", label: "Store lookup", color: REQUEST_COLORS.lookup },
  { key: "cacheLoadMs", label: "Cache load", color: REQUEST_COLORS.cacheLoad },
  { key: "modelComputeMs", label: "Model compute", color: REQUEST_COLORS.modelCompute },
  { key: "cacheDumpMs", label: "Cache dump", color: REQUEST_COLORS.cacheDump },
  { key: "kvTransferFinishMs", label: "KV transfer / finish", color: REQUEST_COLORS.kvTransfer }
];

function summarizeTaskGroup(tasks: NormalizedUCTask[]) {
  let start: number | undefined;
  let end: number | undefined;
  let totalCostMs = 0;
  let bytes = 0;
  let pid: number | undefined;
  let maxBandwidthMBps = 0;
  const bandwidthSamples: number[] = [];

  for (const task of tasks) {
    const currentStart = taskStart(task);
    const currentEnd = taskEnd(task);
    if (currentStart !== undefined) {
      start = start === undefined ? currentStart : Math.min(start, currentStart);
    }
    if (currentEnd !== undefined) {
      end = end === undefined ? currentEnd : Math.max(end, currentEnd);
    }
    if (task.costMs !== undefined) {
      totalCostMs += task.costMs;
    }
    if (task.bytes !== undefined) {
      bytes += task.bytes;
    }
    pid ??= task.pid;
    const sample = bandwidthMBps(task);
    if (sample !== undefined) {
      bandwidthSamples.push(sample);
      maxBandwidthMBps = Math.max(maxBandwidthMBps, sample);
    }
  }

  return {
    start,
    end,
    pid,
    totalCostMs,
    bytes,
    avgBandwidthMBps:
      bandwidthSamples.length > 0
        ? bandwidthSamples.reduce((sum, value) => sum + value, 0) / bandwidthSamples.length
        : undefined,
    maxBandwidthMBps: bandwidthSamples.length > 0 ? maxBandwidthMBps : undefined
  };
}

export function RequestTimelineView({
  requests,
  scheduleBatches,
  tasks,
  events,
  initialZoom = 2,
  keyboardPanStepMs = 1_000,
  selectedRequestId,
  onSelectRequest
}: RequestTimelineViewProps) {
  const { items, phaseMetrics } = useMemo(() => {
    const nextItems: TimelineItem[] = [];
    const nextPhaseMetrics: RequestPhaseMetrics[] = [];
    const schedulingEvents = events.filter(
      (event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_scheduling"
    );
    const showExpandedDetailsForAll = requests.length <= DETAIL_EXPAND_THRESHOLD;
    const detailedRequestIds = showExpandedDetailsForAll
      ? new Set(requests.map((request) => request.id))
      : new Set(selectedRequestId ? [selectedRequestId] : []);

    for (const request of requests) {
      const derived = deriveRequestTimeline(request, scheduleBatches, tasks, schedulingEvents);
      const label = derived.requestLabel;
      const mainLane = `Req ${label}`;
      const requestEnteredAt = derived.requestStartAt;
      const requestFinishedAt = derived.requestEndAt;
      const batches = derived.batches;
      const isSelected = request.id === selectedRequestId;
      const metrics: RequestPhaseMetrics = { ...derived.metrics };

      if (requestEnteredAt !== undefined) {
        nextItems.push({
          id: `request:${request.id}:received`,
          lane: mainLane,
          label: "Received",
          start: requestEnteredAt,
          end: requestEnteredAt + 1,
          color: REQUEST_COLORS.receive,
          legendKey: "request-received",
          legendLabel: "Request received",
          selected: isSelected,
          meta: {
            requestId: label,
            phase: "received",
            dpRank: request.dpRank ?? null
          },
          anomaly: request.anomalies.length > 0
        });
      }

      if (requestFinishedAt !== undefined && requestEnteredAt !== undefined && batches.length === 0) {
        nextItems.push({
          id: `request:${request.id}:lifecycle`,
          lane: mainLane,
          label: "Lifecycle",
          start: requestEnteredAt,
          end: requestFinishedAt,
          color: "#2563eb",
          legendKey: "request-lifecycle",
          legendLabel: "Request lifecycle",
          selected: isSelected,
          meta: {
            requestId: label,
            totalMs: requestFinishedAt - requestEnteredAt
          },
          anomaly: request.anomalies.length > 0
        });
      }

      for (const [batchIndex, { batch, scheduleAt, taskGroups }] of batches.entries()) {
        const batchKey = `${request.id}:${batch.id}`;

        if (scheduleAt !== undefined) {
          nextItems.push({
            id: `request:${batchKey}:schedule`,
            lane: mainLane,
            label: "Scheduled",
            start: scheduleAt,
            end: scheduleAt + 1,
            color: REQUEST_COLORS.schedule,
            legendKey: "request-scheduled",
            legendLabel: "Scheduled",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              schedulingRound: batch.schedulingRound ?? null
            }
          });
        }

        for (const phase of derived.phases.filter((item) => item.batchId === batch.id)) {
          nextItems.push({
            id: `request:${batchKey}:${phase.key}`,
            lane: mainLane,
            label: phase.label,
            start: phase.start,
            end: phase.end,
            color:
              phase.key === "queueWait"
                ? REQUEST_COLORS.waiting
                : phase.key === "lookup"
                  ? REQUEST_COLORS.lookup
                  : phase.key === "cacheLoad"
                    ? REQUEST_COLORS.cacheLoad
                    : phase.key === "modelCompute"
                      ? REQUEST_COLORS.modelCompute
                      : phase.key === "cacheDump"
                        ? REQUEST_COLORS.cacheDump
                        : REQUEST_COLORS.kvTransfer,
            legendKey: `request-${phase.key}`,
            legendLabel: phase.label,
            selected: isSelected,
            meta: phase.meta,
            anomaly: request.anomalies.length > 0
          });
        }

        if (!detailedRequestIds.has(request.id)) {
          continue;
        }

        const lookupStartAt = batch.lookupStartMs;
        const lookupEndAt = batch.lookupEndMs ?? lookupStartAt;
        if (lookupStartAt !== undefined && lookupEndAt !== undefined) {
          nextItems.push({
            id: `request:${batchKey}:lookup-detail`,
            lane: `${mainLane} / Batch ${batchIndex + 1} lookup`,
            label: `Lookup x${batch.lookupCount}`,
            start: lookupStartAt,
            end: lookupEndAt,
            color: REQUEST_COLORS.lookup,
            legendKey: "batch-lookup-aggregate",
            legendLabel: "Batch lookup aggregate",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              taskCount: batch.lookupCount,
              totalMs: batch.lookupTotalMs,
              p50Ms: batch.lookupP50Ms ?? null,
              p90Ms: batch.lookupP90Ms ?? null,
              maxMs: batch.lookupMaxMs ?? null
            }
          });
        }

        const groupedDetailTasks = new Map<string, { label: string; color: string; tasks: NormalizedUCTask[] }>();
        const registerGroup = (groupTasks: NormalizedUCTask[], categoryLabel: string, color: string) => {
          for (const task of groupTasks) {
            const groupKey = `${task.workerId}:${categoryLabel}`;
            const existing = groupedDetailTasks.get(groupKey) ?? {
              label: categoryLabel,
              color,
              tasks: []
            };
            existing.tasks.push(task);
            groupedDetailTasks.set(groupKey, existing);
          }
        };

        registerGroup(taskGroups.cacheLoadTasks, "Cache Load", "#0f766e");
        registerGroup(taskGroups.posixLoadTasks, "Posix Load", "#0891b2");
        registerGroup(taskGroups.cacheDumpTasks, "Cache Dump", "#b45309");
        registerGroup(taskGroups.posixDumpTasks, "Posix Dump", "#dc2626");

        for (const [groupKey, group] of groupedDetailTasks) {
          const firstTask = group.tasks[0];
          if (!firstTask) {
            continue;
          }
          const summary = summarizeTaskGroup(group.tasks);
          if (summary.start === undefined || summary.end === undefined) {
            continue;
          }
          nextItems.push({
            id: `request:${batchKey}:${groupKey}`,
            lane: `${mainLane} / ${firstTask.workerId} ${group.label}`,
            label: `${group.label} x${group.tasks.length}`,
            start: summary.start,
            end: summary.end,
            color: group.color,
            legendKey: `batch-${group.label.toLowerCase().replace(/\s+/g, "-")}`,
            legendLabel: group.label,
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              workerId: firstTask.workerId,
              pid: summary.pid ?? null,
              taskCount: group.tasks.length,
              totalCostMs: summary.totalCostMs,
              bytes: summary.bytes || null,
              avgBandwidthMBps: summary.avgBandwidthMBps ?? null,
              maxBandwidthMBps: summary.maxBandwidthMBps ?? null
            }
          });
        }
      }

      nextPhaseMetrics.push(metrics);
    }

    return { items: nextItems, phaseMetrics: nextPhaseMetrics };
  }, [requests, scheduleBatches, tasks, events, selectedRequestId]);

  const orderedPhaseMetrics = useMemo(
    () =>
      [...phaseMetrics].sort(
        (left, right) => (left.requestStart ?? Number.MAX_SAFE_INTEGER) - (right.requestStart ?? Number.MAX_SAFE_INTEGER)
      ),
    [phaseMetrics]
  );

  if (items.length === 0) {
    return <div className="empty-state">No request timeline data is available for the current filters.</div>;
  }

  return (
    <div className="view-grid">
      <TimelineChart
        title="Request + Scheduling Execution Timeline"
        items={items}
        initialZoom={initialZoom}
        keyboardPanStepMs={keyboardPanStepMs}
        onItemClick={(itemId) => {
          if (itemId.startsWith("request:")) {
            const requestId = itemId.split(":")[1];
            if (requestId) {
              onSelectRequest(requestId);
            }
          }
        }}
      />

      {phaseChartConfig.map((phase) => {
        const data = orderedPhaseMetrics
          .filter((item) => typeof item[phase.key] === "number")
          .map((item) => ({
            requestId: item.requestId,
            requestLabel: item.requestLabel,
            durationMs: Number(item[phase.key] ?? 0)
          }));

        if (data.length === 0) {
          return null;
        }

        return (
          <div key={phase.key} className="chart-panel">
            <h3>{phase.label} duration by request order</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="requestLabel" stroke="#94a3b8" minTickGap={24} />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  formatter={(value: number) => formatDuration(value)}
                  contentStyle={{ background: "#101827", border: "1px solid #334155" }}
                />
                <Bar dataKey="durationMs" fill={phase.color} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
