import type { LogSource, RawLogLine } from "../types/models";
import { parseTimestampToMs } from "../utils/time";
import { parseFileInfo } from "./helpers";

function parseStandardHeader(
  source: LogSource,
  lineNo: number,
  rawText: string
): RawLogLine | undefined {
  const match = rawText.match(
    /^\[(?<ts>[^\]]+)\]\s*\[(?<pid>[^\]]+)\]\s*\[(?<tid>[^\]]+)\]\s*\[(?<module>[^\]]+)\]\s*\[(?<level>[^\]]+)\]\s*\[(?<fileInfo>[^\]]+)\]\s*:?\s*(?<message>.*)$/
  );

  if (!match?.groups) {
    return undefined;
  }

  const { ts, pid, tid, module, level, fileInfo, message } = match.groups;

  return {
    id: `${source.id}:${lineNo}`,
    sourceId: source.id,
    sourceName: source.name,
    lineNo,
    rawText,
    headerKind: "standard",
    timestampText: ts ?? "",
    timestampMs: parseTimestampToMs(ts ?? ""),
    pid: Number(pid ?? 0),
    tid: tid ?? "",
    module: module ?? "",
    level: level ?? "",
    message: message ?? "",
    metadata: {},
    ...parseFileInfo(fileInfo ?? "")
  };
}

function parseUcHeader(
  source: LogSource,
  lineNo: number,
  rawText: string
): RawLogLine | undefined {
  const headMatch = rawText.match(/^\[(?<ts>[^\]]+)\]\[(?<module>[^\]]+)\]\[(?<level>[^\]]+)\]\s*(?<message>.*)$/);
  if (!headMatch?.groups) {
    return undefined;
  }

  const { ts, module, level } = headMatch.groups;
  let message = headMatch.groups.message ?? "";
  let pid: number | undefined;
  let tid: string | undefined;
  let file: string | undefined;
  let line: number | undefined;
  let functionName: string | undefined;

  const trailerMatch = message.match(/\s+\[(\d+),(\d+)\]\[([^:\]]+):(\d+),([^\]]+)\]\s*$/);
  if (trailerMatch) {
    pid = Number(trailerMatch[1]);
    tid = trailerMatch[2];
    file = trailerMatch[3];
    line = Number(trailerMatch[4]);
    functionName = trailerMatch[5];
    const trailerIndex = trailerMatch.index ?? message.length;
    message = message.slice(0, trailerIndex).trimEnd();
  }

  return {
    id: `${source.id}:${lineNo}`,
    sourceId: source.id,
    sourceName: source.name,
    lineNo,
    rawText,
    headerKind: "uc",
    timestampText: ts ?? "",
    timestampMs: parseTimestampToMs(ts ?? ""),
    pid,
    tid,
    module: module ?? "",
    level: level ?? "",
    file,
    line,
    functionName,
    message,
    metadata: {}
  };
}

export function parseRawLogLine(source: LogSource, lineNo: number, rawText: string): RawLogLine {
  return (
    parseStandardHeader(source, lineNo, rawText) ??
    parseUcHeader(source, lineNo, rawText) ?? {
      id: `${source.id}:${lineNo}`,
      sourceId: source.id,
      sourceName: source.name,
      lineNo,
      rawText,
      headerKind: "unknown",
      message: rawText,
      metadata: {}
    }
  );
}
