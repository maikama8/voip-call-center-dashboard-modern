import type { HourBucket } from "../types";

export function HourlyChart({
  buckets,
  statsDate,
  timezone,
  now,
}: {
  buckets: HourBucket[];
  statsDate: string;
  timezone: string;
  now: number;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.offered));
  const peak = buckets.reduce((best, bucket) => (bucket.offered > best.offered ? bucket : best), buckets[0]);
  let currentHour = 0;
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(now));
    currentHour = Number(hour);
  } catch {
    currentHour = new Date(now).getUTCHours();
  }
  const width = 640;
  const height = 180;
  const padL = 28;
  const padB = 22;
  const padT = 8;
  const innerW = width - padL - 8;
  const innerH = height - padB - padT;
  const gap = 3;
  const barW = (innerW - gap * buckets.length) / buckets.length;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-panel" aria-label="Calls per hour">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Calls per hour</h2>
        <p className="text-xs text-muted">
          {statsDate} · {timezone}
        </p>
      </div>
      <div className="mt-1 flex gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm" style={{ background: "var(--accent)" }} /> Answered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm" style={{ background: "var(--danger)" }} /> Abandoned
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-2 w-full"
        role="img"
        aria-label={
          peak && peak.offered > 0
            ? `Calls per hour. Busiest hour is ${peak.hour}:00 with ${peak.offered} calls, ${peak.answered} answered and ${peak.abandoned} abandoned.`
            : "Calls per hour. No calls yet."
        }
      >
        {[0, 0.5, 1].map((mark) => {
          const y = padT + innerH - mark * innerH;
          const label = Math.round(max * mark);
          return (
            <g key={mark}>
              <line x1={padL} x2={width - 8} y1={y} y2={y} stroke="var(--line)" />
              <text x={0} y={y + 3} fill="var(--muted)" fontSize="10" fontFamily="IBM Plex Mono, monospace">
                {label}
              </text>
            </g>
          );
        })}
        {buckets.map((bucket, index) => {
          const x = padL + index * (barW + gap);
          const answeredH = (bucket.answered / max) * innerH;
          const abandonedH = (bucket.abandoned / max) * innerH;
          const base = padT + innerH;
          const current = bucket.hour === currentHour;
          return (
            <g key={bucket.hour}>
              <rect
                x={x}
                y={base - answeredH - abandonedH}
                width={barW}
                height={abandonedH}
                fill="var(--danger)"
                rx="1"
              />
              <rect x={x} y={base - answeredH} width={barW} height={answeredH} fill="var(--accent)" rx="1" />
              {bucket.hour % 2 === 0 && (
                <text
                  x={x + barW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fill={current ? "var(--ink)" : "var(--muted)"}
                  fontSize="10"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {String(bucket.hour).padStart(2, "0")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
