import type { ReduceContext } from "../src/domain/reducer.js";
import type { CenterState, SlaPolicy } from "../src/domain/types.js";

export function testPolicy(overrides: Partial<SlaPolicy> = {}): SlaPolicy {
  return {
    defaultTargetPercent: 80,
    defaultThresholdSeconds: 20,
    shortAbandonSeconds: 5,
    minOfferedForAlert: 15,
    maxAbandonPercent: 8,
    maxWaitSeconds: 60,
    overrides: {},
    ...overrides,
  };
}

export function testContext(policy: SlaPolicy = testPolicy()): ReduceContext {
  return { timeZone: "UTC", policy };
}

export function assertInvariants(state: CenterState): void {
  const callIds = new Set<string>();
  for (const call of state.calls) {
    if (callIds.has(call.id)) throw new Error(`duplicate call ${call.id}`);
    callIds.add(call.id);
  }
  const outcomeIds = new Set<string>();
  for (const outcome of state.outcomes) {
    if (outcomeIds.has(outcome.id)) throw new Error(`duplicate outcome ${outcome.id}`);
    outcomeIds.add(outcome.id);
    if (outcome.waitSeconds < 0 || outcome.talkSeconds < 0 || outcome.wrapSeconds < 0) {
      throw new Error(`negative time on ${outcome.id}`);
    }
  }
  for (const queue of state.queues) {
    queue.waiting.forEach((waiter, index) => {
      if (waiter.position !== index + 1) throw new Error(`position gap on ${queue.id}`);
      if (!state.calls.some((call) => call.id === waiter.id && call.state === "queued")) {
        throw new Error(`waiter ${waiter.id} has no queued call`);
      }
    });
  }
  for (const agent of state.agents) {
    if (agent.status === "on-call" && !state.calls.some((call) => call.id === agent.callId && call.state === "talking")) {
      throw new Error(`${agent.id} is on-call without a talking call`);
    }
    if (agent.status === "wrap-up" && !state.calls.some((call) => call.id === agent.callId && call.state === "wrap-up")) {
      throw new Error(`${agent.id} is in wrap-up without a wrap-up call`);
    }
    const handled = state.outcomes.filter((o) => o.agentId === agent.id && o.disposition === "answered");
    if (agent.callsHandled !== handled.length) {
      throw new Error(`${agent.id} callsHandled ${agent.callsHandled} != ${handled.length}`);
    }
  }
  for (const call of state.calls) {
    if (call.state === "talking") {
      const agent = state.agents.find((item) => item.id === call.agentId);
      if (!agent || agent.status !== "on-call" || agent.callId !== call.id) {
        throw new Error(`talking call ${call.id} is not owned by an on-call agent`);
      }
    }
  }
}
