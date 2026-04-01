import {
  Bar,
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
import type { ParsedEvent, ScheduleBatch } from "../../types/models";
import { formatDuration, formatTimestamp } from "../../utils/time";

interface SchedulerViewProps {
  events: ParsedEvent[];
  scheduleBatches: ScheduleBatch[];
  onSelectEvent: (eventId: string) => void;
}

export function SchedulerView({ events, scheduleBatches, onSelectEvent }: SchedulerViewProps) {
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
      const batch = scheduleBatches.find((item) => item.responseEventIds.includes(event.id));
      return {
        id: event.id,
        timeLabel: formatTimestamp(event.timestampMs),
        responseCostMs: Number(event.extracted.responseCostMs ?? event.costMs ?? 0),
        scheduleCostMs: Number(event.extracted.scheduleCostMs ?? 0),
        totalIterCostMs: Number(event.extracted.totalIterCostMs ?? 0),
        overlapCount: batch?.lookupCount ?? 0,
        anomaly: event.anomalyTags.includes("slow_scheduler_response")
      };
    });

  const lookupWindows = scheduleBatches.map((batch) => ({
    id: batch.id,
    timeLabel: formatTimestamp(batch.reporterMs ?? batch.executionEndMs ?? batch.endMs ?? batch.startMs),
    workerCount: batch.workerIds.length,
    requestCount: batch.requestIds.length,
    lookupCount: batch.lookupCount,
    lookupTotalMs: batch.lookupTotalMs,
    schedulingRound: batch.schedulingRound ?? "n/a",
    cacheLoadTotalMs: batch.cacheLoadTotalMs,
    posixLoadTotalMs: batch.posixLoadTotalMs
  }));

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
        <h3>Response cost and batch lookup</h3>
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

      <div className="chart-panel">
        <h3>Lookup totals per schedule batch</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={lookupWindows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" stroke="#94a3b8" minTickGap={32} />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              formatter={(value: number, name: string) => (name.includes("Ms") ? formatDuration(value) : value)}
              contentStyle={{ background: "#101827", border: "1px solid #334155" }}
            />
            <Legend />
            <Bar dataKey="lookupTotalMs" fill="#6366f1" />
            <Line type="monotone" dataKey="lookupCount" stroke="#22c55e" dot />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="table-panel">
        <h3>Scheduler response points</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>time</th>
              <th>response cost</th>
              <th>schedule cost</th>
              <th>total iter cost</th>
              <th>lookup count</th>
            </tr>
          </thead>
          <tbody>
            {responseData.map((row) => (
              <tr key={row.id} className={row.anomaly ? "anomaly-row" : undefined} onClick={() => onSelectEvent(row.id)}>
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

      <div className="table-panel">
        <h3>Schedule batch lookup summary</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>time</th>
              <th>round</th>
              <th>worker count</th>
              <th>request count</th>
              <th>lookup count</th>
              <th>lookup total</th>
              <th>cache load</th>
              <th>posix load</th>
            </tr>
          </thead>
          <tbody>
            {lookupWindows.map((row) => (
              <tr
                key={row.id}
                onClick={() => {
                  const batch = scheduleBatches.find((item) => item.id === row.id);
                  const firstEventId = batch?.responseEventIds[0] ?? batch?.schedulingEventIds[0] ?? batch?.reporterEventId;
                  if (firstEventId) {
                    onSelectEvent(firstEventId);
                  }
                }}
              >
                <td>{row.timeLabel}</td>
                <td>{String(row.schedulingRound)}</td>
                <td>{row.workerCount}</td>
                <td>{row.requestCount}</td>
                <td>{row.lookupCount}</td>
                <td>{formatDuration(row.lookupTotalMs)}</td>
                <td>{formatDuration(row.cacheLoadTotalMs)}</td>
                <td>{formatDuration(row.posixLoadTotalMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
