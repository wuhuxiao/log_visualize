import type {
  AnalysisResult,
  FilterState,
  NormalizedRequest,
  NormalizedUCTask,
  ParsedEvent,
  ScheduleBatch,
  SchedulerEvent
} from "../types/models";
import { hasDisplayRequestAnomaly, hasDisplayTaskAnomaly } from "./anomalyDisplay";

export interface RequestMetricSnapshot {
  cacheLoadBandwidthMBps?: number;
  cacheDumpBandwidthMBps?: number;
  modelComputeMs?: number;
}

function matchesSearch(event: ParsedEvent, searchText: string) {
  if (!searchText) {
    return true;
  }

  const lower = searchText.toLowerCase();
  return [
    event.requestRef?.llmMgrReqId,
    event.requestRef?.llmMgrReqIdRaw,
    event.requestRef?.engineReqId,
    event.requestRef?.seqId,
    event.rawMessage
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(lower));
}

function matchesCoreFilters(
  workerId: string | undefined,
  pid: number | undefined,
  dpRank: number | undefined,
  eventType: string,
  searchMatches: boolean,
  filters: FilterState,
  anomalyTags: string[]
) {
  const workerOk = filters.workerIds.length === 0 || (workerId ? filters.workerIds.includes(workerId) : false);
  const pidOk = filters.pids.length === 0 || (pid !== undefined && filters.pids.includes(pid));
  const dpOk = filters.dpRanks.length === 0 || (dpRank !== undefined && filters.dpRanks.includes(dpRank));
  const eventOk = filters.eventTypes.length === 0 || filters.eventTypes.includes(eventType as never);
  const anomalyOk = !filters.onlyAnomalies || anomalyTags.some((tag) => tag === "low_cache_bandwidth" || tag === "cache_posix_gap");
  return workerOk && pidOk && dpOk && eventOk && searchMatches && anomalyOk;
}

function taskEnd(task: NormalizedUCTask) {
  return task.finishAt ?? task.startAt ?? task.dispatchAt;
}

function aggregateBandwidth(taskIds: string[], taskMap: Map<string, NormalizedUCTask>) {
  const tasks = [...new Set(taskIds)]
    .map((taskId) => taskMap.get(taskId))
    .filter(
      (task): task is NormalizedUCTask =>
        task !== undefined && task.bytes !== undefined && task.costMs !== undefined && task.costMs > 0
    );

  if (tasks.length === 0) {
    return undefined;
  }

  const totalBytes = tasks.reduce((sum, task) => sum + (task.bytes ?? 0), 0);
  const totalCostMs = tasks.reduce((sum, task) => sum + (task.costMs ?? 0), 0);

  if (totalBytes <= 0 || totalCostMs <= 0) {
    return undefined;
  }

  return totalBytes / 1024 / 1024 / (totalCostMs / 1000);
}

function computeBatchModelComputeMs(
  request: NormalizedRequest,
  batch: ScheduleBatch,
  taskMap: Map<string, NormalizedUCTask>,
  schedulerEventMap: Map<string, SchedulerEvent>
) {
  const computeEndAt = request.stages.prefillCompleteAt;
  if (computeEndAt === undefined) {
    return undefined;
  }

  const schedulingEvents = batch.schedulingEventIds
    .map((eventId) => schedulerEventMap.get(eventId))
    .filter((event): event is SchedulerEvent => event !== undefined)
    .filter((event) => request.dpRank === undefined || event.requestRef?.dpRank === request.dpRank);

  const latestSchedulingAt = schedulingEvents.reduce<number | undefined>((max, event) => {
    if (event.timestampMs === undefined) {
      return max;
    }
    return max === undefined ? event.timestampMs : Math.max(max, event.timestampMs);
  }, undefined);

  const relatedLoadTasks = [...batch.cacheLoadTaskIds, ...batch.posixLoadTaskIds]
    .map((taskId) => taskMap.get(taskId))
    .filter((task): task is NormalizedUCTask => task !== undefined);

  const latestLoadFinishAt = relatedLoadTasks.reduce<number | undefined>((max, task) => {
    const endAt = taskEnd(task);
    if (endAt === undefined) {
      return max;
    }
    return max === undefined ? endAt : Math.max(max, endAt);
  }, undefined);

  const computeStartAt = [latestSchedulingAt, latestLoadFinishAt]
    .filter((value): value is number => value !== undefined)
    .reduce<number | undefined>((max, value) => (max === undefined ? value : Math.max(max, value)), undefined);

  if (computeStartAt === undefined || computeEndAt < computeStartAt) {
    return undefined;
  }

  return computeEndAt - computeStartAt;
}

export function buildRequestMetricSnapshots(result: AnalysisResult) {
  const taskMap = new Map(result.ucTasks.map((task) => [task.id, task]));
  const batchMap = new Map(result.scheduleBatches.map((batch) => [batch.id, batch]));
  const schedulerEventMap = new Map(
    result.events
      .filter((event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_scheduling")
      .map((event) => [event.id, event])
  );

  const snapshots = new Map<string, RequestMetricSnapshot>();

  for (const request of result.requests) {
    const batches = request.relatedScheduleBatchIds
      .map((batchId) => batchMap.get(batchId))
      .filter((batch): batch is ScheduleBatch => batch !== undefined);

    const cacheLoadBandwidths = batches
      .map((batch) => aggregateBandwidth(batch.cacheLoadTaskIds, taskMap))
      .filter((value): value is number => value !== undefined);

    const cacheDumpBandwidths = batches
      .map((batch) => aggregateBandwidth(batch.cacheDumpTaskIds, taskMap))
      .filter((value): value is number => value !== undefined);

    const modelComputeDurations = batches
      .map((batch) => computeBatchModelComputeMs(request, batch, taskMap, schedulerEventMap))
      .filter((value): value is number => value !== undefined);

    snapshots.set(request.id, {
      cacheLoadBandwidthMBps:
        cacheLoadBandwidths.length > 0 ? Math.min(...cacheLoadBandwidths) : undefined,
      cacheDumpBandwidthMBps:
        cacheDumpBandwidths.length > 0 ? Math.min(...cacheDumpBandwidths) : undefined,
      modelComputeMs:
        modelComputeDurations.length > 0 ? Math.max(...modelComputeDurations) : undefined
    });
  }

  return snapshots;
}

function matchesCustomRequestThresholds(metrics: RequestMetricSnapshot | undefined, filters: FilterState) {
  const thresholds = filters.customRequestThresholds;
  if (!thresholds.enabled) {
    return true;
  }

  const loadOk =
    thresholds.maxCacheLoadBandwidthMBps === undefined ||
    ((metrics?.cacheLoadBandwidthMBps ?? Number.POSITIVE_INFINITY) <= thresholds.maxCacheLoadBandwidthMBps);

  const dumpOk =
    thresholds.maxCacheDumpBandwidthMBps === undefined ||
    ((metrics?.cacheDumpBandwidthMBps ?? Number.POSITIVE_INFINITY) <= thresholds.maxCacheDumpBandwidthMBps);

  const computeOk =
    thresholds.minModelComputeMs === undefined ||
    ((metrics?.modelComputeMs ?? Number.NEGATIVE_INFINITY) >= thresholds.minModelComputeMs);

  return loadOk && dumpOk && computeOk;
}

export function filterEvents(result: AnalysisResult, filters: FilterState): ParsedEvent[] {
  return result.events.filter((event) =>
    matchesCoreFilters(
      event.workerId,
      event.pid,
      event.requestRef?.dpRank,
      event.eventType,
      matchesSearch(event, filters.searchText),
      filters,
      event.anomalyTags
    )
  );
}

export function filterRequests(
  result: AnalysisResult,
  filters: FilterState,
  visibleEvents: ParsedEvent[]
): NormalizedRequest[] {
  const visibleEventIds = new Set(visibleEvents.map((event) => event.id));
  const requestMetrics = buildRequestMetricSnapshots(result);

  return result.requests.filter((request) => {
    const matchesIds =
      !filters.searchText ||
      [request.llmMgrReqId, request.llmMgrReqIdRaw, request.engineReqId, request.seqId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filters.searchText.toLowerCase()));

    const workerOk =
      filters.workerIds.length === 0 || request.workerIds.some((workerId) => filters.workerIds.includes(workerId));
    const pidOk = filters.pids.length === 0 || request.pidSet.some((pid) => filters.pids.includes(pid));
    const dpOk = filters.dpRanks.length === 0 || (request.dpRank !== undefined && filters.dpRanks.includes(request.dpRank));
    const eventOk = filters.eventTypes.length === 0 || filters.eventTypes.includes("request");
    const anomalyOk = !filters.onlyAnomalies || hasDisplayRequestAnomaly(request);
    const thresholdOk = matchesCustomRequestThresholds(requestMetrics.get(request.id), filters);
    const hasVisibleEvent =
      request.lifecycleEvents.some((event) => visibleEventIds.has(event.id)) ||
      (filters.onlyAnomalies && hasDisplayRequestAnomaly(request));
    return workerOk && pidOk && dpOk && eventOk && anomalyOk && matchesIds && hasVisibleEvent && thresholdOk;
  });
}

export function filterUCTasks(
  result: AnalysisResult,
  filters: FilterState,
  visibleRequestIds: Set<string>
): NormalizedUCTask[] {
  const search = filters.searchText.toLowerCase();
  return result.ucTasks.filter((task) => {
    const searchOk =
      !filters.searchText ||
      task.relatedRequestIds.some(({ requestId }) => visibleRequestIds.has(requestId)) ||
      [task.taskId, task.taskType, task.direction, task.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    const workerOk = filters.workerIds.length === 0 || filters.workerIds.includes(task.workerId);
    const pidOk = filters.pids.length === 0 || (task.pid !== undefined && filters.pids.includes(task.pid));
    const eventOk = filters.eventTypes.length === 0 || filters.eventTypes.includes("uc_task");
    const anomalyOk = !filters.onlyAnomalies || hasDisplayTaskAnomaly(task);
    return workerOk && pidOk && eventOk && anomalyOk && searchOk;
  });
}
