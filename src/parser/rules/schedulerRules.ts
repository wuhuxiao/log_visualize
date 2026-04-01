import type { ParsedEvent, RawLogLine, SchedulerEvent } from "../../types/models";
import { createBaseEvent, extractNumber } from "../helpers";

export function parseSchedulerEvent(raw: RawLogLine): ParsedEvent | undefined {
  if (raw.message.includes("[Scheduler|Schedule-scheduling]")) {
    return createBaseEvent(raw, "scheduler_scheduling", "scheduler", {
      correlationConfidence: "medium",
      extracted: {
        waitingSize: extractNumber(raw.message, /waiting size:\s*(\d+)/i) ?? null,
        runningSize: extractNumber(raw.message, /running size:\s*(\d+)/i) ?? null,
        swappedSize: extractNumber(raw.message, /swapped size:\s*(\d+)/i) ?? null,
        batchSize: extractNumber(raw.message, /batch size:\s*(\d+)/i) ?? null,
        transferringSize: extractNumber(raw.message, /transferring size:\s*(\d+)/i) ?? null,
        scheduleForwardMode: extractNumber(raw.message, /forwardMode:\s*(\d+)/i) ?? null
      },
      requestRef: undefined
    }) as SchedulerEvent;
  }

  if (raw.message.includes("[Scheduler|Schedule-Response]")) {
    const responseCostMs = extractNumber(raw.message, /response cost:(\d+(?:\.\d+)?)/i);
    const scheduleCostMs = extractNumber(raw.message, /scheduleCost:(\d+(?:\.\d+)?)/i);
    const totalIterCostMs = extractNumber(raw.message, /totalIterCost:(\d+(?:\.\d+)?)/i);
    return createBaseEvent(raw, "scheduler_response", "scheduler", {
      correlationConfidence: "medium",
      costMs: responseCostMs,
      extracted: {
        responseCostMs: responseCostMs ?? null,
        scheduleExecTransferCostMs:
          extractNumber(raw.message, /ScheduleExecTransfer cost:(\d+(?:\.\d+)?)/i) ?? null,
        scheduleCostMs: scheduleCostMs ?? null,
        totalIterCostMs: totalIterCostMs ?? null,
        schedulingRound: extractNumber(raw.message, /schedulingRound:(\d+)/i) ?? null
      },
      requestRef: {
        dpRank: extractNumber(raw.message, /DP RankId:(\d+)/i)
      },
      severity: (responseCostMs ?? 0) > 1000 ? "warning" : "info"
    }) as SchedulerEvent;
  }

  return undefined;
}
