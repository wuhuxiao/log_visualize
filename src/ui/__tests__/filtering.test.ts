import { describe, expect, it } from "vitest";
import { analyzeSources } from "../../normalizer";
import type { FilterState, LogSource } from "../../types/models";
import { filterEvents, filterRequests } from "../filtering";

const source: LogSource = {
  id: "filtering",
  name: "filtering.log",
  text: [
    "[2026-03-31 17:02:10.000111] [901] [1101] [llm] [INFO] [llm_manager_impl.cpp:1514] Get a new inferRequest from server, llmMgrReqId: 20001",
    "[2026-03-31 17:02:10.000512] [901] [1101] [llm] [INFO] [llm_engine.cpp:143] [LlmEngine|Request-Enter Waiting] DP RankId: 0, Add request(llmMgrReqId: 20001/0, EngineReqId: eng20001, seqId: 301) successfully. Total added request num is:1",
    "[2026-03-31 17:02:10.003120] [901] [1102] [llm] [INFO] [scheduler.cpp:229] [Scheduler|Schedule-scheduling] DP RankId: 0. After Backfill, running size:1; waiting size: 1; swapped size:0; batch size:1; transferring size:1; schedule forwardMode:0; PD PriorityType:0",
    "[2026-03-31 17:02:10.004011][UC][D] Cache task(11,Load,32,104857600) dispatching. [1901,22001][trans_manager.h:58,Dispatch]",
    "[2026-03-31 17:02:10.024011][UC][D] Cache task(11,Load,32,104857600) finished, cost 200.0ms. [1901,22001][trans_manager.h:61,operator()]",
    "[2026-03-31 17:02:10,062] [1901] [281470442199168] [llm] [INFO] [prefix_cache_plugin.py-169] : Prefix Cache Reporter: #batchsize: 1, #batched-tokens: 8192, #local cached-tokens: 1024, #local cache hit rate: 12.5%, #remote cached-tokens: 2048, #remote cache hit rate: 25.0%, #cache hit rate: 37.5%",
    "[2026-03-31 17:02:10.300011] [901] [1104] [llm] [INFO] [model_exec_output_handler.cpp:65] [LlmEngine|Request-Publish Complete] DP RankId: 0. Request Prefill Complete, llmMgrReqId:20001, seqId: 301, pInstanceId:0, localDPRank_:0",
    "[2026-03-31 17:02:10.500011] [901] [1106] [llm] [INFO] [llm_manager_impl.cpp:1762] Get a new ControlRequest from server, llmMgrReqId: 20001, EngineReqId: eng20001, with operation:2",
    "[2026-03-31 17:02:10.520011][UC][D] Cache task(31,Dump,16,52428800) dispatching. [1901,22001][trans_manager.h:58,Dispatch]",
    "[2026-03-31 17:02:10.550011][UC][D] Cache task(31,Dump,16,52428800) finished, cost 300.0ms. [1901,22001][trans_manager.h:61,operator()]",
    "[2026-03-31 17:02:10.510011] [901] [1106] [llm] [INFO] [llm_engine.cpp:236] [LlmEngine] DP RankId: 0. Send Release KV response(EngineReqId: eng20001) successfully."
  ].join("\n")
};

const baseFilters: FilterState = {
  workerIds: [],
  pids: [],
  dpRanks: [],
  eventTypes: [],
  searchText: "",
  onlyAnomalies: false,
  customRequestThresholds: {
    enabled: false
  }
};

describe("filterRequests", () => {
  it("filters requests by custom anomaly thresholds", () => {
    const result = analyzeSources([source]);
    const filters: FilterState = {
      ...baseFilters,
      customRequestThresholds: {
        enabled: true,
        maxCacheLoadBandwidthMBps: 600,
        maxCacheDumpBandwidthMBps: 200,
        minModelComputeMs: 200
      }
    };

    const visibleEvents = filterEvents(result, filters);
    const requests = filterRequests(result, filters, visibleEvents);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.llmMgrReqId).toBe("20001");
  });
});
