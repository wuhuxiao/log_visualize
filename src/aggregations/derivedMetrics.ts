import type { NormalizedRequest, NormalizedUCTask, ParsedEvent } from "../types/models";
import { average, quantile } from "../utils/stats";

export interface RequestPhaseSummary {
  phase: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
}

export interface WorkerBandwidthSummary {
  workerId: string;
  pid?: number;
  category: "Load" | "Dump";
  count: number;
  avgMBps: number;
  p50MBps: number;
  p90MBps: number;
  maxMBps: number;
}

export interface SchedulerLookupSummary {
  id: string;
  workerId: string;
  pid?: number;
  timestampMs?: number;
  phase: string;
  lookupCount: number;
  lookupTotalMs: number;
}

function safeDuration(start?: number, end?: number): number | undefined {
  if (start === undefined || end === undefined || end < start) {
    return undefined;
  }
  return end - start;
}

export function buildRequestPhaseSummaries(requests: NormalizedRequest[]): RequestPhaseSummary[] {
  const phaseMap = new Map<string, number[]>();

  const push = (phase: string, value?: number) => {
    if (value === undefined) {
      return;
    }
    const list = phaseMap.get(phase) ?? [];
    list.push(value);
    phaseMap.set(phase, list);
  };

  requests.forEach((request) => {
    const start = request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
    const prefill = request.stages.prefillCompleteAt;
    const kvRelease = request.stages.kvReleaseAt;
    const end = request.stages.endedAt ?? request.stages.releaseResponseAt;

    push("Enter → Prefill", safeDuration(start, prefill));
    push("Prefill → KV Release", safeDuration(prefill, kvRelease));
    push("KV Release → End", safeDuration(kvRelease, end));
    push("Enter → End", safeDuration(start, end));
  });

  return [...phaseMap.entries()].map(([phase, values]) => ({
    phase,
    count: values.length,
    avgMs: average(values),
    p50Ms: quantile(values, 0.5),
    p90Ms: quantile(values, 0.9),
    maxMs: Math.max(...values)
  }));
}

export function buildWorkerBandwidthSummaries(tasks: NormalizedUCTask[]): WorkerBandwidthSummary[] {
  const grouped = new Map<string, { workerId: string; pid?: number; category: "Load" | "Dump"; values: number[] }>();

  tasks.forEach((task) => {
    if ((task.category !== "Load" && task.category !== "Dump") || !task.bytes || !task.costMs || task.costMs <= 0) {
      return;
    }

    const bandwidthMBps = task.bytes / 1024 / 1024 / (task.costMs / 1000);
    const key = `${task.workerId}:${task.category}`;
    const entry = grouped.get(key) ?? {
      workerId: task.workerId,
      pid: task.pid,
      category: task.category,
      values: []
    };
    entry.values.push(bandwidthMBps);
    grouped.set(key, entry);
  });

  return [...grouped.values()].map((entry) => ({
    workerId: entry.workerId,
    pid: entry.pid,
    category: entry.category,
    count: entry.values.length,
    avgMBps: average(entry.values),
    p50MBps: quantile(entry.values, 0.5),
    p90MBps: quantile(entry.values, 0.9),
    maxMBps: Math.max(...entry.values)
  }));
}

export function buildSchedulerLookupSummaries(
  events: ParsedEvent[],
  tasks: NormalizedUCTask[]
): SchedulerLookupSummary[] {
  const schedulerEvents = events
    .filter((event) => event.eventType === "scheduler")
    .sort((left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER));

  const lookupTasks = tasks
    .filter((task) => task.category === "Lookup")
    .sort((left, right) => (left.dispatchAt ?? left.finishAt ?? Number.MAX_SAFE_INTEGER) - (right.dispatchAt ?? right.finishAt ?? Number.MAX_SAFE_INTEGER));

  return schedulerEvents.map((event, index) => {
    const next = schedulerEvents
      .slice(index + 1)
      .find((candidate) => candidate.workerId === event.workerId);
    const start = event.timestampMs ?? Number.MIN_SAFE_INTEGER;
    const end = next?.timestampMs ?? Number.MAX_SAFE_INTEGER;
    const windowTasks = lookupTasks.filter((task) => {
      const time = task.dispatchAt ?? task.finishAt;
      return task.workerId === event.workerId && time !== undefined && time >= start && time < end;
    });

    return {
      id: event.id,
      workerId: event.workerId,
      pid: event.pid,
      timestampMs: event.timestampMs,
      phase: event.eventName,
      lookupCount: windowTasks.length,
      lookupTotalMs: windowTasks.reduce((sum, task) => sum + (task.costMs ?? 0), 0)
    };
  });
}
