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

interface RequestPhaseMetrics {
  requestId: string;
  requestLabel: string;
  requestStart?: number;
  queueWaitMs?: number;
  lookupMs?: number;
  cacheLoadMs?: number;
  modelComputeMs?: number;
  cacheDumpMs?: number;
  kvTransferFinishMs?: number;
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

function requestLabel(request: NormalizedRequest) {
  return request.llmMgrReqId ?? request.engineReqId ?? request.seqId ?? request.id;
}

function requestStart(request: NormalizedRequest) {
  return request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
}

function requestEnd(request: NormalizedRequest) {
  return (
    request.stages.endedAt ??
    request.stages.releaseResponseAt ??
    request.stages.kvReleaseAt ??
    request.lifecycleEvents.at(-1)?.timestampMs
  );
}

function taskStart(task: NormalizedUCTask) {
  return task.dispatchAt ?? task.startAt ?? task.finishAt;
}

function taskEnd(task: NormalizedUCTask) {
  return task.finishAt ?? task.startAt ?? task.dispatchAt;
}

function bandwidthMBps(task: NormalizedUCTask) {
  if (!task.bytes || !task.costMs || task.costMs <= 0) {
    return undefined;
  }
  return task.bytes / 1024 / 1024 / (task.costMs / 1000);
}

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

function getLatestSchedulingTime(
  request: NormalizedRequest,
  batch: ScheduleBatch,
  schedulingEventById: Map<string, SchedulerEvent>
) {
  const matchedSchedulingEvents = batch.schedulingEventIds
    .map((eventId) => schedulingEventById.get(eventId))
    .filter((event): event is SchedulerEvent => event !== undefined);

  const rankMatchedSchedulingEvents = matchedSchedulingEvents.filter(
    (event) => request.dpRank === undefined || event.requestRef?.dpRank === request.dpRank
  );

  return (rankMatchedSchedulingEvents.length > 0 ? rankMatchedSchedulingEvents : matchedSchedulingEvents).reduce<
    number | undefined
  >((max, event) => {
    if (event.timestampMs === undefined) {
      return max;
    }
    return max === undefined ? event.timestampMs : Math.max(max, event.timestampMs);
  }, undefined);
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
    const batchById = new Map(scheduleBatches.map((batch) => [batch.id, batch]));
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const schedulingEventById = new Map(
      events
        .filter(
          (event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_scheduling"
        )
        .map((event) => [event.id, event])
    );
    const showExpandedDetailsForAll = requests.length <= DETAIL_EXPAND_THRESHOLD;
    const detailedRequestIds = showExpandedDetailsForAll
      ? new Set(requests.map((request) => request.id))
      : new Set(selectedRequestId ? [selectedRequestId] : []);

    for (const request of requests) {
      const label = requestLabel(request);
      const mainLane = `Req ${label}`;
      const requestEnteredAt = requestStart(request);
      const requestFinishedAt = requestEnd(request);
      const batches = request.relatedScheduleBatchIds
        .map((batchId) => batchById.get(batchId))
        .filter((batch): batch is ScheduleBatch => batch !== undefined)
        .sort((left, right) => (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER));
      const isSelected = request.id === selectedRequestId;
      let waitingCursor = requestEnteredAt;

      const metrics: RequestPhaseMetrics = {
        requestId: request.id,
        requestLabel: label,
        requestStart: requestEnteredAt,
        queueWaitMs: 0,
        lookupMs: 0,
        cacheLoadMs: 0,
        modelComputeMs: 0
      };

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

      for (const [batchIndex, batch] of batches.entries()) {
        const batchKey = `${request.id}:${batch.id}`;
        const scheduleAt = getLatestSchedulingTime(request, batch, schedulingEventById) ?? batch.startMs;
        const reporterAt = batch.reporterMs ?? batch.executionEndMs;
        const batchEndAt = batch.endMs ?? reporterAt;
        const lookupStartAt = batch.lookupStartMs;
        const lookupEndAt = batch.lookupEndMs ?? lookupStartAt;
        const relatedLoadTasks = [...batch.cacheLoadTaskIds, ...batch.posixLoadTaskIds]
          .map((taskId) => taskById.get(taskId))
          .filter((task): task is NormalizedUCTask => task !== undefined);
        const latestLoadFinishAt = relatedLoadTasks.reduce<number | undefined>((max, task) => {
          const currentEnd = taskEnd(task);
          if (currentEnd === undefined) {
            return max;
          }
          return max === undefined ? currentEnd : Math.max(max, currentEnd);
        }, undefined);
        const loadStartAt = [lookupEndAt, scheduleAt]
          .filter((value): value is number => value !== undefined)
          .reduce<number | undefined>((max, value) => (max === undefined ? value : Math.max(max, value)), undefined);
        const computeStartAt = [scheduleAt, latestLoadFinishAt]
          .filter((value): value is number => value !== undefined)
          .reduce<number | undefined>((max, value) => (max === undefined ? value : Math.max(max, value)), undefined);
        const relatedCacheDumpTasks = batch.cacheDumpTaskIds
          .map((taskId) => taskById.get(taskId))
          .filter((task): task is NormalizedUCTask => task !== undefined);
        const earliestCacheDumpStartAt = relatedCacheDumpTasks.reduce<number | undefined>((min, task) => {
          const currentStart = taskStart(task);
          if (currentStart === undefined) {
            return min;
          }
          return min === undefined ? currentStart : Math.min(min, currentStart);
        }, undefined);
        const latestCacheDumpEndAt = relatedCacheDumpTasks.reduce<number | undefined>((max, task) => {
          const currentEnd = taskEnd(task);
          if (currentEnd === undefined) {
            return max;
          }
          return max === undefined ? currentEnd : Math.max(max, currentEnd);
        }, undefined);
        const computeEndCandidates = [
          request.stages.prefillCompleteAt,
          earliestCacheDumpStartAt
        ].filter((value): value is number => value !== undefined);
        const computeEndAt =
          computeEndCandidates.length > 0
            ? Math.min(...computeEndCandidates)
            : request.stages.prefillCompleteAt ?? earliestCacheDumpStartAt ?? reporterAt;
        const kvStageEndAt =
          requestFinishedAt ??
          request.stages.controlRequestAt ??
          request.stages.releaseResponseAt ??
          request.stages.kvReleaseAt;

        if (waitingCursor !== undefined && scheduleAt !== undefined && scheduleAt > waitingCursor) {
          const waitMs = scheduleAt - waitingCursor;
          metrics.queueWaitMs = (metrics.queueWaitMs ?? 0) + waitMs;
          nextItems.push({
            id: `request:${batchKey}:waiting`,
            lane: mainLane,
            label: "Queue wait",
            start: waitingCursor,
            end: scheduleAt,
            color: REQUEST_COLORS.waiting,
            legendKey: "request-queue-wait",
            legendLabel: "Queue wait",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              waitMs
            },
            anomaly: request.anomalies.length > 0
          });
        }

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

        if (lookupStartAt !== undefined && lookupEndAt !== undefined) {
          const lookupMs = lookupEndAt - lookupStartAt;
          metrics.lookupMs = (metrics.lookupMs ?? 0) + lookupMs;
          nextItems.push({
            id: `request:${batchKey}:lookup-main`,
            lane: mainLane,
            label: "Store lookup",
            start: lookupStartAt,
            end: lookupEndAt,
            color: REQUEST_COLORS.lookup,
            legendKey: "request-store-lookup",
            legendLabel: "Store lookup",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              lookupCount: batch.lookupCount,
              lookupTotalMs: batch.lookupTotalMs
            }
          });
        }

        if (loadStartAt !== undefined && computeStartAt !== undefined && computeStartAt > loadStartAt) {
          const cacheLoadMs = computeStartAt - loadStartAt;
          metrics.cacheLoadMs = (metrics.cacheLoadMs ?? 0) + cacheLoadMs;
          nextItems.push({
            id: `request:${batchKey}:load-main`,
            lane: mainLane,
            label: "Cache load",
            start: loadStartAt,
            end: computeStartAt,
            color: REQUEST_COLORS.cacheLoad,
            legendKey: "request-cache-load",
            legendLabel: "Cache load",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              cacheLoadTotalMs: batch.cacheLoadTotalMs,
              posixLoadTotalMs: batch.posixLoadTotalMs
            }
          });
        }

        if (computeStartAt !== undefined && computeEndAt !== undefined && computeEndAt >= computeStartAt) {
          const modelComputeMs = computeEndAt - computeStartAt;
          metrics.modelComputeMs = (metrics.modelComputeMs ?? 0) + modelComputeMs;
          nextItems.push({
            id: `request:${batchKey}:compute`,
            lane: mainLane,
            label: "Model compute",
            start: computeStartAt,
            end: computeEndAt,
            color: REQUEST_COLORS.modelCompute,
            legendKey: "request-model-compute",
            legendLabel: "Model compute",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              computeMs: modelComputeMs
            }
          });
        }

        if (
          earliestCacheDumpStartAt !== undefined &&
          latestCacheDumpEndAt !== undefined &&
          latestCacheDumpEndAt > earliestCacheDumpStartAt &&
          batchIndex === batches.length - 1
        ) {
          const cacheDumpMs = latestCacheDumpEndAt - earliestCacheDumpStartAt;
          metrics.cacheDumpMs = cacheDumpMs;
          nextItems.push({
            id: `request:${batchKey}:cache-dump`,
            lane: mainLane,
            label: "Cache dump",
            start: earliestCacheDumpStartAt,
            end: latestCacheDumpEndAt,
            color: REQUEST_COLORS.cacheDump,
            legendKey: "request-cache-dump",
            legendLabel: "Cache dump",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              durationMs: cacheDumpMs,
              taskCount: relatedCacheDumpTasks.length
            },
            anomaly: request.anomalies.length > 0
          });
        }

        const kvTransferStartAt =
          latestCacheDumpEndAt ??
          request.stages.prefillCompleteAt ??
          computeEndAt;

        if (
          kvTransferStartAt !== undefined &&
          kvStageEndAt !== undefined &&
          kvStageEndAt > kvTransferStartAt &&
          batchIndex === batches.length - 1
        ) {
          const kvTransferFinishMs = kvStageEndAt - kvTransferStartAt;
          metrics.kvTransferFinishMs = kvTransferFinishMs;
          nextItems.push({
            id: `request:${batchKey}:kv-transfer-finish`,
            lane: mainLane,
            label: "KV transfer / finish",
            start: kvTransferStartAt,
            end: kvStageEndAt,
            color: REQUEST_COLORS.kvTransfer,
            legendKey: "request-kv-transfer-finish",
            legendLabel: "KV transfer / finish",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              kvTransferStartAt,
              finishedAt: kvStageEndAt,
              durationMs: kvTransferFinishMs
            },
            anomaly: request.anomalies.length > 0
          });
        }

        if (!detailedRequestIds.has(request.id)) {
          waitingCursor = batchEndAt ?? reporterAt ?? waitingCursor;
          continue;
        }

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

        const taskGroups = new Map<string, { label: string; color: string; tasks: NormalizedUCTask[] }>();
        const registerGroup = (taskIds: string[], categoryLabel: string, color: string) => {
          for (const taskId of taskIds) {
            const task = taskById.get(taskId);
            if (!task) {
              continue;
            }
            const groupKey = `${task.workerId}:${categoryLabel}`;
            const existing = taskGroups.get(groupKey) ?? {
              label: categoryLabel,
              color,
              tasks: []
            };
            existing.tasks.push(task);
            taskGroups.set(groupKey, existing);
          }
        };

        registerGroup(batch.cacheLoadTaskIds, "Cache Load", "#0f766e");
        registerGroup(batch.posixLoadTaskIds, "Posix Load", "#0891b2");
        registerGroup(batch.cacheDumpTaskIds, "Cache Dump", "#b45309");
        registerGroup(batch.posixDumpTaskIds, "Posix Dump", "#dc2626");

        for (const [groupKey, group] of taskGroups) {
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

        waitingCursor = batchEndAt ?? reporterAt ?? waitingCursor;
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
