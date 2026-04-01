import { describe, expect, it } from "vitest";
import { analyzeSources } from "../../normalizer";
import { parseSources } from "..";
import type { LogSource } from "../../types/models";

const baseSource: LogSource = {
  id: "test",
  name: "test.log",
  text: [
    "[2026-03-31 17:02:10.000111] [901] [1101] [llm] [INFO] [llm_manager_impl.cpp:1514] Get a new inferRequest from server, llmMgrReqId: 20001",
    "[2026-03-31 17:02:10.000512] [901] [1101] [llm] [INFO] [llm_engine.cpp:143] [LlmEngine|Request-Enter Waiting] DP RankId: 0, Add request(llmMgrReqId: 20001/0, EngineReqId: eng20001, seqId: 301) successfully. Total added request num is:1",
    "[2026-03-31 17:02:10.003120] [901] [1102] [llm] [INFO] [scheduler.cpp:229] [Scheduler|Schedule-scheduling] DP RankId: 0. After Backfill, running size:1; waiting size: 1; swapped size:0; batch size:1; transferring size:1; schedule forwardMode:0; PD PriorityType:0",
    "[2026-03-31 17:02:10.125551] [902] [1203] [llm] [INFO] [llm_engine.cpp:478] [Scheduler|Schedule-Response] Response and schedule transfer cost too long. DP RankId:1, response cost:1880, ScheduleExecTransfer cost:0, scheduleCost:66, totalIterCost:1946, schedulingRound:101",
    "[2026-03-31 17:02:10.126017] [902] [1204] [llm] [INFO] [model_exec_output_handler.cpp:47] Can not find sequence group, seqId=301",
    "[2026-03-31 17:02:10.004011][UC][D] Cache task(11,Load,32,262144000) dispatching. [1901,22001][trans_manager.h:58,Dispatch]",
    "[2026-03-31 17:02:10.004511][UC][D] Posix task(11,Backend2Cache,32,262144000) dispatching. [1901,22007][io_engine_psync.h:53,Dispatch]",
    "[2026-03-31 17:02:10.025611][UC][D] Posix task(11,Backend2Cache,32,262144000) finished, cost 20.331ms. [1901,22007][io_engine_psync.h:56,operator()]",
    "[2026-03-31 17:02:10.061712][UC][D] Cache task(11,Load,32,262144000) finished, cost 57.701ms. [1901,22001][trans_manager.h:61,operator()]",
    "[2026-03-31 17:02:10,062] [1901] [281470442199168] [llm] [INFO] [prefix_cache_plugin.py-169] : Prefix Cache Reporter: #batchsize: 1, #batched-tokens: 8192, #local cached-tokens: 1024, #local cache hit rate: 12.5%, #remote cached-tokens: 2048, #remote cache hit rate: 25.0%, #cache hit rate: 37.5%"
  ].join("\n")
};

const scheduledBatchSource: LogSource = {
  id: "scheduled-batch",
  name: "scheduled-batch.log",
  text: [
    "[2026-03-31 17:02:10.000111] [901] [1101] [llm] [INFO] [llm_manager_impl.cpp:1514] Get a new inferRequest from server, llmMgrReqId: 20001",
    "[2026-03-31 17:02:10.000512] [901] [1101] [llm] [INFO] [llm_engine.cpp:143] [LlmEngine|Request-Enter Waiting] DP RankId: 0, Add request(llmMgrReqId: 20001/0, EngineReqId: eng20001, seqId: 301) successfully. Total added request num is:1",
    "[2026-03-31 17:02:10.001002] [901] [1101] [llm] [INFO] [llm_manager_impl.cpp:1566] Insert a new inferRequest, llmMgrReqId: 20001/0, EngineReqId: eng20001",
    "[2026-03-31 17:02:10.003120] [901] [1102] [llm] [INFO] [scheduler.cpp:229] [Scheduler|Schedule-scheduling] DP RankId: 0. After Backfill, running size:1; waiting size: 1; swapped size:0; batch size:1; transferring size:1; schedule forwardMode:0; PD PriorityType:0",
    "[2026-03-31 17:02:10.003900][UC][D] Cache lookup(1/1) in backend costs 0.529ms. [901,1199][buffer_manager.h:115,LookupOnPrefixFast]",
    "[2026-03-31 17:02:10.004011][UC][D] Cache task(11,Load,32,262144000) dispatching. [1901,22001][trans_manager.h:58,Dispatch]",
    "[2026-03-31 17:02:10.004511][UC][D] Posix task(11,Backend2Cache,32,262144000) dispatching. [1901,22007][io_engine_psync.h:53,Dispatch]",
    "[2026-03-31 17:02:10.012845][UC][D] Posix load task(11) start running, wait 0.861ms. [1901,22008][trans_queue.cc:111,LoadWorker]",
    "[2026-03-31 17:02:10.025611][UC][D] Posix task(11,Backend2Cache,32,262144000) finished, cost 20.331ms. [1901,22007][io_engine_psync.h:56,operator()]",
    "[2026-03-31 17:02:10.061712][UC][D] Cache task(11,Load,32,262144000) finished, cost 57.701ms. [1901,22001][trans_manager.h:61,operator()]",
    "[2026-03-31 17:02:10,062] [1901] [281470442199168] [llm] [INFO] [prefix_cache_plugin.py-169] : Prefix Cache Reporter: #batchsize: 1, #batched-tokens: 8192, #local cached-tokens: 1024, #local cache hit rate: 12.5%, #remote cached-tokens: 2048, #remote cache hit rate: 25.0%, #cache hit rate: 37.5%",
    "[2026-03-31 17:02:10.065015] [901] [1104] [server] [INFO] [prefill_wrapper.cpp:194] [endpoint] Finish decode tokenIds. RequestId is 20001",
    "[2026-03-31 17:02:10.065091] [901] [1104] [llm] [INFO] [model_exec_output_handler.cpp:65] [LlmEngine|Request-Publish Complete] DP RankId: 0. Request Prefill Complete, llmMgrReqId:20001, seqId: 301, pInstanceId:0, localDPRank_:0",
    "[2026-03-31 17:02:10.080211] [901] [1105] [server] [INFO] [dmi_msg_receiver.cpp:99] [endpoint] Get kv release request, reqId is 20001",
    "[2026-03-31 17:02:10.080544] [901] [1106] [llm] [INFO] [llm_manager_impl.cpp:1762] Get a new ControlRequest from server, llmMgrReqId: 20001, EngineReqId: eng20001, with operation:2",
    "[2026-03-31 17:02:10.080620] [901] [1106] [server] [INFO] [infer_backend_manager.cpp:402] [infer_backend_manager] Backendmanager control request successfully, RequestId is 20001",
    "[2026-03-31 17:02:10.080694] [901] [1106] [llm] [INFO] [llm_engine.cpp:236] [LlmEngine] DP RankId: 0. Send Release KV response(EngineReqId: eng20001) successfully.",
    "[2026-03-31 17:02:10.080992] [901] [1106] [llm] [INFO] [llm_manager_impl.cpp:1888] Request life endup, llmMgrReqId: 20001, final status: success",
    "[2026-03-31 17:02:10.081411] [901] [1203] [llm] [INFO] [llm_engine.cpp:478] [Scheduler|Schedule-Response] Response and schedule transfer cost too long. DP RankId:0, response cost:1880, ScheduleExecTransfer cost:0, scheduleCost:66, totalIterCost:1946, schedulingRound:101",
    "[2026-03-31 17:02:10.083011][UC][D] Cache task(21,Dump,4,32768000) dispatching. [2901,32001][trans_manager.h:58,Dispatch]",
    "[2026-03-31 17:02:10.083428][UC][D] Posix task(21,Cache2Backend,4,32768000) dispatching. [2901,32009][io_engine_psync.h:53,Dispatch]",
    "[2026-03-31 17:02:10.084422][UC][D] Cache task(21,Dump,4,32768000) finished, cost 40.500ms. [2901,32001][trans_manager.h:61,operator()]",
    "[2026-03-31 17:02:10.091021][UC][D] Posix task(21,Cache2Backend,4,32768000) finished, cost 9.300ms. [2901,32009][io_engine_psync.h:56,operator()]"
  ].join("\n")
};

describe("parseSources", () => {
  it("parses multiple event families from heterogeneous log formats", () => {
    const { events } = parseSources([baseSource]);

    expect(events.some((event) => event.eventName === "request_received")).toBe(true);
    expect(events.some((event) => event.eventName === "scheduler_scheduling")).toBe(true);
    expect(events.some((event) => event.eventName === "cache_task_dispatch")).toBe(true);
    expect(events.some((event) => event.eventName === "prefix_cache_request")).toBe(true);
  });
});

describe("analyzeSources", () => {
  it("correlates request lifecycle and attaches anomalies", () => {
    const result = analyzeSources([baseSource]);

    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.llmMgrReqId).toBe("20001");
    expect(result.requests[0]?.engineReqId).toBe("eng20001");
    expect(result.requests[0]?.seqId).toBe("301");
    expect(result.requests[0]?.anomalies.some((anomaly) => anomaly.type === "sequence_group_missing")).toBe(true);
    expect(result.anomalies.some((anomaly) => anomaly.type === "slow_scheduler_response")).toBe(true);
    expect(result.prefixAssociations[0]?.requestId).toBe(result.requests[0]?.id);
  });

  it("pairs cache and posix tasks and detects large cost gaps", () => {
    const result = analyzeSources([baseSource]);

    const cacheTask = result.ucTasks.find((task) => task.category === "Load");
    const posixTask = result.ucTasks.find((task) => task.category === "Backend2Cache");

    expect(cacheTask?.pairedPosixTaskId).toBe(posixTask?.id);
    expect(
      result.anomalies.some(
        (anomaly) =>
          anomaly.type === "cache_posix_gap" &&
          anomaly.taskId === cacheTask?.id
      )
    ).toBe(true);
  });

  it("builds schedule batches from Prefix Cache Reporter to request release", () => {
    const result = analyzeSources([scheduledBatchSource]);

    expect(result.scheduleBatches).toHaveLength(1);
    const batch = result.scheduleBatches[0];
    const request = result.requests[0];

    expect(batch?.requestIds).toContain(request?.id);
    expect(batch?.lookupCount).toBe(1);
    expect(batch?.cacheLoadTaskIds.length).toBe(1);
    expect(batch?.posixLoadTaskIds.length).toBe(1);
    expect(batch?.cacheDumpTaskIds.length).toBe(1);
    expect(batch?.posixDumpTaskIds.length).toBe(1);
    expect(batch?.responseEventIds.length).toBe(1);
    expect(batch?.reporterMs).toBeDefined();
    expect(request?.relatedScheduleBatchIds).toContain(batch?.id ?? "");
    expect(request?.stages.controlRequestAt).toBeDefined();
  });

  it("marks request anomalies using cache bandwidth and model compute percentiles", () => {
    const result = analyzeSources([scheduledBatchSource]);
    const request = result.requests[0];

    expect(request?.anomalies.some((anomaly) => anomaly.type === "low_cache_bandwidth")).toBe(true);
    expect(request?.anomalies.some((anomaly) => anomaly.type === "slow_model_compute")).toBe(true);
  });
});
