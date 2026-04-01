import type { AnalysisResult, FilterState, NormalizedRequest, NormalizedUCTask, ParsedEvent } from "../types/models";

function matchesSearch(event: ParsedEvent, searchText: string) {
  if (!searchText) {
    return true;
  }

  const lower = searchText.toLowerCase();
  return [
    event.requestRef?.llmMgrReqId,
    event.requestRef?.llmMgrReqIdRaw,
    event.requestRef?.engineReqId,
    event.requestRef?.seqId,
    event.rawMessage
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(lower));
}

function matchesCoreFilters(
  workerId: string | undefined,
  pid: number | undefined,
  dpRank: number | undefined,
  eventType: string,
  searchMatches: boolean,
  filters: FilterState,
  anomalyTags: string[]
) {
  const workerOk = filters.workerIds.length === 0 || (workerId ? filters.workerIds.includes(workerId) : false);
  const pidOk = filters.pids.length === 0 || (pid !== undefined && filters.pids.includes(pid));
  const dpOk = filters.dpRanks.length === 0 || (dpRank !== undefined && filters.dpRanks.includes(dpRank));
  const eventOk = filters.eventTypes.length === 0 || filters.eventTypes.includes(eventType as never);
  const anomalyOk = !filters.onlyAnomalies || anomalyTags.length > 0;
  return workerOk && pidOk && dpOk && eventOk && searchMatches && anomalyOk;
}

export function filterEvents(result: AnalysisResult, filters: FilterState): ParsedEvent[] {
  return result.events.filter((event) =>
    matchesCoreFilters(
      event.workerId,
      event.pid,
      event.requestRef?.dpRank,
      event.eventType,
      matchesSearch(event, filters.searchText),
      filters,
      event.anomalyTags
    )
  );
}

export function filterRequests(
  result: AnalysisResult,
  filters: FilterState,
  visibleEvents: ParsedEvent[]
): NormalizedRequest[] {
  const visibleEventIds = new Set(visibleEvents.map((event) => event.id));
  return result.requests.filter((request) => {
    const matchesIds =
      !filters.searchText ||
      [request.llmMgrReqId, request.llmMgrReqIdRaw, request.engineReqId, request.seqId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filters.searchText.toLowerCase()));

    const workerOk =
      filters.workerIds.length === 0 || request.workerIds.some((workerId) => filters.workerIds.includes(workerId));
    const pidOk = filters.pids.length === 0 || request.pidSet.some((pid) => filters.pids.includes(pid));
    const dpOk = filters.dpRanks.length === 0 || (request.dpRank !== undefined && filters.dpRanks.includes(request.dpRank));
    const eventOk = filters.eventTypes.length === 0 || filters.eventTypes.includes("request");
    const anomalyOk = !filters.onlyAnomalies || request.anomalies.length > 0;
    const hasVisibleEvent = request.lifecycleEvents.some((event) => visibleEventIds.has(event.id));
    return workerOk && pidOk && dpOk && eventOk && anomalyOk && matchesIds && hasVisibleEvent;
  });
}

export function filterUCTasks(
  result: AnalysisResult,
  filters: FilterState,
  visibleRequestIds: Set<string>
): NormalizedUCTask[] {
  const search = filters.searchText.toLowerCase();
  return result.ucTasks.filter((task) => {
    const searchOk =
      !filters.searchText ||
      task.relatedRequestIds.some(({ requestId }) => visibleRequestIds.has(requestId)) ||
      [task.taskId, task.taskType, task.direction, task.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    const workerOk = filters.workerIds.length === 0 || filters.workerIds.includes(task.workerId);
    const pidOk = filters.pids.length === 0 || (task.pid !== undefined && filters.pids.includes(task.pid));
    const eventOk = filters.eventTypes.length === 0 || filters.eventTypes.includes("uc_task");
    const anomalyOk = !filters.onlyAnomalies || task.anomalies.length > 0;
    return workerOk && pidOk && eventOk && anomalyOk && searchOk;
  });
}
