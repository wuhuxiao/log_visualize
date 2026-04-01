import type { ParsedEvent, RawLogLine, UCTaskEvent } from "../../types/models";
import { createBaseEvent, extractNumber, extractTaskTuple } from "../helpers";

function buildUCTaskEvent(
  raw: RawLogLine,
  eventName: string,
  ucKind: UCTaskEvent["ucKind"],
  ucPhase: UCTaskEvent["ucPhase"],
  overrides: Partial<UCTaskEvent>
): UCTaskEvent {
  return {
    ...(createBaseEvent(raw, eventName, "uc_task", {
      correlationConfidence: "none"
    }) as UCTaskEvent),
    ucKind,
    ucPhase,
    ...overrides
  };
}

export function parseUCEvent(raw: RawLogLine): ParsedEvent | undefined {
  if (!raw.message.includes("Cache") && !raw.message.includes("Posix")) {
    return undefined;
  }

  const cacheLookupMatch = raw.message.match(/Cache lookup\((\d+)(?:\/(\d+))?\)(?: in backend)? costs ([\d.]+)ms/i);
  if (cacheLookupMatch) {
    const isBackend = raw.message.includes("in backend");
    return buildUCTaskEvent(
      raw,
      isBackend ? "cache_lookup_backend" : "cache_lookup",
      "lookup",
      "lookup",
      {
        taskType: "Lookup",
        costMs: Number(cacheLookupMatch[3]),
        shards: cacheLookupMatch[2] ? Number(cacheLookupMatch[2]) : Number(cacheLookupMatch[1]),
        bytes: undefined,
        extracted: {
          lookupCount: Number(cacheLookupMatch[1]),
          backendLookupCount: cacheLookupMatch[2] ? Number(cacheLookupMatch[2]) : null
        }
      }
    );
  }

  if (raw.message.includes("Cache task(")) {
    const tuple = extractTaskTuple(raw.message, "Cache task");
    if (!tuple?.taskId) {
      return undefined;
    }

    const taskType = tuple.second && /^(Load|Dump)$/i.test(tuple.second) ? tuple.second : undefined;
    const shards = tuple.third ? Number(tuple.third) : undefined;
    const bytes = tuple.fourth ? Number(tuple.fourth) : undefined;

    if (raw.message.includes("dispatching")) {
      return buildUCTaskEvent(raw, "cache_task_dispatch", "cache", "dispatch", {
        taskId: tuple.taskId,
        taskType,
        shards,
        bytes
      });
    }

    if (raw.message.includes("start running")) {
      return buildUCTaskEvent(raw, "cache_task_start", "cache", "start", {
        taskId: tuple.taskId,
        taskType,
        shards,
        bytes,
        extracted: {
          waitMs: extractNumber(raw.message, /wait\s*([\d.]+)ms/i) ?? null
        }
      });
    }

    if (raw.message.includes("finished")) {
      return buildUCTaskEvent(raw, "cache_task_finish", "cache", "finish", {
        taskId: tuple.taskId,
        taskType,
        shards,
        bytes,
        costMs: extractNumber(raw.message, /cost\s*([\d.]+)ms/i)
      });
    }

    if (raw.message.includes("wait=") || raw.message.includes("mk_buf=") || raw.message.includes("sync=")) {
      return buildUCTaskEvent(raw, "cache_task_metrics", "cache", "metrics", {
        taskId: tuple.taskId,
        extracted: {
          waitMs: extractNumber(raw.message, /wait=([\d.]+)ms/i) ?? null,
          mkBufMs: extractNumber(raw.message, /mk_buf=([\d.]+)ms/i) ?? null,
          syncMs: extractNumber(raw.message, /sync=([\d.]+)ms/i) ?? null,
          backMs: extractNumber(raw.message, /back=([\d.]+)ms/i) ?? null
        }
      });
    }
  }

  if (raw.message.includes("Posix")) {
    const tuple = extractTaskTuple(raw.message, "Posix task");
    if (tuple?.taskId) {
      const direction = tuple.second as UCTaskEvent["direction"] | undefined;
      const shards = tuple.third ? Number(tuple.third) : undefined;
      const bytes = tuple.fourth ? Number(tuple.fourth) : undefined;

      if (raw.message.includes("dispatching")) {
        return buildUCTaskEvent(raw, "posix_task_dispatch", "posix", "dispatch", {
          taskId: tuple.taskId,
          direction,
          shards,
          bytes
        });
      }

      if (raw.message.includes("finished")) {
        return buildUCTaskEvent(raw, "posix_task_finish", "posix", "finish", {
          taskId: tuple.taskId,
          direction,
          shards,
          bytes,
          costMs: extractNumber(raw.message, /cost\s*([\d.]+)ms/i)
        });
      }
    }

    const startMatch = raw.message.match(/Posix (load|dump) task\((\d+)\) start running, wait ([\d.]+)ms/i);
    if (startMatch) {
      const phaseType = startMatch[1] ?? "";
      const taskType = phaseType.toLowerCase() === "load" ? "Load" : "Dump";
      return buildUCTaskEvent(raw, "posix_task_start", "posix", "start", {
        taskId: startMatch[2] ?? "",
        taskType,
        direction: taskType === "Load" ? "Backend2Cache" : "Cache2Backend",
        extracted: {
          waitMs: Number(startMatch[3] ?? 0)
        }
      });
    }
  }

  return undefined;
}
