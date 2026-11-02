import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { createAdapter } from "./adapters/factory.js";
import type { AppConfig } from "./config.js";
import { Wallboard } from "./hub.js";

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  const hub = new Wallboard(config);
  const adapter = createAdapter(config, {
    info: (msg) => app.log.info(msg),
    warn: (msg) => app.log.warn(msg),
    error: (msg) => app.log.error(msg),
    debug: (msg) => app.log.debug(msg),
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/api/health", async () => ({
    status: "ok",
    source: config.dataSource,
    timezone: config.timezone,
    agents: hub.agentCount,
    queues: hub.queueCount,
    activeCalls: hub.callCount,
    alerts: hub.alertCount,
  }));

  app.get("/api/snapshot", async () => hub.snapshot());

  app.get("/ws", { websocket: true }, (socket) => {
    hub.add(socket);
    socket.on("close", () => hub.remove(socket));
    socket.on("error", () => hub.remove(socket));
  });

  if (config.webDist) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api") || request.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await adapter.start((event) => hub.apply(event));
  app.addHook("onClose", async () => {
    await adapter.stop();
  });

  return app;
}
