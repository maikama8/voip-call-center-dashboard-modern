import { reduce, type ReduceContext } from "../../domain/reducer.js";
import type { CenterEvent, CenterState, SlaPolicy } from "../../domain/types.js";
import type { DataSourceAdapter } from "../types.js";
import { buildOpeningState } from "./opening.js";
import { CALLERS, ROSTER_QUEUES } from "./roster.js";

export interface SimulatedOptions {
  seed: number;
  tickMs: number;
  timeZone: string;
  policy: SlaPolicy;
  now?: () => Date;
}

const PAUSE_REASONS = ["Break", "Lunch", "Coaching", "Meeting"];
const QUEUE_WEIGHTS: Array<[string, number]> = [
  ["support", 46],
  ["sales", 28],
  ["billing", 18],
  ["vip", 8],
];

/**
 * A floor that keeps moving without a PBX. `step` is synchronous so tests
 * can advance a virtual clock. `start` emits the opening snapshot, then
 * steps on an interval.
 */
export class SimulatedAdapter implements DataSourceAdapter {
  readonly name = "simulated";
  private readonly now: () => Date;
  private readonly ctx: ReduceContext;
  private readonly random: () => number;
  private state: CenterState;
  private emit: (event: CenterEvent) => void = () => {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private hangupAt = new Map<string, number>();
  private wrapEndAt = new Map<string, number>();
  private seq = 0;

  constructor(private readonly options: SimulatedOptions) {
    this.now = options.now ?? (() => new Date());
    this.ctx = { timeZone: options.timeZone, policy: options.policy };
    this.random = mulberry32(options.seed);
    const now = this.now();
    this.state = buildOpeningState({
      now,
      timeZone: options.timeZone,
      policy: options.policy,
      seed: options.seed,
    });
    this.seedSchedules(now.getTime());
  }

  async start(emit: (event: CenterEvent) => void): Promise<void> {
    this.emit = emit;
    this.push({ type: "snapshot", at: this.now().toISOString(), state: this.state });
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.step();
    }, this.options.tickMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getState(): CenterState {
    return this.state;
  }

  step(): CenterEvent[] {
    const now = this.now();
    const emitted: CenterEvent[] = [];
    const makers = [
      () => this.finishWraps(now),
      () => this.finishTalks(now),
      () => this.maybeAbandon(now),
      () => this.maybeAnswer(now),
      () => this.maybeJoin(now),
      () => this.maybePause(now),
    ];
    for (const maker of makers) {
      for (const event of maker()) {
        this.push(event);
        emitted.push(event);
      }
    }
    return emitted;
  }

  private push(event: CenterEvent): void {
    this.state = reduce(this.state, event, this.ctx);
    this.emit(event);
  }

  private seedSchedules(nowMs: number): void {
    for (const call of this.state.calls) {
      if (call.state === "talking") {
        const span = 50 + (hash(call.id) % 70);
        this.hangupAt.set(call.id, nowMs + span * 1000);
      }
    }
    for (const agent of this.state.agents) {
      if (agent.status === "wrap-up" && agent.callId) {
        this.wrapEndAt.set(agent.id, nowMs + 25_000);
      }
    }
  }

  private finishWraps(now: Date): CenterEvent[] {
    const events: CenterEvent[] = [];
    for (const agent of this.state.agents) {
      const due = this.wrapEndAt.get(agent.id);
      if (agent.status !== "wrap-up" || due == null || due > now.getTime() || !agent.callId) continue;
      const call = this.state.calls.find((item) => item.id === agent.callId);
      const wrapSeconds = call?.wrapStartedAt
        ? Math.max(0, Math.round((now.getTime() - Date.parse(call.wrapStartedAt)) / 1000))
        : 15;
      events.push({
        type: "call.wrapup.end",
        at: now.toISOString(),
        agentId: agent.id,
        callId: agent.callId,
        wrapSeconds,
      });
      this.wrapEndAt.delete(agent.id);
    }
    return events;
  }

  private finishTalks(now: Date): CenterEvent[] {
    const events: CenterEvent[] = [];
    for (const call of this.state.calls) {
      if (call.state !== "talking") continue;
      const due = this.hangupAt.get(call.id);
      if (due == null || due > now.getTime()) continue;
      const talkSeconds = call.answeredAt
        ? Math.max(0, Math.round((now.getTime() - Date.parse(call.answeredAt)) / 1000))
        : 60;
      events.push({ type: "call.hangup", at: now.toISOString(), callId: call.id, talkSeconds });
      this.hangupAt.delete(call.id);
      if (call.agentId) {
        this.wrapEndAt.set(call.agentId, now.getTime() + (12 + Math.floor(this.random() * 28)) * 1000);
      }
    }
    return events;
  }

  private maybeAbandon(now: Date): CenterEvent[] {
    let oldest: { queueId: string; id: string; joinedAt: string; wait: number } | null = null;
    for (const queue of this.state.queues) {
      for (const waiter of queue.waiting) {
        const wait = Math.floor((now.getTime() - Date.parse(waiter.joinedAt)) / 1000);
        if (!oldest || wait > oldest.wait) oldest = { queueId: queue.id, id: waiter.id, joinedAt: waiter.joinedAt, wait };
      }
    }
    if (!oldest || oldest.wait < 80) return [];
    const chance = oldest.wait >= 150 ? 0.25 : 0.06;
    if (this.random() > chance) return [];
    return [
      {
        type: "caller.abandon",
        at: now.toISOString(),
        queueId: oldest.queueId,
        callId: oldest.id,
        waitSeconds: oldest.wait,
      },
    ];
  }

  private maybeAnswer(now: Date): CenterEvent[] {
    const ranked = [...this.state.queues].sort((a, b) => oldestWait(b, now) - oldestWait(a, now));
    for (const queue of ranked) {
      if (queue.waiting.length === 0) continue;
      const agent = availableFor(this.state, queue.id);
      if (!agent) continue;
      const pressure = oldestWait(queue, now) > 45 ? 0.85 : 0.55;
      if (this.random() > pressure) return [];
      const waiter = [...queue.waiting].sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))[0];
      if (!waiter) return [];
      const talk = 40 + Math.floor(this.random() * 80);
      this.hangupAt.set(waiter.id, now.getTime() + talk * 1000);
      return [
        {
          type: "call.answered",
          at: now.toISOString(),
          queueId: queue.id,
          callId: waiter.id,
          agentId: agent.id,
          agentName: agent.name,
          agentExtension: agent.extension,
          callerNumber: waiter.callerNumber,
          callerName: waiter.callerName,
          waitSeconds: Math.max(0, Math.round((now.getTime() - Date.parse(waiter.joinedAt)) / 1000)),
        },
      ];
    }
    return [];
  }

  private maybeJoin(now: Date): CenterEvent[] {
    const waiting = this.state.queues.reduce((sum, queue) => sum + queue.waiting.length, 0);
    if (waiting >= 5 || this.random() > 0.3) return [];
    const queueId = pickWeighted(this.random, QUEUE_WEIGHTS);
    const queue = this.state.queues.find((item) => item.id === queueId);
    if (!queue || queue.waiting.length >= 4) return [];
    if (!ROSTER_QUEUES.some((item) => item.id === queueId)) return [];
    this.seq += 1;
    const [number, name] = CALLERS[(this.seq + this.options.seed) % CALLERS.length] ?? ["08010000000", "Unknown"];
    return [
      {
        type: "caller.join",
        at: now.toISOString(),
        queueId,
        callId: `sim-${now.getTime()}-${this.seq}`,
        callerNumber: number,
        callerName: name,
      },
    ];
  }

  private maybePause(now: Date): CenterEvent[] {
    if (this.random() > 0.05) return [];
    const paused = this.state.agents.filter((agent) => agent.status === "paused");
    const stale = paused.find((agent) => now.getTime() - Date.parse(agent.statusSince) > 8 * 60 * 1000);
    if (stale) {
      return [{ type: "agent.pause", at: now.toISOString(), agentId: stale.id, paused: false, reason: null }];
    }
    if (paused.length >= 3) return [];
    const ready = this.state.agents.filter((agent) => agent.status === "available");
    const agent = ready[Math.floor(this.random() * ready.length)];
    if (!agent) return [];
    const reason = PAUSE_REASONS[Math.floor(this.random() * PAUSE_REASONS.length)] ?? "Break";
    return [{ type: "agent.pause", at: now.toISOString(), agentId: agent.id, paused: true, reason }];
  }
}

function availableFor(state: CenterState, queueId: string) {
  const members = state.agents.filter(
    (agent) => agent.status === "available" && !agent.pauseAfterCall && agent.queues.includes(queueId),
  );
  members.sort((a, b) => a.callsHandled - b.callsHandled || a.extension.localeCompare(b.extension));
  return members[0];
}

function oldestWait(queue: { waiting: { joinedAt: string }[] }, now: Date): number {
  let oldest = 0;
  for (const waiter of queue.waiting) {
    const wait = Math.floor((now.getTime() - Date.parse(waiter.joinedAt)) / 1000);
    if (wait > oldest) oldest = wait;
  }
  return oldest;
}

function pickWeighted(random: () => number, weights: Array<[string, number]>): string {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random() * total;
  for (const [id, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return id;
  }
  return weights[weights.length - 1]?.[0] ?? "support";
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 33 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
