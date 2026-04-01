import { useEffect, useMemo, useRef, useState } from "react";
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
  selected?: boolean;
  legendKey?: string;
  legendLabel?: string;
  forceLabel?: boolean;
  forceLabelSide?: "left" | "right";
}

interface TimelineChartProps {
  title: string;
  items: TimelineItem[];
  initialZoom?: number;
  keyboardPanStepMs?: number;
  onItemClick?: (itemId: string) => void;
}

const MIN_BAR_LABEL_WIDTH = 84;
const MAX_ZOOM = 64;
const LANE_HEIGHT = 34;
const OVERSCAN_LANES = 10;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const DEFAULT_KEYBOARD_PAN_STEP_MS = 1_000;
const KEYBOARD_PAN_LARGE_STEP_MULTIPLIER = 5;

function getItemRange(items: TimelineItem[]) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const start = item.start ?? item.end;
    const end = item.end ?? item.start;
    if (start !== undefined && start < min) {
      min = start;
    }
    if (end !== undefined && end > max) {
      max = end;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  return { min, max: max <= min ? min + 1 : max };
}

export function TimelineChart({
  title,
  items,
  initialZoom = 1,
  keyboardPanStepMs = DEFAULT_KEYBOARD_PAN_STEP_MS,
  onItemClick
}: TimelineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const [scrollTop, setScrollTop] = useState(0);
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState(0);

  useEffect(() => {
    setZoom(initialZoom);
  }, [initialZoom]);

  useEffect(() => {
    const node = containerRef.current;
    const viewport = viewportRef.current;
    if (!node || !viewport) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setContainerWidth(node.getBoundingClientRect().width);
      setViewportHeight(viewport.getBoundingClientRect().height || DEFAULT_VIEWPORT_HEIGHT);
    });

    observer.observe(node);
    observer.observe(viewport);
    setContainerWidth(node.getBoundingClientRect().width);
    setViewportHeight(viewport.getBoundingClientRect().height || DEFAULT_VIEWPORT_HEIGHT);

    return () => observer.disconnect();
  }, []);

  const lanes = useMemo(() => [...new Set(items.map((item) => item.lane))], [items]);
  const laneIndexMap = useMemo(() => new Map(lanes.map((lane, index) => [lane, index])), [lanes]);
  const { min: safeMin, max: safeMax } = useMemo(() => getItemRange(items), [items]);
  const fullSpan = Math.max(1, safeMax - safeMin);
  const visibleSpan = fullSpan / zoom;
  const maxPanSpan = Math.max(0, fullSpan - visibleSpan);
  const visibleMin = safeMin + maxPanSpan * pan;
  const visibleMax = visibleMin + visibleSpan;
  const width = Math.floor(containerWidth || 720);
  const padding = { top: 24, left: 180, right: 24, bottom: 20 };
  const innerWidth = Math.max(200, width - padding.left - padding.right);
  const totalContentHeight = lanes.length * LANE_HEIGHT;
  const totalHeight = totalContentHeight + padding.top + padding.bottom;

  useEffect(() => {
    setPan((current) => clamp(current, 0, 1));
  }, [zoom]);

  const legendItems = useMemo(() => {
    const grouped = new Map<string, { label: string; color: string; count: number }>();
    for (const item of items) {
      const key = item.legendKey ?? item.label;
      const current = grouped.get(key) ?? {
        label: item.legendLabel ?? item.legendKey ?? item.label,
        color: item.color,
        count: 0
      };
      current.count += 1;
      grouped.set(key, current);
    }
    return [...grouped.entries()].map(([key, value]) => ({ key, ...value }));
  }, [items]);

  const startLaneIndex = Math.max(0, Math.floor(scrollTop / LANE_HEIGHT) - OVERSCAN_LANES);
  const endLaneIndex = Math.min(
    lanes.length - 1,
    Math.ceil((scrollTop + viewportHeight) / LANE_HEIGHT) + OVERSCAN_LANES
  );

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        const laneIndex = laneIndexMap.get(item.lane);
        if (laneIndex === undefined || laneIndex < startLaneIndex || laneIndex > endLaneIndex) {
          return false;
        }

        const start = item.start ?? item.end ?? safeMin;
        const end = item.end ?? item.start ?? start;
        return end >= visibleMin && start <= visibleMax;
      }),
    [items, laneIndexMap, startLaneIndex, endLaneIndex, safeMin, visibleMin, visibleMax]
  );

  const visibleLanes = lanes.slice(startLaneIndex, endLaneIndex + 1);

  const xFor = (value: number) => {
    if (visibleMax === visibleMin) {
      return padding.left + innerWidth / 2;
    }
    return padding.left + clamp(((value - visibleMin) / (visibleMax - visibleMin)) * innerWidth, 0, innerWidth);
  };

  const handleKeyboardPan = (direction: "left" | "right", largeStep = false) => {
    if (zoom <= 1.001 || maxPanSpan <= 0) {
      return;
    }
    const stepMs = Math.max(1, keyboardPanStepMs) * (largeStep ? KEYBOARD_PAN_LARGE_STEP_MULTIPLIER : 1);
    const stepPan = stepMs / maxPanSpan;
    const delta = direction === "left" ? -stepPan : stepPan;
    setPan((current) => clamp(current + delta, 0, 1));
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
    <div
      ref={containerRef}
      className="timeline-shell"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          handleKeyboardPan("left", event.shiftKey);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          handleKeyboardPan("right", event.shiftKey);
        }
      }}
    >
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
        <span>
          窗口: {formatTimestamp(visibleMin)} ~ {formatTimestamp(visibleMax)}
        </span>
        <span>缩放: {zoom.toFixed(2)}x</span>
        <span>显示 lane: {Math.max(0, endLaneIndex - startLaneIndex + 1)} / {lanes.length}</span>
        <span>
          ← / → 平移 {Math.max(1, keyboardPanStepMs) / 1000}s，Shift + ← / → 平移{" "}
          {(Math.max(1, keyboardPanStepMs) * KEYBOARD_PAN_LARGE_STEP_MULTIPLIER) / 1000}s
        </span>
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

      <div
        ref={viewportRef}
        className="timeline-scroll"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <svg width={width} height={totalHeight} className="timeline-svg">
          {visibleLanes.map((lane) => {
            const laneIndex = laneIndexMap.get(lane) ?? 0;
            const y = padding.top + laneIndex * LANE_HEIGHT;
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
            const laneIndex = laneIndexMap.get(item.lane);
            if (laneIndex === undefined) {
              return null;
            }

            const y = padding.top + laneIndex * LANE_HEIGHT;
            const start = item.start ?? item.end ?? safeMin;
            const end = item.end ?? item.start ?? start;
            const x = xFor(start);
            const barWidth = Math.max(4, xFor(end) - x || 0);
            const showInlineLabel = barWidth >= MIN_BAR_LABEL_WIDTH;
            const showOutsideLabel = item.forceLabel && !showInlineLabel;
            const tooltip = [
              item.label,
              ...Object.entries(item.meta).map(([key, value]) => `${key}: ${value ?? "n/a"}`),
              `start: ${formatTimestamp(item.start)}`,
              `end: ${formatTimestamp(item.end)}`,
              `duration: ${formatDuration(item.end && item.start ? item.end - item.start : undefined)}`
            ].join("\n");
            const strokeWidth = item.selected ? 3 : item.anomaly ? 2 : 1;
            const strokeColor = item.selected ? "#f8fafc" : item.anomaly ? "#ef4444" : item.accentColor ?? item.color;

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
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                />
                {showInlineLabel ? (
                  <text x={x + 6} y={y + 16} className="timeline-item-label">
                    {item.label}
                  </text>
                ) : null}
                {showOutsideLabel ? (
                  <text
                    x={
                      item.forceLabelSide === "left"
                        ? Math.max(padding.left + 4, x - 6)
                        : Math.min(width - padding.right - 4, x + barWidth + 6)
                    }
                    y={y + 16}
                    textAnchor={item.forceLabelSide === "left" ? "end" : "start"}
                    className="timeline-item-label"
                  >
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
