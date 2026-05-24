import type {
  Account,
  Agent,
  AgentFamily,
  ConsumerAgent,
  Coord,
  ElectricityLogisticsAgent,
  LogisticsAgent,
  Resource,
} from "./types";

export const GRID_WIDTH = 24;
export const GRID_HEIGHT = 16;
export const MONEY_ACCOUNT: Account = "";

export const POPULATION_CELLS: Array<Coord & { amount: number }> = [
  { x: 5, y: 5, amount: 6 },
  { x: 9, y: 13, amount: 5 },
  { x: 17, y: 4, amount: 7 },
  { x: 21, y: 9, amount: 4 },
];

export function consumerAgentFor(x: number, y: number): ConsumerAgent {
  return `Consumer-${x},${y}`;
}

export const PACKED_POPULATION_CELLS: Array<Coord & { amount: number }> = Array.from({ length: GRID_HEIGHT }, (_, y) =>
  Array.from({ length: GRID_WIDTH }, (_unused, x) => ({ x, y, amount: 1 + ((x * 3 + y * 5) % 4) })),
).flat();

export const CONSUMER_AGENTS: ConsumerAgent[] = [
  ...new Set(
    [...POPULATION_CELLS, ...PACKED_POPULATION_CELLS].map((cell) => consumerAgentFor(cell.x, cell.y)),
  ),
];
export const LOGISTICS_AGENTS: LogisticsAgent[] = ["Logistics-0", "Logistics-1"];
export const ELECTRICITY_LOGISTICS_AGENT: ElectricityLogisticsAgent = "ElectricityLogistics";

export const AGENTS: Agent[] = ["Common", "Producer", ...CONSUMER_AGENTS, ...LOGISTICS_AGENTS, ELECTRICITY_LOGISTICS_AGENT];
export const RESOURCES: Resource[] = [
  "money",
  "widget",
  "factory",
  "population",
  "road",
  "congestion",
  "last-congestion",
  "electricity",
  "power-line",
  "power-plant",
];

export const AGENT_COLORS: Record<AgentFamily, string> = {
  Common: "#94a3b8",
  Producer: "#f59e0b",
  Consumer: "#38bdf8",
  Logistics: "#a78bfa",
  ElectricityLogistics: "#60a5fa",
};

export function agentFamily(agent: Agent): AgentFamily {
  if (agent === "Common") return "Common";
  if (agent === ELECTRICITY_LOGISTICS_AGENT) return "ElectricityLogistics";
  if (agent.startsWith("Consumer-")) return "Consumer";
  if (agent.startsWith("Logistics-")) return "Logistics";
  return "Producer";
}

export function agentColor(agent: Agent) {
  return AGENT_COLORS[agentFamily(agent)];
}
