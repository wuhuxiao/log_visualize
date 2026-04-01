import type { AnomalyRecord, NormalizedRequest, NormalizedUCTask } from "../../types/models";
import { formatDuration } from "../../utils/time";

interface OverviewCardsProps {
  requests: NormalizedRequest[];
  tasks: NormalizedUCTask[];
  anomalies: AnomalyRecord[];
}

export function OverviewCards({ requests, tasks, anomalies }: OverviewCardsProps) {
  const cacheTaskCosts = tasks.filter((task) => task.ucKind === "cache" && task.costMs !== undefined).map((task) => task.costMs!);
  const posixTaskCosts = tasks.filter((task) => task.ucKind === "posix" && task.costMs !== undefined).map((task) => task.costMs!);
  const slowestResponse = anomalies
    .filter((anomaly) => anomaly.type === "slow_scheduler_response")
    .map((anomaly) => Number(anomaly.metrics?.responseCostMs ?? 0));

  const cards = [
    { label: "总请求数", value: requests.length.toString() },
    { label: "异常请求数", value: requests.filter((request) => request.anomalies.length > 0).length.toString() },
    { label: "总 worker 数", value: new Set(tasks.map((task) => task.workerId)).size.toString() },
    {
      label: "Cache task 平均耗时",
      value: formatDuration(cacheTaskCosts.length ? cacheTaskCosts.reduce((sum, value) => sum + value, 0) / cacheTaskCosts.length : undefined)
    },
    {
      label: "Posix task 平均耗时",
      value: formatDuration(posixTaskCosts.length ? posixTaskCosts.reduce((sum, value) => sum + value, 0) / posixTaskCosts.length : undefined)
    },
    {
      label: "最慢 response cost",
      value: formatDuration(slowestResponse.length ? Math.max(...slowestResponse) : undefined)
    }
  ];

  return (
    <div className="overview-grid">
      {cards.map((card) => (
        <div key={card.label} className="overview-card">
          <div className="overview-label">{card.label}</div>
          <div className="overview-value">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
