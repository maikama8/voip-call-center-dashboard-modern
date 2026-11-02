export type DataSourceName = "simulated" | "ami";

export type AgentStatus = "available" | "on-call" | "paused" | "wrap-up" | "offline";

export type CallDirection = "inbound" | "outbound" | "internal";

export type ActiveCallState = "queued" | "talking" | "wrap-up";

export interface WaitingCaller {
  id: string;
  queueId: string;
  callerNumber: string;
  callerName: string;
  joinedAt: string;
  position: number;
}

export interface PbxCounters {
  completed: number;
  abandoned: number;
  /** Asterisk QueueParams ServicelevelPerf, since the queue was loaded. */
  serviceLevelPerf: number | null;
  holdTimeSeconds: number | null;
  talkTimeSeconds: number | null;
  waitingCalls: number | null;
}

export interface Queue {
  id: string;
  name: string;
  extension: string;
  strategy: string;
  slaTargetPercent: number;
  slaThresholdSeconds: number;
  waiting: WaitingCaller[];
  pbx: PbxCounters | null;
}

export interface Agent {
  id: string;
  name: string;
  extension: string;
  status: AgentStatus;
  pauseReason: string | null;
  /** AMI pause while the device is still in use. Applied when wrap-up ends. */
  pauseAfterCall: boolean;
  queues: string[];
  callId: string | null;
  /** Calls this process has seen answered. */
  callsHandled: number;
  talkSeconds: number;
  wrapSeconds: number;
  /** QueueMember CallsTaken, when AMI sent it. Not mixed into callsHandled. */
  pbxCallsTaken: number | null;
  loggedInAt: string | null;
  statusSince: string;
}

export interface ActiveCall {
  id: string;
  queueId: string;
  agentId: string | null;
  callerNumber: string;
  callerName: string;
  direction: CallDirection;
  state: ActiveCallState;
  startedAt: string;
  queueJoinedAt: string | null;
  answeredAt: string | null;
  wrapStartedAt: string | null;
  /** Frozen talk time once the call leaves the talking state. */
  talkSeconds: number | null;
}

export interface CallOutcome {
  id: string;
  queueId: string;
  agentId: string | null;
  disposition: "answered" | "abandoned";
  waitSeconds: number;
  talkSeconds: number;
  wrapSeconds: number;
  wrapComplete: boolean;
  offeredAt: string;
}

export type AlertKind = "service-level" | "abandon-rate" | "longest-wait";

export interface Alert {
  id: string;
  severity: "warning" | "critical";
  queueId: string;
  kind: AlertKind;
  message: string;
  at: string;
}

export interface CenterState {
  source: DataSourceName;
  timezone: string;
  /** YYYY-MM-DD in the configured timezone. Outcomes belong to this day. */
  statsDate: string;
  agents: Agent[];
  queues: Queue[];
  calls: ActiveCall[];
  outcomes: CallOutcome[];
  alerts: Alert[];
  updatedAt: string;
}

export interface SlaOverride {
  targetPercent: number;
  thresholdSeconds: number;
}

export interface SlaPolicy {
  defaultTargetPercent: number;
  defaultThresholdSeconds: number;
  shortAbandonSeconds: number;
  minOfferedForAlert: number;
  maxAbandonPercent: number;
  maxWaitSeconds: number;
  overrides: Record<string, SlaOverride>;
}

export interface QueueDraft {
  id: string;
  name?: string;
  extension?: string;
  strategy?: string;
  slaTargetPercent?: number;
  slaThresholdSeconds?: number;
  pbx?: PbxCounters | null;
}

export interface AgentUpsert {
  id: string;
  name: string;
  extension: string;
  queues: string[];
  status: AgentStatus;
  pauseReason: string | null;
  pauseAfterCall: boolean;
  pbxCallsTaken: number | null;
}

export type CenterEvent =
  | { type: "snapshot"; at: string; state: CenterState }
  | { type: "queue.upsert"; at: string; queue: QueueDraft }
  | { type: "agent.upsert"; at: string; agent: AgentUpsert }
  | { type: "agent.logout"; at: string; agentId: string }
  | { type: "agent.queue-removed"; at: string; agentId: string; queueId: string }
  | {
      type: "agent.pause";
      at: string;
      agentId: string;
      paused: boolean;
      reason: string | null;
    }
  | {
      type: "agent.status";
      at: string;
      agentId: string;
      status: AgentStatus;
      pauseReason: string | null;
      pauseAfterCall: boolean;
    }
  | {
      type: "caller.join";
      at: string;
      queueId: string;
      callId: string;
      callerNumber: string;
      callerName: string;
      /** Set when AMI already reports a wait (QueueEntry Wait). */
      alreadyWaitingSeconds?: number;
    }
  | {
      type: "caller.abandon";
      at: string;
      queueId: string;
      callId: string;
      waitSeconds: number;
    }
  | {
      type: "caller.leave";
      at: string;
      queueId: string;
      callId: string;
    }
  | {
      type: "call.answered";
      at: string;
      queueId: string;
      callId: string;
      agentId: string;
      agentName?: string;
      agentExtension?: string;
      callerNumber: string;
      callerName: string;
      waitSeconds: number;
    }
  | { type: "call.hangup"; at: string; callId: string; talkSeconds: number }
  | {
      type: "call.wrapup.end";
      at: string;
      agentId: string;
      callId: string;
      wrapSeconds: number;
    };

export interface HourBucket {
  hour: number;
  offered: number;
  answered: number;
  abandoned: number;
}

export interface KpiSummary {
  offered: number;
  answered: number;
  abandoned: number;
  /** Denominator of the service-level ratio. Short abandons are already removed. */
  serviceLevelSample: number;
  serviceLevel: number | null;
  asaSeconds: number | null;
  abandonRate: number | null;
  ahtSeconds: number | null;
  waiting: number;
  longestWaitSeconds: number;
  callsPerHour: HourBucket[];
}

export interface QueueKpi extends KpiSummary {
  queueId: string;
  slaTargetPercent: number;
  slaThresholdSeconds: number;
}

export interface WallboardRules {
  shortAbandonSeconds: number;
  maxWaitSeconds: number;
  maxAbandonPercent: number;
  minOfferedForAlert: number;
}

export interface WallboardSnapshot {
  type: "snapshot";
  serverTime: string;
  source: DataSourceName;
  timezone: string;
  statsDate: string;
  /** "Today" for the simulated day, "Since connect" for AMI. */
  statsLabel: string;
  updatedAt: string;
  agents: Agent[];
  queues: Queue[];
  calls: ActiveCall[];
  kpis: {
    overall: KpiSummary;
    byQueue: QueueKpi[];
  };
  alerts: Alert[];
  rules: WallboardRules;
}
