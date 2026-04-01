import { useMemo } from "react";
import type { NormalizedRequest, NormalizedUCTask, ScheduleBatch } from "../../types/models";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface RequestTimelineViewProps {
  requests: NormalizedRequest[];
  scheduleBatches: ScheduleBatch[];
  tasks: NormalizedUCTask[];
  initialZoom?: number;
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
  prefill: "#22c55e",
  kvRelease: "#d97706",
  end: "#64748b"
} as const;

function requestLabel(request: NormalizedRequest) {
  return request.llmMgrReqId ?? request.engineReqId ?? request.seqId ?? request.id;
}

function requestStart(request: NormalizedRequest) {
  return request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
}

function requestEnd(request: NormalizedRequest) {
  return request.stages.endedAt ?? request.stages.releaseResponseAt ?? request.stages.kvReleaseAt ?? request.lifecycleEvents.at(-1)?.timestampMs;
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

export function RequestTimelineView({
  requests,
  scheduleBatches,
  tasks,
  initialZoom = 2,
  selectedRequestId,
  onSelectRequest
}: RequestTimelineViewProps) {
  const items = useMemo<TimelineItem[]>(() => {
    const nextItems: TimelineItem[] = [];
    const batchById = new Map(scheduleBatches.map((batch) => [batch.id, batch]));
    const taskById = new Map(tasks.map((task) => [task.id, task]));
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
            totalMs: requestFinishedAt - requestEnteredAt,
            dpRank: request.dpRank ?? null
          },
          anomaly: request.anomalies.length > 0
        });
      }

      for (const [batchIndex, batch] of batches.entries()) {
        const batchKey = `${request.id}:${batch.id}`;
        const scheduleAt = batch.startMs;
        const reporterAt = batch.reporterMs ?? batch.executionEndMs;
        const batchEndAt = batch.endMs ?? reporterAt;
        const lookupEndAt = batch.lookupEndMs ?? batch.lookupStartMs;
        const computeStartAt = batch.computeStartMs ?? lookupEndAt ?? scheduleAt;

        if (waitingCursor !== undefined && scheduleAt !== undefined && scheduleAt > waitingCursor) {
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
              waitMs: scheduleAt - waitingCursor,
              dpRanks: batch.dpRanks.join(",") || null
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
              schedulingRound: batch.schedulingRound ?? null,
              workerCount: batch.workerIds.length
            }
          });
        }

        if (scheduleAt !== undefined && batch.lookupStartMs !== undefined && batch.lookupEndMs !== undefined) {
          nextItems.push({
            id: `request:${batchKey}:lookup-main`,
            lane: mainLane,
            label: "Store lookup",
            start: batch.lookupStartMs,
            end: batch.lookupEndMs,
            color: REQUEST_COLORS.lookup,
            legendKey: "request-store-lookup",
            legendLabel: "Store lookup",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              lookupCount: batch.lookupCount,
              lookupTotalMs: batch.lookupTotalMs,
              lookupP50Ms: batch.lookupP50Ms ?? null,
              lookupP90Ms: batch.lookupP90Ms ?? null,
              lookupMaxMs: batch.lookupMaxMs ?? null
            }
          });
        }

        if (lookupEndAt !== undefined && computeStartAt !== undefined && computeStartAt > lookupEndAt) {
          nextItems.push({
            id: `request:${batchKey}:load-main`,
            lane: mainLane,
            label: "Cache load",
            start: lookupEndAt,
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

        if (computeStartAt !== undefined && reporterAt !== undefined && reporterAt >= computeStartAt) {
          nextItems.push({
            id: `request:${batchKey}:compute`,
            lane: mainLane,
            label: "Model compute",
            start: computeStartAt,
            end: reporterAt,
            color: REQUEST_COLORS.modelCompute,
            legendKey: "request-model-compute",
            legendLabel: "Model compute",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              computeMs: reporterAt - computeStartAt
            }
          });
        }

        if (request.stages.prefillCompleteAt !== undefined && batchIndex === batches.length - 1) {
          nextItems.push({
            id: `request:${batchKey}:prefill`,
            lane: mainLane,
            label: "Prefill done",
            start: request.stages.prefillCompleteAt,
            end: request.stages.prefillCompleteAt + 1,
            color: REQUEST_COLORS.prefill,
            legendKey: "request-prefill-complete",
            legendLabel: "Prefill complete",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id
            }
          });
        }

        if (request.stages.kvReleaseAt !== undefined && batchIndex === batches.length - 1) {
          nextItems.push({
            id: `request:${batchKey}:kv-release`,
            lane: mainLane,
            label: "Release KV",
            start: request.stages.kvReleaseAt,
            end: request.stages.kvReleaseAt + 1,
            color: REQUEST_COLORS.kvRelease,
            legendKey: "request-kv-release",
            legendLabel: "KV release",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id
            }
          });
        }

        if (requestFinishedAt !== undefined && batchIndex === batches.length - 1) {
          nextItems.push({
            id: `request:${batchKey}:end`,
            lane: mainLane,
            label: "Finished",
            start: requestFinishedAt,
            end: requestFinishedAt + 1,
            color: REQUEST_COLORS.end,
            legendKey: "request-finished",
            legendLabel: "Request finished",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              status: request.status
            },
            anomaly: request.anomalies.length > 0
          });
        }

        if (!detailedRequestIds.has(request.id)) {
          continue;
        }

        const batchLookupLane = `${mainLane} / Batch ${batchIndex + 1} lookup`;
        if (batch.lookupStartMs !== undefined && batch.lookupEndMs !== undefined) {
          nextItems.push({
            id: `request:${batchKey}:lookup-detail`,
            lane: batchLookupLane,
            label: `Lookup x${batch.lookupCount}`,
            start: batch.lookupStartMs,
            end: batch.lookupEndMs,
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
        const registerGroup = (
          taskIds: string[],
          categoryLabel: string,
          color: string
        ) => {
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
          const lane = `${mainLane} / ${firstTask.workerId} ${group.label}`;
          nextItems.push({
            id: `request:${batchKey}:${groupKey}`,
            lane,
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

        if (batchEndAt !== undefined && batchEndAt > (reporterAt ?? batch.startMs ?? batchEndAt)) {
          nextItems.push({
            id: `request:${batchKey}:post`,
            lane: `${mainLane} / Batch ${batchIndex + 1} completion`,
            label: "Release / dump",
            start: reporterAt ?? batch.startMs,
            end: batchEndAt,
            color: "#475569",
            legendKey: "batch-release-dump",
            legendLabel: "Release / dump",
            selected: isSelected,
            meta: {
              requestId: label,
              batchId: batch.id,
              cacheDumpTotalMs: batch.cacheDumpTotalMs,
              posixDumpTotalMs: batch.posixDumpTotalMs
            }
          });
        }

        waitingCursor = batchEndAt ?? reporterAt ?? waitingCursor;
      }
    }

    return nextItems;
  }, [requests, scheduleBatches, tasks, selectedRequestId]);

  if (items.length === 0) {
    return <div className="empty-state">No request timeline data is available for the current filters.</div>;
  }

  return (
    <TimelineChart
      title="Request + Scheduling Execution Timeline"
      items={items}
      initialZoom={initialZoom}
      onItemClick={(itemId) => {
        if (itemId.startsWith("request:")) {
          const requestId = itemId.split(":")[1];
          if (requestId) {
            onSelectRequest(requestId);
          }
        }
      }}
    />
  );
}
