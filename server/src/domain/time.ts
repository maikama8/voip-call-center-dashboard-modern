export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

export function statsDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Build a UTC instant whose wall clock in `timeZone` matches the parts.
 * One correction covers whole-hour offsets. A DST fold can be off by the
 * gap; the hourly chart does not need better than that.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const shown = zonedParts(guess, timeZone);
  const shownUtc = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    shown.second,
  );
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(guess.getTime() + (wanted - shownUtc));
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(rem)}`;
  return `${m}:${pad(rem)}`;
}

export function secondsBetween(laterIso: string, earlierIso: string): number {
  const delta = Date.parse(laterIso) - Date.parse(earlierIso);
  if (!Number.isFinite(delta)) return 0;
  return Math.max(0, Math.round(delta / 1000));
}

export function assertTimeZone(timeZone: string): void {
  Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
}
