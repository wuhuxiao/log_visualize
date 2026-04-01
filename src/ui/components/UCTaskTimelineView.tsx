import type { NormalizedUCTask } from "../../types/models";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface UCTaskTimelineViewProps {
  tasks: NormalizedUCTask[];
  initialZoom?: number;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
}

function bandwidthMBps(task: NormalizedUCTask) {
  if (!task.bytes || !task.costMs || task.costMs <= 0) {
    return undefined;
  }
  return task.bytes / 1024 / 1024 / (task.costMs / 1000);
}

function formatBandwidth(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  if (value >= 1000) {
    return `${value.toFixed(0)} MB/s`;
  }
  return `${value.toFixed(1)} MB/s`;
}

export function UCTaskTimelineView({ tasks, initialZoom = 2, selectedTaskId, onSelectTask }: UCTaskTimelineViewProps) {
  const items: TimelineItem[] = tasks.map((task) => {
    const isDump = task.category === "Dump" || task.category === "Cache2Backend";
    const color = task.category === "Lookup" ? "#6366f1" : isDump ? "#b45309" : "#0f766e";
    const bandwidth = formatBandwidth(bandwidthMBps(task));
    const label = bandwidth ? `${task.category} ${task.taskId ?? ""} ${bandwidth}`.trim() : `${task.category} ${task.taskId ?? ""}`.trim();

    return {
      id: task.id,
      lane: `${task.workerId} / ${task.ucKind}`,
      label,
      start: task.dispatchAt ?? task.startAt ?? task.finishAt,
      end: task.finishAt ?? task.startAt ?? task.dispatchAt,
      color,
      selected: task.id === selectedTaskId,
      legendKey: `${task.ucKind}-${task.category}`,
      legendLabel: `${task.ucKind.toUpperCase()} / ${task.category}`,
      meta: {
        pid: task.pid ?? null,
        taskId: task.taskId ?? null,
        category: task.category,
        bytes: task.bytes ?? null,
        shards: task.shards ?? null,
        waitMs: task.waitMs ?? null,
        mkBufMs: task.mkBufMs ?? null,
        syncMs: task.syncMs ?? null,
        backMs: task.backMs ?? null,
        costMs: task.costMs ?? null,
        bandwidthMBps: bandwidth ?? null,
        pairedPosixTaskId: task.pairedPosixTaskId ?? null
      },
      anomaly: task.anomalies.length > 0
    };
  });

  return <TimelineChart title="Cache / Posix / Lookup 生命周期" items={items} initialZoom={initialZoom} onItemClick={onSelectTask} />;
}
