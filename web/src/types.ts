export type AgentStatus = "available" | "on-call" | "paused" | "wrap-up" | "offline";

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
  pauseAfterCall: boolean;
  queues: string[];
  callId: string | null;
  callsHandled: number;
  talkSeconds: number;
  wrapSeconds: number;
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
  direction: "inbound" | "outbound" | "internal";
  state: "queued" | "talking" | "wrap-up";
  startedAt: string;
  queueJoinedAt: string | null;
  answeredAt: string | null;
  wrapStartedAt: string | null;
  talkSeconds: number | null;
}

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

export interface Alert {
  id: string;
  severity: "warning" | "critical";
  queueId: string;
  kind: "service-level" | "abandon-rate" | "longest-wait";
  message: string;
  at: string;
}

export interface WallboardSnapshot {
  type: "snapshot";
  serverTime: string;
  source: "simulated" | "ami";
  timezone: string;
  statsDate: string;
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
  rules: {
    shortAbandonSeconds: number;
    maxWaitSeconds: number;
    maxAbandonPercent: number;
    minOfferedForAlert: number;
  };
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting";
