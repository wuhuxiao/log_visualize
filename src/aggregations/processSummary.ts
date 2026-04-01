import type { NormalizedUCTask, ProcessTaskSummary } from "../types/models";
import { average, quantile, sum } from "../utils/stats";

export function buildProcessSummaries(tasks: NormalizedUCTask[]): ProcessTaskSummary[] {
  const grouped = new Map<string, { workerId: string; pid?: number; category: ProcessTaskSummary["category"]; costs: number[] }>();

  tasks.forEach((task) => {
    if (task.costMs === undefined) {
      return;
    }

    const key = `${task.workerId}:${task.category}`;
    const existing = grouped.get(key) ?? {
      workerId: task.workerId,
      pid: task.pid,
      category: task.category,
      costs: []
    };
    existing.costs.push(task.costMs);
    grouped.set(key, existing);
  });

  return [...grouped.values()]
    .map<ProcessTaskSummary>((entry) => ({
      workerId: entry.workerId,
      pid: entry.pid,
      category: entry.category,
      count: entry.costs.length,
      sumMs: sum(entry.costs),
      avgMs: average(entry.costs),
      p50Ms: quantile(entry.costs, 0.5),
      p90Ms: quantile(entry.costs, 0.9),
      p99Ms: quantile(entry.costs, 0.99),
      maxMs: Math.max(...entry.costs)
    }))
    .sort((left, right) => left.workerId.localeCompare(right.workerId) || left.category.localeCompare(right.category));
}
