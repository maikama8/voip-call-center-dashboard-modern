import { buildAlerts, queueSla } from "./alerts.js";
import { statsDate, secondsBetween } from "./time.js";
import type {
  ActiveCall,
  Agent,
  AgentStatus,
  CallOutcome,
  CenterEvent,
  CenterState,
  Queue,
  QueueDraft,
  SlaPolicy,
  WaitingCaller,
} from "./types.js";

export interface ReduceContext {
  timeZone: string;
  policy: SlaPolicy;
}

export function emptyState(source: CenterState["source"], timeZone: string, at: string): CenterState {
  return {
    source,
    timezone: timeZone,
    statsDate: statsDate(new Date(at), timeZone),
    agents: [],
    queues: [],
    calls: [],
    outcomes: [],
    alerts: [],
    updatedAt: at,
  };
}

export function reduce(state: CenterState, event: CenterEvent, ctx: ReduceContext): CenterState {
  const next = apply(state, event, ctx);
  return finish(next, event.at, ctx);
}

function apply(state: CenterState, event: CenterEvent, ctx: ReduceContext): CenterState {
  switch (event.type) {
    case "snapshot":
      return {
        ...event.state,
        source: event.state.source,
        timezone: ctx.timeZone,
        alerts: [],
      };
    case "queue.upsert":
      return upsertQueue(state, event.queue, ctx);
    case "agent.upsert":
      return upsertAgent(state, event);
    case "agent.logout":
      return {
        ...state,
        agents: state.agents.filter((agent) => agent.id !== event.agentId),
      };
    case "agent.queue-removed":
      return removeAgentQueue(state, event.agentId, event.queueId);
    case "agent.pause":
      return pauseAgent(state, event);
    case "agent.status":
      return setAgentStatus(state, event);
    case "caller.join":
      return joinCaller(state, event, ctx);
    case "caller.abandon":
      return abandonCaller(state, event);
    case "caller.leave":
      return leaveCaller(state, event);
    case "call.answered":
      return answerCall(state, event, ctx);
    case "call.hangup":
      return hangupCall(state, event);
    case "call.wrapup.end":
      return endWrapup(state, event);
    default:
      return state;
  }
}

function finish(state: CenterState, at: string, ctx: ReduceContext): CenterState {
  const now = new Date(at);
  const date = statsDate(now, ctx.timeZone);
  let next = state;
  if (state.statsDate !== date) {
    next = {
      ...state,
      statsDate: date,
      outcomes: [],
      alerts: [],
      agents: state.agents.map((agent) => ({
        ...agent,
        callsHandled: 0,
        talkSeconds: 0,
        wrapSeconds: 0,
      })),
    };
  }
  const stamped: CenterState = { ...next, updatedAt: at, timezone: ctx.timeZone };
  return { ...stamped, alerts: buildAlerts(stamped, now, ctx.policy) };
}

function upsertQueue(state: CenterState, draft: QueueDraft, ctx: ReduceContext): CenterState {
  const existing = state.queues.find((queue) => queue.id === draft.id);
  const sla = queueSla(draft.id, ctx.policy, existing);
  const queue: Queue = {
    id: draft.id,
    name: draft.name || existing?.name || draft.id,
    extension: draft.extension || existing?.extension || draft.id,
    strategy: (draft.strategy || existing?.strategy || "ringall").toLowerCase(),
    slaTargetPercent: draft.slaTargetPercent ?? sla.targetPercent,
    slaThresholdSeconds: draft.slaThresholdSeconds ?? sla.thresholdSeconds,
    waiting: existing?.waiting ?? [],
    pbx: draft.pbx === undefined ? (existing?.pbx ?? null) : draft.pbx,
  };
  // An explicit override always wins over a number carried on the draft.
  const over = ctx.policy.overrides[draft.id.toLowerCase()];
  if (over) {
    queue.slaTargetPercent = over.targetPercent;
    queue.slaThresholdSeconds = over.thresholdSeconds;
  }
  const queues = existing
    ? state.queues.map((item) => (item.id === queue.id ? queue : item))
    : [...state.queues, queue];
  return { ...state, queues };
}

function upsertAgent(state: CenterState, event: Extract<CenterEvent, { type: "agent.upsert" }>): CenterState {
  const incoming = event.agent;
  const existing = state.agents.find((agent) => agent.id === incoming.id);
  if (!existing) {
    const agent: Agent = {
      id: incoming.id,
      name: incoming.name || incoming.extension,
      extension: incoming.extension,
      status: incoming.status,
      pauseReason: incoming.pauseReason,
      pauseAfterCall: incoming.pauseAfterCall,
      queues: unique(incoming.queues),
      callId: null,
      callsHandled: 0,
      talkSeconds: 0,
      wrapSeconds: 0,
      pbxCallsTaken: incoming.pbxCallsTaken,
      loggedInAt: event.at,
      statusSince: event.at,
    };
    return { ...state, agents: [...state.agents, agent] };
  }
  const statusChanged = existing.status !== incoming.status;
  return {
    ...state,
    agents: state.agents.map((agent) =>
      agent.id !== incoming.id
        ? agent
        : {
            ...agent,
            name: incoming.name || agent.name,
            extension: incoming.extension || agent.extension,
            queues: unique([...agent.queues, ...incoming.queues]),
            status: incoming.status,
            pauseReason: incoming.pauseReason,
            pauseAfterCall: incoming.pauseAfterCall,
            pbxCallsTaken: incoming.pbxCallsTaken ?? agent.pbxCallsTaken,
            statusSince: statusChanged ? event.at : agent.statusSince,
            callId:
              incoming.status === "on-call" || incoming.status === "wrap-up" ? agent.callId : null,
          },
    ),
  };
}

function removeAgentQueue(state: CenterState, agentId: string, queueId: string): CenterState {
  return {
    ...state,
    agents: state.agents.map((agent) => {
      if (agent.id !== agentId) return agent;
      const queues = agent.queues.filter((id) => id !== queueId);
      const stranded =
        queues.length === 0 && agent.status !== "on-call" && agent.status !== "wrap-up";
      return { ...agent, queues, status: stranded ? "offline" : agent.status };
    }),
  };
}

function pauseAgent(
  state: CenterState,
  event: Extract<CenterEvent, { type: "agent.pause" }>,
): CenterState {
  return {
    ...state,
    agents: state.agents.map((agent) => {
      if (agent.id !== event.agentId) return agent;
      if (event.paused) {
        if (agent.status === "on-call" || agent.status === "wrap-up") {
          return { ...agent, pauseAfterCall: true, pauseReason: event.reason };
        }
        return {
          ...agent,
          status: "paused",
          pauseReason: event.reason,
          pauseAfterCall: false,
          statusSince: event.at,
        };
      }
      const next: Agent = { ...agent, pauseAfterCall: false, pauseReason: null };
      if (agent.status === "paused") {
        next.status = "available";
        next.statusSince = event.at;
      }
      return next;
    }),
  };
}

function setAgentStatus(
  state: CenterState,
  event: Extract<CenterEvent, { type: "agent.status" }>,
): CenterState {
  const agent = state.agents.find((item) => item.id === event.agentId);
  if (!agent) return state;
  let next = state;
  if (
    (event.status === "available" || event.status === "paused" || event.status === "offline") &&
    agent.callId
  ) {
    const call = next.calls.find((item) => item.id === agent.callId);
    if (call?.state === "talking") {
      next = hangupCall(next, {
        type: "call.hangup",
        at: event.at,
        callId: call.id,
        talkSeconds: talkLength(call, event.at),
      });
    }
    if (call?.state === "wrap-up" || next.agents.find((item) => item.id === agent.id)?.status === "wrap-up") {
      next = endWrapup(next, {
        type: "call.wrapup.end",
        at: event.at,
        agentId: agent.id,
        callId: agent.callId,
        wrapSeconds: wrapLength(next, agent.callId, event.at),
      });
    }
  }
  return {
    ...next,
    agents: next.agents.map((item) => {
      if (item.id !== event.agentId) return item;
      return {
        ...item,
        status: event.status,
        pauseReason: event.pauseReason,
        pauseAfterCall: event.pauseAfterCall,
        statusSince: item.status === event.status ? item.statusSince : event.at,
        callId: event.status === "on-call" || event.status === "wrap-up" ? item.callId : null,
      };
    }),
  };
}

function joinCaller(
  state: CenterState,
  event: Extract<CenterEvent, { type: "caller.join" }>,
  ctx: ReduceContext,
): CenterState {
  let next = ensureQueue(state, event.queueId, ctx);
  if (next.queues.some((queue) => queue.id === event.queueId && queue.waiting.some((w) => w.id === event.callId))) {
    return next;
  }
  const waited = Math.max(0, event.alreadyWaitingSeconds ?? 0);
  const joinedAt = new Date(Date.parse(event.at) - waited * 1000).toISOString();
  const caller: WaitingCaller = {
    id: event.callId,
    queueId: event.queueId,
    callerNumber: event.callerNumber,
    callerName: blankName(event.callerName),
    joinedAt,
    position: 0,
  };
  next = {
    ...next,
    queues: next.queues.map((queue) =>
      queue.id !== event.queueId
        ? queue
        : { ...queue, waiting: reposition([...queue.waiting, caller]) },
    ),
  };
  if (!next.calls.some((call) => call.id === event.callId)) {
    const call: ActiveCall = {
      id: event.callId,
      queueId: event.queueId,
      agentId: null,
      callerNumber: event.callerNumber,
      callerName: blankName(event.callerName),
      direction: "inbound",
      state: "queued",
      startedAt: joinedAt,
      queueJoinedAt: joinedAt,
      answeredAt: null,
      wrapStartedAt: null,
      talkSeconds: null,
    };
    next = { ...next, calls: [...next.calls, call] };
  }
  return next;
}

function abandonCaller(
  state: CenterState,
  event: Extract<CenterEvent, { type: "caller.abandon" }>,
): CenterState {
  if (state.outcomes.some((outcome) => outcome.id === event.callId)) {
    return dropWaiting(state, event.queueId, event.callId);
  }
  const waiter = findWaiter(state, event.callId);
  const waitSeconds = waiter ? secondsBetween(event.at, waiter.joinedAt) : event.waitSeconds;
  const call = state.calls.find((item) => item.id === event.callId);
  const offeredAt = waiter?.joinedAt ?? call?.queueJoinedAt ?? event.at;
  let next = dropWaiting(state, event.queueId, event.callId);
  next = {
    ...next,
    calls: next.calls.filter((item) => item.id !== event.callId),
    outcomes: [
      ...next.outcomes,
      {
        id: event.callId,
        queueId: event.queueId,
        agentId: null,
        disposition: "abandoned",
        waitSeconds: Math.max(0, waitSeconds),
        talkSeconds: 0,
        wrapSeconds: 0,
        wrapComplete: true,
        offeredAt,
      },
    ],
  };
  return next;
}

function leaveCaller(
  state: CenterState,
  event: Extract<CenterEvent, { type: "caller.leave" }>,
): CenterState {
  // Leave fires for both abandon and answer. It only drops the waiting row.
  // Abandon and AgentConnect are what record an outcome.
  return dropWaiting(state, event.queueId, event.callId);
}

function answerCall(
  state: CenterState,
  event: Extract<CenterEvent, { type: "call.answered" }>,
  ctx: ReduceContext,
): CenterState {
  let next = ensureQueue(state, event.queueId, ctx);
  const waiter = findWaiter(next, event.callId);
  const waitSeconds = waiter ? secondsBetween(event.at, waiter.joinedAt) : event.waitSeconds;
  next = dropWaiting(next, event.queueId, event.callId);
  const existing = next.calls.find((call) => call.id === event.callId);
  const call: ActiveCall = {
    id: event.callId,
    queueId: event.queueId,
    agentId: event.agentId,
    callerNumber: event.callerNumber || existing?.callerNumber || "",
    callerName: blankName(event.callerName || existing?.callerName || ""),
    direction: existing?.direction ?? "inbound",
    state: "talking",
    startedAt: existing?.startedAt ?? waiter?.joinedAt ?? event.at,
    queueJoinedAt: existing?.queueJoinedAt ?? waiter?.joinedAt ?? event.at,
    answeredAt: event.at,
    wrapStartedAt: null,
    talkSeconds: null,
  };
  next = {
    ...next,
    calls: existing
      ? next.calls.map((item) => (item.id === call.id ? call : item))
      : [...next.calls, call],
  };
  if (!next.agents.some((agent) => agent.id === event.agentId)) {
    const stub: Agent = {
      id: event.agentId,
      name: event.agentName || event.agentExtension || event.agentId,
      extension: event.agentExtension || extensionFromId(event.agentId),
      status: "on-call",
      pauseReason: null,
      pauseAfterCall: false,
      queues: [event.queueId],
      callId: event.callId,
      callsHandled: 0,
      talkSeconds: 0,
      wrapSeconds: 0,
      pbxCallsTaken: null,
      loggedInAt: event.at,
      statusSince: event.at,
    };
    next = { ...next, agents: [...next.agents, stub] };
  } else {
    next = {
      ...next,
      agents: next.agents.map((agent) =>
        agent.id !== event.agentId
          ? agent
          : {
              ...agent,
              status: "on-call" as AgentStatus,
              callId: event.callId,
              statusSince: event.at,
              queues: agent.queues.includes(event.queueId)
                ? agent.queues
                : [...agent.queues, event.queueId],
              name: event.agentName || agent.name,
              extension: event.agentExtension || agent.extension,
            },
      ),
    };
  }
  // Remember the wait on a side field by storing it as a 0-talk outcome? No.
  // Hangup reads queueJoinedAt and answeredAt. waitSeconds on the event is
  // kept only when the waiter was already removed (AMI Leave-then-Connect).
  if (!waiter && waitSeconds !== secondsBetween(event.at, call.queueJoinedAt ?? event.at)) {
    next = {
      ...next,
      calls: next.calls.map((item) =>
        item.id !== call.id
          ? item
          : {
              ...item,
              queueJoinedAt: new Date(Date.parse(event.at) - waitSeconds * 1000).toISOString(),
            },
      ),
    };
  }
  return next;
}

function hangupCall(
  state: CenterState,
  event: Extract<CenterEvent, { type: "call.hangup" }>,
): CenterState {
  const call = state.calls.find((item) => item.id === event.callId);
  if (!call) return state;
  if (call.state === "queued") {
    return abandonCaller(state, {
      type: "caller.abandon",
      at: event.at,
      queueId: call.queueId,
      callId: call.id,
      waitSeconds: secondsBetween(event.at, call.queueJoinedAt ?? call.startedAt),
    });
  }
  if (call.state !== "talking") return state;
  if (state.outcomes.some((outcome) => outcome.id === call.id)) {
    return {
      ...state,
      calls: state.calls.map((item) =>
        item.id !== call.id ? item : { ...item, state: "wrap-up", wrapStartedAt: event.at },
      ),
    };
  }
  const waitSeconds = secondsBetween(call.answeredAt ?? event.at, call.queueJoinedAt ?? call.startedAt);
  const talkSeconds = event.talkSeconds >= 0 ? event.talkSeconds : talkLength(call, event.at);
  const outcome: CallOutcome = {
    id: call.id,
    queueId: call.queueId,
    agentId: call.agentId,
    disposition: "answered",
    waitSeconds,
    talkSeconds,
    wrapSeconds: 0,
    wrapComplete: false,
    offeredAt: call.queueJoinedAt ?? call.startedAt,
  };
  return {
    ...state,
    calls: state.calls.map((item) =>
      item.id !== call.id
        ? item
        : { ...item, state: "wrap-up", wrapStartedAt: event.at, talkSeconds, agentId: call.agentId },
    ),
    outcomes: [...state.outcomes, outcome],
    agents: state.agents.map((agent) => {
      if (agent.id !== call.agentId) return agent;
      return {
        ...agent,
        status: "wrap-up" as AgentStatus,
        callId: call.id,
        statusSince: event.at,
        callsHandled: agent.callsHandled + 1,
        talkSeconds: agent.talkSeconds + talkSeconds,
      };
    }),
  };
}

function endWrapup(
  state: CenterState,
  event: Extract<CenterEvent, { type: "call.wrapup.end" }>,
): CenterState {
  const agent = state.agents.find((item) => item.id === event.agentId);
  if (!agent || agent.status !== "wrap-up") return state;
  const wrapSeconds = Math.max(0, event.wrapSeconds);
  return {
    ...state,
    calls: state.calls.filter((call) => call.id !== event.callId),
    outcomes: state.outcomes.map((outcome) =>
      outcome.id !== event.callId
        ? outcome
        : { ...outcome, wrapSeconds, wrapComplete: true },
    ),
    agents: state.agents.map((item) => {
      if (item.id !== event.agentId) return item;
      const paused = item.pauseAfterCall;
      return {
        ...item,
        status: paused ? "paused" : "available",
        pauseReason: paused ? item.pauseReason : null,
        pauseAfterCall: false,
        callId: null,
        statusSince: event.at,
        wrapSeconds: item.wrapSeconds + wrapSeconds,
      };
    }),
  };
}

function ensureQueue(state: CenterState, queueId: string, ctx: ReduceContext): CenterState {
  if (state.queues.some((queue) => queue.id === queueId)) return state;
  return upsertQueue(state, { id: queueId, name: queueId }, ctx);
}

function dropWaiting(state: CenterState, queueId: string, callId: string): CenterState {
  return {
    ...state,
    queues: state.queues.map((queue) =>
      queue.id !== queueId && !queue.waiting.some((w) => w.id === callId)
        ? queue
        : { ...queue, waiting: reposition(queue.waiting.filter((w) => w.id !== callId)) },
    ),
  };
}

function findWaiter(state: CenterState, callId: string): WaitingCaller | undefined {
  for (const queue of state.queues) {
    const waiter = queue.waiting.find((item) => item.id === callId);
    if (waiter) return waiter;
  }
  return undefined;
}

function reposition(waiting: WaitingCaller[]): WaitingCaller[] {
  return [...waiting]
    .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt) || a.id.localeCompare(b.id))
    .map((caller, index) => ({ ...caller, position: index + 1 }));
}

function blankName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed === "<unknown>") return "Unknown";
  return trimmed;
}

function extensionFromId(id: string): string {
  const local = id.match(/Local\/(\d+)/i);
  if (local) return local[1] ?? id;
  const tech = id.match(/^(?:PJSIP|SIP|IAX2|DAHDI)\/(\d+)/i);
  if (tech) return tech[1] ?? id;
  return id;
}

function talkLength(call: ActiveCall, at: string): number {
  if (!call.answeredAt) return 0;
  return secondsBetween(at, call.answeredAt);
}

function wrapLength(state: CenterState, callId: string, at: string): number {
  const call = state.calls.find((item) => item.id === callId);
  if (!call?.wrapStartedAt) return 0;
  return secondsBetween(at, call.wrapStartedAt);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
