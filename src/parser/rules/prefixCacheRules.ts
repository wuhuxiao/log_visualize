import type { ParsedEvent, PrefixCacheEvent, RawLogLine } from "../../types/models";
import { createBaseEvent, extractNumber } from "../helpers";

export function parsePrefixCacheEvent(raw: RawLogLine): ParsedEvent | undefined {
  if (!raw.message.includes("Prefix Cache Reporter") && !raw.message.includes("Prefix Cache Global Reporter")) {
    return undefined;
  }

  const scope = raw.message.includes("Global") ? "global" : "request";
  const eventName = scope === "global" ? "prefix_cache_global" : "prefix_cache_request";
  return {
    ...(createBaseEvent(raw, eventName, "prefix_cache", {
      correlationConfidence: scope === "request" ? "low" : "none",
      uncertain: scope === "request",
      extracted: {
        batchSize: extractNumber(raw.message, /#batchsize:\s*(\d+)/i) ?? null,
        batchedTokens: extractNumber(raw.message, /#batched-tokens:\s*(\d+)/i) ?? null,
        totalPrefillTokens: extractNumber(raw.message, /#total prefill tokens:\s*(\d+)/i) ?? null,
        localCachedTokens:
          extractNumber(raw.message, /#(?:total )?local (?:cached|matched)[-\w ]*tokens:\s*(\d+)/i) ?? null,
        remoteCachedTokens:
          extractNumber(raw.message, /#(?:total )?remote (?:cached|matched)[-\w ]*tokens:\s*(\d+)/i) ?? null,
        localHitRate:
          extractNumber(raw.message, /#(?:total )?local (?:cache|cached) hit rate:\s*([\d.]+)/i) ?? null,
        remoteHitRate:
          extractNumber(raw.message, /#(?:total )?remote (?:cache|cached) hit rate:\s*([\d.]+)/i) ?? null,
        hitRate: extractNumber(raw.message, /#(?:total )?cached hit rate:\s*([\d.]+)/i) ?? null
      }
    }) as PrefixCacheEvent),
    scope
  };
}
