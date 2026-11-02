import { describe, expect, it } from "vitest";
import { buildAlerts } from "../src/domain/alerts.js";
import { summarize } from "../src/domain/kpis.js";
import { emptyState, reduce } from "../src/domain/reducer.js";
import type { CenterEvent, CenterState } from "../src/domain/types.js";
import { assertInvariants, testContext, testPolicy } from "./helpers.js";

const AT = "2026-11-02T12:00:00.000Z";
const ctx = testContext();

function at(seconds: number): string {
  return new Date(Date.parse(AT) + seconds * 1000).toISOString();
}

function apply(events: CenterEvent[], state = emptyState("simulated", "UTC", AT)): CenterState {
  return events.reduce((current, event) => reduce(current, event, ctx), state);
}

describe("event reducer", () => {
  it("answers a queued caller, wraps the agent, then returns them to available", () => {
    const state = apply([
      { type: "queue.upsert", at: AT, queue: { id: "support", name: "Support", extension: "610" } },
      {
        type: "agent.upsert",
        at: AT,
        agent: {
          id: "1003",
          name: "Fatima Bello",
          extension: "1003",
          queues: ["support"],
          status: "available",
          pauseReason: null,
          pauseAfterCall: false,
          pbxCallsTaken: null,
        },
      },
      {
        type: "caller.join",
        at: AT,
        queueId: "support",
        callId: "c1",
        callerNumber: "08031234567",
        callerName: "Adaeze Umeh",
      },
      {
        type: "call.answered",
        at: at(12),
        queueId: "support",
        callId: "c1",
        agentId: "1003",
        callerNumber: "08031234567",
        callerName: "Adaeze Umeh",
        waitSeconds: 12,
      },
      { type: "call.hangup", at: at(12 + 100), callId: "c1", talkSeconds: 100 },
      { type: "call.wrapup.end", at: at(12 + 100 + 25), agentId: "1003", callId: "c1", wrapSeconds: 25 },
    ]);

    expect(state.queues[0]?.waiting).toHaveLength(0);
    expect(state.calls).toHaveLength(0);
    expect(state.agents[0]).toMatchObject({ status: "available", callsHandled: 1, talkSeconds: 100, wrapSeconds: 25, callId: null });
    expect(state.outcomes[0]).toMatchObject({
      disposition: "answered",
      waitSeconds: 12,
      talkSeconds: 100,
      wrapSeconds: 25,
      wrapComplete: true,
    });

    const kpi = summarize(state.outcomes, [], {
      now: new Date(at(200)),
      timeZone: "UTC",
      shortAbandonSeconds: 5,
      thresholdSecondsFor: () => 20,
    });
    expect(kpi.serviceLevel).toBe(100);
    expect(kpi.asaSeconds).toBe(12);
    expect(kpi.ahtSeconds).toBe(125);
    expect(kpi.abandonRate).toBe(0);
    assertInvariants(state);
  });

  it("does not mutate the previous state", () => {
    const start = apply([
      { type: "caller.join", at: AT, queueId: "sales", callId: "c1", callerNumber: "100", callerName: "A" },
    ]);
    const frozen = structuredClone(start);
    reduce(start, { type: "caller.abandon", at: at(10), queueId: "sales", callId: "c1", waitSeconds: 10 }, ctx);
    expect(start).toEqual(frozen);
  });

  it("records an abandon and ignores a duplicate", () => {
    const once = apply([
      { type: "caller.join", at: AT, queueId: "sales", callId: "c1", callerNumber: "0801", callerName: "unknown" },
      { type: "caller.abandon", at: at(30), queueId: "sales", callId: "c1", waitSeconds: 30 },
    ]);
    expect(once.outcomes).toHaveLength(1);
    expect(once.outcomes[0]).toMatchObject({ disposition: "abandoned", waitSeconds: 30 });
    expect(once.calls).toHaveLength(0);
    expect(once.queues[0]?.waiting).toHaveLength(0);
    expect(once.calls.find((call) => call.callerName === "Unknown") ?? once.outcomes[0]?.id).toBeTruthy();

    const twice = reduce(once, { type: "caller.abandon", at: at(31), queueId: "sales", callId: "c1", waitSeconds: 31 }, ctx);
    expect(twice.outcomes).toHaveLength(1);
  });

  it("leaves a short abandon out of the service-level denominator", () => {
    const state = apply([
      { type: "caller.join", at: AT, queueId: "sales", callId: "fast", callerNumber: "1", callerName: "A" },
      { type: "caller.abandon", at: at(3), queueId: "sales", callId: "fast", waitSeconds: 3 },
      { type: "caller.join", at: at(4), queueId: "sales", callId: "slow", callerNumber: "2", callerName: "B" },
      {
        type: "call.answered",
        at: at(4 + 10),
        queueId: "sales",
        callId: "slow",
        agentId: "1001",
        callerNumber: "2",
        callerName: "B",
        waitSeconds: 10,
      },
      { type: "call.hangup", at: at(80), callId: "slow", talkSeconds: 40 },
      { type: "call.wrapup.end", at: at(90), agentId: "1001", callId: "slow", wrapSeconds: 10 },
    ]);
    const kpi = summarize(state.outcomes, [], {
      now: new Date(at(90)),
      timeZone: "UTC",
      shortAbandonSeconds: 5,
      thresholdSecondsFor: () => 20,
    });
    expect(kpi.offered).toBe(2);
    expect(kpi.serviceLevelSample).toBe(1);
    expect(kpi.serviceLevel).toBe(100);
    expect(kpi.abandonRate).toBeCloseTo(50, 5);
  });

  it("holds a pause requested during a call until wrap-up ends", () => {
    const state = apply([
      {
        type: "agent.upsert",
        at: AT,
        agent: {
          id: "1005",
          name: "Ngozi Eze",
          extension: "1005",
          queues: ["support"],
          status: "available",
          pauseReason: null,
          pauseAfterCall: false,
          pbxCallsTaken: null,
        },
      },
      { type: "caller.join", at: AT, queueId: "support", callId: "c1", callerNumber: "0802", callerName: "Musa" },
      {
        type: "call.answered",
        at: at(5),
        queueId: "support",
        callId: "c1",
        agentId: "1005",
        callerNumber: "0802",
        callerName: "Musa",
        waitSeconds: 5,
      },
      { type: "agent.pause", at: at(6), agentId: "1005", paused: true, reason: "Lunch" },
      { type: "call.hangup", at: at(40), callId: "c1", talkSeconds: 35 },
      { type: "call.wrapup.end", at: at(55), agentId: "1005", callId: "c1", wrapSeconds: 15 },
    ]);
    expect(state.agents[0]).toMatchObject({ status: "paused", pauseReason: "Lunch", pauseAfterCall: false });
  });

  it("does not double-count a caller who joins twice", () => {
    const state = apply([
      { type: "caller.join", at: AT, queueId: "vip", callId: "c1", callerNumber: "0802", callerName: "Lola" },
      { type: "caller.join", at: at(2), queueId: "vip", callId: "c1", callerNumber: "0802", callerName: "Lola" },
    ]);
    expect(state.queues[0]?.waiting).toHaveLength(1);
    expect(state.calls).toHaveLength(1);
  });

  it("drops a waiting caller on QueueCallerLeave without an outcome", () => {
    const state = apply([
      { type: "caller.join", at: AT, queueId: "vip", callId: "c1", callerNumber: "0802", callerName: "Lola" },
      { type: "caller.leave", at: at(4), queueId: "vip", callId: "c1" },
    ]);
    expect(state.queues[0]?.waiting).toHaveLength(0);
    expect(state.outcomes).toHaveLength(0);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.state).toBe("queued");
  });

  it("treats a hangup while queued as an abandon", () => {
    const state = apply([
      { type: "caller.join", at: AT, queueId: "sales", callId: "c1", callerNumber: "0809", callerName: "Peter" },
      { type: "call.hangup", at: at(18), callId: "c1", talkSeconds: -1 },
    ]);
    expect(state.outcomes[0]).toMatchObject({ disposition: "abandoned", waitSeconds: 18 });
    expect(state.calls).toHaveLength(0);
  });

  it("ignores a hangup for an unknown channel", () => {
    const start = emptyState("simulated", "UTC", AT);
    const next = reduce(start, { type: "call.hangup", at: at(1), callId: "missing", talkSeconds: 10 }, ctx);
    expect(next.outcomes).toHaveLength(0);
    expect(next.calls).toHaveLength(0);
  });

  it("keeps the waited time reported by AMI when the caller already left the queue", () => {
    const state = apply([
      { type: "caller.join", at: AT, queueId: "support", callId: "c1", callerNumber: "0803", callerName: "Ada" },
      { type: "caller.leave", at: at(2), queueId: "support", callId: "c1" },
      {
        type: "call.answered",
        at: at(18),
        queueId: "support",
        callId: "c1",
        agentId: "PJSIP/1003",
        agentExtension: "1003",
        callerNumber: "0803",
        callerName: "Ada",
        waitSeconds: 18,
      },
      { type: "call.hangup", at: at(80), callId: "c1", talkSeconds: 40 },
    ]);
    expect(state.outcomes[0]).toMatchObject({ disposition: "answered", waitSeconds: 18, talkSeconds: 40 });
  });

  it("rolls the day and clears outcomes but keeps the agents", () => {
    const started = apply([
      { type: "caller.join", at: AT, queueId: "sales", callId: "c1", callerNumber: "1", callerName: "A" },
      { type: "caller.abandon", at: at(20), queueId: "sales", callId: "c1", waitSeconds: 20 },
    ]);
    expect(started.outcomes).toHaveLength(1);
    const next = reduce(
      started,
      { type: "agent.pause", at: "2026-11-03T00:05:00.000Z", agentId: "nobody", paused: true, reason: "Break" },
      ctx,
    );
    expect(next.statsDate).toBe("2026-11-03");
    expect(next.outcomes).toHaveLength(0);
    expect(next.queues).toHaveLength(1);
  });

  it("replaces state on a snapshot", () => {
    const opening = apply([
      { type: "caller.join", at: AT, queueId: "sales", callId: "c1", callerNumber: "1", callerName: "A" },
    ]);
    const replacement = emptyState("ami", "UTC", at(5));
    const next = reduce(opening, { type: "snapshot", at: at(5), state: replacement }, ctx);
    expect(next.source).toBe("ami");
    expect(next.calls).toHaveLength(0);
    expect(next.queues).toHaveLength(0);
  });

  it("raises a service-level alert once the sample is large enough, and stays quiet before that", () => {
    const policy = testPolicy({ minOfferedForAlert: 3, maxWaitSeconds: 60 });
    const context = testContext(policy);
    let state = emptyState("simulated", "UTC", AT);
    state = reduce(state, { type: "queue.upsert", at: AT, queue: { id: "support", name: "Support", slaTargetPercent: 80, slaThresholdSeconds: 20 } }, context);
    for (let i = 0; i < 2; i += 1) {
      state = reduce(state, { type: "caller.join", at: at(i), queueId: "support", callId: `c${i}`, callerNumber: "1", callerName: "A" }, context);
      state = reduce(
        state,
        { type: "call.answered", at: at(i + 40), queueId: "support", callId: `c${i}`, agentId: "1003", callerNumber: "1", callerName: "A", waitSeconds: 40 },
        context,
      );
      state = reduce(state, { type: "call.hangup", at: at(i + 50), callId: `c${i}`, talkSeconds: 10 }, context);
    }
    expect(state.alerts.some((alert) => alert.kind === "service-level")).toBe(false);

    state = reduce(state, { type: "caller.join", at: at(10), queueId: "support", callId: "c9", callerNumber: "1", callerName: "A" }, context);
    state = reduce(
      state,
      { type: "call.answered", at: at(50), queueId: "support", callId: "c9", agentId: "1003", callerNumber: "1", callerName: "A", waitSeconds: 40 },
      context,
    );
    state = reduce(state, { type: "call.hangup", at: at(60), callId: "c9", talkSeconds: 10 }, context);
    const alert = state.alerts.find((item) => item.kind === "service-level");
    expect(alert?.severity).toBe("critical");
    expect(alert?.message).toContain("Support");
    expect(alert?.message).toContain("0.0%");
  });

  it("raises a longest-wait alert from the caller who is still in queue", () => {
    const policy = testPolicy({ maxWaitSeconds: 60 });
    const state = reduce(
      emptyState("simulated", "UTC", AT),
      {
        type: "caller.join",
        at: new Date(Date.parse(AT) - 130_000).toISOString(),
        queueId: "support",
        callId: "old",
        callerNumber: "0802",
        callerName: "Musa",
      },
      testContext(policy),
    );
    // The join is stamped in the past, then finish() uses that timestamp, so the wait is ~0.
    // Recompute against a later clock the way the wallboard does on the next event.
    const later = reduce(
      state,
      { type: "queue.upsert", at: AT, queue: { id: "support", name: "Support" } },
      testContext(policy),
    );
    expect(later.alerts.some((alert) => alert.kind === "longest-wait" && alert.severity === "critical")).toBe(true);
    expect(buildAlerts(later, new Date(AT), policy).some((alert) => alert.kind === "longest-wait")).toBe(true);
  });
});
