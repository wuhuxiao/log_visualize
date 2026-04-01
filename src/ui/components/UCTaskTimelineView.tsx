import type { NormalizedUCTask } from "../../types/models";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface UCTaskTimelineViewProps {
  tasks: NormalizedUCTask[];
  zoom: number;
  onSelectTask: (taskId: string) => void;
}

export function UCTaskTimelineView({ tasks, zoom, onSelectTask }: UCTaskTimelineViewProps) {
  const items: TimelineItem[] = tasks.map((task) => ({
    id: task.id,
    lane: `${task.workerId} / ${task.ucKind}`,
    label: `${task.category} ${task.taskId ?? ""}`.trim(),
    start: task.dispatchAt ?? task.startAt ?? task.finishAt,
    end: task.finishAt ?? task.startAt ?? task.dispatchAt,
    color:
      task.category === "Lookup"
        ? "#6366f1"
        : task.category === "Dump" || task.category === "Cache2Backend"
          ? "#b45309"
          : "#0f766e",
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
      pairedPosixTaskId: task.pairedPosixTaskId ?? null
    },
    anomaly: task.anomalies.length > 0
  }));

  return <TimelineChart title="Cache / Posix / Lookup 生命周期" items={items} zoom={zoom} onItemClick={onSelectTask} />;
}
