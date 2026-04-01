import type { NormalizedRequest, NormalizedUCTask } from "../../types/models";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface RequestTimelineViewProps {
  request?: NormalizedRequest;
  tasks: NormalizedUCTask[];
  zoom: number;
  onSelectTask: (taskId: string) => void;
}

const stageLabels: Array<{ key: keyof NormalizedRequest["stages"]; label: string; color: string }> = [
  { key: "enteredAt", label: "Enter", color: "#1d4ed8" },
  { key: "addedAt", label: "Add", color: "#2563eb" },
  { key: "insertedAt", label: "Insert", color: "#3b82f6" },
  { key: "decodeFinishedAt", label: "Decode", color: "#14b8a6" },
  { key: "prefillCompleteAt", label: "Prefill", color: "#0f766e" },
  { key: "kvReleaseAt", label: "KV Release", color: "#d97706" },
  { key: "controlRequestAt", label: "Control", color: "#b45309" },
  { key: "releaseResponseAt", label: "Release Resp", color: "#7c3aed" },
  { key: "endedAt", label: "End", color: "#a21caf" }
];

export function RequestTimelineView({ request, tasks, zoom, onSelectTask }: RequestTimelineViewProps) {
  if (!request) {
    return <div className="empty-state">先从请求列表中选中一个请求。</div>;
  }

  const items: TimelineItem[] = [];
  const requestStart = request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
  const requestEnd = request.stages.endedAt ?? request.stages.releaseResponseAt ?? request.lifecycleEvents.at(-1)?.timestampMs;
  if (requestStart !== undefined || requestEnd !== undefined) {
    items.push({
      id: request.id,
      lane: "request",
      label: request.llmMgrReqId ?? request.engineReqId ?? request.seqId ?? request.id,
      start: requestStart,
      end: requestEnd,
      color: "#2563eb",
      legendKey: "request-main",
      legendLabel: "Request 主流程",
      meta: {
        llmMgrReqId: request.llmMgrReqId ?? request.llmMgrReqIdRaw ?? null,
        engineReqId: request.engineReqId ?? null,
        seqId: request.seqId ?? null,
        dpRank: request.dpRank ?? null
      },
      anomaly: request.anomalies.length > 0
    });
  }

  stageLabels.forEach((stage) => {
    const time = request.stages[stage.key];
    if (time !== undefined) {
      items.push({
        id: `${request.id}:${String(stage.key)}`,
        lane: "request stages",
        label: stage.label,
        start: time,
        end: time + 1,
        color: stage.color,
        legendKey: `stage-${stage.key}`,
        legendLabel: `阶段: ${stage.label}`,
        meta: {
          stage: stage.key
        }
      });
    }
  });

  tasks
    .filter((task) => task.relatedRequestIds.some(({ requestId }) => requestId === request.id))
    .forEach((task) => {
      const isDump = task.category === "Dump" || task.category === "Cache2Backend";
      items.push({
        id: task.id,
        lane: `${task.workerId} / ${task.category}`,
        label: `${task.category} ${task.taskId ?? ""}`.trim(),
        start: task.dispatchAt ?? task.startAt ?? task.finishAt,
        end: task.finishAt ?? task.startAt ?? task.dispatchAt,
        color: isDump ? "#b45309" : "#0f766e",
        legendKey: `uc-${task.category}`,
        legendLabel: `UC: ${task.category}`,
        meta: {
          workerId: task.workerId,
          pid: task.pid ?? null,
          taskId: task.taskId ?? null,
          category: task.category,
          confidence: task.relatedRequestIds.find(({ requestId }) => requestId === request.id)?.confidence ?? null
        },
        anomaly: task.anomalies.length > 0
      });
    });

  return <TimelineChart title="请求生命周期与相关 UC Task" items={items} initialZoom={zoom} onItemClick={onSelectTask} />;
}
