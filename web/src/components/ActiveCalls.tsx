import { duration, elapsed, formatNumber, STATUS_LABEL } from "../lib/format";
import type { ActiveCall, Agent, Queue } from "../types";

export function ActiveCalls({
  calls,
  agents,
  queues,
  now,
  queueId,
}: {
  calls: ActiveCall[];
  agents: Agent[];
  queues: Queue[];
  now: number;
  queueId: string | null;
}) {
  const rows = calls
    .filter((call) => !queueId || call.queueId === queueId)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || age(b, now) - age(a, now));
  return (
    <section aria-label="Active calls" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-panel">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Active calls</h2>
        <p className="num text-sm text-muted">{rows.length}</p>
      </div>
      <div className="mt-2 max-h-[440px] overflow-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-surface text-xs uppercase tracking-[0.08em] text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Caller</th>
              <th scope="col" className="px-3 py-2 font-medium">Queue</th>
              <th scope="col" className="px-3 py-2 font-medium">Agent</th>
              <th scope="col" className="px-3 py-2 font-medium">State</th>
              <th scope="col" className="px-3 py-2 font-medium">Wait</th>
              <th scope="col" className="px-4 py-2 font-medium">Talk</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No calls in progress.
                </td>
              </tr>
            )}
            {rows.map((call) => {
              const queue = queues.find((item) => item.id === call.queueId);
              const agent = agents.find((item) => item.id === call.agentId);
              const wait = call.answeredAt
                ? elapsed(call.queueJoinedAt, Date.parse(call.answeredAt))
                : elapsed(call.queueJoinedAt, now);
              const talk =
                call.state === "wrap-up"
                  ? call.talkSeconds
                  : call.state === "talking"
                    ? elapsed(call.answeredAt, now)
                    : null;
              return (
                <tr key={call.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <div>{call.callerName}</div>
                    <div className="num text-xs text-muted">{formatNumber(call.callerNumber)}</div>
                  </td>
                  <td className="px-3 py-2.5">{queue?.name ?? call.queueId}</td>
                  <td className="px-3 py-2.5">{agent ? agent.name : "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`pill ${call.state === "queued" ? "st-paused" : call.state === "talking" ? "st-on-call" : "st-wrap-up"}`}>
                      <i />
                      {STATUS_LABEL[call.state] ?? call.state}
                    </span>
                  </td>
                  <td className="num px-3 py-2.5">{duration(wait)}</td>
                  <td className="num px-4 py-2.5">{duration(talk)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function rank(call: ActiveCall): number {
  if (call.state === "queued") return 0;
  if (call.state === "talking") return 1;
  return 2;
}

function age(call: ActiveCall, now: number): number {
  return elapsed(call.queueJoinedAt ?? call.startedAt, now) ?? 0;
}
