import type { NormalizedRequest, NormalizedUCTask, ParsedEvent, ScheduleBatch, SchedulerEvent } from "../types/models";

interface WorkerScheduleWindow {
  responseEvent: SchedulerEvent;
  schedulingEvent?: SchedulerEvent;
  startMs?: number;
  endMs?: number;
}

function getSchedulingRound(event: ParsedEvent): number | undefined {
  const value = event.extracted.schedulingRound;
  return typeof value === "number" ? value : undefined;
}

function getEventTime(event: ParsedEvent): number | undefined {
  return event.timestampMs;
}

export function correlateScheduleBatches(
  events: ParsedEvent[],
  requests: NormalizedRequest[],
  tasks: NormalizedUCTask[]
): ScheduleBatch[] {
  const schedulingEvents = events
    .filter((event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_scheduling")
    .sort((left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER));

  const responseEvents = events
    .filter((event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_response")
    .sort((left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER));

  const schedulingByWorker = new Map<string, SchedulerEvent[]>();
  for (const event of schedulingEvents) {
    const bucket = schedulingByWorker.get(event.workerId) ?? [];
    bucket.push(event);
    schedulingByWorker.set(event.workerId, bucket);
  }

  const windows: WorkerScheduleWindow[] = responseEvents.map((responseEvent) => {
    const candidates = schedulingByWorker.get(responseEvent.workerId) ?? [];
    const responseTime = responseEvent.timestampMs;
    let matched: SchedulerEvent | undefined;

    if (responseTime !== undefined) {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const candidateTime = candidate?.timestampMs;
        if (candidateTime === undefined || candidateTime > responseTime) {
          continue;
        }
        if (responseTime - candidateTime > 5000) {
          break;
        }
        matched = candidate;
        candidates.splice(index, 1);
        break;
      }
    }

    return {
      responseEvent,
      schedulingEvent: matched,
      startMs: matched?.timestampMs ?? responseEvent.timestampMs,
      endMs: responseEvent.timestampMs
    };
  });

  const grouped = new Map<string, WorkerScheduleWindow[]>();
  for (const window of windows) {
    const round = getSchedulingRound(window.responseEvent);
    const key = round !== undefined ? `round:${round}` : `time:${window.endMs ?? window.startMs ?? 0}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(window);
    grouped.set(key, bucket);
  }

  const lookupTasks = tasks.filter((task) => task.category === "Lookup");

  const batches = [...grouped.entries()]
    .map<ScheduleBatch>(([key, batchWindows], index) => {
      const startMs = batchWindows.reduce<number | undefined>((min, window) => {
        if (window.startMs === undefined) {
          return min;
        }
        return min === undefined ? window.startMs : Math.min(min, window.startMs);
      }, undefined);
      const endMs = batchWindows.reduce<number | undefined>((max, window) => {
        if (window.endMs === undefined) {
          return max;
        }
        return max === undefined ? window.endMs : Math.max(max, window.endMs);
      }, undefined);

      const workerIds = [...new Set(batchWindows.map((window) => window.responseEvent.workerId))];
      const pids = [
        ...new Set(
          batchWindows
            .map((window) => window.responseEvent.pid)
            .filter((pid): pid is number => pid !== undefined)
        )
      ];
      const dpRanks = [
        ...new Set(
          batchWindows
            .map((window) => window.responseEvent.requestRef?.dpRank)
            .filter((dpRank): dpRank is number => dpRank !== undefined)
        )
      ];

      const lookupTaskIds = new Set<string>();
      let lookupTotalMs = 0;

      for (const window of batchWindows) {
        for (const task of lookupTasks) {
          if (task.workerId !== window.responseEvent.workerId) {
            continue;
          }
          const taskTime = task.dispatchAt ?? task.finishAt;
          if (
            taskTime !== undefined &&
            window.startMs !== undefined &&
            window.endMs !== undefined &&
            taskTime >= window.startMs &&
            taskTime <= window.endMs
          ) {
            lookupTaskIds.add(task.id);
            lookupTotalMs += task.costMs ?? 0;
          }
        }
      }

      const batch: ScheduleBatch = {
        id: `schedule-batch-${index + 1}`,
        schedulingRound: key.startsWith("round:") ? Number(key.replace("round:", "")) : undefined,
        startMs,
        endMs,
        workerIds,
        pids,
        dpRanks,
        schedulingEventIds: batchWindows
          .map((window) => window.schedulingEvent?.id)
          .filter((id): id is string => !!id),
        responseEventIds: batchWindows.map((window) => window.responseEvent.id),
        requestIds: [],
        lookupTaskIds: [...lookupTaskIds],
        lookupCount: lookupTaskIds.size,
        lookupTotalMs
      };

      for (const request of requests) {
        const requestStart = request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
        const requestEnd =
          request.stages.endedAt ?? request.stages.releaseResponseAt ?? request.stages.kvReleaseAt;
        const rankMatches = batch.dpRanks.length === 0 || request.dpRank === undefined || batch.dpRanks.includes(request.dpRank);
        const overlaps =
          requestStart !== undefined &&
          batch.startMs !== undefined &&
          batch.endMs !== undefined &&
          requestStart <= batch.endMs &&
          (requestEnd === undefined || requestEnd >= batch.startMs);

        if (rankMatches && overlaps) {
          batch.requestIds.push(request.id);
          request.relatedScheduleBatchIds.push(batch.id);
        }
      }

      return batch;
    })
    .sort((left, right) => (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER));

  return batches;
}
