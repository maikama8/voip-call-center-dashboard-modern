import type { CallOutcome, HourBucket, KpiSummary, WaitingCaller } from "./types.js";
import { zonedParts } from "./time.js";

export interface SummarizeOptions {
  now: Date;
  timeZone: string;
  shortAbandonSeconds: number;
  thresholdSecondsFor: (queueId: string) => number;
}

export function summarize(
  outcomes: readonly CallOutcome[],
  waiting: readonly WaitingCaller[],
  options: SummarizeOptions,
): KpiSummary {
  const answered = outcomes.filter((o) => o.disposition === "answered");
  const abandoned = outcomes.filter((o) => o.disposition === "abandoned");
  const shortAbandons = abandoned.filter((o) => o.waitSeconds < options.shortAbandonSeconds);
  const within = answered.filter(
    (o) => o.waitSeconds <= options.thresholdSecondsFor(o.queueId),
  );
  const offered = answered.length + abandoned.length;
  const serviceLevelSample = offered - shortAbandons.length;

  const serviceLevel =
    serviceLevelSample > 0 ? (within.length / serviceLevelSample) * 100 : null;
  const asaSeconds =
    answered.length > 0
      ? answered.reduce((sum, o) => sum + o.waitSeconds, 0) / answered.length
      : null;
  const abandonRate = offered > 0 ? (abandoned.length / offered) * 100 : null;
  const handled = answered.filter((o) => o.wrapComplete);
  const ahtSeconds =
    handled.length > 0
      ? handled.reduce((sum, o) => sum + o.talkSeconds + o.wrapSeconds, 0) / handled.length
      : null;

  return {
    offered,
    answered: answered.length,
    abandoned: abandoned.length,
    serviceLevelSample,
    serviceLevel,
    asaSeconds,
    abandonRate,
    ahtSeconds,
    waiting: waiting.length,
    longestWaitSeconds: longestWait(waiting, options.now),
    callsPerHour: callsPerHour(outcomes, options.timeZone),
  };
}

export function longestWait(waiting: readonly WaitingCaller[], now: Date): number {
  let longest = 0;
  for (const caller of waiting) {
    const seconds = Math.floor((now.getTime() - Date.parse(caller.joinedAt)) / 1000);
    if (Number.isFinite(seconds) && seconds > longest) longest = seconds;
  }
  return Math.max(0, longest);
}

export function callsPerHour(outcomes: readonly CallOutcome[], timeZone: string): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    offered: 0,
    answered: 0,
    abandoned: 0,
  }));
  for (const outcome of outcomes) {
    const when = new Date(outcome.offeredAt);
    if (Number.isNaN(when.getTime())) continue;
    const bucket = buckets[zonedParts(when, timeZone).hour];
    if (!bucket) continue;
    bucket.offered += 1;
    if (outcome.disposition === "answered") bucket.answered += 1;
    else bucket.abandoned += 1;
  }
  return buckets;
}
