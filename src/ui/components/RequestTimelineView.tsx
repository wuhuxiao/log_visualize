import type { NormalizedRequest, NormalizedUCTask } from "../../types/models";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface RequestTimelineViewProps {
  requests: NormalizedRequest[];
  tasks: NormalizedUCTask[];
  initialZoom?: number;
  selectedRequestId?: string;
  selectedTaskId?: string;
  onSelectRequest: (requestId: string) => void;
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

export function RequestTimelineView({
  requests,
  tasks,
  initialZoom = 2,
  selectedRequestId,
  selectedTaskId,
  onSelectRequest,
  onSelectTask
}: RequestTimelineViewProps) {
  if (requests.length === 0) {
    return <div className="empty-state">当前过滤条件下没有可展示的请求时序。</div>;
  }

  const items: TimelineItem[] = [];

  requests.forEach((request) => {
    const requestLabel = request.llmMgrReqId ?? request.engineReqId ?? request.seqId ?? request.id;
    const mainLane = `Req ${requestLabel}`;
    const taskLane = `${mainLane} / UC`;
    const requestStart = request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
    const requestEnd =
      request.stages.endedAt ?? request.stages.releaseResponseAt ?? request.lifecycleEvents.at(-1)?.timestampMs;

    if (requestStart !== undefined || requestEnd !== undefined) {
      items.push({
        id: `request:${request.id}`,
        lane: mainLane,
        label: requestLabel,
        start: requestStart,
        end: requestEnd,
        color: "#2563eb",
        legendKey: "request-main",
        legendLabel: "Request 主流程",
        selected: request.id === selectedRequestId,
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
          id: `request:${request.id}:${String(stage.key)}`,
          lane: mainLane,
          label: stage.label,
          start: time,
          end: time + 1,
          color: stage.color,
          legendKey: `stage:${stage.key}`,
          legendLabel: `阶段: ${stage.label}`,
          selected: request.id === selectedRequestId,
          meta: {
            requestId: requestLabel,
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
          id: `task:${task.id}`,
          lane: taskLane,
          label: `${task.category} ${task.taskId ?? ""}`.trim(),
          start: task.dispatchAt ?? task.startAt ?? task.finishAt,
          end: task.finishAt ?? task.startAt ?? task.dispatchAt,
          color: isDump ? "#b45309" : "#0f766e",
          legendKey: `uc:${task.category}`,
          legendLabel: `UC: ${task.category}`,
          selected: task.id === selectedTaskId,
          meta: {
            requestId: requestLabel,
            workerId: task.workerId,
            pid: task.pid ?? null,
            taskId: task.taskId ?? null,
            category: task.category,
            confidence: task.relatedRequestIds.find(({ requestId }) => requestId === request.id)?.confidence ?? null
          },
          anomaly: task.anomalies.length > 0
        });
      });
  });

  return (
    <TimelineChart
      title="多请求生命周期与相关 UC Task"
      items={items}
      initialZoom={initialZoom}
      onItemClick={(itemId) => {
        if (itemId.startsWith("request:")) {
          onSelectRequest(itemId.split(":")[1] ?? "");
          return;
        }
        if (itemId.startsWith("task:")) {
          onSelectTask(itemId.split(":")[1] ?? "");
        }
      }}
    />
  );
}
