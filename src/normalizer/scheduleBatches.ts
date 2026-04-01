import { quantile } from "../utils/stats";
import type {
  NormalizedRequest,
  NormalizedUCTask,
  ParsedEvent,
  PrefixCacheEvent,
  ScheduleBatch,
  SchedulerEvent
} from "../types/models";

const REQUEST_BATCH_GAP_MS = 6_000;
const EVENT_MATCH_WINDOW_MS = 5_000;

function getTaskStart(task: NormalizedUCTask): number | undefined {
  return task.dispatchAt ?? task.startAt ?? task.finishAt;
}

function getTaskEnd(task: NormalizedUCTask): number | undefined {
  return task.finishAt ?? task.startAt ?? task.dispatchAt;
}

function getRequestEnd(request: NormalizedRequest): number | undefined {
  return (
    request.stages.endedAt ??
    request.stages.releaseResponseAt ??
    request.stages.kvReleaseAt ??
    request.stages.prefillCompleteAt ??
    request.stages.decodeFinishedAt
  );
}

function uniqueSortedNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => value !== undefined))].sort((a, b) => a - b);
}

function uniqueSortedStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA <= endB && startB <= endA;
}

function collectTaskIds(tasks: NormalizedUCTask[]) {
  return [...new Set(tasks.map((task) => task.id))];
}

function matchSchedulingEvents(
  events: SchedulerEvent[],
  reporterMs: number,
  previousReporterMs: number | undefined,
  dpRanks: number[]
) {
  return events.filter((event) => {
    const eventTime = event.timestampMs;
    if (eventTime === undefined) {
      return false;
    }

    if (eventTime > reporterMs || reporterMs - eventTime > EVENT_MATCH_WINDOW_MS) {
      return false;
    }

    if (previousReporterMs !== undefined && eventTime < previousReporterMs) {
      return false;
    }

    const eventRank = event.requestRef?.dpRank;
    return dpRanks.length === 0 || eventRank === undefined || dpRanks.includes(eventRank);
  });
}

function matchResponseEvents(
  events: SchedulerEvent[],
  reporterMs: number,
  batchEndMs: number,
  nextReporterMs: number | undefined,
  dpRanks: number[]
) {
  return events.filter((event) => {
    const eventTime = event.timestampMs;
    if (eventTime === undefined) {
      return false;
    }

    if (eventTime < reporterMs || eventTime > batchEndMs + EVENT_MATCH_WINDOW_MS) {
      return false;
    }

    if (nextReporterMs !== undefined && eventTime >= nextReporterMs) {
      return false;
    }

    const eventRank = event.requestRef?.dpRank;
    return dpRanks.length === 0 || eventRank === undefined || dpRanks.includes(eventRank);
  });
}

function buildTaskStats(tasks: NormalizedUCTask[]) {
  const durations = tasks
    .map((task) => task.costMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);

  let startMs: number | undefined;
  let endMs: number | undefined;

  for (const task of tasks) {
    const taskStart = getTaskStart(task);
    const taskEnd = getTaskEnd(task);
    if (taskStart !== undefined) {
      startMs = startMs === undefined ? taskStart : Math.min(startMs, taskStart);
    }
    if (taskEnd !== undefined) {
      endMs = endMs === undefined ? taskEnd : Math.max(endMs, taskEnd);
    }
  }

  return {
    startMs,
    endMs,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    p50Ms: durations.length > 0 ? quantile(durations, 0.5) : undefined,
    p90Ms: durations.length > 0 ? quantile(durations, 0.9) : undefined,
    maxMs: durations.length > 0 ? durations[durations.length - 1] : undefined
  };
}

function requestKvTransferAnchor(request: NormalizedRequest) {
  return (
    request.stages.decodeFinishedAt ??
    request.stages.prefillCompleteAt ??
    request.stages.controlRequestAt ??
    request.stages.releaseResponseAt ??
    request.stages.kvReleaseAt ??
    getRequestEnd(request)
  );
}

function batchAssignmentAnchor(batch: ScheduleBatch) {
  return batch.reporterMs ?? batch.executionEndMs ?? batch.startMs ?? batch.endMs;
}

function assignRequestsToBatches(requests: NormalizedRequest[], batches: ScheduleBatch[]) {
  for (const request of requests) {
    request.relatedScheduleBatchIds = [];
  }

  for (const batch of batches) {
    batch.requestIds = [];
  }

  for (const request of requests) {
    const kvTransferAnchor = requestKvTransferAnchor(request);
    if (kvTransferAnchor === undefined) {
      continue;
    }

    const chosenBatch = batches
      .filter((batch) => {
        const anchor = batchAssignmentAnchor(batch);
        return anchor !== undefined && anchor <= kvTransferAnchor;
      })
      .sort(
        (left, right) =>
          (batchAssignmentAnchor(right) ?? Number.NEGATIVE_INFINITY) -
          (batchAssignmentAnchor(left) ?? Number.NEGATIVE_INFINITY)
      )[0];

    if (!chosenBatch) {
      continue;
    }

    chosenBatch.requestIds.push(request.id);
    request.relatedScheduleBatchIds = [chosenBatch.id];
  }
}

export function correlateScheduleBatches(
  events: ParsedEvent[],
  requests: NormalizedRequest[],
  tasks: NormalizedUCTask[]
): ScheduleBatch[] {
  const prefixReporters = events
    .filter(
      (event): event is PrefixCacheEvent =>
        event.eventType === "prefix_cache" && event.scope === "request" && event.timestampMs !== undefined
    )
    .sort((left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER));

  const schedulingEvents = events
    .filter(
      (event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_scheduling"
    )
    .sort((left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER));

  const responseEvents = events
    .filter(
      (event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_response"
    )
    .sort((left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER));

  const lookupTasks = tasks.filter((task) => task.category === "Lookup");
  const cacheLoadTasks = tasks.filter((task) => task.category === "Load");
  const posixLoadTasks = tasks.filter((task) => task.category === "Backend2Cache");
  const cacheDumpTasks = tasks.filter((task) => task.category === "Dump");
  const posixDumpTasks = tasks.filter((task) => task.category === "Cache2Backend");
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const batches = prefixReporters.map<ScheduleBatch>((reporter, index) => {
    const reporterMs = reporter.timestampMs!;
    const previousReporterMs = prefixReporters[index - 1]?.timestampMs;
    const nextReporterMs = prefixReporters[index + 1]?.timestampMs;

    const matchedSchedulingEvents = matchSchedulingEvents(schedulingEvents, reporterMs, previousReporterMs, []);
    const provisionalDpRanks = uniqueSortedNumbers(matchedSchedulingEvents.map((event) => event.requestRef?.dpRank));

    const preStartCandidates = [
      ...matchedSchedulingEvents.map((event) => event.timestampMs),
      ...lookupTasks.map((task) => getTaskStart(task)).filter((time) => time !== undefined && time <= reporterMs),
      ...cacheLoadTasks.map((task) => getTaskStart(task)).filter((time) => time !== undefined && time <= reporterMs),
      ...posixLoadTasks.map((task) => getTaskStart(task)).filter((time) => time !== undefined && time <= reporterMs)
    ] as number[];

    const startBoundary = previousReporterMs ?? reporterMs - EVENT_MATCH_WINDOW_MS;
    const startMs = preStartCandidates
      .filter((time) => time >= startBoundary && reporterMs - time <= EVENT_MATCH_WINDOW_MS)
      .reduce<number | undefined>((min, value) => (min === undefined ? value : Math.min(min, value)), undefined) ?? reporterMs;

    const batchLookupTasks = lookupTasks.filter((task) => {
      const taskStart = getTaskStart(task);
      const taskEnd = getTaskEnd(task);
      return (
        taskStart !== undefined &&
        taskEnd !== undefined &&
        overlaps(taskStart, taskEnd, startMs, reporterMs)
      );
    });

    const batchCacheLoadTasks = cacheLoadTasks.filter((task) => {
      const taskStart = getTaskStart(task);
      const taskEnd = getTaskEnd(task);
      return (
        taskStart !== undefined &&
        taskEnd !== undefined &&
        overlaps(taskStart, taskEnd, startMs, reporterMs)
      );
    });

    const batchPosixLoadTasks = posixLoadTasks.filter((task) => {
      const taskStart = getTaskStart(task);
      const taskEnd = getTaskEnd(task);
      return (
        taskStart !== undefined &&
        taskEnd !== undefined &&
        overlaps(taskStart, taskEnd, startMs, reporterMs)
      );
    });

    const postReporterWindowEnd = nextReporterMs ?? reporterMs + REQUEST_BATCH_GAP_MS;
    const batchCacheDumpTasks = cacheDumpTasks.filter((task) => {
      const taskStart = getTaskStart(task);
      const taskEnd = getTaskEnd(task);
      return (
        taskStart !== undefined &&
        taskEnd !== undefined &&
        overlaps(taskStart, taskEnd, reporterMs, postReporterWindowEnd)
      );
    });

    const batchPosixDumpTasks = posixDumpTasks.filter((task) => {
      const taskStart = getTaskStart(task);
      const taskEnd = getTaskEnd(task);
      return (
        taskStart !== undefined &&
        taskEnd !== undefined &&
        overlaps(taskStart, taskEnd, reporterMs, postReporterWindowEnd)
      );
    });

    const dumpEndCandidates = [
      ...batchCacheDumpTasks.map((task) => getTaskEnd(task)),
      ...batchPosixDumpTasks.map((task) => getTaskEnd(task)),
      ...responseEvents
        .map((event) => event.timestampMs)
        .filter((value): value is number => value !== undefined && value >= reporterMs && value <= postReporterWindowEnd),
      reporterMs
    ].filter((value): value is number => value !== undefined);

    const endMs =
      dumpEndCandidates.reduce<number | undefined>(
        (max, value) => (max === undefined ? value : Math.max(max, value)),
        undefined
      ) ?? reporterMs;

    const matchedResponseEvents = matchResponseEvents(
      responseEvents,
      reporterMs,
      endMs,
      nextReporterMs,
      provisionalDpRanks
    );
    const dpRanks = uniqueSortedNumbers([
      ...provisionalDpRanks,
      ...matchedResponseEvents.map((event) => event.requestRef?.dpRank)
    ]);
    const lookupStats = buildTaskStats(batchLookupTasks);
    const cacheLoadStats = buildTaskStats(batchCacheLoadTasks);
    const posixLoadStats = buildTaskStats(batchPosixLoadTasks);
    const cacheDumpStats = buildTaskStats(batchCacheDumpTasks);
    const posixDumpStats = buildTaskStats(batchPosixDumpTasks);

    const computeStartMs =
      [
        lookupStats.endMs,
        cacheLoadStats.endMs,
        posixLoadStats.endMs,
        startMs
      ]
        .filter((value): value is number => value !== undefined)
        .reduce((max, value) => Math.max(max, value), startMs);

    const executionEndMs = reporterMs;
    const taskIds = collectTaskIds([
      ...batchLookupTasks,
      ...batchCacheLoadTasks,
      ...batchPosixLoadTasks,
      ...batchCacheDumpTasks,
      ...batchPosixDumpTasks
    ]);

    const workerIds = uniqueSortedStrings([
      reporter.workerId,
      ...matchedSchedulingEvents.map((event) => event.workerId),
      ...matchedResponseEvents.map((event) => event.workerId),
      ...taskIds.map((taskId) => taskById.get(taskId)?.workerId)
    ]);

    const pids = uniqueSortedNumbers([
      reporter.pid,
      ...matchedSchedulingEvents.map((event) => event.pid),
      ...matchedResponseEvents.map((event) => event.pid),
      ...taskIds.map((taskId) => taskById.get(taskId)?.pid)
    ]);

    const schedulingRound =
      matchedResponseEvents
        .map((event) => event.extracted.schedulingRound)
        .find((value): value is number => typeof value === "number") ??
      matchedSchedulingEvents
        .map((event) => event.extracted.schedulingRound)
        .find((value): value is number => typeof value === "number");

    const batch: ScheduleBatch = {
      id: `schedule-batch-${index + 1}`,
      schedulingRound,
      reporterEventId: reporter.id,
      reporterMs,
      startMs,
      computeStartMs,
      executionEndMs,
      endMs,
      workerIds,
      pids,
      dpRanks,
      schedulingEventIds: matchedSchedulingEvents.map((event) => event.id),
      responseEventIds: matchedResponseEvents.map((event) => event.id),
      requestIds: [],
      taskIds,
      lookupTaskIds: collectTaskIds(batchLookupTasks),
      lookupCount: batchLookupTasks.length,
      lookupTotalMs: lookupStats.totalMs,
      lookupStartMs: lookupStats.startMs,
      lookupEndMs: lookupStats.endMs,
      lookupP50Ms: lookupStats.p50Ms,
      lookupP90Ms: lookupStats.p90Ms,
      lookupMaxMs: lookupStats.maxMs,
      cacheLoadTaskIds: collectTaskIds(batchCacheLoadTasks),
      posixLoadTaskIds: collectTaskIds(batchPosixLoadTasks),
      cacheDumpTaskIds: collectTaskIds(batchCacheDumpTasks),
      posixDumpTaskIds: collectTaskIds(batchPosixDumpTasks),
      cacheLoadTotalMs: cacheLoadStats.totalMs,
      posixLoadTotalMs: posixLoadStats.totalMs,
      cacheDumpTotalMs: cacheDumpStats.totalMs,
      posixDumpTotalMs: posixDumpStats.totalMs
    };

    return batch;
  });
  const sortedBatches = batches.sort((left, right) => (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER));
  assignRequestsToBatches(requests, sortedBatches);
  return sortedBatches;
}
