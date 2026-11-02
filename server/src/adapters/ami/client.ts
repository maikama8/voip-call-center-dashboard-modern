import net from "node:net";
import { emptyState, reduce, type ReduceContext } from "../../domain/reducer.js";
import type { CenterEvent, CenterState, SlaPolicy } from "../../domain/types.js";
import type { DataSourceAdapter } from "../types.js";
import { completeAgentId, mapAmiMessage } from "./map.js";
import { consumeAmiBuffer, type AmiMessage } from "./parser.js";

export interface AdapterLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface AmiOptions {
  host: string;
  port: number;
  username: string;
  secret: string;
  reconnectMs: number;
  wrapupSeconds: number;
  timeZone: string;
  policy: SlaPolicy;
}

const noopLog: AdapterLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Asterisk Manager client. It logs in, asks for QueueStatus, emits one
 * snapshot, then forwards queue, agent, and channel events. It never
 * sends Originate, Hangup, or Command.
 */
export class AmiAdapter implements DataSourceAdapter {
  readonly name = "ami";
  private socket: net.Socket | null = null;
  private buffer = "";
  private emit: (event: CenterEvent) => void = () => {};
  private stopped = false;
  private loggedIn = false;
  private syncing = false;
  private ready = false;
  private scratch: CenterState | null = null;
  private backlog: AmiMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private wrapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ctx: ReduceContext;

  constructor(
    private readonly options: AmiOptions,
    private readonly log: AdapterLog = noopLog,
  ) {
    this.ctx = { timeZone: options.timeZone, policy: options.policy };
  }

  async start(emit: (event: CenterEvent) => void): Promise<void> {
    this.emit = emit;
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    this.socket?.destroy();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    this.loggedIn = false;
    this.syncing = false;
    this.ready = false;
    this.buffer = "";
    this.scratch = null;
    this.backlog = [];
    const socket = net.connect({ host: this.options.host, port: this.options.port });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      this.log.info(`AMI connected to ${this.options.host}:${this.options.port}`);
      this.sendLogin();
    });
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (error: Error) => {
      this.log.warn(`AMI socket error: ${error.message}`);
    });
    socket.on("close", () => {
      this.log.warn("AMI socket closed");
      this.socket = null;
      this.clearLiveTimers();
      this.scheduleReconnect();
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const { messages, rest } = consumeAmiBuffer(this.buffer);
    this.buffer = rest;
    for (const message of messages) this.onMessage(message);
  }

  private onMessage(message: AmiMessage): void {
    if (message.kind === "response") {
      this.onResponse(message);
      return;
    }
    if (message.kind !== "event") return;
    const eventName = message.fields.Event ?? "";
    if (!this.loggedIn) return;
    if (eventName === "QueueStatusComplete") {
      this.finishSync();
      return;
    }
    if (this.syncing && !this.ready) {
      if (isSyncEvent(eventName)) this.applyScratch(message);
      else this.backlog.push(message);
      return;
    }
    if (this.ready) this.applyLive(message);
  }

  private onResponse(message: AmiMessage): void {
    const response = message.fields.Response;
    const text = message.fields.Message ?? "";
    if (!this.loggedIn) {
      if (response === "Success") {
        this.loggedIn = true;
        this.log.info(`AMI login accepted for ${this.options.username}`);
        this.beginSync();
        return;
      }
      if (response === "Error") {
        this.log.error(`AMI login failed: ${text}`);
        this.socket?.destroy();
      }
      return;
    }
    if (response === "Error") this.log.warn(`AMI action failed: ${text}`);
  }

  private sendLogin(): void {
    this.send(
      [
        "Action: Login",
        `Username: ${this.options.username}`,
        `Secret: ${this.options.secret}`,
        "Events: on",
        "",
        "",
      ].join("\r\n"),
    );
  }

  private beginSync(): void {
    this.syncing = true;
    this.scratch = emptyState("ami", this.options.timeZone, new Date().toISOString());
    this.send(["Action: QueueStatus", "ActionID: callboard-status", "", ""].join("\r\n"));
    this.syncTimer = setTimeout(() => {
      if (this.syncing && !this.ready) {
        this.log.warn("AMI QueueStatus did not complete; continuing with a partial snapshot");
        this.finishSync();
      }
    }, 5000);
    this.pingTimer = setInterval(() => {
      this.send(["Action: Ping", "ActionID: callboard-ping", "", ""].join("\r\n"));
    }, 20_000);
  }

  private finishSync(): void {
    if (this.ready) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.syncing = false;
    this.ready = true;
    const now = new Date().toISOString();
    const state = this.scratch ?? emptyState("ami", this.options.timeZone, now);
    this.scratch = null;
    this.emit({ type: "snapshot", at: now, state: { ...state, updatedAt: now } });
    const queued = this.backlog;
    this.backlog = [];
    for (const message of queued) this.applyLive(message);
  }

  private applyScratch(message: AmiMessage): void {
    if (!this.scratch) return;
    const event = mapAmiMessage(message, new Date().toISOString());
    if (!event) return;
    this.scratch = reduce(this.scratch, event, this.ctx);
  }

  private applyLive(message: AmiMessage): void {
    const at = new Date().toISOString();
    const event = mapAmiMessage(message, at);
    if (!event) return;
    this.log.debug(`AMI ${message.fields.Event ?? "event"}`);
    this.emit(event);
    if (message.fields.Event === "AgentComplete" && event.type === "call.hangup") {
      this.scheduleWrap(event.callId, completeAgentId(message.fields));
    }
  }

  private scheduleWrap(callId: string, agentId: string | null): void {
    if (!agentId) return;
    const seconds = this.options.wrapupSeconds;
    const fire = () => {
      this.wrapTimers.delete(callId);
      this.emit({
        type: "call.wrapup.end",
        at: new Date().toISOString(),
        agentId,
        callId,
        wrapSeconds: seconds,
      });
    };
    if (seconds <= 0) {
      fire();
      return;
    }
    const timer = setTimeout(fire, seconds * 1000);
    this.wrapTimers.set(callId, timer);
  }

  private send(payload: string): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(payload);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.ready = false;
    this.loggedIn = false;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectMs);
  }

  private clearLiveTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.pingTimer = null;
    this.syncTimer = null;
    for (const timer of this.wrapTimers.values()) clearTimeout(timer);
    this.wrapTimers.clear();
  }

  private clearTimers(): void {
    this.clearLiveTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

function isSyncEvent(name: string): boolean {
  return name === "QueueParams" || name === "QueueMember" || name === "QueueEntry";
}
