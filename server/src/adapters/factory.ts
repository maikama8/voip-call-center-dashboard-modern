import type { AppConfig } from "../config.js";
import { AmiAdapter, type AdapterLog } from "./ami/client.js";
import { SimulatedAdapter } from "./simulated/adapter.js";
import type { DataSourceAdapter } from "./types.js";

export function createAdapter(config: AppConfig, log: AdapterLog): DataSourceAdapter {
  if (config.dataSource === "ami") {
    return new AmiAdapter(
      {
        host: config.amiHost,
        port: config.amiPort,
        username: config.amiUsername,
        secret: config.amiSecret,
        reconnectMs: config.amiReconnectMs,
        wrapupSeconds: config.amiWrapupSeconds,
        timeZone: config.timezone,
        policy: config.sla,
      },
      log,
    );
  }
  return new SimulatedAdapter({
    seed: config.simSeed,
    tickMs: config.simTickMs,
    timeZone: config.timezone,
    policy: config.sla,
  });
}
