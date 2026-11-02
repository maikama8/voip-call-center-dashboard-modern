import { duration, formatNumber, longestWait, percent } from "../lib/format";
import type { Agent, Queue, QueueKpi } from "../types";

export function QueueBoard({
  queues,
  kpis,
  agents,
  now,
  maxWaitSeconds,
  selectedId,
  onSelect,
}: {
  queues: Queue[];
  kpis: QueueKpi[];
  agents: Agent[];
  now: number;
  maxWaitSeconds: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="Queues">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Queues</h2>
        <p className="text-xs text-muted">Select a queue to filter the floor</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {queues.map((queue) => {
          const kpi = kpis.find((item) => item.queueId === queue.id);
          const wait = longestWait(queue.waiting, now);
          const under =
            kpi?.serviceLevel != null && kpi.serviceLevel + 1e-9 < queue.slaTargetPercent;
          const ready = agents.filter(
            (agent) => agent.queues.includes(queue.id) && agent.status === "available",
          ).length;
          const selected = selectedId === queue.id;
          return (
            <button
              key={queue.id}
              type="button"
              onClick={() => onSelect(queue.id)}
              aria-pressed={selected}
              className={`min-w-0 rounded-2xl border bg-surface p-4 text-left shadow-panel ${
                selected ? "border-accent" : "border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{queue.name}</h3>
                  <p className="text-xs text-muted">
                    <span className="num">{queue.extension}</span>
                    <span className="mx-1.5">·</span>
                    {queue.strategy}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`num text-2xl leading-none ${queue.waiting.length > 0 ? "text-warn" : "text-ink"}`}>
                    {queue.waiting.length}
                  </p>
                  <p className="text-xs text-muted">waiting</p>
                </div>
              </div>
              <p className={`num mt-3 text-sm ${wait >= maxWaitSeconds ? "text-danger" : "text-ink"}`}>
                Longest {duration(wait)}
                <span className="ml-2 font-sans text-muted">{ready} ready</span>
              </p>
              <ul className="mt-3 space-y-1.5">
                {queue.waiting.length === 0 && <li className="text-sm text-muted">No callers in queue</li>}
                {queue.waiting.slice(0, 3).map((caller) => {
                  const age = Math.max(0, (now - Date.parse(caller.joinedAt)) / 1000);
                  return (
                    <li key={caller.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">
                        <span className="num text-muted">{caller.position}</span> {caller.callerName}
                        <span className="num ml-2 text-xs text-muted">{formatNumber(caller.callerNumber)}</span>
                      </span>
                      <span className={`num ${age >= maxWaitSeconds ? "text-danger" : ""}`}>{duration(age)}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4">
                <div className="flex items-baseline justify-between text-sm">
                  <span className={under ? "text-danger" : "text-accent"}>
                    SL {percent(kpi?.serviceLevel ?? null)}
                  </span>
                  <span className="text-xs text-muted">
                    target {queue.slaTargetPercent}% / {queue.slaThresholdSeconds}s
                  </span>
                </div>
                <SlaBar value={kpi?.serviceLevel ?? null} target={queue.slaTargetPercent} under={under} />
                <p className="mt-2 text-xs text-muted">
                  Abandon {percent(kpi?.abandonRate ?? null)} · ASA {duration(kpi?.asaSeconds ?? null)}
                </p>
                {queue.pbx && (
                  <p className="mt-1 text-xs text-muted">
                    PBX SL {percent(queue.pbx.serviceLevelPerf)} · {queue.pbx.completed} completed since reload
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SlaBar({ value, target, under }: { value: number | null; target: number; under: boolean }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-surface-2" aria-hidden="true">
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${width}%`, background: under ? "var(--danger)" : "var(--accent)" }}
      />
      <div className="absolute -top-1 h-3.5 w-px bg-ink/50" style={{ left: `${target}%` }} />
    </div>
  );
}
