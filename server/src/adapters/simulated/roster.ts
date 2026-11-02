export interface RosterQueue {
  id: string;
  name: string;
  extension: string;
  strategy: string;
  slaTargetPercent: number;
  slaThresholdSeconds: number;
}

export interface RosterAgent {
  id: string;
  name: string;
  extension: string;
  queues: string[];
}

export interface HistorySpec {
  /** Wait of each answered call, seconds. */
  answeredWaits: number[];
  /** Wait of each abandoned call, seconds. */
  abandonedWaits: number[];
}

export const ROSTER_QUEUES: RosterQueue[] = [
  { id: "sales", name: "Sales", extension: "600", strategy: "rrmemory", slaTargetPercent: 80, slaThresholdSeconds: 20 },
  { id: "support", name: "Support", extension: "610", strategy: "leastrecent", slaTargetPercent: 80, slaThresholdSeconds: 20 },
  { id: "billing", name: "Billing", extension: "620", strategy: "fewestcalls", slaTargetPercent: 90, slaThresholdSeconds: 15 },
  { id: "vip", name: "VIP", extension: "630", strategy: "ringall", slaTargetPercent: 95, slaThresholdSeconds: 10 },
];

export const ROSTER_AGENTS: RosterAgent[] = [
  { id: "1001", name: "Amaka Okonkwo", extension: "1001", queues: ["sales"] },
  { id: "1002", name: "Chinedu Adeyemi", extension: "1002", queues: ["sales"] },
  { id: "1003", name: "Fatima Bello", extension: "1003", queues: ["support"] },
  { id: "1004", name: "Ibrahim Lawal", extension: "1004", queues: ["support"] },
  { id: "1005", name: "Ngozi Eze", extension: "1005", queues: ["support"] },
  { id: "1006", name: "Tunde Bakare", extension: "1006", queues: ["billing"] },
  { id: "1007", name: "Aisha Mohammed", extension: "1007", queues: ["billing"] },
  { id: "1008", name: "Emeka Nwosu", extension: "1008", queues: ["vip"] },
  { id: "1009", name: "Seyi Adebanjo", extension: "1009", queues: ["sales"] },
  { id: "1010", name: "Halima Yusuf", extension: "1010", queues: ["support"] },
  { id: "1011", name: "Kunle Ajayi", extension: "1011", queues: ["billing"] },
  { id: "1012", name: "Zainab Abdullahi", extension: "1012", queues: ["vip"] },
];

const TALK = [186, 240, 312, 154, 420, 205, 268, 333, 148, 390];
const WRAP = [22, 35, 18, 41, 27, 15, 33, 20];

/**
 * Fixed day so the wallboard is already telling a story when it starts.
 * Support is the queue in trouble: 32 of 40 answers within 20s, plus 5
 * abandons (one of them under 5s). Service level is 32/44.
 * Sales, billing, and VIP sit inside their targets.
 */
export const HISTORY: Record<string, HistorySpec> = {
  support: {
    answeredWaits: [
      8, 9, 22, 11, 14, 6, 28, 12, 18, 19, 7, 33, 15, 16, 10, 41, 13, 5, 9, 12, 27, 17, 8, 11, 14,
      36, 18, 7, 13, 4, 48, 10, 15, 19, 24, 12, 8, 6, 11, 16,
    ],
    abandonedWaits: [3, 26, 34, 55, 81],
  },
  sales: {
    answeredWaits: [
      ...cycle([4, 7, 9, 12, 6, 8, 11, 15, 5, 10], 4),
      3, 9, 14, 18, 7, 6,
      23, 29, 37, 52,
    ],
    abandonedWaits: [4, 18],
  },
  billing: {
    answeredWaits: [...cycle([3, 6, 8, 11, 5, 9, 12, 4, 7], 3), 22],
    abandonedWaits: [9],
  },
  vip: {
    answeredWaits: cycle([4, 6, 3, 8, 5, 7, 2, 9], 2),
    abandonedWaits: [],
  },
};

export const TALK_SECONDS = TALK;
export const WRAP_SECONDS = WRAP;

export const CALLERS: Array<[string, string]> = [
  ["08032341001", "Adaeze Umeh"],
  ["08029881101", "Musa Garba"],
  ["08145550902", "Chioma Obi"],
  ["07031220044", "Unknown"],
  ["08095551212", "Peter Mensah"],
  ["08021110088", "Lola Adeniyi"],
  ["09087654321", "Yusuf Danjuma"],
  ["08160004421", "Blessing Okorie"],
  ["07015559876", "Samuel Boateng"],
  ["08034447721", "Hauwa Sule"],
  ["08123334455", "Ifeanyi Okeke"],
  ["09051112233", "Maryam Bello"],
];

function cycle(pattern: number[], times: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < times; i += 1) out.push(...pattern);
  return out;
}
