import { duration, longestWait, percent } from "../lib/format";
import type { Alert, KpiSummary, Queue, QueueKpi } from "../types";

export function KpiStrip({
  overall,
  queues,
  byQueue,
  alerts,
  now,
  statsLabel,
}: {
  overall: KpiSummary;
  queues: Queue[];
  byQueue: QueueKpi[];
  alerts: Alert[];
  now: number;
  statsLabel: string;
}) {
  const slAlert = alerts.some((alert) => alert.kind === "service-level");
  const worst = [...byQueue]
    .filter((queue) => queue.serviceLevel != null)
    .sort((a, b) => (a.serviceLevel ?? 0) - (b.serviceLevel ?? 0))[0];
  const wait = longestWait(queues.flatMap((queue) => queue.waiting), now);
  const overallUnder = overall.serviceLevel != null && overall.serviceLevel < 80;
  const slSubtitle =
    worst && slAlert
      ? `${nameOf(queues, worst.queueId)} ${percent(worst.serviceLevel)}`
      : "Queues inside target";

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Key performance indicators">
      <Card
        label="Service level"
        value={percent(overall.serviceLevel)}
        hint={slSubtitle}
        tone={overallUnder ? "danger" : overall.serviceLevel == null ? "muted" : "good"}
        hintTone={slAlert ? "danger" : "muted"}
        detail={statsLabel}
      />
      <Card label="ASA" value={duration(overall.asaSeconds)} hint="Answered calls" detail="Average speed of answer" />
      <Card
        label="Abandon rate"
        value={percent(overall.abandonRate)}
        hint={`${overall.abandoned} abandoned`}
        tone={alerts.some((alert) => alert.kind === "abandon-rate") ? "warn" : "muted"}
        detail={`${overall.offered} offered`}
      />
      <Card label="AHT" value={duration(overall.ahtSeconds)} hint="Talk + wrap-up" detail="Completed wrap-ups" />
      <Card
        label="Offered"
        value={String(overall.offered)}
        hint={`${overall.answered} answered`}
        detail={`${overall.abandoned} abandoned`}
      />
      <Card
        label="Waiting"
        value={String(queues.reduce((sum, queue) => sum + queue.waiting.length, 0))}
        hint={`Longest ${duration(wait)}`}
        tone={alerts.some((alert) => alert.kind === "longest-wait") ? "danger" : "muted"}
        detail="Still in queue"
      />
    </section>
  );
}

function nameOf(queues: Queue[], id: string): string {
  return queues.find((queue) => queue.id === id)?.name ?? id;
}

function Card({
  label,
  value,
  hint,
  detail,
  tone = "muted",
  hintTone = "muted",
}: {
  label: string;
  value: string;
  hint: string;
  detail: string;
  tone?: "good" | "warn" | "danger" | "muted";
  hintTone?: "danger" | "muted";
}) {
  const valueColor =
    tone === "good" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink";
  const hintColor = hintTone === "danger" ? "text-danger" : "text-ink";
  return (
    <article className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-panel">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={`num mt-1 text-3xl font-medium leading-none ${valueColor}`}>{value}</p>
      <p className={`mt-2 text-sm ${hintColor}`}>{hint}</p>
      <p className="text-xs text-muted">{detail}</p>
    </article>
  );
}
