import type {
  NormalizedRequest,
  NormalizedUCTask,
  Primitive,
  ScheduleBatch,
  SchedulerEvent
} from "../types/models";

export interface RequestPhaseSegment {
  key: "queueWait" | "lookup" | "cacheLoad" | "modelCompute" | "cacheDump" | "kvTransferFinish";
  label: string;
  start: number;
  end: number;
  batchId?: string;
  meta: Record<string, Primitive>;
}

export interface RequestBatchTaskGroups {
  lookupTasks: NormalizedUCTask[];
  cacheLoadTasks: NormalizedUCTask[];
  posixLoadTasks: NormalizedUCTask[];
  cacheDumpTasks: NormalizedUCTask[];
  posixDumpTasks: NormalizedUCTask[];
}

export interface DerivedRequestBatch {
  batch: ScheduleBatch;
  scheduleAt?: number;
  taskGroups: RequestBatchTaskGroups;
}

export interface RequestPhaseMetrics {
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

export interface DerivedRequestTimeline {
  requestLabel: string;
  requestStartAt?: number;
  requestEndAt?: number;
  phases: RequestPhaseSegment[];
  batches: DerivedRequestBatch[];
  metrics: RequestPhaseMetrics;
}

export function requestLabel(request: NormalizedRequest) {
  return request.llmMgrReqId ?? request.engineReqId ?? request.seqId ?? request.id;
}

export function requestStart(request: NormalizedRequest) {
  return request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
}

export function requestEnd(request: NormalizedRequest) {
  return (
    request.stages.endedAt ??
    request.stages.releaseResponseAt ??
    request.stages.kvReleaseAt ??
    request.lifecycleEvents.at(-1)?.timestampMs
  );
}

export function taskStart(task: NormalizedUCTask) {
  return task.dispatchAt ?? task.startAt ?? task.finishAt;
}

export function taskEnd(task: NormalizedUCTask) {
  return task.finishAt ?? task.startAt ?? task.dispatchAt;
}

export function bandwidthMBps(task: NormalizedUCTask) {
  if (!task.bytes || !task.costMs || task.costMs <= 0) {
    return undefined;
  }
  return task.bytes / 1024 / 1024 / (task.costMs / 1000);
}

function collectTasks(taskIds: string[], taskById: Map<string, NormalizedUCTask>) {
  return taskIds.map((taskId) => taskById.get(taskId)).filter((task): task is NormalizedUCTask => task !== undefined);
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

export function deriveRequestTimeline(
  request: NormalizedRequest,
  scheduleBatches: ScheduleBatch[],
  tasks: NormalizedUCTask[],
  schedulingEvents: SchedulerEvent[]
) {
  const label = requestLabel(request);
  const requestEnteredAt = requestStart(request);
  const requestFinishedAt = requestEnd(request);
  const batchById = new Map(scheduleBatches.map((batch) => [batch.id, batch]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const schedulingEventById = new Map(schedulingEvents.map((event) => [event.id, event]));
  const batches = request.relatedScheduleBatchIds
    .map((batchId) => batchById.get(batchId))
    .filter((batch): batch is ScheduleBatch => batch !== undefined)
    .sort((left, right) => (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER));

  const metrics: RequestPhaseMetrics = {
    requestId: request.id,
    requestLabel: label,
    requestStart: requestEnteredAt,
    queueWaitMs: 0,
    lookupMs: 0,
    cacheLoadMs: 0,
    modelComputeMs: 0
  };
  const phases: RequestPhaseSegment[] = [];
  const derivedBatches: DerivedRequestBatch[] = [];
  let waitingCursor = requestEnteredAt;

  for (const [batchIndex, batch] of batches.entries()) {
    const scheduleAt = getLatestSchedulingTime(request, batch, schedulingEventById) ?? batch.startMs;
    const batchEndAt = batch.endMs ?? batch.reporterMs ?? batch.executionEndMs;
    const lookupStartAt = batch.lookupStartMs;
    const lookupEndAt = batch.lookupEndMs ?? lookupStartAt;
    const taskGroups: RequestBatchTaskGroups = {
      lookupTasks: collectTasks(batch.lookupTaskIds, taskById),
      cacheLoadTasks: collectTasks(batch.cacheLoadTaskIds, taskById),
      posixLoadTasks: collectTasks(batch.posixLoadTaskIds, taskById),
      cacheDumpTasks: collectTasks(batch.cacheDumpTaskIds, taskById),
      posixDumpTasks: collectTasks(batch.posixDumpTaskIds, taskById)
    };
    const relatedLoadTasks = [...taskGroups.cacheLoadTasks, ...taskGroups.posixLoadTasks];
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
    const earliestCacheDumpStartAt = taskGroups.cacheDumpTasks.reduce<number | undefined>((min, task) => {
      const currentStart = taskStart(task);
      if (currentStart === undefined) {
        return min;
      }
      return min === undefined ? currentStart : Math.min(min, currentStart);
    }, undefined);
    const latestCacheDumpEndAt = taskGroups.cacheDumpTasks.reduce<number | undefined>((max, task) => {
      const currentEnd = taskEnd(task);
      if (currentEnd === undefined) {
        return max;
      }
      return max === undefined ? currentEnd : Math.max(max, currentEnd);
    }, undefined);
    const computeEndCandidates = [request.stages.prefillCompleteAt, earliestCacheDumpStartAt].filter(
      (value): value is number => value !== undefined
    );
    const computeEndAt =
      computeEndCandidates.length > 0
        ? Math.min(...computeEndCandidates)
        : request.stages.prefillCompleteAt ?? earliestCacheDumpStartAt ?? batch.reporterMs ?? batch.executionEndMs;
    const kvStageEndAt =
      requestFinishedAt ??
      request.stages.controlRequestAt ??
      request.stages.releaseResponseAt ??
      request.stages.kvReleaseAt;
    const kvTransferStartAt = latestCacheDumpEndAt ?? request.stages.prefillCompleteAt ?? computeEndAt;

    if (waitingCursor !== undefined && scheduleAt !== undefined && scheduleAt > waitingCursor) {
      const durationMs = scheduleAt - waitingCursor;
      metrics.queueWaitMs = (metrics.queueWaitMs ?? 0) + durationMs;
      phases.push({
        key: "queueWait",
        label: "Queue wait",
        start: waitingCursor,
        end: scheduleAt,
        batchId: batch.id,
        meta: {
          requestId: label,
          batchId: batch.id,
          durationMs
        }
      });
    }

    if (lookupStartAt !== undefined && lookupEndAt !== undefined && lookupEndAt >= lookupStartAt) {
      const durationMs = lookupEndAt - lookupStartAt;
      metrics.lookupMs = (metrics.lookupMs ?? 0) + durationMs;
      phases.push({
        key: "lookup",
        label: "Store lookup",
        start: lookupStartAt,
        end: lookupEndAt,
        batchId: batch.id,
        meta: {
          requestId: label,
          batchId: batch.id,
          durationMs,
          taskCount: batch.lookupCount,
          totalLookupMs: batch.lookupTotalMs
        }
      });
    }

    if (loadStartAt !== undefined && computeStartAt !== undefined && computeStartAt > loadStartAt) {
      const durationMs = computeStartAt - loadStartAt;
      metrics.cacheLoadMs = (metrics.cacheLoadMs ?? 0) + durationMs;
      phases.push({
        key: "cacheLoad",
        label: "Cache load",
        start: loadStartAt,
        end: computeStartAt,
        batchId: batch.id,
        meta: {
          requestId: label,
          batchId: batch.id,
          durationMs,
          cacheLoadTotalMs: batch.cacheLoadTotalMs,
          posixLoadTotalMs: batch.posixLoadTotalMs
        }
      });
    }

    if (computeStartAt !== undefined && computeEndAt !== undefined && computeEndAt >= computeStartAt) {
      const durationMs = computeEndAt - computeStartAt;
      metrics.modelComputeMs = (metrics.modelComputeMs ?? 0) + durationMs;
      phases.push({
        key: "modelCompute",
        label: "Model compute",
        start: computeStartAt,
        end: computeEndAt,
        batchId: batch.id,
        meta: {
          requestId: label,
          batchId: batch.id,
          durationMs
        }
      });
    }

    if (
      earliestCacheDumpStartAt !== undefined &&
      latestCacheDumpEndAt !== undefined &&
      latestCacheDumpEndAt > earliestCacheDumpStartAt &&
      batchIndex === batches.length - 1
    ) {
      const durationMs = latestCacheDumpEndAt - earliestCacheDumpStartAt;
      metrics.cacheDumpMs = durationMs;
      phases.push({
        key: "cacheDump",
        label: "Cache dump",
        start: earliestCacheDumpStartAt,
        end: latestCacheDumpEndAt,
        batchId: batch.id,
        meta: {
          requestId: label,
          batchId: batch.id,
          durationMs,
          taskCount: taskGroups.cacheDumpTasks.length
        }
      });
    }

    if (
      kvTransferStartAt !== undefined &&
      kvStageEndAt !== undefined &&
      kvStageEndAt > kvTransferStartAt &&
      batchIndex === batches.length - 1
    ) {
      const durationMs = kvStageEndAt - kvTransferStartAt;
      metrics.kvTransferFinishMs = durationMs;
      phases.push({
        key: "kvTransferFinish",
        label: "KV transfer / finish",
        start: kvTransferStartAt,
        end: kvStageEndAt,
        batchId: batch.id,
        meta: {
          requestId: label,
          batchId: batch.id,
          durationMs
        }
      });
    }

    derivedBatches.push({
      batch,
      scheduleAt,
      taskGroups
    });
    waitingCursor = batchEndAt ?? waitingCursor;
  }

  return {
    requestLabel: label,
    requestStartAt: requestEnteredAt,
    requestEndAt: requestFinishedAt,
    phases,
    batches: derivedBatches,
    metrics
  } satisfies DerivedRequestTimeline;
}
