import type { ParsedEventBase, RawLogLine, RequestRef, Severity } from "../types/models";

export function resolveWorkerId(raw: RawLogLine): string {
  if (typeof raw.metadata.workerId === "string") {
    return raw.metadata.workerId;
  }

  if (raw.pid !== undefined) {
    return `pid:${raw.pid}`;
  }

  return raw.sourceName;
}

export function parseFileInfo(fileInfo?: string): Pick<
  RawLogLine,
  "file" | "line" | "functionName"
> {
  if (!fileInfo) {
    return {};
  }

  const match = fileInfo.match(/^(.*?)(?::|-)(\d+)(?:,(.*))?$/);
  if (!match) {
    return { file: fileInfo };
  }

  const [, file, line, functionName] = match;
  return {
    file,
    line: Number(line),
    functionName: functionName?.trim() || undefined
  };
}

export function buildRequestRef(message: string): RequestRef | undefined {
  const llmMatch =
    message.match(/llmMgrReqId[:=]\s*([0-9]+(?:\/\d+)?)/i) ??
    message.match(/request[_ ]?id[:=]\s*([0-9]+)(?![0-9a-f])/i) ??
    message.match(/RequestId is\s*([0-9]+)/i);
  const engineMatch = message.match(/EngineReqId[:=]\s*([a-zA-Z0-9]+)/i);
  const seqMatch = message.match(/seqId[:=]\s*([0-9]+)/i);
  const dpMatch = message.match(/DP RankId[:=]\s*([0-9]+)/i);

  const llmMgrReqIdRaw = llmMatch?.[1];
  const llmMgrReqId = llmMgrReqIdRaw?.split("/")[0];
  const engineReqId = engineMatch?.[1];
  const seqId = seqMatch?.[1];
  const dpRank = dpMatch?.[1] ? Number(dpMatch[1]) : undefined;

  if (!llmMgrReqId && !engineReqId && !seqId && dpRank === undefined) {
    return undefined;
  }

  return {
    llmMgrReqId,
    llmMgrReqIdRaw,
    engineReqId,
    seqId,
    dpRank
  };
}

export function inferSeverity(
  level?: string,
  message?: string
): Severity {
  const normalizedLevel = level?.toLowerCase();

  if (normalizedLevel === "error" || normalizedLevel === "e") {
    return "error";
  }

  if (message?.toLowerCase().includes("too long") || message?.toLowerCase().includes("can not find")) {
    return "warning";
  }

  return "info";
}

export function createBaseEvent(
  raw: RawLogLine,
  eventName: string,
  eventType: ParsedEventBase["eventType"],
  overrides: Partial<ParsedEventBase> = {}
): ParsedEventBase {
  return {
    id: `${raw.sourceId}:${raw.lineNo}:${eventName}`,
    rawLineId: raw.id,
    sourceId: raw.sourceId,
    sourceName: raw.sourceName,
    lineNo: raw.lineNo,
    timestampMs: raw.timestampMs,
    timestampText: raw.timestampText,
    pid: raw.pid,
    tid: raw.tid,
    module: raw.module,
    file: raw.file,
    line: raw.line,
    functionName: raw.functionName,
    workerId: resolveWorkerId(raw),
    eventType,
    eventName,
    severity: inferSeverity(raw.level, raw.message),
    requestRef: buildRequestRef(raw.message),
    costMs: undefined,
    bytes: undefined,
    shards: undefined,
    unmatched: false,
    uncertain: false,
    correlationConfidence: "none",
    anomalyTags: [],
    extracted: {},
    rawMessage: raw.message,
    ...overrides
  };
}

export function extractNumber(
  message: string,
  pattern: RegExp
): number | undefined {
  const match = message.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }

  return Number(match[1]);
}

export function extractTaskTuple(message: string, noun: "Cache task" | "Posix task") {
  const match = message.match(
    new RegExp(`${noun.replace(" ", "\\s+")}\\(([^,\\)]+)(?:,([^,\\)]+))?(?:,([^,\\)]+))?(?:,([^,\\)]+))?\\)`, "i")
  );
  if (!match) {
    return undefined;
  }

  return {
    taskId: match[1]?.trim(),
    second: match[2]?.trim(),
    third: match[3]?.trim(),
    fourth: match[4]?.trim()
  };
}
