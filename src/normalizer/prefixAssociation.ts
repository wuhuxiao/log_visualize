import type { NormalizedRequest, ParsedEvent, PrefixCacheAssociation, PrefixCacheEvent } from "../types/models";

export function correlatePrefixCache(
  events: ParsedEvent[],
  requests: NormalizedRequest[]
): PrefixCacheAssociation[] {
  const associations: PrefixCacheAssociation[] = [];

  events
    .filter((event): event is PrefixCacheEvent => event.eventType === "prefix_cache")
    .forEach((event) => {
      if (event.scope === "global" || event.timestampMs === undefined) {
        associations.push({ eventId: event.id, confidence: "none" });
        return;
      }

      const candidates = requests
        .map((request) => {
          const pivot = request.stages.prefillCompleteAt ?? request.stages.decodeFinishedAt ?? request.stages.enteredAt;
          return {
            request,
            distance: pivot === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(pivot - event.timestampMs!)
          };
        })
        .filter((candidate) => candidate.distance <= 1000)
        .sort((left, right) => left.distance - right.distance);

      const best = candidates[0];
      const second = candidates[1];
      if (!best || (second && Math.abs(second.distance - best.distance) <= 50)) {
        associations.push({ eventId: event.id, confidence: "low" });
        return;
      }

      best.request.relatedPrefixCacheEventIds.push(event.id);
      associations.push({
        eventId: event.id,
        requestId: best.request.id,
        confidence: best.distance <= 200 ? "medium" : "low"
      });
    });

  return associations;
}
