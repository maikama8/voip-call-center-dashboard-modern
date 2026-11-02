import type { AmiMessage } from "./parser.js";
import type { AgentStatus, CenterEvent, PbxCounters } from "../../domain/types.js";

export interface MappedInterface {
  id: string;
  extension: string;
}

/**
 * Collapse a channel or queue-member interface to a stable agent id.
 * `PJSIP/1001-0000001a` and `Local/1001@from-queue/n` both become the
 * endpoint, not the per-call leg.
 */
export function interfaceIdentity(value: string): MappedInterface {
  const trimmed = value.trim();
  const local = trimmed.match(/^(Local\/(\d+)@[^/\s]+)/i);
  if (local?.[1] && local[2]) return { id: local[1], extension: local[2] };
  const tech = trimmed.match(/^((?:PJSIP|SIP|IAX2|DAHDI)\/(\d+))/i);
  if (tech?.[1] && tech[2]) return { id: tech[1], extension: tech[2] };
  const digits = trimmed.match(/(\d{2,6})/);
  return { id: trimmed || "unknown", extension: digits?.[1] ?? trimmed };
}

/**
 * Asterisk device status on QueueMember / QueueMemberStatus.
 * 1 not in use, 2 in use, 3 busy, 4 invalid, 5 unavailable,
 * 6 ringing, 7 ring+inuse, 8 on hold.
 */
export function memberStatus(statusCode: number, paused: boolean): AgentStatus {
  const inUse = statusCode === 2 || statusCode === 3 || statusCode === 7 || statusCode === 8;
  if (inUse) return "on-call";
  if (paused) return "paused";
  if (statusCode === 1 || statusCode === 6) return "available";
  return "offline";
}

export function mapAmiMessage(message: AmiMessage, at: string): CenterEvent | null {
  if (message.kind !== "event") return null;
  const name = message.fields.Event;
  const fields = message.fields;
  switch (name) {
    case "QueueParams":
      return mapQueueParams(fields, at);
    case "QueueMember":
    case "QueueMemberStatus":
      return mapMember(fields, at);
    case "QueueMemberPause":
      return mapPause(fields, at);
    case "QueueMemberRemoved":
      return mapRemoved(fields, at);
    case "QueueEntry":
      return mapEntry(fields, at);
    case "QueueCallerJoin":
      return mapJoin(fields, at);
    case "QueueCallerAbandon":
      return mapAbandon(fields, at);
    case "QueueCallerLeave":
      return mapLeave(fields, at);
    case "AgentConnect":
      return mapConnect(fields, at);
    case "AgentComplete":
      return mapComplete(fields, at);
    case "Hangup":
      return mapHangup(fields, at);
    default:
      return null;
  }
}

function mapQueueParams(fields: Record<string, string>, at: string): CenterEvent | null {
  const id = fields.Queue;
  if (!id) return null;
  const pbx: PbxCounters = {
    completed: numberField(fields.Completed) ?? 0,
    abandoned: numberField(fields.Abandoned) ?? 0,
    serviceLevelPerf: numberField(fields.ServicelevelPerf),
    holdTimeSeconds: numberField(fields.Holdtime),
    talkTimeSeconds: numberField(fields.TalkTime),
    waitingCalls: numberField(fields.Calls),
  };
  const threshold = numberField(fields.ServiceLevel);
  return {
    type: "queue.upsert",
    at,
    queue: {
      id,
      name: id,
      extension: id,
      strategy: fields.Strategy || "ringall",
      ...(threshold != null ? { slaThresholdSeconds: threshold } : {}),
      pbx,
    },
  };
}

function mapMember(fields: Record<string, string>, at: string): CenterEvent | null {
  const queueId = fields.Queue;
  const iface = fields.Location || fields.Interface || fields.StateInterface;
  if (!queueId || !iface) return null;
  const identity = interfaceIdentity(iface);
  const code = numberField(fields.Status) ?? 0;
  const paused = fields.Paused === "1";
  const status = memberStatus(code, paused);
  return {
    type: "agent.upsert",
    at,
    agent: {
      id: identity.id,
      name: cleanName(fields.Name || fields.MemberName) || identity.extension,
      extension: identity.extension,
      queues: [queueId],
      status,
      pauseReason: paused ? cleanReason(fields.PausedReason) : null,
      pauseAfterCall: paused && status === "on-call",
      pbxCallsTaken: numberField(fields.CallsTaken),
    },
  };
}

function mapPause(fields: Record<string, string>, at: string): CenterEvent | null {
  const iface = fields.Interface || fields.Location;
  if (!iface) return null;
  const identity = interfaceIdentity(iface);
  const paused = fields.Paused === "1";
  return {
    type: "agent.pause",
    at,
    agentId: identity.id,
    paused,
    reason: paused ? cleanReason(fields.PausedReason) : null,
  };
}

function mapRemoved(fields: Record<string, string>, at: string): CenterEvent | null {
  const iface = fields.Interface || fields.Location;
  const queueId = fields.Queue;
  if (!iface || !queueId) return null;
  return {
    type: "agent.queue-removed",
    at,
    agentId: interfaceIdentity(iface).id,
    queueId,
  };
}

function mapEntry(fields: Record<string, string>, at: string): CenterEvent | null {
  const queueId = fields.Queue;
  const callId = fields.Uniqueid;
  if (!queueId || !callId) return null;
  return {
    type: "caller.join",
    at,
    queueId,
    callId,
    callerNumber: fields.CallerIDNum || "",
    callerName: fields.CallerIDName || "",
    alreadyWaitingSeconds: numberField(fields.Wait) ?? 0,
  };
}

function mapJoin(fields: Record<string, string>, at: string): CenterEvent | null {
  const queueId = fields.Queue;
  const callId = fields.Uniqueid;
  if (!queueId || !callId) return null;
  return {
    type: "caller.join",
    at,
    queueId,
    callId,
    callerNumber: fields.CallerIDNum || "",
    callerName: fields.CallerIDName || "",
  };
}

function mapAbandon(fields: Record<string, string>, at: string): CenterEvent | null {
  const queueId = fields.Queue;
  const callId = fields.Uniqueid;
  if (!queueId || !callId) return null;
  return {
    type: "caller.abandon",
    at,
    queueId,
    callId,
    waitSeconds: numberField(fields.HoldTime) ?? 0,
  };
}

function mapLeave(fields: Record<string, string>, at: string): CenterEvent | null {
  const queueId = fields.Queue;
  const callId = fields.Uniqueid;
  if (!queueId || !callId) return null;
  return { type: "caller.leave", at, queueId, callId };
}

function mapConnect(fields: Record<string, string>, at: string): CenterEvent | null {
  const queueId = fields.Queue;
  const callId = fields.Uniqueid;
  const iface = fields.Interface || fields.Member;
  if (!queueId || !callId || !iface) return null;
  const identity = interfaceIdentity(iface);
  return {
    type: "call.answered",
    at,
    queueId,
    callId,
    agentId: identity.id,
    agentName: cleanName(fields.MemberName),
    agentExtension: identity.extension,
    callerNumber: fields.CallerIDNum || "",
    callerName: fields.CallerIDName || "",
    waitSeconds: numberField(fields.HoldTime) ?? 0,
  };
}

function mapComplete(fields: Record<string, string>, at: string): CenterEvent | null {
  const callId = fields.Uniqueid;
  if (!callId) return null;
  return {
    type: "call.hangup",
    at,
    callId,
    talkSeconds: numberField(fields.TalkTime) ?? 0,
  };
}

function mapHangup(fields: Record<string, string>, at: string): CenterEvent | null {
  const callId = fields.Uniqueid;
  if (!callId) return null;
  return { type: "call.hangup", at, callId, talkSeconds: -1 };
}

function numberField(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanName(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === "unknown") return "";
  return trimmed;
}

function cleanReason(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/** Agent interface carried on AgentComplete, so wrap-up can be closed. */
export function completeAgentId(fields: Record<string, string>): string | null {
  const iface = fields.Interface || fields.Member;
  if (!iface) return null;
  return interfaceIdentity(iface).id;
}
