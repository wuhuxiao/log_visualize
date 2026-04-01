import type {
  AnomalyRecord,
  NormalizedRequest,
  NormalizedUCTask,
  ParsedEvent,
  ScheduleBatch,
  SchedulerEvent
} from "../types/models";

const SLOW_SCHEDULER_THRESHOLD_MS = 1000;
const CACHE_POSIX_GAP_RATIO = 2;
const CACHE_POSIX_GAP_MS = 20;
const REQUEST_ANOMALY_RATIO = 0.2;

function uniqueTasks(taskIds: string[], taskMap: Map<string, NormalizedUCTask>) {
  return [...new Set(taskIds)]
    .map((taskId) => taskMap.get(taskId))
    .filter((task): task is NormalizedUCTask => task !== undefined);
}

function taskEnd(task: NormalizedUCTask) {
  return task.finishAt ?? task.startAt ?? task.dispatchAt;
}

function requestComputeDurationMs(
  request: NormalizedRequest,
  batch: ScheduleBatch | undefined,
  taskMap: Map<string, NormalizedUCTask>,
  schedulerEventMap: Map<string, SchedulerEvent>
) {
  const computeEndAt = request.stages.prefillCompleteAt;
  if (!batch || computeEndAt === undefined) {
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

  const loadTasks = uniqueTasks([...batch.cacheLoadTaskIds, ...batch.posixLoadTaskIds], taskMap);
  const latestLoadFinishAt = loadTasks.reduce<number | undefined>((max, task) => {
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

  return {
    computeStartAt,
    computeEndAt,
    durationMs: computeEndAt - computeStartAt,
    latestSchedulingAt,
    latestLoadFinishAt
  };
}

function markBatchEvents(
  batch: ScheduleBatch | undefined,
  anomalyType: AnomalyRecord["type"],
  eventMap: Map<string, ParsedEvent>
) {
  if (!batch) {
    return;
  }

  const relatedEventIds = [
    batch.reporterEventId,
    ...batch.schedulingEventIds,
    ...batch.responseEventIds
  ];

  for (const eventId of relatedEventIds) {
    const event = eventMap.get(eventId);
    if (event && !event.anomalyTags.includes(anomalyType)) {
      event.anomalyTags.push(anomalyType);
    }
  }
}

function anomalyCount(total: number) {
  if (total === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(total * REQUEST_ANOMALY_RATIO));
}

export function detectAnomalies(
  events: ParsedEvent[],
  requests: NormalizedRequest[],
  tasks: NormalizedUCTask[],
  scheduleBatches: ScheduleBatch[]
): AnomalyRecord[] {
  const anomalies: AnomalyRecord[] = [];
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const requestMap = new Map(requests.map((request) => [request.id, request]));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const batchMap = new Map(scheduleBatches.map((batch) => [batch.id, batch]));
  const schedulerEventMap = new Map(
    events
      .filter((event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_scheduling")
      .map((event) => [event.id, event])
  );

  events.forEach((event) => {
    if (event.eventType === "scheduler") {
      const responseCost = typeof event.extracted.responseCostMs === "number" ? event.extracted.responseCostMs : event.costMs;
      if ((responseCost ?? 0) > SLOW_SCHEDULER_THRESHOLD_MS) {
        const anomaly: AnomalyRecord = {
          id: `anomaly:${event.id}:slow-response`,
          type: "slow_scheduler_response",
          severity: "warning",
          title: "Scheduler response cost too long",
          description: `response cost ${responseCost}ms exceeds ${SLOW_SCHEDULER_THRESHOLD_MS}ms`,
          eventId: event.id,
          workerId: event.workerId,
          timestampMs: event.timestampMs,
          metrics: {
            responseCostMs: responseCost ?? null,
            scheduleCostMs: event.extracted.scheduleCostMs ?? null,
            totalIterCostMs: event.extracted.totalIterCostMs ?? null
          }
        };
        anomalies.push(anomaly);
        event.anomalyTags.push(anomaly.type);
      }
    }

    if (event.eventName === "sequence_group_missing") {
      const targetRequest = requests.find(
        (request) =>
          request.seqId !== undefined &&
          request.seqId === event.requestRef?.seqId
      );
      const anomaly: AnomalyRecord = {
        id: `anomaly:${event.id}:sequence-group`,
        type: "sequence_group_missing",
        severity: "error",
        title: "Sequence group missing",
        description: "Sequence group lookup failed during request handling",
        eventId: event.id,
        requestId: targetRequest?.id,
        workerId: event.workerId,
        timestampMs: event.timestampMs,
        metrics: {
          seqId: event.requestRef?.seqId ?? null
        }
      };
      anomalies.push(anomaly);
      event.anomalyTags.push(anomaly.type);
      if (targetRequest) {
        targetRequest.anomalies.push(anomaly);
        targetRequest.status = "anomalous";
      }
    }
  });

  requests.forEach((request) => {
    const started = request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
    const finished = request.stages.endedAt ?? request.stages.releaseResponseAt;
    if (started !== undefined && finished === undefined) {
      const anomaly: AnomalyRecord = {
        id: `anomaly:${request.id}:incomplete`,
        type: "request_incomplete",
        severity: "warning",
        title: "Request missing terminal event",
        description: "Request has start events but no explicit completion or release response",
        requestId: request.id,
        workerId: request.workerIds[0],
        timestampMs: started,
        metrics: {
          llmMgrReqId: request.llmMgrReqId ?? null,
          engineReqId: request.engineReqId ?? null,
          seqId: request.seqId ?? null
        }
      };
      anomalies.push(anomaly);
      request.anomalies.push(anomaly);
      request.status = request.status === "anomalous" ? "anomalous" : "incomplete";
    }
  });

  tasks.forEach((task) => {
    if (task.ucKind !== "cache" || task.costMs === undefined || !task.pairedPosixTaskId) {
      return;
    }

    const paired = taskMap.get(task.pairedPosixTaskId);
    if (!paired?.costMs) {
      return;
    }

    const ratio = task.costMs / paired.costMs;
    const delta = task.costMs - paired.costMs;
    if (ratio >= CACHE_POSIX_GAP_RATIO && delta >= CACHE_POSIX_GAP_MS) {
      const anomaly: AnomalyRecord = {
        id: `anomaly:${task.id}:cache-gap`,
        type: "cache_posix_gap",
        severity: "warning",
        title: "Cache task overhead is much larger than Posix cost",
        description: `cache task ${task.costMs.toFixed(2)}ms vs posix ${paired.costMs.toFixed(2)}ms`,
        requestId: task.relatedRequestIds[0]?.requestId,
        taskId: task.id,
        workerId: task.workerId,
        timestampMs: task.finishAt ?? task.dispatchAt,
        metrics: {
          cacheCostMs: task.costMs,
          posixCostMs: paired.costMs,
          deltaMs: delta,
          ratio
        }
      };
      anomalies.push(anomaly);
      task.anomalies.push(anomaly);
      paired.anomalies.push(anomaly);
    }
  });

  const requestBandwidthRows = requests
    .map((request) => {
      const batches = request.relatedScheduleBatchIds
        .map((batchId) => batchMap.get(batchId))
        .filter((batch): batch is ScheduleBatch => batch !== undefined);
      const loadTasks = uniqueTasks(
        batches.flatMap((batch) => batch.cacheLoadTaskIds),
        taskMap
      ).filter((task) => task.bytes !== undefined && task.costMs !== undefined && (task.costMs ?? 0) > 0);

      const totalBytes = loadTasks.reduce((sum, task) => sum + (task.bytes ?? 0), 0);
      const totalCostMs = loadTasks.reduce((sum, task) => sum + (task.costMs ?? 0), 0);
      if (loadTasks.length === 0 || totalBytes <= 0 || totalCostMs <= 0) {
        return undefined;
      }

      return {
        request,
        batches,
        loadTasks,
        totalBytes,
        totalCostMs,
        bandwidthMBps: totalBytes / 1024 / 1024 / (totalCostMs / 1000)
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .sort((left, right) => left.bandwidthMBps - right.bandwidthMBps);

  for (const row of requestBandwidthRows.slice(0, anomalyCount(requestBandwidthRows.length))) {
    const anomaly: AnomalyRecord = {
      id: `anomaly:${row.request.id}:low-cache-bandwidth`,
      type: "low_cache_bandwidth",
      severity: "warning",
      title: "Cache load bandwidth is in the slowest 20%",
      description: `aggregate cache load bandwidth ${row.bandwidthMBps.toFixed(2)} MB/s is in the lowest 20% of requests`,
      requestId: row.request.id,
      workerId: row.request.workerIds[0],
      timestampMs: row.request.stages.enteredAt ?? row.request.stages.addedAt,
      metrics: {
        bandwidthMBps: Number(row.bandwidthMBps.toFixed(3)),
        totalBytes: row.totalBytes,
        totalCostMs: Number(row.totalCostMs.toFixed(3)),
        taskCount: row.loadTasks.length
      }
    };
    anomalies.push(anomaly);
    row.request.anomalies.push(anomaly);
    row.request.status = "anomalous";
    row.loadTasks.forEach((task) => task.anomalies.push(anomaly));
    row.batches.forEach((batch) => markBatchEvents(batch, anomaly.type, eventMap));
  }

  const requestComputeRows = requests
    .map((request) => {
      const batch = [...request.relatedScheduleBatchIds]
        .map((batchId) => batchMap.get(batchId))
        .filter((item): item is ScheduleBatch => item !== undefined)
        .sort((left, right) => (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER))
        .at(-1);

      const compute = requestComputeDurationMs(request, batch, taskMap, schedulerEventMap);
      if (!batch || !compute) {
        return undefined;
      }

      return {
        request,
        batch,
        ...compute
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .sort((left, right) => right.durationMs - left.durationMs);

  for (const row of requestComputeRows.slice(0, anomalyCount(requestComputeRows.length))) {
    const anomaly: AnomalyRecord = {
      id: `anomaly:${row.request.id}:slow-model-compute`,
      type: "slow_model_compute",
      severity: "warning",
      title: "Model compute time is in the slowest 20%",
      description: `model compute duration ${row.durationMs.toFixed(2)}ms is in the highest 20% of requests`,
      requestId: row.request.id,
      workerId: row.request.workerIds[0],
      timestampMs: row.computeStartAt,
      metrics: {
        computeStartAt: row.computeStartAt,
        computeEndAt: row.computeEndAt,
        durationMs: Number(row.durationMs.toFixed(3)),
        latestSchedulingAt: row.latestSchedulingAt ?? null,
        latestLoadFinishAt: row.latestLoadFinishAt ?? null
      }
    };
    anomalies.push(anomaly);
    row.request.anomalies.push(anomaly);
    row.request.status = "anomalous";
    markBatchEvents(row.batch, anomaly.type, eventMap);
  }

  return anomalies.sort(
    (left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER)
  );
}
