import type { NormalizedRequest, NormalizedUCTask, ProcessTaskSummary } from "../../types/models";
import { formatDuration } from "../../utils/time";

interface ProcessSummaryViewProps {
  summaries: ProcessTaskSummary[];
  requests: NormalizedRequest[];
  tasks: NormalizedUCTask[];
}

export function ProcessSummaryView({ summaries }: ProcessSummaryViewProps) {
  return (
    <div className="view-grid">
      <div className="table-panel">
        <h3>Worker / Task Summary</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>worker</th>
              <th>category</th>
              <th>count</th>
              <th>sum</th>
              <th>avg</th>
              <th>p50</th>
              <th>p90</th>
              <th>p99</th>
              <th>max</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary) => (
              <tr key={`${summary.workerId}:${summary.category}`}>
                <td>{summary.workerId}</td>
                <td>{summary.category}</td>
                <td>{summary.count}</td>
                <td>{formatDuration(summary.sumMs)}</td>
                <td>{formatDuration(summary.avgMs)}</td>
                <td>{formatDuration(summary.p50Ms)}</td>
                <td>{formatDuration(summary.p90Ms)}</td>
                <td>{formatDuration(summary.p99Ms)}</td>
                <td>{formatDuration(summary.maxMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
