import type { NormalizedRequest } from "../../types/models";
import { formatDuration, formatTimestamp } from "../../utils/time";

interface RequestListViewProps {
  requests: NormalizedRequest[];
  selectedRequestId?: string;
  onSelectRequest: (requestId: string) => void;
}

export function RequestListView({ requests, selectedRequestId, onSelectRequest }: RequestListViewProps) {
  return (
    <div className="table-panel">
      <h3>请求列表</h3>
      <table className="data-table request-table">
        <thead>
          <tr>
            <th>llmMgrReqId</th>
            <th>EngineReqId</th>
            <th>seqId</th>
            <th>pid</th>
            <th>dp rank</th>
            <th>进入</th>
            <th>prefill complete</th>
            <th>kv release</th>
            <th>结束</th>
            <th>总耗时</th>
            <th>异常</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr
              key={request.id}
              className={
                request.id === selectedRequestId ? "selected-row" : request.anomalies.length ? "anomaly-row" : undefined
              }
              onClick={() => onSelectRequest(request.id)}
            >
              <td>{request.llmMgrReqId ?? request.llmMgrReqIdRaw ?? "n/a"}</td>
              <td>{request.engineReqId ?? "n/a"}</td>
              <td>{request.seqId ?? "n/a"}</td>
              <td>{request.pidSet.join(", ") || "n/a"}</td>
              <td>{request.dpRank ?? "n/a"}</td>
              <td>{formatTimestamp(request.stages.enteredAt)}</td>
              <td>{formatTimestamp(request.stages.prefillCompleteAt)}</td>
              <td>{formatTimestamp(request.stages.kvReleaseAt)}</td>
              <td>{formatTimestamp(request.stages.endedAt ?? request.stages.releaseResponseAt)}</td>
              <td>{formatDuration(request.totalDurationMs)}</td>
              <td>{request.anomalies.length ? request.anomalies.map((anomaly) => anomaly.type).join(", ") : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
