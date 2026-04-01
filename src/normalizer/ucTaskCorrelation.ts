import type {
  CorrelationConfidence,
  NormalizedRequest,
  NormalizedUCTask,
  ParsedEvent,
  UCTaskEvent
} from "../types/models";

interface UCTaskBuilder {
  id: string;
  pid?: number;
  workerId: string;
  ucKind: "cache" | "posix" | "lookup";
  taskId?: string;
  taskType?: string;
  direction?: "Backend2Cache" | "Cache2Backend";
  category: NormalizedUCTask["category"];
  shards?: number;
  bytes?: number;
  dispatchAt?: number;
  startAt?: number;
  finishAt?: number;
  waitMs?: number;
  mkBufMs?: number;
  syncMs?: number;
  backMs?: number;
  costMs?: number;
  eventIds: string[];
  uncertain: boolean;
  pairedPosixTaskId?: string;
  relatedRequestIds: Array<{
    requestId: string;
    confidence: CorrelationConfidence;
  }>;
}

function categoryFromEvent(event: UCTaskEvent): NormalizedUCTask["category"] {
  if (event.ucKind === "lookup") {
    return "Lookup";
  }

  if (event.ucKind === "cache") {
    if (event.taskType === "Dump") {
      return "Dump";
    }
    return "Load";
  }

  if (event.direction === "Cache2Backend") {
    return "Cache2Backend";
  }

  return "Backend2Cache";
}

function overlaps(
  startA: number,
  endA: number,
  startB: number,
  endB: number
) {
  return startA <= endB && startB <= endA;
}

export function correlateUCTasks(
  events: ParsedEvent[],
  requests: NormalizedRequest[]
): NormalizedUCTask[] {
  const builders: UCTaskBuilder[] = [];
  let counter = 0;

  function findBuilder(event: UCTaskEvent): UCTaskBuilder | undefined {
    const candidates = builders
      .filter((builder) => builder.pid === event.pid && builder.ucKind === event.ucKind && builder.taskId === event.taskId)
      .filter((builder) => !builder.finishAt || event.ucPhase !== "dispatch")
      .filter((builder) => !event.taskType || !builder.taskType || builder.taskType === event.taskType)
      .filter((builder) => !event.direction || !builder.direction || builder.direction === event.direction)
      .sort((left, right) => {
        const leftTime = left.finishAt ?? left.startAt ?? left.dispatchAt ?? 0;
        const rightTime = right.finishAt ?? right.startAt ?? right.dispatchAt ?? 0;
        return rightTime - leftTime;
      });
    return candidates[0];
  }

  function createBuilder(event: UCTaskEvent): UCTaskBuilder {
    const builder: UCTaskBuilder = {
      id: `uc-task-${++counter}`,
      pid: event.pid,
      workerId: event.workerId,
      ucKind: event.ucKind,
      taskId: event.taskId,
      taskType: event.taskType,
      direction: event.direction,
      category: categoryFromEvent(event),
      shards: event.shards,
      bytes: event.bytes,
      eventIds: [],
      uncertain: !!event.uncertain,
      relatedRequestIds: []
    };
    builders.push(builder);
    return builder;
  }

  for (const event of events) {
    if (event.eventType !== "uc_task") {
      continue;
    }

    const ucEvent = event as UCTaskEvent;
    const builder =
      ucEvent.ucPhase === "dispatch" || ucEvent.ucKind === "lookup"
        ? createBuilder(ucEvent)
        : findBuilder(ucEvent) ?? createBuilder({ ...ucEvent, uncertain: true });

    builder.taskType ??= ucEvent.taskType;
    builder.direction ??= ucEvent.direction;
    builder.shards ??= ucEvent.shards;
    builder.bytes ??= ucEvent.bytes;
    builder.costMs ??= ucEvent.costMs;
    builder.uncertain ||= !!ucEvent.uncertain;
    builder.eventIds.push(ucEvent.id);

    if (ucEvent.timestampMs !== undefined) {
      if (ucEvent.ucPhase === "lookup") {
        builder.dispatchAt ??= ucEvent.timestampMs;
        builder.finishAt ??= ucEvent.timestampMs;
      }
      if (ucEvent.ucPhase === "dispatch") {
        builder.dispatchAt = ucEvent.timestampMs;
      }
      if (ucEvent.ucPhase === "start") {
        builder.startAt = ucEvent.timestampMs;
      }
      if (ucEvent.ucPhase === "finish") {
        builder.finishAt = ucEvent.timestampMs;
      }
    }

    const extracted = ucEvent.extracted;
    const waitMs = typeof extracted.waitMs === "number" ? extracted.waitMs : undefined;
    const mkBufMs = typeof extracted.mkBufMs === "number" ? extracted.mkBufMs : undefined;
    const syncMs = typeof extracted.syncMs === "number" ? extracted.syncMs : undefined;
    const backMs = typeof extracted.backMs === "number" ? extracted.backMs : undefined;
    builder.waitMs ??= waitMs;
    builder.mkBufMs ??= mkBufMs;
    builder.syncMs ??= syncMs;
    builder.backMs ??= backMs;
  }

  const tasks: NormalizedUCTask[] = builders.map((builder) => ({
    ...builder,
    anomalies: []
  }));

  const unpairedPosix = tasks.filter((task) => task.ucKind === "posix" && task.finishAt !== undefined);
  tasks
    .filter((task) => task.ucKind === "cache" && task.finishAt !== undefined)
    .forEach((cacheTask) => {
      const targetCategory = cacheTask.category === "Dump" ? "Cache2Backend" : "Backend2Cache";
      const candidate = unpairedPosix
        .filter((task) => !task.pairedPosixTaskId && task.pid === cacheTask.pid && task.category === targetCategory)
        .sort((left, right) => {
          const leftDiff = Math.abs((left.finishAt ?? 0) - (cacheTask.finishAt ?? 0));
          const rightDiff = Math.abs((right.finishAt ?? 0) - (cacheTask.finishAt ?? 0));
          return leftDiff - rightDiff;
        })[0];

      if (candidate && Math.abs((candidate.finishAt ?? 0) - (cacheTask.finishAt ?? 0)) <= 500) {
        cacheTask.pairedPosixTaskId = candidate.id;
        candidate.pairedPosixTaskId = cacheTask.id;
      }
    });

  tasks.forEach((task) => {
    const taskStart = task.dispatchAt ?? task.startAt ?? task.finishAt;
    const taskEnd = task.finishAt ?? task.startAt ?? task.dispatchAt;
    if (taskStart === undefined || taskEnd === undefined) {
      return;
    }

    const relatedRequests = requests.filter((request) => {
      const loadWindowStart = (request.stages.enteredAt ?? request.stages.addedAt ?? taskStart) - 50;
      const loadWindowEnd =
        (request.stages.prefillCompleteAt ?? request.stages.decodeFinishedAt ?? request.stages.kvReleaseAt ?? taskEnd) + 50;
      const dumpWindowStart =
        (request.stages.kvReleaseAt ?? request.stages.prefillCompleteAt ?? request.stages.decodeFinishedAt ?? taskStart) - 50;
      const dumpWindowEnd = (request.stages.endedAt ?? request.stages.releaseResponseAt ?? taskEnd) + 200;

      if (task.category === "Load" || task.category === "Lookup" || task.category === "Backend2Cache") {
        return overlaps(taskStart, taskEnd, loadWindowStart, loadWindowEnd);
      }

      return overlaps(taskStart, taskEnd, dumpWindowStart, dumpWindowEnd);
    });

    const candidateCount = relatedRequests.length;
    relatedRequests.forEach((request) => {
      const pidMatch = task.pid !== undefined && request.pidSet.includes(task.pid);
      const confidence: CorrelationConfidence =
        pidMatch && candidateCount === 1 ? "high" : candidateCount === 1 ? "medium" : "low";
      task.relatedRequestIds.push({ requestId: request.id, confidence });
      request.relatedUCTaskIds.push(task.id);
    });
  });

  requests.forEach((request) => {
    request.relatedUCTaskIds = [...new Set(request.relatedUCTaskIds)];
  });

  return tasks;
}
