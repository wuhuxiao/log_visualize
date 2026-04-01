import { describe, expect, it } from "vitest";
import type { NormalizedUCTask } from "../../types/models";
import { deriveAbstractUCTimelineSegments } from "../ucTimelineAbstraction";

function createTask(partial: Partial<NormalizedUCTask> & Pick<NormalizedUCTask, "id" | "workerId" | "ucKind" | "category">) {
  return {
    taskId: partial.id,
    eventIds: [],
    uncertain: false,
    anomalies: [],
    relatedRequestIds: [],
    ...partial
  } satisfies NormalizedUCTask;
}

describe("deriveAbstractUCTimelineSegments", () => {
  it("derives lookup, cache load, model forward, and cache dump between lookup windows", () => {
    const tasks: NormalizedUCTask[] = [
      createTask({
        id: "lookup-1",
        workerId: "pid:901",
        ucKind: "lookup",
        category: "Lookup",
        dispatchAt: 100,
        finishAt: 110,
        costMs: 10
      }),
      createTask({
        id: "load-1",
        workerId: "pid:1901",
        ucKind: "cache",
        category: "Load",
        dispatchAt: 112,
        finishAt: 125,
        costMs: 13,
        bytes: 1024
      }),
      createTask({
        id: "dump-1",
        workerId: "pid:2901",
        ucKind: "cache",
        category: "Dump",
        dispatchAt: 150,
        finishAt: 160,
        costMs: 10,
        bytes: 2048
      }),
      createTask({
        id: "posix-dump-1",
        workerId: "pid:3901",
        ucKind: "posix",
        category: "Cache2Backend",
        dispatchAt: 162,
        finishAt: 180,
        costMs: 18,
        bytes: 4096
      }),
      createTask({
        id: "lookup-2",
        workerId: "pid:901",
        ucKind: "lookup",
        category: "Lookup",
        dispatchAt: 200,
        finishAt: 210,
        costMs: 10
      })
    ];

    const segments = deriveAbstractUCTimelineSegments(tasks);
    const lookup = segments.find((segment) => segment.phase === "lookup" && segment.start === 100);
    const load = segments.find((segment) => segment.phase === "cacheLoad");
    const forward = segments.find((segment) => segment.phase === "modelForward");
    const dump = segments.find((segment) => segment.phase === "cacheDump");

    expect(lookup).toBeDefined();
    expect(load?.start).toBe(112);
    expect(load?.end).toBe(125);
    expect(forward?.start).toBe(125);
    expect(forward?.end).toBe(150);
    expect(dump?.start).toBe(150);
    expect(dump?.end).toBe(160);
  });
});
