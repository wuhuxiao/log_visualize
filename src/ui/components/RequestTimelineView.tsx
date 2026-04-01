import { useMemo } from "react";
import type { NormalizedRequest } from "../../types/models";
import { TimelineChart, type TimelineItem } from "./TimelineChart";

interface RequestTimelineViewProps {
  requests: NormalizedRequest[];
  initialZoom?: number;
  selectedRequestId?: string;
  onSelectRequest: (requestId: string) => void;
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
  initialZoom = 2,
  selectedRequestId,
  onSelectRequest
}: RequestTimelineViewProps) {
  const items = useMemo<TimelineItem[]>(() => {
    const nextItems: TimelineItem[] = [];

    for (const request of requests) {
      const requestLabel = request.llmMgrReqId ?? request.engineReqId ?? request.seqId ?? request.id;
      const mainLane = `Req ${requestLabel}`;
      const requestStart = request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
      const requestEnd =
        request.stages.endedAt ?? request.stages.releaseResponseAt ?? request.lifecycleEvents.at(-1)?.timestampMs;

      if (requestStart !== undefined || requestEnd !== undefined) {
        nextItems.push({
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
            dpRank: request.dpRank ?? null,
            scheduleBatchCount: request.relatedScheduleBatchIds.length
          },
          anomaly: request.anomalies.length > 0
        });
      }

      for (const stage of stageLabels) {
        const time = request.stages[stage.key];
        if (time === undefined) {
          continue;
        }
        nextItems.push({
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
    }

    return nextItems;
  }, [requests, selectedRequestId]);

  if (items.length === 0) {
    return <div className="empty-state">当前过滤条件下没有可展示的请求时序。</div>;
  }

  return (
    <TimelineChart
      title="多请求生命周期时序"
      items={items}
      initialZoom={initialZoom}
      onItemClick={(itemId) => {
        if (itemId.startsWith("request:")) {
          onSelectRequest(itemId.split(":")[1] ?? "");
        }
      }}
    />
  );
}
