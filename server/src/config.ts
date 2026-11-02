import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTimeZone } from "./domain/time.js";
import type { DataSourceName, SlaOverride, SlaPolicy } from "./domain/types.js";

export interface AppConfig {
  host: string;
  port: number;
  dataSource: DataSourceName;
  timezone: string;
  logLevel: string;
  webDist: string | null;
  simTickMs: number;
  simSeed: number;
  amiHost: string;
  amiPort: number;
  amiUsername: string;
  amiSecret: string;
  amiReconnectMs: number;
  amiWrapupSeconds: number;
  sla: SlaPolicy;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadEnvFile();
  const dataSource = readSource(env.DATA_SOURCE);
  const timezone = env.TIMEZONE?.trim() || "UTC";
  try {
    assertTimeZone(timezone);
  } catch {
    throw new Error(`TIMEZONE "${timezone}" is not a valid IANA timezone`);
  }
  const sla = {
    defaultTargetPercent: 80,
    defaultThresholdSeconds: 20,
    shortAbandonSeconds: readNumber(env.SHORT_ABANDON_SECONDS, 5),
    minOfferedForAlert: readNumber(env.SLA_MIN_OFFERED, 15),
    maxAbandonPercent: readNumber(env.MAX_ABANDON_PERCENT, 8),
    maxWaitSeconds: readNumber(env.MAX_WAIT_SECONDS, 60),
    overrides: parseQueueSla(env.QUEUE_SLA),
  };
  if (dataSource === "ami" && !env.AMI_SECRET?.trim()) {
    throw new Error("DATA_SOURCE=ami requires AMI_SECRET");
  }
  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: readNumber(env.PORT, 8080),
    dataSource,
    timezone,
    logLevel: env.LOG_LEVEL?.trim() || "info",
    webDist: resolveWebDist(env.WEB_DIST),
    simTickMs: Math.max(200, readNumber(env.SIM_TICK_MS, 1500)),
    simSeed: readNumber(env.SIM_SEED, 20261102),
    amiHost: env.AMI_HOST?.trim() || "127.0.0.1",
    amiPort: readNumber(env.AMI_PORT, 5038),
    amiUsername: env.AMI_USERNAME?.trim() || "callboard",
    amiSecret: env.AMI_SECRET?.trim() || "",
    amiReconnectMs: Math.max(1000, readNumber(env.AMI_RECONNECT_MS, 5000)),
    amiWrapupSeconds: Math.max(0, readNumber(env.AMI_WRAPUP_SECONDS, 0)),
    sla,
  };
}

export function parseQueueSla(raw: string | undefined): Record<string, SlaOverride> {
  const overrides: Record<string, SlaOverride> = {};
  if (!raw?.trim()) return overrides;
  for (const part of raw.split(",")) {
    const bits = part.trim().split(":");
    if (bits.length !== 3) {
      throw new Error(`QUEUE_SLA entry "${part.trim()}" must look like support:80:20`);
    }
    const [name, target, threshold] = bits;
    const targetPercent = Number(target);
    const thresholdSeconds = Number(threshold);
    if (!name?.trim() || !Number.isFinite(targetPercent) || !Number.isFinite(thresholdSeconds)) {
      throw new Error(`QUEUE_SLA entry "${part.trim()}" is not valid`);
    }
    if (targetPercent < 0 || targetPercent > 100 || thresholdSeconds < 0) {
      throw new Error(`QUEUE_SLA entry "${part.trim()}" is out of range`);
    }
    overrides[name.trim().toLowerCase()] = { targetPercent, thresholdSeconds };
  }
  return overrides;
}

function readSource(raw: string | undefined): DataSourceName {
  const value = (raw?.trim() || "simulated").toLowerCase();
  if (value === "simulated" || value === "ami") return value;
  throw new Error(`DATA_SOURCE must be "simulated" or "ami" (got "${raw}")`);
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Expected a number, got "${raw}"`);
  return value;
}

function resolveWebDist(explicit: string | undefined): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    explicit?.trim(),
    path.resolve(process.cwd(), "web/dist"),
    path.resolve(here, "../../web/dist"),
    path.resolve(here, "../web/dist"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

function loadEnvFile(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(here, "../../.env"),
    path.resolve(here, "../.env"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const text = readFileSync(candidate, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}
