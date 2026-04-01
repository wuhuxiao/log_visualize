import { useMemo } from "react";
import type { NormalizedUCTask } from "../../types/models";
import { hasDisplayTaskAnomaly } from "../anomalyDisplay";
import { deriveAbstractUCTimelineSegments } from "../ucTimelineAbstraction";
import { formatDuration } from "../../utils/time";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface UCTaskTimelineViewProps {
  tasks: NormalizedUCTask[];
  initialZoom?: number;
  keyboardPanStepMs?: number;
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

export function UCTaskTimelineView({
  tasks,
  initialZoom = 2,
  keyboardPanStepMs = 1_000,
  selectedTaskId,
  onSelectTask
}: UCTaskTimelineViewProps) {
  const items: TimelineItem[] = useMemo(() => {
    const abstractItems: TimelineItem[] = deriveAbstractUCTimelineSegments(tasks).map((segment) => ({
      id: segment.id,
      lane: segment.lane,
      label: segment.label,
      start: segment.start,
      end: segment.end,
      color: segment.color,
      accentColor: "#f8fafc",
      legendKey: `abstract-${segment.phase}`,
      legendLabel: `Abstract / ${segment.phase}`,
      meta: segment.meta
    }));

    const taskItems: TimelineItem[] = tasks.map((task) => {
      const isDump = task.category === "Dump" || task.category === "Cache2Backend";
      const color = task.category === "Lookup" ? "#6366f1" : isDump ? "#b45309" : "#0f766e";
      const bandwidth = formatBandwidth(bandwidthMBps(task));
      const cost = formatDuration(task.costMs);
      const labelParts = [task.category, cost, bandwidth].filter(Boolean);
      const label = labelParts.join(" ");

      return {
        id: task.id,
        lane: `${task.workerId} / ${task.ucKind}`,
        label,
        start: task.dispatchAt ?? task.startAt ?? task.finishAt,
        end: task.finishAt ?? task.startAt ?? task.dispatchAt,
        color,
        selected: task.id === selectedTaskId,
        forceLabel: true,
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
        anomaly: hasDisplayTaskAnomaly(task)
      };
    });

    return [...abstractItems, ...taskItems];
  }, [selectedTaskId, tasks]);

  return (
    <TimelineChart
      title="UC Task Timeline + Schedule Abstraction"
      items={items}
      initialZoom={initialZoom}
      keyboardPanStepMs={keyboardPanStepMs}
      onItemClick={(itemId) => {
        if (!itemId.startsWith("abstract:")) {
          onSelectTask(itemId);
        }
      }}
    />
  );
}
