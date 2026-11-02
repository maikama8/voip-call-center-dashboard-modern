import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { FastifyInstance } from "fastify";
import { testPolicy } from "./helpers.js";

function config(): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataSource: "simulated",
    timezone: "UTC",
    logLevel: "silent",
    webDist: null,
    simTickMs: 60_000,
    simSeed: 20261102,
    amiHost: "127.0.0.1",
    amiPort: 5038,
    amiUsername: "callboard",
    amiSecret: "",
    amiReconnectMs: 5000,
    amiWrapupSeconds: 0,
    sla: testPolicy(),
  };
}

describe("HTTP API", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("reports health and a snapshot from the simulated source", async () => {
    app = await buildApp(config());
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      source: "simulated",
      timezone: "UTC",
      agents: 12,
      queues: 4,
    });
    expect(health.json().alerts).toBeGreaterThan(0);

    const snapshot = await app.inject({ method: "GET", url: "/api/snapshot" });
    expect(snapshot.statusCode).toBe(200);
    const body = snapshot.json();
    expect(body.type).toBe("snapshot");
    expect(body.statsLabel).toBe("Today");
    expect(body.kpis.overall.offered).toBeGreaterThan(0);
    expect(body.kpis.byQueue).toHaveLength(4);
    expect(body.alerts.some((alert: { kind: string }) => alert.kind === "service-level")).toBe(true);
  });
});
