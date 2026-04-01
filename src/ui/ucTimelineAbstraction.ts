import type { NormalizedUCTask } from "../types/models";
import { bandwidthMBps, taskEnd, taskStart } from "./requestTimeline";

const LOOKUP_CLUSTER_GAP_MS = 5;

export interface AbstractUCTimelineSegment {
  id: string;
  phase: "lookup" | "cacheLoad" | "modelForward" | "cacheDump";
  lane: string;
  label: string;
  start: number;
  end: number;
  color: string;
  meta: Record<string, string | number | boolean | null | undefined>;
}

interface TaskSummary {
  tasks: NormalizedUCTask[];
  start?: number;
  end?: number;
  totalCostMs: number;
  totalBytes: number;
  avgBandwidthMBps?: number;
}

interface LookupCluster {
  id: string;
  start: number;
  end: number;
  tasks: NormalizedUCTask[];
}

function summarizeTasks(tasks: NormalizedUCTask[]) {
  let start: number | undefined;
  let end: number | undefined;
  let totalCostMs = 0;
  let totalBytes = 0;
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
    totalCostMs += task.costMs ?? 0;
    totalBytes += task.bytes ?? 0;
    const bandwidth = bandwidthMBps(task);
    if (bandwidth !== undefined) {
      bandwidthSamples.push(bandwidth);
    }
  }

  return {
    tasks,
    start,
    end,
    totalCostMs,
    totalBytes,
    avgBandwidthMBps:
      bandwidthSamples.length > 0
        ? bandwidthSamples.reduce((sum, value) => sum + value, 0) / bandwidthSamples.length
        : undefined
  } satisfies TaskSummary;
}

function formatDurationLabel(label: string, start?: number, end?: number) {
  if (start === undefined || end === undefined || end <= start) {
    return label;
  }
  return `${label} ${(end - start).toFixed(1)}ms`;
}

function clusterLookupTasks(tasks: NormalizedUCTask[]) {
  const lookupTasks = tasks
    .filter((task) => task.category === "Lookup")
    .map((task) => ({
      task,
      start: taskStart(task),
      end: taskEnd(task)
    }))
    .filter((task): task is { task: NormalizedUCTask; start: number; end: number } => task.start !== undefined && task.end !== undefined)
    .sort((left, right) => left.start - right.start);

  const clusters: LookupCluster[] = [];

  for (const lookup of lookupTasks) {
    const previous = clusters.at(-1);
    if (!previous || lookup.start > previous.end + LOOKUP_CLUSTER_GAP_MS) {
      clusters.push({
        id: `lookup-cluster-${clusters.length + 1}`,
        start: lookup.start,
        end: lookup.end,
        tasks: [lookup.task]
      });
      continue;
    }

    previous.end = Math.max(previous.end, lookup.end);
    previous.tasks.push(lookup.task);
  }

  return clusters;
}

function phaseColor(phase: AbstractUCTimelineSegment["phase"]) {
  if (phase === "lookup") {
    return "#8b5cf6";
  }
  if (phase === "cacheLoad") {
    return "#06b6d4";
  }
  if (phase === "modelForward") {
    return "#ef4444";
  }
  return "#f97316";
}

export function deriveAbstractUCTimelineSegments(tasks: NormalizedUCTask[]) {
  const clusters = clusterLookupTasks(tasks);
  const loadTasks = tasks.filter((task) => task.category === "Load" || task.category === "Backend2Cache");
  const dumpTasks = tasks.filter((task) => task.category === "Dump");
  const segments: AbstractUCTimelineSegment[] = [];

  for (const [index, cluster] of clusters.entries()) {
    const nextCluster = clusters[index + 1];
    const cycleUpperBound = nextCluster?.start;

    const cycleLoadTasks = loadTasks.filter((task) => {
      const start = taskStart(task);
      return start !== undefined && start >= cluster.start && (cycleUpperBound === undefined || start < cycleUpperBound);
    });
    const cycleDumpTasks = dumpTasks.filter((task) => {
      const start = taskStart(task);
      return start !== undefined && start >= cluster.start && (cycleUpperBound === undefined || start < cycleUpperBound);
    });

    const lookupSummary = summarizeTasks(cluster.tasks);
    const loadSummary = summarizeTasks(cycleLoadTasks);
    const dumpSummary = summarizeTasks(cycleDumpTasks);
    const loadEnd = loadSummary.end ?? cluster.end;
    const dumpStart = dumpSummary.start;
    const modelStart = Math.max(cluster.end, loadEnd);
    const modelEndCandidate =
      cycleUpperBound !== undefined && dumpStart !== undefined
        ? Math.min(cycleUpperBound, dumpStart)
        : cycleUpperBound ?? dumpStart;

    segments.push({
      id: `abstract:${cluster.id}:lookup`,
      phase: "lookup",
      lane: "Schedule abstraction / lookup",
      label: formatDurationLabel("Lookup", lookupSummary.start, lookupSummary.end),
      start: cluster.start,
      end: cluster.end,
      color: phaseColor("lookup"),
      meta: {
        clusterId: cluster.id,
        taskCount: cluster.tasks.length,
        totalCostMs: lookupSummary.totalCostMs,
        cycleIndex: index + 1
      }
    });

    if (loadSummary.start !== undefined && loadSummary.end !== undefined && loadSummary.end > loadSummary.start) {
      segments.push({
        id: `abstract:${cluster.id}:cache-load`,
        phase: "cacheLoad",
        lane: "Schedule abstraction / cache load",
        label: formatDurationLabel("Cache load", loadSummary.start, loadSummary.end),
        start: loadSummary.start,
        end: loadSummary.end,
        color: phaseColor("cacheLoad"),
        meta: {
          clusterId: cluster.id,
          taskCount: loadSummary.tasks.length,
          totalCostMs: loadSummary.totalCostMs,
          totalBytes: loadSummary.totalBytes || null,
          avgBandwidthMBps: loadSummary.avgBandwidthMBps ?? null,
          cycleIndex: index + 1
        }
      });
    }

    if (modelEndCandidate !== undefined && modelEndCandidate > modelStart) {
      segments.push({
        id: `abstract:${cluster.id}:model-forward`,
        phase: "modelForward",
        lane: "Schedule abstraction / model forward",
        label: formatDurationLabel("Model forward", modelStart, modelEndCandidate),
        start: modelStart,
        end: modelEndCandidate,
        color: phaseColor("modelForward"),
        meta: {
          clusterId: cluster.id,
          inferred: true,
          inferredFrom: "between lookup windows",
          previousLookupEnd: cluster.end,
          nextLookupStart: nextCluster?.start ?? null,
          nextDumpStart: dumpStart ?? null,
          cycleIndex: index + 1
        }
      });
    }

    if (dumpSummary.start !== undefined && dumpSummary.end !== undefined && dumpSummary.end > dumpSummary.start) {
      segments.push({
        id: `abstract:${cluster.id}:cache-dump`,
        phase: "cacheDump",
        lane: "Schedule abstraction / cache dump",
        label: formatDurationLabel("Cache dump", dumpSummary.start, dumpSummary.end),
        start: dumpSummary.start,
        end: dumpSummary.end,
        color: phaseColor("cacheDump"),
        meta: {
          clusterId: cluster.id,
          taskCount: dumpSummary.tasks.length,
          totalCostMs: dumpSummary.totalCostMs,
          totalBytes: dumpSummary.totalBytes || null,
          avgBandwidthMBps: dumpSummary.avgBandwidthMBps ?? null,
          cycleIndex: index + 1
        }
      });
    }
  }

  return segments;
}
