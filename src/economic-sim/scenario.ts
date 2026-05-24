import {
  ELECTRICITY_LOGISTICS_AGENT,
  GRID_HEIGHT,
  GRID_WIDTH,
  LOGISTICS_AGENTS,
  MONEY_ACCOUNT,
  PACKED_POPULATION_CELLS,
  POPULATION_CELLS,
  consumerAgentFor,
} from "./constants";
import { accountOf, addBalance, makeLedger } from "./ledger";
import type { Coord, SimState } from "./types";

function addPowerLineSegment(ledger: ReturnType<typeof makeLedger>, from: Coord, to: Coord) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  addBalance(ledger, "Common", accountOf(x, y), "power-line", 1);
  while (x !== to.x || y !== to.y) {
    if (x !== to.x) x += dx;
    else y += dy;
    addBalance(ledger, "Common", accountOf(x, y), "power-line", 1);
  }
}

export function createInitialState(): SimState {
  const ledger = makeLedger();
  const factories: Coord[] = [
    { x: 3, y: 3 },
    { x: 6, y: 11 },
    { x: 12, y: 5 },
    { x: 19, y: 12 },
  ];
  for (const factory of factories) {
    const account = accountOf(factory.x, factory.y);
    addBalance(ledger, "Producer", account, "factory", 1);
    addBalance(ledger, "Producer", account, "widget", 10);
  }
  addBalance(ledger, "Producer", MONEY_ACCOUNT, "money", 220);
  const powerPlants: Coord[] = [
    { x: 2, y: 2 },
    { x: 14, y: 2 },
    { x: 22, y: 13 },
  ];
  for (const powerPlant of powerPlants) {
    const account = accountOf(powerPlant.x, powerPlant.y);
    addBalance(ledger, "Producer", account, "power-plant", 1);
    addBalance(ledger, "Producer", account, "electricity", 30);
  }
  for (const population of POPULATION_CELLS) {
    const account = accountOf(population.x, population.y);
    const consumer = consumerAgentFor(population.x, population.y);
    addBalance(ledger, consumer, account, "population", population.amount);
    addBalance(ledger, consumer, MONEY_ACCOUNT, "money", population.amount * 8);
  }
  for (const logisticsAgent of LOGISTICS_AGENTS) {
    addBalance(ledger, logisticsAgent, MONEY_ACCOUNT, "money", 1000);
  }
  addBalance(ledger, ELECTRICITY_LOGISTICS_AGENT, MONEY_ACCOUNT, "money", 1000);
  for (let x = 1; x < GRID_WIDTH - 1; x += 1) {
    addBalance(ledger, "Common", accountOf(x, 5), "road", x % 3 === 0 ? 3 : 2);
    addBalance(ledger, "Common", accountOf(x, 10), "road", x % 4 === 0 ? 3 : 1);
  }
  for (let y = 2; y < GRID_HEIGHT - 1; y += 1) {
    addBalance(ledger, "Common", accountOf(5, y), "road", 2);
    addBalance(ledger, "Common", accountOf(17, y), "road", y % 3 === 0 ? 3 : 1);
  }
  for (const hub of [
    { x: 9, y: 13 },
    { x: 12, y: 5 },
    { x: 19, y: 12 },
    { x: 21, y: 9 },
  ]) {
    addBalance(ledger, "Common", accountOf(hub.x, hub.y), "road", 3);
  }
  for (let x = 2; x <= 22; x += 1) addBalance(ledger, "Common", accountOf(x, 2), "power-line", 1);
  for (let y = 2; y <= 13; y += 1) addBalance(ledger, "Common", accountOf(22, y), "power-line", 1);
  for (const factory of factories) {
    addPowerLineSegment(ledger, { x: factory.x, y: 2 }, factory);
  }
  for (const population of POPULATION_CELLS) {
    addPowerLineSegment(ledger, { x: Math.min(22, Math.max(2, population.x)), y: 2 }, population);
  }

  return {
    turn: 0,
    nextOrderId: 1,
    ledger,
    orders: [],
    lastOrderResults: [],
    trades: [],
    transports: [],
    note: "Initial endowments loaded",
  };
}

export function createPackedState(): SimState {
  const ledger = makeLedger();

  addBalance(ledger, "Producer", MONEY_ACCOUNT, "money", 2400);
  for (const logisticsAgent of LOGISTICS_AGENTS) {
    addBalance(ledger, logisticsAgent, MONEY_ACCOUNT, "money", 2400);
  }
  addBalance(ledger, ELECTRICITY_LOGISTICS_AGENT, MONEY_ACCOUNT, "money", 2400);

  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const account = accountOf(x, y);
      addBalance(ledger, "Common", account, "road", 2 + ((x + y) % 3));
      addBalance(ledger, "Common", account, "power-line", 1);
      addBalance(ledger, "Producer", account, "widget", 4 + ((x * 2 + y) % 5));
      addBalance(ledger, "Producer", account, "electricity", 6 + ((x + y * 2) % 7));
      if ((x + y) % 3 === 0) addBalance(ledger, "Producer", account, "factory", 1);
      if ((x * 2 + y) % 11 === 0) addBalance(ledger, "Producer", account, "power-plant", 1);
      if ((x + y) % 5 === 0) addBalance(ledger, LOGISTICS_AGENTS[(x + y) % LOGISTICS_AGENTS.length], account, "widget", 1);
      if ((x * 3 + y) % 7 === 0) addBalance(ledger, ELECTRICITY_LOGISTICS_AGENT, account, "electricity", 4);
    }
  }

  for (const population of PACKED_POPULATION_CELLS) {
    const account = accountOf(population.x, population.y);
    const consumer = consumerAgentFor(population.x, population.y);
    addBalance(ledger, consumer, account, "population", population.amount);
    addBalance(ledger, consumer, MONEY_ACCOUNT, "money", population.amount * 24);
  }

  return {
    turn: 0,
    nextOrderId: 1,
    ledger,
    orders: [],
    lastOrderResults: [],
    trades: [],
    transports: [],
    note: "Packed stress scenario loaded",
  };
}

export const SCENARIOS = [
  { id: "baseline", label: "Baseline", createState: createInitialState },
  { id: "packed", label: "Packed", createState: createPackedState },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];
