import { GRID_HEIGHT, GRID_WIDTH, LOGISTICS_AGENTS, MONEY_ACCOUNT, POPULATION_CELLS, consumerAgentFor } from "./constants";
import { accountOf, addBalance, makeLedger } from "./ledger";
import type { Coord, SimState } from "./types";

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
  for (const population of POPULATION_CELLS) {
    const account = accountOf(population.x, population.y);
    const consumer = consumerAgentFor(population.x, population.y);
    addBalance(ledger, consumer, account, "population", population.amount);
    addBalance(ledger, consumer, MONEY_ACCOUNT, "money", population.amount * 8);
  }
  for (const logisticsAgent of LOGISTICS_AGENTS) {
    addBalance(ledger, logisticsAgent, MONEY_ACCOUNT, "money", 140);
  }
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
