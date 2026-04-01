import { useMemo } from "react";
import { clamp, formatDuration, formatTimestamp } from "../../utils/time";

export interface TimelineItem {
  id: string;
  lane: string;
  label: string;
  start?: number;
  end?: number;
  color: string;
  accentColor?: string;
  meta: Record<string, string | number | boolean | null | undefined>;
  anomaly?: boolean;
}

interface TimelineChartProps {
  title: string;
  items: TimelineItem[];
  zoom: number;
  onItemClick?: (itemId: string) => void;
}

export function TimelineChart({ title, items, zoom, onItemClick }: TimelineChartProps) {
  const lanes = useMemo(() => [...new Set(items.map((item) => item.lane))], [items]);
  const min = Math.min(...items.map((item) => item.start ?? item.end ?? Number.MAX_SAFE_INTEGER));
  const max = Math.max(...items.map((item) => item.end ?? item.start ?? Number.MIN_SAFE_INTEGER));
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : safeMin + 1;
  const width = Math.max(900, 1100 * zoom);
  const laneHeight = 34;
  const padding = { top: 24, left: 180, right: 40, bottom: 30 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = lanes.length * laneHeight;
  const totalHeight = innerHeight + padding.top + padding.bottom;

  const xFor = (value: number) => {
    if (safeMax === safeMin) {
      return padding.left + innerWidth / 2;
    }
    return padding.left + clamp(((value - safeMin) / (safeMax - safeMin)) * innerWidth, 0, innerWidth);
  };

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <strong>{title}</strong>
        <span>当前过滤条件下没有可展示的数据。</span>
      </div>
    );
  }

  return (
    <div className="timeline-shell">
      <div className="timeline-title">{title}</div>
      <div className="timeline-scroll">
        <svg width={width} height={totalHeight} className="timeline-svg">
          {lanes.map((lane, laneIndex) => {
            const y = padding.top + laneIndex * laneHeight;
            return (
              <g key={lane}>
                <text x={16} y={y + 18} className="lane-label">
                  {lane}
                </text>
                <line x1={padding.left} y1={y + 12} x2={width - padding.right} y2={y + 12} className="lane-line" />
              </g>
            );
          })}

          {items.map((item) => {
            const laneIndex = lanes.indexOf(item.lane);
            const y = padding.top + laneIndex * laneHeight;
            const start = item.start ?? item.end ?? safeMin;
            const end = item.end ?? item.start ?? start;
            const x = xFor(start);
            const barWidth = Math.max(4, xFor(end) - x);
            const tooltip = [
              item.label,
              ...Object.entries(item.meta).map(([key, value]) => `${key}: ${value ?? "n/a"}`),
              `start: ${formatTimestamp(item.start)}`,
              `end: ${formatTimestamp(item.end)}`,
              `duration: ${formatDuration(item.end && item.start ? item.end - item.start : undefined)}`
            ].join("\n");

            return (
              <g
                key={item.id}
                onClick={() => onItemClick?.(item.id)}
                className="timeline-item"
                role={onItemClick ? "button" : undefined}
              >
                <title>{tooltip}</title>
                <rect
                  x={x}
                  y={y + 3}
                  width={barWidth}
                  height={18}
                  rx={4}
                  fill={item.color}
                  stroke={item.anomaly ? "#ef4444" : item.accentColor ?? item.color}
                  strokeWidth={item.anomaly ? 2 : 1}
                />
                <text x={x + 6} y={y + 16} className="timeline-item-label">
                  {item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
