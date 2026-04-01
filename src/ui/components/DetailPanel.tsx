import type { AnalysisResult, AnomalyRecord, NormalizedRequest, NormalizedUCTask, ParsedEvent } from "../../types/models";
import { formatDuration, formatTimestamp } from "../../utils/time";

interface DetailPanelProps {
  result: AnalysisResult;
  selectedRequest?: NormalizedRequest;
  selectedTask?: NormalizedUCTask;
  selectedEvent?: ParsedEvent;
}

function renderAnomalies(anomalies: AnomalyRecord[]) {
  if (anomalies.length === 0) {
    return <div className="detail-muted">无异常。</div>;
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

export function DetailPanel({ result, selectedRequest, selectedTask, selectedEvent }: DetailPanelProps) {
  if (selectedRequest) {
    const relatedTasks = result.ucTasks.filter((task) =>
      task.relatedRequestIds.some(({ requestId }) => requestId === selectedRequest.id)
    );
    return (
      <aside className="detail-panel">
        <h2>请求详情</h2>
        <div className="detail-card">
          <strong>{selectedRequest.llmMgrReqId ?? selectedRequest.engineReqId ?? selectedRequest.id}</strong>
          <span>EngineReqId: {selectedRequest.engineReqId ?? "n/a"}</span>
          <span>seqId: {selectedRequest.seqId ?? "n/a"}</span>
          <span>pid: {selectedRequest.pidSet.join(", ") || "n/a"}</span>
          <span>dp rank: {selectedRequest.dpRank ?? "n/a"}</span>
          <span>总耗时: {formatDuration(selectedRequest.totalDurationMs)}</span>
          <span>状态: {selectedRequest.status}</span>
        </div>
        <h3>关键阶段</h3>
        <div className="detail-list">
          {Object.entries(selectedRequest.stages).map(([key, value]) => (
            <div key={key} className="detail-card">
              <strong>{key}</strong>
              <span>{formatTimestamp(value)}</span>
            </div>
          ))}
        </div>
        <h3>相关 UC task</h3>
        <div className="detail-list">
          {relatedTasks.map((task) => (
            <div key={task.id} className="detail-card">
              <strong>
                {task.category} / {task.taskId ?? "n/a"}
              </strong>
              <span>{task.workerId}</span>
              <span>耗时: {formatDuration(task.costMs)}</span>
            </div>
          ))}
        </div>
        <h3>异常</h3>
        {renderAnomalies(selectedRequest.anomalies)}
      </aside>
    );
  }

  if (selectedTask) {
    return (
      <aside className="detail-panel">
        <h2>UC task 详情</h2>
        <div className="detail-card">
          <strong>
            {selectedTask.category} / {selectedTask.taskId ?? "n/a"}
          </strong>
          <span>worker: {selectedTask.workerId}</span>
          <span>pid: {selectedTask.pid ?? "n/a"}</span>
          <span>bytes: {selectedTask.bytes ?? "n/a"}</span>
          <span>shards: {selectedTask.shards ?? "n/a"}</span>
          <span>cost: {formatDuration(selectedTask.costMs)}</span>
          <span>paired posix: {selectedTask.pairedPosixTaskId ?? "n/a"}</span>
        </div>
        <h3>阶段</h3>
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
        <h3>异常</h3>
        {renderAnomalies(selectedTask.anomalies)}
      </aside>
    );
  }

  if (selectedEvent) {
    return (
      <aside className="detail-panel">
        <h2>事件详情</h2>
        <div className="detail-card">
          <strong>{selectedEvent.eventName}</strong>
          <span>time: {formatTimestamp(selectedEvent.timestampMs)}</span>
          <span>worker: {selectedEvent.workerId}</span>
          <span>pid: {selectedEvent.pid ?? "n/a"}</span>
          <span>module: {selectedEvent.module ?? "n/a"}</span>
          <span>file: {selectedEvent.file ? `${selectedEvent.file}:${selectedEvent.line ?? ""}` : "n/a"}</span>
          <span>message: {selectedEvent.rawMessage}</span>
        </div>
        <h3>提取字段</h3>
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
      <h2>详情面板</h2>
      <div className="detail-card">
        <strong>当前数据</strong>
        <span>请求数: {result.requests.length}</span>
        <span>事件数: {result.events.length}</span>
        <span>UC task 数: {result.ucTasks.length}</span>
        <span>异常数: {result.anomalies.length}</span>
        <span>未匹配事件: {result.unmatchedEvents.length}</span>
      </div>
    </aside>
  );
}
