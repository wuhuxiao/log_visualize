import type { ParsedEvent, RawLogLine, RequestLifecycleEvent } from "../../types/models";
import { createBaseEvent } from "../helpers";

interface RequestRule {
  pattern: RegExp;
  eventName: RequestLifecycleEvent["eventName"];
}

const requestRules: RequestRule[] = [
  { pattern: /Get a new inferRequest from server/i, eventName: "request_received" },
  { pattern: /Add request\(.*\) successfully/i, eventName: "request_added" },
  { pattern: /Insert a new inferRequest/i, eventName: "request_inserted" },
  { pattern: /Finish decode tokenIds/i, eventName: "decode_finished" },
  { pattern: /Request Prefill Complete/i, eventName: "prefill_complete" },
  { pattern: /Get kv release request/i, eventName: "kv_release_requested" },
  { pattern: /send control request/i, eventName: "control_request_sent" },
  { pattern: /Get a new ControlRequest from server/i, eventName: "control_request_received" },
  { pattern: /Send Release KV response/i, eventName: "release_kv_response" },
  { pattern: /Request life endup/i, eventName: "request_end" },
  { pattern: /final status/i, eventName: "request_final_status" },
  { pattern: /Can not find sequence group/i, eventName: "sequence_group_missing" }
];

export function parseRequestEvent(raw: RawLogLine): ParsedEvent | undefined {
  const rule = requestRules.find(({ pattern }) => pattern.test(raw.message));
  if (!rule) {
    return undefined;
  }

  const base = createBaseEvent(raw, rule.eventName, "request", {
    correlationConfidence: "high",
    uncertain: rule.eventName === "sequence_group_missing"
  });

  if (rule.eventName === "sequence_group_missing") {
    base.anomalyTags.push("sequence_group_missing");
    base.severity = "warning";
  }

  return base as RequestLifecycleEvent;
}
