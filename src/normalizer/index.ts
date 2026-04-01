import type { AnalysisResult, LogSource } from "../types/models";
import { detectAnomalies } from "../anomaly/detect";
import { buildProcessSummaries } from "../aggregations/processSummary";
import { parseSources } from "../parser";
import { correlatePrefixCache } from "./prefixAssociation";
import { correlateRequests } from "./requestCorrelation";
import { correlateScheduleBatches } from "./scheduleBatches";
import { correlateUCTasks } from "./ucTaskCorrelation";

export function analyzeSources(sources: LogSource[]): AnalysisResult {
  const { rawLines, events } = parseSources(sources);
  const { requests } = correlateRequests(events);
  const prefixAssociations = correlatePrefixCache(events, requests);
  const ucTasks = correlateUCTasks(events, requests);
  const scheduleBatches = correlateScheduleBatches(events, requests, ucTasks);
  const processSummaries = buildProcessSummaries(ucTasks);
  const anomalies = detectAnomalies(events, requests, ucTasks);

  return {
    sources,
    rawLines,
    events,
    requests,
    ucTasks,
    processSummaries,
    scheduleBatches,
    anomalies,
    unmatchedEvents: events.filter((event) => event.unmatched),
    prefixAssociations
  };
}
