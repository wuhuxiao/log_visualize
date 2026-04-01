import type { AnomalyRecord, NormalizedRequest, NormalizedUCTask, ParsedEvent } from "../types/models";

const DISPLAY_ANOMALY_TYPES = new Set<AnomalyRecord["type"]>(["low_cache_bandwidth", "cache_posix_gap"]);

export function isDisplayAnomaly(anomaly: AnomalyRecord) {
  return DISPLAY_ANOMALY_TYPES.has(anomaly.type);
}

export function filterDisplayAnomalies(anomalies: AnomalyRecord[]) {
  return anomalies.filter(isDisplayAnomaly);
}

export function hasDisplayRequestAnomaly(request: NormalizedRequest) {
  return filterDisplayAnomalies(request.anomalies).length > 0;
}

export function hasDisplayTaskAnomaly(task: NormalizedUCTask) {
  if (task.ucKind !== "cache") {
    return false;
  }

  if (task.category !== "Load" && task.category !== "Dump") {
    return false;
  }

  return filterDisplayAnomalies(task.anomalies).length > 0;
}

export function hasDisplayEventAnomaly(event: ParsedEvent) {
  return event.anomalyTags.some((tag) => DISPLAY_ANOMALY_TYPES.has(tag as AnomalyRecord["type"]));
}
