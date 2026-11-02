import { summarize } from "./kpis.js";
import type { Alert, CenterState, Queue, SlaPolicy } from "./types.js";

export function buildAlerts(state: CenterState, now: Date, policy: SlaPolicy): Alert[] {
  const alerts: Alert[] = [];
  for (const queue of state.queues) {
    const kpi = summarize(
      state.outcomes.filter((o) => o.queueId === queue.id),
      queue.waiting,
      {
        now,
        timeZone: state.timezone,
        shortAbandonSeconds: policy.shortAbandonSeconds,
        thresholdSecondsFor: () => queue.slaThresholdSeconds,
      },
    );
    const enough = kpi.offered >= policy.minOfferedForAlert;

    if (
      enough &&
      kpi.serviceLevel != null &&
      kpi.serviceLevel + 1e-9 < queue.slaTargetPercent
    ) {
      const gap = queue.slaTargetPercent - kpi.serviceLevel;
      alerts.push({
        id: `sl:${queue.id}`,
        severity: gap >= 10 ? "critical" : "warning",
        queueId: queue.id,
        kind: "service-level",
        message: `${queue.name} service level is ${kpi.serviceLevel.toFixed(1)}%, under the ${queue.slaTargetPercent}% target for answers within ${queue.slaThresholdSeconds}s.`,
        at: now.toISOString(),
      });
    }

    if (enough && kpi.abandonRate != null && kpi.abandonRate > policy.maxAbandonPercent) {
      alerts.push({
        id: `abn:${queue.id}`,
        severity: kpi.abandonRate >= policy.maxAbandonPercent + 5 ? "critical" : "warning",
        queueId: queue.id,
        kind: "abandon-rate",
        message: `${queue.name} abandon rate is ${kpi.abandonRate.toFixed(1)}%. The limit is ${policy.maxAbandonPercent}%.`,
        at: now.toISOString(),
      });
    }

    if (queue.waiting.length > 0 && kpi.longestWaitSeconds >= policy.maxWaitSeconds) {
      alerts.push({
        id: `wait:${queue.id}`,
        severity: kpi.longestWaitSeconds >= policy.maxWaitSeconds * 2 ? "critical" : "warning",
        queueId: queue.id,
        kind: "longest-wait",
        message: `${queue.name} has a caller waiting longer than ${policy.maxWaitSeconds}s.`,
        at: now.toISOString(),
      });
    }
  }

  const rank = { critical: 0, warning: 1 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.queueId.localeCompare(b.queueId));
  return alerts;
}

export function queueSla(
  queueId: string,
  policy: SlaPolicy,
  existing?: Queue,
): { targetPercent: number; thresholdSeconds: number } {
  const over = policy.overrides[queueId.toLowerCase()];
  return {
    targetPercent: over?.targetPercent ?? existing?.slaTargetPercent ?? policy.defaultTargetPercent,
    thresholdSeconds:
      over?.thresholdSeconds ?? existing?.slaThresholdSeconds ?? policy.defaultThresholdSeconds,
  };
}
