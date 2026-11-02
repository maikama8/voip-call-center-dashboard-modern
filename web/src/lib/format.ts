export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${m}:${ss}`;
}

export function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatNumber(raw: string): string {
  if (/^0\d{10}$/.test(raw)) return `${raw.slice(0, 4)} ${raw.slice(4, 7)} ${raw.slice(7)}`;
  return raw || "—";
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? first;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

export function formatClock(now: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(now));
}

export function formatDay(isoDate: string, timeZone: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(utcGuess);
}

export function elapsed(from: string | null, now: number): number | null {
  if (!from) return null;
  const start = Date.parse(from);
  if (!Number.isFinite(start)) return null;
  return Math.max(0, (now - start) / 1000);
}

export function longestWait(waiting: { joinedAt: string }[], now: number): number {
  let max = 0;
  for (const caller of waiting) {
    const seconds = elapsed(caller.joinedAt, now);
    if (seconds != null && seconds > max) max = seconds;
  }
  return max;
}

export const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  "on-call": "On call",
  paused: "Paused",
  "wrap-up": "Wrap-up",
  offline: "Offline",
  queued: "Queued",
  talking: "Talking",
};
