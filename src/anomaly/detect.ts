import type { AnomalyRecord, NormalizedRequest, NormalizedUCTask, ParsedEvent } from "../types/models";

const SLOW_SCHEDULER_THRESHOLD_MS = 1000;
const CACHE_POSIX_GAP_RATIO = 2;
const CACHE_POSIX_GAP_MS = 20;

export function detectAnomalies(
  events: ParsedEvent[],
  requests: NormalizedRequest[],
  tasks: NormalizedUCTask[]
): AnomalyRecord[] {
  const anomalies: AnomalyRecord[] = [];
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const requestMap = new Map(requests.map((request) => [request.id, request]));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  events.forEach((event) => {
    if (event.eventType === "scheduler") {
      const responseCost = typeof event.extracted.responseCostMs === "number" ? event.extracted.responseCostMs : event.costMs;
      if ((responseCost ?? 0) > SLOW_SCHEDULER_THRESHOLD_MS) {
        const anomaly: AnomalyRecord = {
          id: `anomaly:${event.id}:slow-response`,
          type: "slow_scheduler_response",
          severity: "warning",
          title: "Scheduler response cost too long",
          description: `response cost ${responseCost}ms exceeds ${SLOW_SCHEDULER_THRESHOLD_MS}ms`,
          eventId: event.id,
          workerId: event.workerId,
          timestampMs: event.timestampMs,
          metrics: {
            responseCostMs: responseCost ?? null,
            scheduleCostMs: event.extracted.scheduleCostMs ?? null,
            totalIterCostMs: event.extracted.totalIterCostMs ?? null
          }
        };
        anomalies.push(anomaly);
        event.anomalyTags.push(anomaly.type);
      }
    }

    if (event.eventName === "sequence_group_missing") {
      const targetRequest = requests.find(
        (request) =>
          request.seqId !== undefined &&
          request.seqId === event.requestRef?.seqId
      );
      const anomaly: AnomalyRecord = {
        id: `anomaly:${event.id}:sequence-group`,
        type: "sequence_group_missing",
        severity: "error",
        title: "Sequence group missing",
        description: "Sequence group lookup failed during request handling",
        eventId: event.id,
        requestId: targetRequest?.id,
        workerId: event.workerId,
        timestampMs: event.timestampMs,
        metrics: {
          seqId: event.requestRef?.seqId ?? null
        }
      };
      anomalies.push(anomaly);
      event.anomalyTags.push(anomaly.type);
      if (targetRequest) {
        targetRequest.anomalies.push(anomaly);
        targetRequest.status = "anomalous";
      }
    }
  });

  requests.forEach((request) => {
    const started = request.stages.enteredAt ?? request.stages.addedAt ?? request.stages.insertedAt;
    const finished = request.stages.endedAt ?? request.stages.releaseResponseAt;
    if (started !== undefined && finished === undefined) {
      const anomaly: AnomalyRecord = {
        id: `anomaly:${request.id}:incomplete`,
        type: "request_incomplete",
        severity: "warning",
        title: "Request missing terminal event",
        description: "Request has start events but no explicit completion or release response",
        requestId: request.id,
        workerId: request.workerIds[0],
        timestampMs: started,
        metrics: {
          llmMgrReqId: request.llmMgrReqId ?? null,
          engineReqId: request.engineReqId ?? null,
          seqId: request.seqId ?? null
        }
      };
      anomalies.push(anomaly);
      request.anomalies.push(anomaly);
      request.status = request.status === "anomalous" ? "anomalous" : "incomplete";
    }
  });

  tasks.forEach((task) => {
    if (task.ucKind !== "cache" || task.costMs === undefined || !task.pairedPosixTaskId) {
      return;
    }

    const paired = taskMap.get(task.pairedPosixTaskId);
    if (!paired?.costMs) {
      return;
    }

    const ratio = task.costMs / paired.costMs;
    const delta = task.costMs - paired.costMs;
    if (ratio >= CACHE_POSIX_GAP_RATIO && delta >= CACHE_POSIX_GAP_MS) {
      const relatedRequestId = task.relatedRequestIds[0]?.requestId;
      const anomaly: AnomalyRecord = {
        id: `anomaly:${task.id}:cache-gap`,
        type: "cache_posix_gap",
        severity: "warning",
        title: "Cache task overhead is much larger than Posix cost",
        description: `cache task ${task.costMs.toFixed(2)}ms vs posix ${paired.costMs.toFixed(2)}ms`,
        requestId: relatedRequestId,
        taskId: task.id,
        workerId: task.workerId,
        timestampMs: task.finishAt ?? task.dispatchAt,
        metrics: {
          cacheCostMs: task.costMs,
          posixCostMs: paired.costMs,
          deltaMs: delta,
          ratio
        }
      };
      anomalies.push(anomaly);
      task.anomalies.push(anomaly);
      paired.anomalies.push(anomaly);

      const request = relatedRequestId ? requestMap.get(relatedRequestId) : undefined;
      if (request) {
        request.anomalies.push(anomaly);
        request.status = "anomalous";
      }
    }
  });

  return anomalies.sort(
    (left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER)
  );
}
