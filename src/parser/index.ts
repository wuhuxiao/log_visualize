import type { LogSource, ParsedEvent, RawLogLine } from "../types/models";
import { parseRawLogLine } from "./base";
import { createBaseEvent } from "./helpers";
import { parsePrefixCacheEvent } from "./rules/prefixCacheRules";
import { parseRequestEvent } from "./rules/requestRules";
import { parseSchedulerEvent } from "./rules/schedulerRules";
import { parseUCEvent } from "./rules/ucRules";

const parserRules = [parseRequestEvent, parseSchedulerEvent, parseUCEvent, parsePrefixCacheEvent];

export function parseSources(sources: LogSource[]): { rawLines: RawLogLine[]; events: ParsedEvent[] } {
  const rawLines: RawLogLine[] = [];
  const events: ParsedEvent[] = [];

  for (const source of sources) {
    const lines = source.text.split(/\r?\n/);
    lines.forEach((text, index) => {
      if (!text.trim()) {
        return;
      }

      const rawLine = parseRawLogLine(source, index + 1, text);
      rawLines.push(rawLine);

      const parsedEvent = parserRules
        .map((rule) => rule(rawLine))
        .find((event): event is ParsedEvent => event !== undefined);

      if (parsedEvent) {
        events.push(parsedEvent);
        return;
      }

      events.push(
        createBaseEvent(rawLine, rawLine.headerKind === "unknown" ? "unparsed_line" : "unmatched_line", "unknown", {
          unmatched: true,
          uncertain: true
        }) as ParsedEvent
      );
    });
  }

  events.sort((left, right) => (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER));

  return { rawLines, events };
}
