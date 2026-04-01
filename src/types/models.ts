export type Primitive = string | number | boolean | null;

export type EventType =
  | "request"
  | "scheduler"
  | "uc_task"
  | "prefix_cache"
  | "status"
  | "unknown";

export type Severity = "info" | "warning" | "error";

export type CorrelationConfidence = "high" | "medium" | "low" | "none";

export interface LogSource {
  id: string;
  name: string;
  text: string;
}

export interface RawLogLine {
  id: string;
  sourceId: string;
  sourceName: string;
  lineNo: number;
  rawText: string;
  headerKind: "standard" | "uc" | "unknown";
  timestampText?: string;
  timestampMs?: number;
  pid?: number;
  tid?: string;
  module?: string;
  level?: string;
  file?: string;
  line?: number;
  functionName?: string;
  message: string;
  metadata: Record<string, Primitive>;
}

export interface RequestRef {
  llmMgrReqId?: string;
  llmMgrReqIdRaw?: string;
  engineReqId?: string;
  seqId?: string;
  dpRank?: number;
}

export interface ParsedEventBase {
  id: string;
  rawLineId: string;
  sourceId: string;
  sourceName: string;
  lineNo: number;
  timestampMs?: number;
  timestampText?: string;
  pid?: number;
  tid?: string;
  module?: string;
  file?: string;
  line?: number;
  functionName?: string;
  workerId: string;
  eventType: EventType;
  eventName: string;
  severity: Severity;
  requestRef?: RequestRef;
  costMs?: number;
  bytes?: number;
  shards?: number;
  unmatched?: boolean;
  uncertain?: boolean;
  correlationConfidence: CorrelationConfidence;
  anomalyTags: string[];
  extracted: Record<string, Primitive>;
  rawMessage: string;
}

export interface RequestLifecycleEvent extends ParsedEventBase {
  eventType: "request";
}

export interface SchedulerEvent extends ParsedEventBase {
  eventType: "scheduler";
  schedulerPhase: "scheduling" | "response";
}

export interface UCTaskEvent extends ParsedEventBase {
  eventType: "uc_task";
  ucKind: "cache" | "posix" | "lookup";
  ucPhase: "lookup" | "dispatch" | "start" | "finish" | "metrics";
  taskId?: string;
  taskType?: string;
  direction?: "Backend2Cache" | "Cache2Backend";
}

export interface PrefixCacheEvent extends ParsedEventBase {
  eventType: "prefix_cache";
  scope: "request" | "global";
}

export interface UnknownEvent extends ParsedEventBase {
  eventType: "unknown" | "status";
}

export type ParsedEvent =
  | RequestLifecycleEvent
  | SchedulerEvent
  | UCTaskEvent
  | PrefixCacheEvent
  | UnknownEvent;

export interface AnomalyRecord {
  id: string;
  type:
    | "slow_scheduler_response"
    | "sequence_group_missing"
    | "request_incomplete"
    | "cache_posix_gap";
  severity: "warning" | "error";
  title: string;
  description: string;
  eventId?: string;
  requestId?: string;
  taskId?: string;
  workerId?: string;
  timestampMs?: number;
  metrics?: Record<string, Primitive>;
}

export interface NormalizedRequest {
  id: string;
  llmMgrReqId?: string;
  llmMgrReqIdRaw?: string;
  engineReqId?: string;
  seqId?: string;
  dpRank?: number;
  pidSet: number[];
  workerIds: string[];
  correlationConfidence: CorrelationConfidence;
  stages: Partial<Record<RequestStageKey, number>>;
  lifecycleEvents: RequestLifecycleEvent[];
  relatedPrefixCacheEventIds: string[];
  relatedUCTaskIds: string[];
  relatedScheduleBatchIds: string[];
  anomalies: AnomalyRecord[];
  unmatchedEvents: string[];
  totalDurationMs?: number;
  status: "complete" | "incomplete" | "anomalous";
}

export type RequestStageKey =
  | "enteredAt"
  | "addedAt"
  | "insertedAt"
  | "decodeFinishedAt"
  | "prefillCompleteAt"
  | "kvReleaseAt"
  | "controlRequestAt"
  | "releaseResponseAt"
  | "endedAt";

export interface NormalizedUCTask {
  id: string;
  pid?: number;
  workerId: string;
  ucKind: "cache" | "posix" | "lookup";
  taskId?: string;
  taskType?: string;
  direction?: "Backend2Cache" | "Cache2Backend";
  category: "Load" | "Dump" | "Lookup" | "Backend2Cache" | "Cache2Backend";
  shards?: number;
  bytes?: number;
  dispatchAt?: number;
  startAt?: number;
  finishAt?: number;
  waitMs?: number;
  mkBufMs?: number;
  syncMs?: number;
  backMs?: number;
  costMs?: number;
  eventIds: string[];
  uncertain: boolean;
  anomalies: AnomalyRecord[];
  pairedPosixTaskId?: string;
  relatedRequestIds: Array<{
    requestId: string;
    confidence: CorrelationConfidence;
  }>;
}

export interface ProcessTaskSummary {
  workerId: string;
  pid?: number;
  category: NormalizedUCTask["category"];
  count: number;
  sumMs: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface PrefixCacheAssociation {
  eventId: string;
  requestId?: string;
  confidence: CorrelationConfidence;
}

export interface ScheduleBatch {
  id: string;
  schedulingRound?: number;
  reporterEventId: string;
  reporterMs?: number;
  startMs?: number;
  computeStartMs?: number;
  executionEndMs?: number;
  endMs?: number;
  workerIds: string[];
  pids: number[];
  dpRanks: number[];
  schedulingEventIds: string[];
  responseEventIds: string[];
  requestIds: string[];
  taskIds: string[];
  lookupTaskIds: string[];
  lookupCount: number;
  lookupTotalMs: number;
  lookupStartMs?: number;
  lookupEndMs?: number;
  lookupP50Ms?: number;
  lookupP90Ms?: number;
  lookupMaxMs?: number;
  cacheLoadTaskIds: string[];
  posixLoadTaskIds: string[];
  cacheDumpTaskIds: string[];
  posixDumpTaskIds: string[];
  cacheLoadTotalMs: number;
  posixLoadTotalMs: number;
  cacheDumpTotalMs: number;
  posixDumpTotalMs: number;
}

export interface AnalysisResult {
  sources: LogSource[];
  rawLines: RawLogLine[];
  events: ParsedEvent[];
  requests: NormalizedRequest[];
  ucTasks: NormalizedUCTask[];
  processSummaries: ProcessTaskSummary[];
  scheduleBatches: ScheduleBatch[];
  anomalies: AnomalyRecord[];
  unmatchedEvents: ParsedEvent[];
  prefixAssociations: PrefixCacheAssociation[];
}

export interface FilterState {
  workerIds: string[];
  pids: number[];
  dpRanks: number[];
  eventTypes: EventType[];
  searchText: string;
  onlyAnomalies: boolean;
}
