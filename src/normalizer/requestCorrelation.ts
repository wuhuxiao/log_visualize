import type {
  CorrelationConfidence,
  NormalizedRequest,
  ParsedEvent,
  RequestLifecycleEvent,
  RequestStageKey
} from "../types/models";

interface RequestBuilder {
  id: string;
  llmMgrReqId?: string;
  llmMgrReqIdRaw?: string;
  engineReqId?: string;
  seqId?: string;
  dpRank?: number;
  pidSet: Set<number>;
  workerIds: Set<string>;
  lifecycleEvents: RequestLifecycleEvent[];
  relatedPrefixCacheEventIds: Set<string>;
  relatedUCTaskIds: Set<string>;
  unmatchedEvents: Set<string>;
}

const stageMap: Partial<Record<RequestLifecycleEvent["eventName"], RequestStageKey>> = {
  request_received: "enteredAt",
  request_added: "addedAt",
  request_inserted: "insertedAt",
  decode_finished: "decodeFinishedAt",
  prefill_complete: "prefillCompleteAt",
  kv_release_requested: "kvReleaseAt",
  control_request_sent: "controlRequestAt",
  control_request_received: "controlRequestAt",
  release_kv_response: "releaseResponseAt",
  request_end: "endedAt",
  request_final_status: "endedAt"
};

function requestConfidence(builder: RequestBuilder): CorrelationConfidence {
  if (builder.llmMgrReqId || builder.engineReqId) {
    return "high";
  }

  if (builder.seqId && builder.dpRank !== undefined) {
    return "medium";
  }

  if (builder.seqId) {
    return "low";
  }

  return "none";
}

function mergeInto(primary: RequestBuilder, secondary: RequestBuilder) {
  secondary.pidSet.forEach((pid) => primary.pidSet.add(pid));
  secondary.workerIds.forEach((workerId) => primary.workerIds.add(workerId));
  secondary.lifecycleEvents.forEach((event) => primary.lifecycleEvents.push(event));
  secondary.relatedPrefixCacheEventIds.forEach((eventId) => primary.relatedPrefixCacheEventIds.add(eventId));
  secondary.relatedUCTaskIds.forEach((taskId) => primary.relatedUCTaskIds.add(taskId));
  secondary.unmatchedEvents.forEach((eventId) => primary.unmatchedEvents.add(eventId));

  primary.llmMgrReqId ??= secondary.llmMgrReqId;
  primary.llmMgrReqIdRaw ??= secondary.llmMgrReqIdRaw;
  primary.engineReqId ??= secondary.engineReqId;
  primary.seqId ??= secondary.seqId;
  primary.dpRank ??= secondary.dpRank;
}

export function correlateRequests(events: ParsedEvent[]): {
  requests: NormalizedRequest[];
  requestById: Map<string, NormalizedRequest>;
} {
  const builders = new Map<string, RequestBuilder>();
  const llmIndex = new Map<string, string>();
  const engineIndex = new Map<string, string>();
  const seqIndex = new Map<string, string>();
  let requestCounter = 0;

  function createBuilder(): RequestBuilder {
    const builder: RequestBuilder = {
      id: `request-${++requestCounter}`,
      pidSet: new Set<number>(),
      workerIds: new Set<string>(),
      lifecycleEvents: [],
      relatedPrefixCacheEventIds: new Set<string>(),
      relatedUCTaskIds: new Set<string>(),
      unmatchedEvents: new Set<string>()
    };
    builders.set(builder.id, builder);
    return builder;
  }

  function indexBuilder(builder: RequestBuilder) {
    if (builder.llmMgrReqId) {
      llmIndex.set(builder.llmMgrReqId, builder.id);
    }
    if (builder.engineReqId) {
      engineIndex.set(builder.engineReqId, builder.id);
    }
    if (builder.seqId) {
      seqIndex.set(builder.seqId, builder.id);
    }
  }

  for (const event of events) {
    if (event.eventType !== "request") {
      continue;
    }

    const requestEvent = event as RequestLifecycleEvent;
    const candidates = new Set<string>();
    const { llmMgrReqId, engineReqId, seqId } = requestEvent.requestRef ?? {};
    if (llmMgrReqId && llmIndex.has(llmMgrReqId)) {
      candidates.add(llmIndex.get(llmMgrReqId)!);
    }
    if (engineReqId && engineIndex.has(engineReqId)) {
      candidates.add(engineIndex.get(engineReqId)!);
    }
    if (seqId && seqIndex.has(seqId)) {
      candidates.add(seqIndex.get(seqId)!);
    }

    let builder: RequestBuilder | undefined;
    if (candidates.size === 0) {
      builder = createBuilder();
    } else {
      const [first, ...rest] = [...candidates];
      builder = first ? builders.get(first) : undefined;
      rest.forEach((candidateId) => {
        const candidate = builders.get(candidateId);
        if (builder && candidate && candidate.id !== builder.id) {
          mergeInto(builder, candidate);
          builders.delete(candidate.id);
        }
      });
    }

    if (!builder) {
      builder = createBuilder();
    }

    builder.llmMgrReqId ??= llmMgrReqId;
    builder.llmMgrReqIdRaw ??= requestEvent.requestRef?.llmMgrReqIdRaw;
    builder.engineReqId ??= engineReqId;
    builder.seqId ??= seqId;
    builder.dpRank ??= requestEvent.requestRef?.dpRank;
    if (requestEvent.pid !== undefined) {
      builder.pidSet.add(requestEvent.pid);
    }
    builder.workerIds.add(requestEvent.workerId);
    builder.lifecycleEvents.push(requestEvent);
    indexBuilder(builder);
  }

  const requests = [...builders.values()]
    .map<NormalizedRequest>((builder) => {
      const lifecycleEvents = [...builder.lifecycleEvents].sort(
        (left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER)
      );

      const stages: Partial<Record<RequestStageKey, number>> = {};
      lifecycleEvents.forEach((event) => {
        const stageKey = stageMap[event.eventName];
        if (!stageKey || event.timestampMs === undefined) {
          return;
        }
        stages[stageKey] ??= event.timestampMs;
      });

      const start = stages.enteredAt ?? stages.addedAt ?? stages.insertedAt;
      const end =
        stages.endedAt ??
        stages.releaseResponseAt ??
        lifecycleEvents.at(-1)?.timestampMs;

      const status =
        lifecycleEvents.some((event) => event.eventName === "sequence_group_missing")
          ? "anomalous"
          : stages.endedAt || stages.releaseResponseAt
            ? "complete"
            : "incomplete";

      return {
        id: builder.id,
        llmMgrReqId: builder.llmMgrReqId,
        llmMgrReqIdRaw: builder.llmMgrReqIdRaw,
        engineReqId: builder.engineReqId,
        seqId: builder.seqId,
        dpRank: builder.dpRank,
        pidSet: [...builder.pidSet].sort((a, b) => a - b),
        workerIds: [...builder.workerIds].sort(),
        correlationConfidence: requestConfidence(builder),
        stages,
        lifecycleEvents,
        relatedPrefixCacheEventIds: [...builder.relatedPrefixCacheEventIds],
        relatedUCTaskIds: [...builder.relatedUCTaskIds],
        anomalies: [],
        unmatchedEvents: [...builder.unmatchedEvents],
        totalDurationMs: start !== undefined && end !== undefined ? end - start : undefined,
        status
      };
    })
    .sort((left, right) => {
      const leftStart = left.stages.enteredAt ?? left.stages.addedAt ?? Number.MAX_SAFE_INTEGER;
      const rightStart = right.stages.enteredAt ?? right.stages.addedAt ?? Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart;
    });

  return {
    requests,
    requestById: new Map(requests.map((request) => [request.id, request]))
  };
}
