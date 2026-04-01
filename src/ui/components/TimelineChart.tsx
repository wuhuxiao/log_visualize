import { useEffect, useMemo, useState, type WheelEvent } from "react";
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
  legendKey?: string;
  legendLabel?: string;
}

interface TimelineChartProps {
  title: string;
  items: TimelineItem[];
  initialZoom?: number;
  onItemClick?: (itemId: string) => void;
}

const MIN_BAR_LABEL_WIDTH = 84;
const MAX_ZOOM = 24;

export function TimelineChart({ title, items, initialZoom = 1, onItemClick }: TimelineChartProps) {
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState(0);

  useEffect(() => {
    setZoom(initialZoom);
  }, [initialZoom]);

  useEffect(() => {
    setPan((current) => clamp(current, 0, 1));
  }, [zoom]);

  const lanes = useMemo(() => [...new Set(items.map((item) => item.lane))], [items]);
  const min = Math.min(...items.map((item) => item.start ?? item.end ?? Number.MAX_SAFE_INTEGER));
  const max = Math.max(...items.map((item) => item.end ?? item.start ?? Number.MIN_SAFE_INTEGER));
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : safeMin + 1;
  const fullSpan = Math.max(1, safeMax - safeMin);
  const visibleSpan = fullSpan / zoom;
  const maxPanSpan = Math.max(0, fullSpan - visibleSpan);
  const visibleMin = safeMin + maxPanSpan * pan;
  const visibleMax = visibleMin + visibleSpan;
  const width = 1200;
  const laneHeight = 34;
  const padding = { top: 24, left: 180, right: 40, bottom: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = lanes.length * laneHeight;
  const totalHeight = innerHeight + padding.top + padding.bottom;

  const legendItems = useMemo(() => {
    const grouped = new Map<string, { label: string; color: string; count: number }>();
    items.forEach((item) => {
      const key = item.legendKey ?? item.label;
      const current = grouped.get(key) ?? {
        label: item.legendLabel ?? item.legendKey ?? item.label,
        color: item.color,
        count: 0
      };
      current.count += 1;
      grouped.set(key, current);
    });
    return [...grouped.entries()].map(([key, value]) => ({ key, ...value }));
  }, [items]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        const start = item.start ?? item.end ?? safeMin;
        const end = item.end ?? item.start ?? start;
        return end >= visibleMin && start <= visibleMax;
      }),
    [items, safeMin, visibleMin, visibleMax]
  );

  const xFor = (value: number) => {
    if (visibleMax === visibleMin) {
      return padding.left + innerWidth / 2;
    }
    return padding.left + clamp(((value - visibleMin) / (visibleMax - visibleMin)) * innerWidth, 0, innerWidth);
  };

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (items.length === 0) {
      return;
    }

    event.preventDefault();
    if (event.shiftKey) {
      const nextPan = pan + event.deltaY / 1200;
      setPan(clamp(nextPan, 0, 1));
      return;
    }

    const nextZoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 1, MAX_ZOOM);
    setZoom(nextZoom);
  }

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
      <div className="timeline-header">
        <div className="timeline-title">{title}</div>
        <div className="timeline-controls">
          <button type="button" onClick={() => setZoom((current) => clamp(current / 1.5, 1, MAX_ZOOM))}>
            缩小
          </button>
          <button type="button" onClick={() => setZoom((current) => clamp(current * 1.5, 1, MAX_ZOOM))}>
            放大
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan(0);
            }}
          >
            重置
          </button>
        </div>
      </div>

      <div className="timeline-meta">
        <span>窗口: {formatTimestamp(visibleMin)} ~ {formatTimestamp(visibleMax)}</span>
        <span>缩放: {zoom.toFixed(2)}x</span>
        <span>提示: 滚轮缩放，`Shift + 滚轮` 平移</span>
      </div>

      <div className="timeline-legend">
        {legendItems.map((legend) => (
          <div key={legend.key} className="timeline-legend-item">
            <span className="timeline-legend-swatch" style={{ background: legend.color }} />
            <span>{legend.label}</span>
            <span className="timeline-legend-count">{legend.count}</span>
          </div>
        ))}
      </div>

      <div className="timeline-pan-row">
        <label>
          时间轴滑动
          <input
            type="range"
            min="0"
            max="1000"
            step="1"
            value={Math.round(pan * 1000)}
            onChange={(event) => setPan(Number(event.target.value) / 1000)}
            disabled={zoom <= 1.001}
          />
        </label>
      </div>

      <div className="timeline-scroll" onWheel={handleWheel}>
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

          {visibleItems.map((item) => {
            const laneIndex = lanes.indexOf(item.lane);
            const y = padding.top + laneIndex * laneHeight;
            const start = item.start ?? item.end ?? safeMin;
            const end = item.end ?? item.start ?? start;
            const x = xFor(start);
            const unclampedWidth = xFor(end) - x;
            const barWidth = Math.max(4, unclampedWidth || 0);
            const showInlineLabel = barWidth >= MIN_BAR_LABEL_WIDTH;
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
                {showInlineLabel ? (
                  <text x={x + 6} y={y + 16} className="timeline-item-label">
                    {item.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
