import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { NormalizedUCTask, ParsedEvent } from "../../types/models";
import { formatDuration, formatTimestamp } from "../../utils/time";

interface SchedulerViewProps {
  events: ParsedEvent[];
  tasks: NormalizedUCTask[];
  onSelectEvent: (eventId: string) => void;
}

export function SchedulerView({ events, tasks, onSelectEvent }: SchedulerViewProps) {
  const schedulerEvents = events.filter((event) => event.eventType === "scheduler");
  const schedulingData = schedulerEvents
    .filter((event) => event.eventName === "scheduler_scheduling")
    .map((event) => ({
      id: event.id,
      timeLabel: formatTimestamp(event.timestampMs),
      waitingSize: Number(event.extracted.waitingSize ?? 0),
      runningSize: Number(event.extracted.runningSize ?? 0),
      batchSize: Number(event.extracted.batchSize ?? 0),
      transferringSize: Number(event.extracted.transferringSize ?? 0)
    }));

  const responseData = schedulerEvents
    .filter((event) => event.eventName === "scheduler_response")
    .map((event) => {
      const time = event.timestampMs ?? 0;
      const overlapCount = tasks.filter((task) => {
        const start = task.dispatchAt ?? task.startAt ?? task.finishAt;
        const end = task.finishAt ?? task.startAt ?? task.dispatchAt;
        return start !== undefined && end !== undefined && start <= time + 50 && end >= time - 50;
      }).length;

      return {
        id: event.id,
        timeLabel: formatTimestamp(event.timestampMs),
        responseCostMs: Number(event.extracted.responseCostMs ?? event.costMs ?? 0),
        scheduleCostMs: Number(event.extracted.scheduleCostMs ?? 0),
        totalIterCostMs: Number(event.extracted.totalIterCostMs ?? 0),
        overlapCount,
        anomaly: event.anomalyTags.includes("slow_scheduler_response")
      };
    });

  return (
    <div className="view-grid">
      <div className="chart-panel">
        <h3>Scheduler queue size</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={schedulingData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" stroke="#94a3b8" minTickGap={32} />
            <YAxis stroke="#94a3b8" />
            <Tooltip contentStyle={{ background: "#101827", border: "1px solid #334155" }} />
            <Legend />
            <Line type="monotone" dataKey="waitingSize" stroke="#1d4ed8" dot={false} />
            <Line type="monotone" dataKey="runningSize" stroke="#0f766e" dot={false} />
            <Line type="monotone" dataKey="batchSize" stroke="#d97706" dot={false} />
            <Line type="monotone" dataKey="transferringSize" stroke="#7c3aed" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-panel">
        <h3>Response cost / overlap</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart
            data={responseData}
            onClick={(payload) => payload?.activePayload?.[0]?.payload?.id && onSelectEvent(payload.activePayload[0].payload.id)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" stroke="#94a3b8" minTickGap={32} />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              formatter={(value: number, name: string) => (name.includes("Cost") ? formatDuration(value) : value)}
              contentStyle={{ background: "#101827", border: "1px solid #334155" }}
            />
            <Legend />
            <Line type="monotone" dataKey="responseCostMs" stroke="#ef4444" dot />
            <Line type="monotone" dataKey="scheduleCostMs" stroke="#f59e0b" dot={false} />
            <Scatter data={responseData.filter((item) => item.anomaly)} dataKey="overlapCount" fill="#22c55e" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="table-panel">
        <h3>调度异常点</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>time</th>
              <th>response cost</th>
              <th>schedule cost</th>
              <th>total iter cost</th>
              <th>重叠 task 数</th>
            </tr>
          </thead>
          <tbody>
            {responseData.map((row) => (
              <tr
                key={row.id}
                className={row.anomaly ? "anomaly-row" : undefined}
                onClick={() => onSelectEvent(row.id)}
              >
                <td>{row.timeLabel}</td>
                <td>{formatDuration(row.responseCostMs)}</td>
                <td>{formatDuration(row.scheduleCostMs)}</td>
                <td>{formatDuration(row.totalIterCostMs)}</td>
                <td>{row.overlapCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
