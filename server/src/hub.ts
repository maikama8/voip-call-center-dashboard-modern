import type { AppConfig } from "./config.js";
import { emptyState, reduce, type ReduceContext } from "./domain/reducer.js";
import type { CenterEvent, CenterState } from "./domain/types.js";
import { projectSnapshot } from "./snapshot.js";

interface LiveSocket {
  send(data: string): void;
  on(event: "close" | "error", listener: () => void): void;
  readyState: number;
}

export class Wallboard {
  private state: CenterState;
  private readonly sockets = new Set<LiveSocket>();
  private readonly ctx: ReduceContext;

  constructor(private readonly config: AppConfig) {
    const at = new Date().toISOString();
    this.ctx = { timeZone: config.timezone, policy: config.sla };
    this.state = emptyState(config.dataSource, config.timezone, at);
  }

  apply(event: CenterEvent): void {
    this.state = reduce(this.state, event, this.ctx);
    this.broadcast();
  }

  snapshot(now = new Date()) {
    return projectSnapshot(this.state, now, this.config.sla);
  }

  add(socket: LiveSocket): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify(this.snapshot()));
  }

  remove(socket: LiveSocket): void {
    this.sockets.delete(socket);
  }

  get agentCount(): number {
    return this.state.agents.length;
  }

  get queueCount(): number {
    return this.state.queues.length;
  }

  get callCount(): number {
    return this.state.calls.length;
  }

  get alertCount(): number {
    return this.state.alerts.length;
  }

  private broadcast(): void {
    const payload = JSON.stringify(this.snapshot());
    for (const socket of this.sockets) {
      if (socket.readyState !== 1) {
        this.sockets.delete(socket);
        continue;
      }
      socket.send(payload);
    }
  }
}
