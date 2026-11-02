import { describe, expect, it } from "vitest";
import { summarize } from "../src/domain/kpis.js";
import { SimulatedAdapter } from "../src/adapters/simulated/adapter.js";
import { buildOpeningState } from "../src/adapters/simulated/opening.js";
import type { SlaPolicy } from "../src/domain/types.js";
import { assertInvariants, testPolicy } from "./helpers.js";

const NOW = new Date("2026-11-02T15:30:00.000Z");

function policy(): SlaPolicy {
  return testPolicy();
}

function opening(seed = 20261102, now = NOW) {
  return buildOpeningState({ now, timeZone: "UTC", policy: policy(), seed });
}

function queueKpi(state: ReturnType<typeof opening>, queueId: string) {
  const queue = state.queues.find((item) => item.id === queueId);
  if (!queue) throw new Error(queueId);
  return summarize(
    state.outcomes.filter((outcome) => outcome.queueId === queueId),
    queue.waiting,
    {
      now: NOW,
      timeZone: "UTC",
      shortAbandonSeconds: 5,
      thresholdSecondsFor: () => queue.slaThresholdSeconds,
    },
  );
}

describe("simulated adapter", () => {
  it("builds the same floor for the same seed and clock", () => {
    expect(opening()).toEqual(opening());
  });

  it("changes callers with the seed and leaves the service level alone", () => {
    const a = opening(1);
    const b = opening(2);
    const level = (state: ReturnType<typeof opening>) =>
      summarize(state.outcomes, state.queues.flatMap((queue) => queue.waiting), {
        now: NOW,
        timeZone: "UTC",
        shortAbandonSeconds: 5,
        thresholdSecondsFor: (id) => state.queues.find((queue) => queue.id === id)?.slaThresholdSeconds ?? 20,
      }).serviceLevel;
    expect(level(a)).toBeCloseTo(level(b) ?? -1, 5);
    const anumber = a.queues.find((queue) => queue.id === "support")?.waiting[0]?.callerNumber;
    const bnumber = b.queues.find((queue) => queue.id === "support")?.waiting[0]?.callerNumber;
    expect(anumber).not.toBe(bnumber);
  });

  it("opens with Support under target and the other queues inside theirs", () => {
    const state = opening();
    expect(state.agents).toHaveLength(12);
    expect(state.queues.map((queue) => queue.id)).toEqual(["sales", "support", "billing", "vip"]);

    const support = queueKpi(state, "support");
    expect(support.serviceLevel).toBeCloseTo((32 / 44) * 100, 5);
    expect(support.abandonRate).toBeGreaterThan(8);
    expect(support.serviceLevel ?? 100).toBeLessThan(80);

    expect(queueKpi(state, "sales").serviceLevel ?? 0).toBeGreaterThanOrEqual(80);
    expect(queueKpi(state, "billing").serviceLevel ?? 0).toBeGreaterThanOrEqual(90);
    expect(queueKpi(state, "vip").serviceLevel).toBe(100);

    expect(state.alerts.some((alert) => alert.queueId === "support" && alert.kind === "service-level")).toBe(true);
    expect(state.alerts.some((alert) => alert.queueId === "support" && alert.kind === "abandon-rate")).toBe(true);
    expect(state.alerts.some((alert) => alert.queueId === "support" && alert.kind === "longest-wait" && alert.severity === "critical")).toBe(true);
    expect(state.alerts.some((alert) => alert.queueId === "sales" && alert.kind === "service-level")).toBe(false);

    const counts = Object.fromEntries(
      ["available", "on-call", "paused", "wrap-up"].map((status) => [
        status,
        state.agents.filter((agent) => agent.status === status).length,
      ]),
    );
    expect(counts).toEqual({ available: 4, "on-call": 5, paused: 2, "wrap-up": 1 });
    expect(state.queues.find((queue) => queue.id === "support")?.waiting).toHaveLength(3);
    assertInvariants(state);
  });

  it("puts historical calls on the midday hours and leaves the night empty", () => {
    const state = opening();
    const kpi = summarize(state.outcomes, [], {
      now: NOW,
      timeZone: "UTC",
      shortAbandonSeconds: 5,
      thresholdSecondsFor: () => 20,
    });
    expect(kpi.callsPerHour[3]?.offered).toBe(0);
    expect(kpi.callsPerHour[16]?.offered).toBe(0);
    expect(kpi.callsPerHour[12]?.offered ?? 0).toBeGreaterThan(kpi.callsPerHour[8]?.offered ?? 0);
    expect(kpi.callsPerHour[15]?.offered ?? 0).toBeGreaterThan(0);
  });

  it("steps deterministically and keeps the floor consistent", () => {
    const leftClock = virtualClock(NOW.getTime());
    const rightClock = virtualClock(NOW.getTime());
    const left = new SimulatedAdapter({ seed: 7, tickMs: 1000, timeZone: "UTC", policy: policy(), now: leftClock.now });
    const right = new SimulatedAdapter({ seed: 7, tickMs: 1000, timeZone: "UTC", policy: policy(), now: rightClock.now });

    leftClock.advance(1500);
    rightClock.advance(1500);
    expect(left.step()).toEqual(right.step());

    for (let i = 0; i < 80; i += 1) {
      leftClock.advance(3000);
      left.step();
      assertInvariants(left.getState());
    }
    const kpi = summarize(left.getState().outcomes, left.getState().queues.flatMap((queue) => queue.waiting), {
      now: leftClock.now(),
      timeZone: "UTC",
      shortAbandonSeconds: 5,
      thresholdSecondsFor: (id) => left.getState().queues.find((queue) => queue.id === id)?.slaThresholdSeconds ?? 20,
    });
    for (const value of [kpi.serviceLevel, kpi.asaSeconds, kpi.abandonRate, kpi.ahtSeconds]) {
      if (value != null) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("emits an opening snapshot and stops the timer", async () => {
    const adapter = new SimulatedAdapter({ seed: 1, tickMs: 60_000, timeZone: "UTC", policy: policy(), now: () => NOW });
    const seen: string[] = [];
    await adapter.start((event) => seen.push(event.type));
    expect(seen).toEqual(["snapshot"]);
    expect(adapter.getState().agents).toHaveLength(12);
    await adapter.stop();
    await adapter.stop();
  });
});

function virtualClock(start: number) {
  let time = start;
  return {
    now: () => new Date(time),
    advance(ms: number) {
      time += ms;
    },
  };
}
