export function parseTimestampToMs(timestampText: string): number | undefined {
  const trimmed = timestampText.trim().replace(",", ".");
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/
  );

  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second, fraction = "0"] = match;
  const millis = Number(`0.${fraction}`) * 1000;

  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0
  ) + millis;
}

export function formatTimestamp(timestampMs?: number): string {
  if (timestampMs === undefined) {
    return "n/a";
  }

  return new Date(timestampMs).toISOString().replace("T", " ").replace("Z", "");
}

export function formatDuration(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }

  if (value >= 1) {
    return `${value.toFixed(2)}ms`;
  }

  return `${value.toFixed(3)}ms`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
