import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { buildRequestPhaseSummaries, buildWorkerBandwidthSummaries } from "../../aggregations/derivedMetrics";
import type { NormalizedRequest, NormalizedUCTask, ProcessTaskSummary } from "../../types/models";
import { formatDuration } from "../../utils/time";

const categoryColors: Record<string, string> = {
  Load: "#1d4ed8",
  Dump: "#0f766e",
  Lookup: "#6366f1",
  Backend2Cache: "#d97706",
  Cache2Backend: "#b45309"
};

function formatBandwidth(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)} MB/s`;
}

interface ProcessSummaryViewProps {
  summaries: ProcessTaskSummary[];
  requests: NormalizedRequest[];
  tasks: NormalizedUCTask[];
}

export function ProcessSummaryView({ summaries, requests, tasks }: ProcessSummaryViewProps) {
  const phaseSummaries = buildRequestPhaseSummaries(requests);
  const bandwidthSummaries = buildWorkerBandwidthSummaries(tasks);

  return (
    <div className="view-grid">
      <div className="chart-panel">
        <h3>平均耗时分布</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={summaries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="workerId" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              formatter={(value: number) => formatDuration(value)}
              contentStyle={{ background: "#101827", border: "1px solid #334155" }}
            />
            <Bar dataKey="avgMs">
              {summaries.map((summary) => (
                <Cell key={`${summary.workerId}:${summary.category}`} fill={categoryColors[summary.category]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-panel">
        <h3>请求阶段耗时汇总</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={phaseSummaries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="phase" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              formatter={(value: number) => formatDuration(value)}
              contentStyle={{ background: "#101827", border: "1px solid #334155" }}
            />
            <Bar dataKey="avgMs" fill="#38bdf8" />
            <Bar dataKey="p90Ms" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-panel">
        <h3>各进程 Load / Dump 带宽</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={bandwidthSummaries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="workerId" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              formatter={(value: number) => formatBandwidth(value)}
              contentStyle={{ background: "#101827", border: "1px solid #334155" }}
            />
            <Bar dataKey="avgMBps">
              {bandwidthSummaries.map((summary) => (
                <Cell
                  key={`${summary.workerId}:${summary.category}`}
                  fill={summary.category === "Load" ? "#2563eb" : "#0f766e"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="table-panel">
        <h3>按 worker / task type 汇总</h3>
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

      <div className="table-panel">
        <h3>Load / Dump 带宽统计</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>worker</th>
              <th>category</th>
              <th>count</th>
              <th>avg</th>
              <th>p50</th>
              <th>p90</th>
              <th>max</th>
            </tr>
          </thead>
          <tbody>
            {bandwidthSummaries.map((summary) => (
              <tr key={`${summary.workerId}:${summary.category}`}>
                <td>{summary.workerId}</td>
                <td>{summary.category}</td>
                <td>{summary.count}</td>
                <td>{formatBandwidth(summary.avgMBps)}</td>
                <td>{formatBandwidth(summary.p50MBps)}</td>
                <td>{formatBandwidth(summary.p90MBps)}</td>
                <td>{formatBandwidth(summary.maxMBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
