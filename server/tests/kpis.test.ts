import { describe, expect, it } from "vitest";
import { summarize } from "../src/domain/kpis.js";
import { statsDate, zonedParts, zonedTimeToUtc } from "../src/domain/time.js";
import type { CallOutcome, WaitingCaller } from "../src/domain/types.js";

const NOW = new Date("2026-11-02T15:30:00.000Z");

function outcome(partial: Partial<CallOutcome> & Pick<CallOutcome, "id" | "disposition" | "waitSeconds">): CallOutcome {
  return {
    queueId: "support",
    agentId: partial.disposition === "answered" ? "1003" : null,
    talkSeconds: partial.disposition === "answered" ? 120 : 0,
    wrapSeconds: partial.disposition === "answered" ? 30 : 0,
    wrapComplete: true,
    offeredAt: "2026-11-02T15:00:00.000Z",
    ...partial,
  };
}

function waiting(id: string, joinedAt: string): WaitingCaller {
  return { id, queueId: "support", callerNumber: "0803", callerName: "Ada", joinedAt, position: 1 };
}

function summarizeOf(outcomes: CallOutcome[], callers: WaitingCaller[] = []) {
  return summarize(outcomes, callers, {
    now: NOW,
    timeZone: "UTC",
    shortAbandonSeconds: 5,
    thresholdSecondsFor: (queueId) => (queueId === "billing" ? 15 : 20),
  });
}

describe("KPI calculations", () => {
  it("returns null rates when nothing has been offered", () => {
    const kpi = summarizeOf([]);
    expect(kpi.offered).toBe(0);
    expect(kpi.serviceLevel).toBeNull();
    expect(kpi.asaSeconds).toBeNull();
    expect(kpi.abandonRate).toBeNull();
    expect(kpi.ahtSeconds).toBeNull();
    expect(kpi.longestWaitSeconds).toBe(0);
    expect(kpi.callsPerHour).toHaveLength(24);
    expect(kpi.callsPerHour.every((bucket) => bucket.offered === 0)).toBe(true);
  });

  it("counts service level as answers inside the threshold over offered, minus short abandons", () => {
    const kpi = summarizeOf([
      outcome({ id: "a1", disposition: "answered", waitSeconds: 10 }),
      outcome({ id: "a2", disposition: "answered", waitSeconds: 20 }),
      outcome({ id: "a3", disposition: "answered", waitSeconds: 21 }),
      outcome({ id: "b1", disposition: "abandoned", waitSeconds: 4 }),
      outcome({ id: "b2", disposition: "abandoned", waitSeconds: 40 }),
    ]);
    // Within threshold: 2. Offered 5. Short abandon removed from the denominator → 2/4.
    expect(kpi.answered).toBe(3);
    expect(kpi.abandoned).toBe(2);
    expect(kpi.offered).toBe(5);
    expect(kpi.serviceLevelSample).toBe(4);
    expect(kpi.serviceLevel).toBeCloseTo(50, 5);
    // Abandon rate keeps the short abandon.
    expect(kpi.abandonRate).toBeCloseTo(40, 5);
  });

  it("uses each queue's own threshold", () => {
    const kpi = summarizeOf([
      outcome({ id: "b", queueId: "billing", disposition: "answered", waitSeconds: 16 }),
      outcome({ id: "s", queueId: "support", disposition: "answered", waitSeconds: 16 }),
    ]);
    expect(kpi.serviceLevel).toBeCloseTo(50, 5);
  });

  it("averages speed of answer from answered calls only", () => {
    const kpi = summarizeOf([
      outcome({ id: "a1", disposition: "answered", waitSeconds: 10 }),
      outcome({ id: "a2", disposition: "answered", waitSeconds: 30 }),
      outcome({ id: "b1", disposition: "abandoned", waitSeconds: 80 }),
    ]);
    expect(kpi.asaSeconds).toBeCloseTo(20, 5);
  });

  it("averages handle time from talk plus wrap, and skips an open wrap-up", () => {
    const kpi = summarizeOf([
      outcome({ id: "done", disposition: "answered", waitSeconds: 5, talkSeconds: 100, wrapSeconds: 20, wrapComplete: true }),
      outcome({ id: "open", disposition: "answered", waitSeconds: 5, talkSeconds: 900, wrapSeconds: 0, wrapComplete: false }),
    ]);
    expect(kpi.ahtSeconds).toBeCloseTo(120, 5);
  });

  it("measures the oldest caller still waiting", () => {
    const kpi = summarizeOf(
      [],
      [waiting("w1", "2026-11-02T15:29:10.000Z"), waiting("w2", "2026-11-02T15:28:30.000Z")],
    );
    expect(kpi.waiting).toBe(2);
    expect(kpi.longestWaitSeconds).toBe(90);
  });

  it("buckets calls by the hour they were offered in the configured timezone", () => {
    const kpi = summarize(
      [
        outcome({ id: "utc", disposition: "answered", waitSeconds: 1, offeredAt: "2026-11-02T15:10:00.000Z" }),
        outcome({ id: "lagos", disposition: "abandoned", waitSeconds: 9, offeredAt: "2026-11-02T23:30:00.000Z" }),
      ],
      [],
      {
        now: NOW,
        timeZone: "Africa/Lagos",
        shortAbandonSeconds: 5,
        thresholdSecondsFor: () => 20,
      },
    );
    // 15:10Z is 16:10 in Lagos. 23:30Z is 00:30 the next calendar day, still hour 0.
    expect(kpi.callsPerHour[16]).toMatchObject({ offered: 1, answered: 1, abandoned: 0 });
    expect(kpi.callsPerHour[0]).toMatchObject({ offered: 1, answered: 0, abandoned: 1 });
    expect(kpi.callsPerHour[15]?.offered).toBe(0);
  });
});

describe("timezone helpers", () => {
  it("reads Lagos wall time and rounds a zoned clock back to UTC", () => {
    const instant = new Date("2026-11-02T23:30:00.000Z");
    expect(zonedParts(instant, "Africa/Lagos")).toMatchObject({ year: 2026, month: 11, day: 3, hour: 0, minute: 30 });
    expect(statsDate(instant, "Africa/Lagos")).toBe("2026-11-03");
    expect(statsDate(instant, "UTC")).toBe("2026-11-02");
    const back = zonedTimeToUtc(2026, 11, 3, 0, 30, 0, "Africa/Lagos");
    expect(back.toISOString()).toBe("2026-11-02T23:30:00.000Z");
  });
});
