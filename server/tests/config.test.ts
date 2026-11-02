import { describe, expect, it } from "vitest";
import { parseQueueSla } from "../src/config.js";

describe("QUEUE_SLA", () => {
  it("parses name, target, and threshold", () => {
    expect(parseQueueSla("sales:80:20, VIP:95:10")).toEqual({
      sales: { targetPercent: 80, thresholdSeconds: 20 },
      vip: { targetPercent: 95, thresholdSeconds: 10 },
    });
  });

  it("rejects a broken entry", () => {
    expect(() => parseQueueSla("support")).toThrow(/support:80:20/);
    expect(() => parseQueueSla("support:120:20")).toThrow(/out of range/);
  });

  it("is empty when unset", () => {
    expect(parseQueueSla(undefined)).toEqual({});
    expect(parseQueueSla("  ")).toEqual({});
  });
});
