import { formatClock, formatDay } from "../lib/format";
import type { Theme } from "../lib/theme";
import type { ConnectionStatus } from "../types";

export function TopBar({
  status,
  source,
  timezone,
  statsDate,
  now,
  theme,
  onToggleTheme,
}: {
  status: ConnectionStatus;
  source: "simulated" | "ami" | null;
  timezone: string;
  statsDate: string | null;
  now: number;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const live = status === "live";
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-[0.16em]">CALLBOARD</h1>
          <span className="text-sm text-muted">Wallboard</span>
        </div>
        <p className="mt-0.5 text-sm text-muted">Asterisk · FreePBX · Vicidial</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm">
          <span className={live ? "live-dot" : "h-2 w-2 rounded-full bg-warn"} />
          {status === "live" ? "Live" : status === "reconnecting" ? "Reconnecting" : "Connecting"}
        </span>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted">
          {source === "ami" ? "Asterisk AMI" : source === "simulated" ? "Simulated" : "…"}
        </span>
        <span className="num rounded-full border border-line bg-surface px-3 py-1 text-sm">
          {statsDate ? formatDay(statsDate, timezone) : "—"}
          <span className="mx-2 text-muted">·</span>
          {formatClock(now, timezone)}
        </span>
        <button
          type="button"
          onClick={onToggleTheme}
          className="rounded-full border border-line bg-surface px-3 py-1 text-sm"
          aria-pressed={theme === "dark"}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </header>
  );
}
