import { summarize } from "./domain/kpis.js";
import type { CenterState, QueueKpi, SlaPolicy, WallboardSnapshot } from "./domain/types.js";

export function projectSnapshot(
  state: CenterState,
  now: Date,
  policy: SlaPolicy,
): WallboardSnapshot {
  const waiting = state.queues.flatMap((queue) => queue.waiting);
  const thresholdFor = (queueId: string) =>
    state.queues.find((queue) => queue.id === queueId)?.slaThresholdSeconds ??
    policy.defaultThresholdSeconds;
  const options = {
    now,
    timeZone: state.timezone,
    shortAbandonSeconds: policy.shortAbandonSeconds,
    thresholdSecondsFor: thresholdFor,
  };
  const byQueue: QueueKpi[] = state.queues.map((queue) => ({
    ...summarize(
      state.outcomes.filter((outcome) => outcome.queueId === queue.id),
      queue.waiting,
      { ...options, thresholdSecondsFor: () => queue.slaThresholdSeconds },
    ),
    queueId: queue.id,
    slaTargetPercent: queue.slaTargetPercent,
    slaThresholdSeconds: queue.slaThresholdSeconds,
  }));
  return {
    type: "snapshot",
    serverTime: now.toISOString(),
    source: state.source,
    timezone: state.timezone,
    statsDate: state.statsDate,
    statsLabel: state.source === "ami" ? "Since connect" : "Today",
    updatedAt: state.updatedAt,
    agents: state.agents,
    queues: state.queues,
    calls: state.calls,
    kpis: {
      overall: summarize(state.outcomes, waiting, options),
      byQueue,
    },
    alerts: state.alerts,
    rules: {
      shortAbandonSeconds: policy.shortAbandonSeconds,
      maxWaitSeconds: policy.maxWaitSeconds,
      maxAbandonPercent: policy.maxAbandonPercent,
      minOfferedForAlert: policy.minOfferedForAlert,
    },
  };
}
