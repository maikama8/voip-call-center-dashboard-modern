import { duration, elapsed, formatNumber, initials, STATUS_LABEL } from "../lib/format";
import type { ActiveCall, Agent, AgentStatus, Queue } from "../types";

const FILTERS: Array<AgentStatus | "all"> = ["all", "available", "on-call", "paused", "wrap-up"];

export function AgentBoard({
  agents,
  calls,
  queues,
  now,
  statsLabel,
  filter,
  onFilter,
  queueId,
}: {
  agents: Agent[];
  calls: ActiveCall[];
  queues: Queue[];
  now: number;
  statsLabel: string;
  filter: AgentStatus | "all";
  onFilter: (filter: AgentStatus | "all") => void;
  queueId: string | null;
}) {
  const visible = agents.filter((agent) => {
    if (queueId && !agent.queues.includes(queueId)) return false;
    if (filter !== "all" && agent.status !== filter) return false;
    return true;
  });
  return (
    <section aria-label="Agents">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Agents</h2>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const count =
              item === "all"
                ? agents.filter((agent) => !queueId || agent.queues.includes(queueId)).length
                : agents.filter(
                    (agent) => agent.status === item && (!queueId || agent.queues.includes(queueId)),
                  ).length;
            const pressed = filter === item;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={pressed}
                onClick={() => onFilter(item)}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  pressed ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-muted"
                }`}
              >
                {item === "all" ? "All" : STATUS_LABEL[item]} <span className="num">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No agents in this view.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((agent) => {
            const call = calls.find((item) => item.id === agent.callId) ?? null;
            return (
              <AgentCard key={agent.id} agent={agent} call={call} queues={queues} now={now} statsLabel={statsLabel} />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AgentCard({
  agent,
  call,
  queues,
  now,
  statsLabel,
}: {
  agent: Agent;
  call: ActiveCall | null;
  queues: Queue[];
  now: number;
  statsLabel: string;
}) {
  const queueNames = agent.queues
    .map((id) => queues.find((queue) => queue.id === id)?.name ?? id)
    .join(", ");
  const tone =
    agent.status === "available"
      ? "var(--st-available)"
      : agent.status === "on-call"
        ? "var(--st-oncall)"
        : agent.status === "paused"
          ? "var(--st-paused)"
          : agent.status === "wrap-up"
            ? "var(--st-wrap)"
            : "var(--st-offline)";
  const detail = detailLine(agent, call, now);
  return (
    <li className="rounded-2xl border border-line bg-surface p-3 shadow-panel" style={{ borderLeft: `3px solid ${tone}` }}>
      <div className="flex items-start gap-3">
        <span
          className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs"
          style={{ color: tone, background: "var(--surface-2)" }}
          aria-hidden="true"
        >
          {initials(agent.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{agent.name}</p>
              <p className="text-xs text-muted">
                <span className="num">{agent.extension}</span>
                <span className="mx-1">·</span>
                {queueNames || "No queue"}
              </p>
            </div>
            <span className={`pill st-${agent.status}`}>
              <i />
              {STATUS_LABEL[agent.status]}
            </span>
          </div>
          <p className="mt-2 text-sm">{detail}</p>
          {call && agent.status === "on-call" && (
            <p className="truncate text-xs text-muted">
              {call.callerName}
              <span className="num ml-2">{formatNumber(call.callerNumber)}</span>
            </p>
          )}
          {agent.status === "paused" && agent.pauseReason && (
            <p className="text-xs text-muted">{agent.pauseReason}</p>
          )}
          <p className="mt-2 text-xs text-muted">
            <span className="num text-ink">{agent.callsHandled}</span> {statsLabel.toLowerCase()}
            {agent.pbxCallsTaken != null && (
              <span>
                {" "}
                · PBX <span className="num">{agent.pbxCallsTaken}</span>
              </span>
            )}
          </p>
        </div>
      </div>
    </li>
  );
}

function detailLine(agent: Agent, call: ActiveCall | null, now: number): string {
  if (agent.status === "on-call") {
    const talk = elapsed(call?.answeredAt ?? null, now);
    return `Talking ${duration(talk)}`;
  }
  if (agent.status === "wrap-up") {
    const wrap = elapsed(call?.wrapStartedAt ?? agent.statusSince, now);
    return `Wrapping ${duration(wrap)}`;
  }
  if (agent.status === "paused") {
    const idle = elapsed(agent.statusSince, now);
    return `Paused ${duration(idle)}`;
  }
  if (agent.status === "available") {
    const idle = elapsed(agent.statusSince, now);
    return `Ready ${duration(idle)}`;
  }
  return "Signed out";
}
