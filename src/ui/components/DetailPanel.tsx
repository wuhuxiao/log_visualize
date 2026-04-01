import { useEffect, useMemo, useState } from "react";
import type {
  AnalysisResult,
  AnomalyRecord,
  NormalizedRequest,
  NormalizedUCTask,
  ParsedEvent,
  SchedulerEvent
} from "../../types/models";
import { bandwidthMBps, deriveRequestTimeline, taskEnd, taskStart } from "../requestTimeline";
import { formatDuration, formatTimestamp } from "../../utils/time";

interface DetailPanelProps {
  result: AnalysisResult;
  selectedRequest?: NormalizedRequest;
  selectedTask?: NormalizedUCTask;
  selectedEvent?: ParsedEvent;
}

interface RequestTaskListItem {
  id: string;
  category: "Lookup" | "Cache Load" | "Posix Load" | "Cache Dump" | "Posix Dump";
  task: NormalizedUCTask;
  batchId?: string;
}

const PAGE_SIZE = 10;

function renderAnomalies(anomalies: AnomalyRecord[]) {
  if (anomalies.length === 0) {
    return <div className="detail-muted">No anomalies detected.</div>;
  }

  return (
    <div className="detail-list">
      {anomalies.map((anomaly) => (
        <div key={anomaly.id} className="detail-card anomaly">
          <strong>{anomaly.title}</strong>
          <span>{anomaly.description}</span>
        </div>
      ))}
    </div>
  );
}

function formatBandwidth(task: NormalizedUCTask) {
  const value = bandwidthMBps(task);
  return value === undefined ? "n/a" : `${value.toFixed(2)} MB/s`;
}

export function DetailPanel({ result, selectedRequest, selectedTask, selectedEvent }: DetailPanelProps) {
  const [taskPage, setTaskPage] = useState(1);

  const schedulingEvents = useMemo(
    () =>
      result.events.filter(
        (event): event is SchedulerEvent => event.eventType === "scheduler" && event.eventName === "scheduler_scheduling"
      ),
    [result.events]
  );

  const requestDetail = useMemo(() => {
    if (!selectedRequest) {
      return undefined;
    }

    const derived = deriveRequestTimeline(selectedRequest, result.scheduleBatches, result.ucTasks, schedulingEvents);
    const taskRows: RequestTaskListItem[] = [];
    const categorySummary = {
      lookup: 0,
      cacheLoad: 0,
      posixLoad: 0,
      cacheDump: 0,
      posixDump: 0
    };

    for (const { batch, taskGroups } of derived.batches) {
      for (const task of taskGroups.lookupTasks) {
        taskRows.push({ id: `lookup:${task.id}`, category: "Lookup", task, batchId: batch.id });
        categorySummary.lookup += 1;
      }
      for (const task of taskGroups.cacheLoadTasks) {
        taskRows.push({ id: `cache-load:${task.id}`, category: "Cache Load", task, batchId: batch.id });
        categorySummary.cacheLoad += 1;
      }
      for (const task of taskGroups.posixLoadTasks) {
        taskRows.push({ id: `posix-load:${task.id}`, category: "Posix Load", task, batchId: batch.id });
        categorySummary.posixLoad += 1;
      }
      for (const task of taskGroups.cacheDumpTasks) {
        taskRows.push({ id: `cache-dump:${task.id}`, category: "Cache Dump", task, batchId: batch.id });
        categorySummary.cacheDump += 1;
      }
      for (const task of taskGroups.posixDumpTasks) {
        taskRows.push({ id: `posix-dump:${task.id}`, category: "Posix Dump", task, batchId: batch.id });
        categorySummary.posixDump += 1;
      }
    }

    taskRows.sort(
      (left, right) =>
        (taskStart(left.task) ?? Number.MAX_SAFE_INTEGER) - (taskStart(right.task) ?? Number.MAX_SAFE_INTEGER)
    );

    return {
      derived,
      taskRows,
      categorySummary,
      relatedScheduleBatches: result.scheduleBatches.filter((batch) => batch.requestIds.includes(selectedRequest.id))
    };
  }, [result.scheduleBatches, result.ucTasks, schedulingEvents, selectedRequest]);

  useEffect(() => {
    setTaskPage(1);
  }, [selectedRequest?.id]);

  if (selectedRequest && requestDetail) {
    const totalPages = Math.max(1, Math.ceil(requestDetail.taskRows.length / PAGE_SIZE));
    const currentPage = Math.min(taskPage, totalPages);
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const pagedTasks = requestDetail.taskRows.slice(startIndex, startIndex + PAGE_SIZE);

    return (
      <aside className="detail-panel">
        <h2>Request Detail</h2>
        <div className="detail-card">
          <strong>{selectedRequest.llmMgrReqId ?? selectedRequest.engineReqId ?? selectedRequest.id}</strong>
          <span>EngineReqId: {selectedRequest.engineReqId ?? "n/a"}</span>
          <span>seqId: {selectedRequest.seqId ?? "n/a"}</span>
          <span>pid: {selectedRequest.pidSet.join(", ") || "n/a"}</span>
          <span>dp rank: {selectedRequest.dpRank ?? "n/a"}</span>
          <span>Total duration: {formatDuration(selectedRequest.totalDurationMs)}</span>
          <span>Status: {selectedRequest.status}</span>
        </div>

        <h3>Key Phases</h3>
        <div className="detail-list">
          {requestDetail.derived.phases.length > 0 ? (
            requestDetail.derived.phases.map((phase, index) => (
              <div key={`${phase.batchId ?? "none"}:${phase.key}:${index}`} className="detail-card">
                <strong>{phase.label}</strong>
                <span>
                  {formatTimestamp(phase.start)} {"->"} {formatTimestamp(phase.end)}
                </span>
                <span>Duration: {formatDuration(phase.end - phase.start)}</span>
                <span>Batch: {phase.batchId ?? "n/a"}</span>
              </div>
            ))
          ) : (
            <div className="detail-muted">No timeline phases matched this request.</div>
          )}
        </div>

        <h3>Related UC Task Summary</h3>
        <div className="detail-summary-grid">
          <div className="detail-card compact">
            <strong>Lookup</strong>
            <span>{requestDetail.categorySummary.lookup} tasks</span>
          </div>
          <div className="detail-card compact">
            <strong>Cache load</strong>
            <span>{requestDetail.categorySummary.cacheLoad} tasks</span>
          </div>
          <div className="detail-card compact">
            <strong>Posix load</strong>
            <span>{requestDetail.categorySummary.posixLoad} tasks</span>
          </div>
          <div className="detail-card compact">
            <strong>Cache dump</strong>
            <span>{requestDetail.categorySummary.cacheDump} tasks</span>
          </div>
          <div className="detail-card compact">
            <strong>Posix dump</strong>
            <span>{requestDetail.categorySummary.posixDump} tasks</span>
          </div>
        </div>

        <h3>UC Task List</h3>
        <div className="detail-pagination">
          <span>
            Page {currentPage} / {totalPages}
          </span>
          <div className="detail-pagination-actions">
            <button type="button" onClick={() => setTaskPage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1}>
              Prev
            </button>
            <button
              type="button"
              onClick={() => setTaskPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
        <div className="detail-scroll-list">
          {pagedTasks.map((item) => (
            <div key={item.id} className="detail-card compact">
              <strong>
                {item.category} / {item.task.taskId ?? item.task.id}
              </strong>
              <span>Batch: {item.batchId ?? "n/a"}</span>
              <span>
                Worker: {item.task.workerId} / pid {item.task.pid ?? "n/a"}
              </span>
              <span>
                {formatTimestamp(taskStart(item.task))} {"->"} {formatTimestamp(taskEnd(item.task))}
              </span>
              <span>Cost: {formatDuration(item.task.costMs)}</span>
              <span>Bandwidth: {formatBandwidth(item.task)}</span>
              <span>Bytes: {item.task.bytes ?? "n/a"}</span>
              <span>Paired posix: {item.task.pairedPosixTaskId ?? "n/a"}</span>
            </div>
          ))}
          {requestDetail.taskRows.length === 0 ? <div className="detail-muted">No related UC tasks for this request.</div> : null}
        </div>

        <h3>Related Schedule Batches</h3>
        <div className="detail-scroll-list">
          {requestDetail.relatedScheduleBatches.map((batch) => (
            <div key={batch.id} className="detail-card compact">
              <strong>{batch.id}</strong>
              <span>Round: {batch.schedulingRound ?? "n/a"}</span>
              <span>
                Window: {formatTimestamp(batch.startMs)} ~ {formatTimestamp(batch.endMs)}
              </span>
              <span>Lookup: {formatDuration(batch.lookupTotalMs)}</span>
              <span>Cache load: {formatDuration(batch.cacheLoadTotalMs)}</span>
              <span>Posix load: {formatDuration(batch.posixLoadTotalMs)}</span>
              <span>Cache dump: {formatDuration(batch.cacheDumpTotalMs)}</span>
              <span>Posix dump: {formatDuration(batch.posixDumpTotalMs)}</span>
            </div>
          ))}
          {requestDetail.relatedScheduleBatches.length === 0 ? (
            <div className="detail-muted">No related schedule batch was matched.</div>
          ) : null}
        </div>

        <h3>Anomalies</h3>
        {renderAnomalies(selectedRequest.anomalies)}
      </aside>
    );
  }

  if (selectedTask) {
    return (
      <aside className="detail-panel">
        <h2>UC Task Detail</h2>
        <div className="detail-card">
          <strong>
            {selectedTask.category} / {selectedTask.taskId ?? "n/a"}
          </strong>
          <span>worker: {selectedTask.workerId}</span>
          <span>pid: {selectedTask.pid ?? "n/a"}</span>
          <span>bytes: {selectedTask.bytes ?? "n/a"}</span>
          <span>shards: {selectedTask.shards ?? "n/a"}</span>
          <span>cost: {formatDuration(selectedTask.costMs)}</span>
          <span>bandwidth: {formatBandwidth(selectedTask)}</span>
          <span>paired posix: {selectedTask.pairedPosixTaskId ?? "n/a"}</span>
        </div>
        <h3>Phases</h3>
        <div className="detail-list">
          <div className="detail-card">
            <strong>dispatch</strong>
            <span>{formatTimestamp(selectedTask.dispatchAt)}</span>
          </div>
          <div className="detail-card">
            <strong>start</strong>
            <span>{formatTimestamp(selectedTask.startAt)}</span>
          </div>
          <div className="detail-card">
            <strong>finish</strong>
            <span>{formatTimestamp(selectedTask.finishAt)}</span>
          </div>
        </div>
        <h3>Anomalies</h3>
        {renderAnomalies(selectedTask.anomalies)}
      </aside>
    );
  }

  if (selectedEvent) {
    return (
      <aside className="detail-panel">
        <h2>Event Detail</h2>
        <div className="detail-card">
          <strong>{selectedEvent.eventName}</strong>
          <span>time: {formatTimestamp(selectedEvent.timestampMs)}</span>
          <span>worker: {selectedEvent.workerId}</span>
          <span>pid: {selectedEvent.pid ?? "n/a"}</span>
          <span>module: {selectedEvent.module ?? "n/a"}</span>
          <span>file: {selectedEvent.file ? `${selectedEvent.file}:${selectedEvent.line ?? ""}` : "n/a"}</span>
          <span>message: {selectedEvent.rawMessage}</span>
        </div>
        <h3>Extracted Fields</h3>
        <div className="detail-list">
          {Object.entries(selectedEvent.extracted).map(([key, value]) => (
            <div key={key} className="detail-card">
              <strong>{key}</strong>
              <span>{String(value)}</span>
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <h2>Detail Panel</h2>
      <div className="detail-card">
        <strong>Current dataset</strong>
        <span>Requests: {result.requests.length}</span>
        <span>Events: {result.events.length}</span>
        <span>UC tasks: {result.ucTasks.length}</span>
        <span>Anomalies: {result.anomalies.length}</span>
        <span>Unmatched events: {result.unmatchedEvents.length}</span>
      </div>
    </aside>
  );
}
