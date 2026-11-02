import { buildAlerts } from "../../domain/alerts.js";
import { statsDate, zonedParts, zonedTimeToUtc } from "../../domain/time.js";
import type {
  ActiveCall,
  Agent,
  AgentStatus,
  CallOutcome,
  CenterState,
  Queue,
  SlaPolicy,
  WaitingCaller,
} from "../../domain/types.js";
import {
  CALLERS,
  HISTORY,
  ROSTER_AGENTS,
  ROSTER_QUEUES,
  TALK_SECONDS,
  WRAP_SECONDS,
  type RosterAgent,
} from "./roster.js";

export interface OpeningInput {
  now: Date;
  timeZone: string;
  policy: SlaPolicy;
  seed: number;
}

export function buildOpeningState(input: OpeningInput): CenterState {
  const { now, timeZone, policy, seed } = input;
  const date = statsDate(now, timeZone);
  const queues = ROSTER_QUEUES.map((roster) => stampQueue(roster, policy));
  const outcomes = buildOutcomes(now, timeZone, seed);
  const agents = ROSTER_AGENTS.map((roster) => {
    const mine = outcomes.filter((outcome) => outcome.agentId === roster.id && outcome.disposition === "answered");
    return baseAgent(roster, now, mine);
  });

  const calls: ActiveCall[] = [];
  const waitingByQueue = new Map<string, WaitingCaller[]>();

  const stageCalls: ActiveCall[] = [
    talking("call-live-1001", "sales", "1001", 0, 20, 120, now),
    talking("call-live-1003", "support", "1003", 1, 18, 260, now),
    talking("call-live-1004", "support", "1004", 2, 34, 95, now),
    talking("call-live-1008", "vip", "1008", 5, 6, 410, now),
    talking("call-live-1010", "support", "1010", 7, 22, 70, now),
  ];
  calls.push(...stageCalls);

  const wrap = talking("call-wrap-1006", "billing", "1006", 6, 11, 204, now);
  wrap.state = "wrap-up";
  wrap.wrapStartedAt = new Date(now.getTime() - 20_000).toISOString();
  wrap.talkSeconds = 204;
  wrap.answeredAt = new Date(now.getTime() - (204 + 20) * 1000).toISOString();
  calls.push(wrap);
  outcomes.push({
    id: wrap.id,
    queueId: "billing",
    agentId: "1006",
    disposition: "answered",
    waitSeconds: 11,
    talkSeconds: 204,
    wrapSeconds: 0,
    wrapComplete: false,
    offeredAt: new Date(now.getTime() - (204 + 20 + 11) * 1000).toISOString(),
  });

  const waiters: Array<[string, number, number]> = [
    ["support", 0, 130],
    ["support", 2, 54],
    ["support", 3, 17],
    ["sales", 4, 28],
    ["vip", 5, 9],
  ];
  for (const [queueId, callerIndex, age] of waiters) {
    const [number, name] = callerAt(callerIndex, seed);
    const joinedAt = new Date(now.getTime() - age * 1000).toISOString();
    const id = `call-wait-${queueId}-${age}`;
    const list = waitingByQueue.get(queueId) ?? [];
    list.push({
      id,
      queueId,
      callerNumber: number,
      callerName: name,
      joinedAt,
      position: 0,
    });
    waitingByQueue.set(queueId, list);
    calls.push({
      id,
      queueId,
      agentId: null,
      callerNumber: number,
      callerName: name,
      direction: "inbound",
      state: "queued",
      startedAt: joinedAt,
      queueJoinedAt: joinedAt,
      answeredAt: null,
      wrapStartedAt: null,
      talkSeconds: null,
    });
  }

  for (const queue of queues) {
    const waiting = (waitingByQueue.get(queue.id) ?? [])
      .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))
      .map((caller, index) => ({ ...caller, position: index + 1 }));
    queue.waiting = waiting;
  }

  applyStage(agents, now);

  const tunde = agents.find((agent) => agent.id === "1006");
  if (tunde) {
    tunde.callsHandled += 1;
    tunde.talkSeconds += 204;
  }

  const state: CenterState = {
    source: "simulated",
    timezone: timeZone,
    statsDate: date,
    agents,
    queues,
    calls,
    outcomes,
    alerts: [],
    updatedAt: now.toISOString(),
  };
  state.alerts = buildAlerts(state, now, policy);
  return state;
}

function stampQueue(roster: (typeof ROSTER_QUEUES)[number], policy: SlaPolicy): Queue {
  const over = policy.overrides[roster.id];
  return {
    id: roster.id,
    name: roster.name,
    extension: roster.extension,
    strategy: roster.strategy,
    slaTargetPercent: over?.targetPercent ?? roster.slaTargetPercent,
    slaThresholdSeconds: over?.thresholdSeconds ?? roster.slaThresholdSeconds,
    waiting: [],
    pbx: null,
  };
}

function buildOutcomes(now: Date, timeZone: string, seed: number): CallOutcome[] {
  const hours = weightedHours(now, timeZone);
  const outcomes: CallOutcome[] = [];
  let cursor = 0;
  for (const queue of ROSTER_QUEUES) {
    const spec = HISTORY[queue.id];
    if (!spec) continue;
    const members = ROSTER_AGENTS.filter((agent) => agent.queues.includes(queue.id));
    spec.answeredWaits.forEach((wait, index) => {
      const agent = members[index % members.length];
      if (!agent) return;
      outcomes.push({
        id: `hist-${queue.id}-a-${index}`,
        queueId: queue.id,
        agentId: agent.id,
        disposition: "answered",
        waitSeconds: wait,
        talkSeconds: TALK_SECONDS[index % TALK_SECONDS.length] ?? 180,
        wrapSeconds: WRAP_SECONDS[index % WRAP_SECONDS.length] ?? 20,
        wrapComplete: true,
        offeredAt: offerStamp(now, timeZone, hours[cursor % hours.length] ?? 12, index, seed),
      });
      cursor += 1;
    });
    spec.abandonedWaits.forEach((wait, index) => {
      outcomes.push({
        id: `hist-${queue.id}-b-${index}`,
        queueId: queue.id,
        agentId: null,
        disposition: "abandoned",
        waitSeconds: wait,
        talkSeconds: 0,
        wrapSeconds: 0,
        wrapComplete: true,
        offeredAt: offerStamp(now, timeZone, hours[cursor % hours.length] ?? 12, index + 3, seed),
      });
      cursor += 1;
    });
  }
  return outcomes;
}

function weightedHours(now: Date, timeZone: string): number[] {
  const hour = zonedParts(now, timeZone).hour;
  const start = Math.min(8, hour);
  const slots: number[] = [];
  for (let h = start; h <= hour; h += 1) {
    const weight = h >= 11 && h <= 14 ? 4 : h >= 9 && h <= 16 ? 2 : 1;
    for (let i = 0; i < weight; i += 1) slots.push(h);
  }
  return slots.length > 0 ? slots : [hour];
}

function offerStamp(
  now: Date,
  timeZone: string,
  hour: number,
  index: number,
  seed: number,
): string {
  const parts = zonedParts(now, timeZone);
  const minute = (index * 7 + (seed % 5)) % 60;
  return zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, index % 50, timeZone).toISOString();
}

function baseAgent(roster: RosterAgent, now: Date, answered: CallOutcome[]): Agent {
  return {
    id: roster.id,
    name: roster.name,
    extension: roster.extension,
    status: "available",
    pauseReason: null,
    pauseAfterCall: false,
    queues: [...roster.queues],
    callId: null,
    callsHandled: answered.length,
    talkSeconds: answered.reduce((sum, outcome) => sum + outcome.talkSeconds, 0),
    wrapSeconds: answered.reduce((sum, outcome) => sum + outcome.wrapSeconds, 0),
    pbxCallsTaken: null,
    loggedInAt: new Date(now.getTime() - 6 * 3600 * 1000).toISOString(),
    statusSince: new Date(now.getTime() - 4 * 60 * 1000).toISOString(),
  };
}

function applyStage(agents: Agent[], now: Date): void {
  const set = (
    id: string,
    status: AgentStatus,
    callId: string | null,
    sinceSeconds: number,
    pauseReason: string | null = null,
  ) => {
    const agent = agents.find((item) => item.id === id);
    if (!agent) return;
    agent.status = status;
    agent.callId = callId;
    agent.pauseReason = pauseReason;
    agent.statusSince = new Date(now.getTime() - sinceSeconds * 1000).toISOString();
  };
  set("1001", "on-call", "call-live-1001", 120);
  set("1002", "available", null, 180);
  set("1003", "on-call", "call-live-1003", 260);
  set("1004", "on-call", "call-live-1004", 95);
  set("1005", "paused", null, 2 * 60, "Lunch");
  set("1006", "wrap-up", "call-wrap-1006", 20);
  set("1007", "available", null, 90);
  set("1008", "on-call", "call-live-1008", 410);
  set("1009", "paused", null, 90, "Break");
  set("1010", "on-call", "call-live-1010", 70);
  set("1011", "available", null, 240);
  set("1012", "available", null, 75);
}

function talking(
  id: string,
  queueId: string,
  agentId: string,
  callerIndex: number,
  waitSeconds: number,
  talkSeconds: number,
  now: Date,
): ActiveCall {
  const [number, name] = CALLERS[callerIndex] ?? ["08000000000", "Unknown"];
  const answeredAt = new Date(now.getTime() - talkSeconds * 1000);
  const joinedAt = new Date(answeredAt.getTime() - waitSeconds * 1000);
  return {
    id,
    queueId,
    agentId,
    callerNumber: number,
    callerName: name,
    direction: "inbound",
    state: "talking",
    startedAt: joinedAt.toISOString(),
    queueJoinedAt: joinedAt.toISOString(),
    answeredAt: answeredAt.toISOString(),
    wrapStartedAt: null,
    talkSeconds: null,
  };
}

function callerAt(index: number, seed: number): [string, string] {
  const row = CALLERS[(index + (seed % CALLERS.length)) % CALLERS.length];
  return row ?? ["08000000000", "Unknown"];
}
