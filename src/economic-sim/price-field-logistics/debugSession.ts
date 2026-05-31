import { stepAgentSim } from "./agents";
import {
  FARM_PRODUCER_AGENT,
  LOGISTICS_AGENT,
  MONEY_ACCOUNT,
  PRODUCER_AGENT,
  accountOfCell,
  addLedgerBalance,
  consumerAgentForCell,
  getLedgerBalance,
  logisticsCell,
  setLedgerBalance,
  type PriceAgent,
  type Cell,
  type State,
  type MarketResource,
  type PriceResource,
} from "./engine";
import { summarizePriceLogisticsState } from "./headlessBenchmark";
import { createPriceLogisticsState } from "./scenario";
import { cellLedgerData } from "./uiData";

export type CellCoord = { x: number; y: number };

export type PriceLogisticsDebugSessionOptions = {
  width?: number;
  height?: number;
  cell?: CellCoord | null;
};

export type CellLedgerSnapshot = Record<
  "consumer" | "producer" | "farm" | "logistics",
  Record<PriceResource, number>
>;

export type CellDebugSnapshot = {
  turn: number;
  x: number;
  y: number;
  account: string;
  consumer: PriceAgent;
  land: boolean;
  population: number;
  malnutritionBurden: number;
  foodConsumed: number;
  latestOrderPrices: {
    productBid: number | null;
    productAsk: number | null;
    foodBid: number | null;
    foodAsk: number | null;
    laborBid: number | null;
    laborAsk: number | null;
  };
  balances: CellLedgerSnapshot;
  last: {
    productBid: { filled: number; unfilled: number };
    productAsk: { filled: number; unfilled: number };
    foodBid: { filled: number; unfilled: number };
    foodAsk: { filled: number; unfilled: number };
    laborBid: { filled: number; unfilled: number };
    laborAsk: { filled: number; unfilled: number };
  };
  logistics: {
    productStock: number;
    foodStock: number;
    movedProduct: number;
    productFieldBid: number;
    productBidVolume: number;
    foodFieldBid: number;
    foodBidVolume: number;
  };
};

export type PriceLogisticsSessionSummary = ReturnType<typeof summarizePriceLogisticsState> & {
  turn: number;
  selected: CellCoord | null;
};

export type EvalResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const RESOURCES: PriceResource[] = ["money", "product", "food", "labor", "factory", "farm"];

function sameCoord(left: CellCoord | null, right: CellCoord | null) {
  return !!left && !!right && left.x === right.x && left.y === right.y;
}

function validateCell(state: State, coord: CellCoord) {
  if (
    !Number.isInteger(coord.x) ||
    !Number.isInteger(coord.y) ||
    coord.x < 0 ||
    coord.y < 0 ||
    coord.x >= state.width ||
    coord.y >= state.height
  ) {
    throw new Error(`cell ${coord.x},${coord.y} is outside ${state.width}x${state.height}`);
  }
}

function ledgerSnapshot(state: State, cell: Cell): CellLedgerSnapshot {
  const account = accountOfCell(cell);
  const consumer = consumerAgentForCell(cell);
  const balanceSet = (agent: PriceAgent, ledgerAccount = account) =>
    Object.fromEntries(
      RESOURCES.map((resource) => [resource, getLedgerBalance(state.ledger, agent, ledgerAccount, resource)]),
    ) as Record<PriceResource, number>;

  return {
    consumer: {
      ...balanceSet(consumer),
      money: getLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money"),
    },
    producer: {
      ...balanceSet(PRODUCER_AGENT),
      money: getLedgerBalance(state.ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money"),
    },
    farm: {
      ...balanceSet(FARM_PRODUCER_AGENT),
      money: getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money"),
    },
    logistics: {
      ...balanceSet(LOGISTICS_AGENT),
      money: getLedgerBalance(state.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money"),
    },
  };
}

function latestOrderPrice(
  cell: Cell,
  resource: MarketResource,
  side: "bid" | "ask",
  agent: PriceAgent,
) {
  for (const tick of cell.marketHistory) {
    const order = tick.resources[resource].orders.find((candidate) =>
      candidate.side === side && candidate.agent === agent
    );
    if (order) return order.price;
  }
  return null;
}

function latestOrderTotals(
  cell: Cell,
  resource: MarketResource,
  side: "bid" | "ask",
  agents: PriceAgent[],
) {
  for (const tick of cell.marketHistory) {
    if (tick.turn === 0) continue;
    const orders = tick.resources[resource].orders.filter((order) =>
      order.side === side && agents.includes(order.agent)
    );
    if (orders.length > 0) {
      return {
        filled: orders.reduce((sum, order) => sum + order.filled, 0),
        unfilled: orders.reduce((sum, order) => sum + order.unfilled, 0),
      };
    }
  }
  return { filled: 0, unfilled: 0 };
}

export function createCellSnapshot(state: State, cell: Cell): CellDebugSnapshot {
  const account = accountOfCell(cell);
  const consumer = consumerAgentForCell(cell);
  return {
    turn: state.turn,
    x: cell.x,
    y: cell.y,
    account,
    consumer,
    land: cell.land,
    population: cell.population,
    malnutritionBurden: cell.malnutritionBurden,
    foodConsumed: cell.foodConsumed,
    latestOrderPrices: {
      productBid: latestOrderPrice(cell, "product", "bid", consumer),
      productAsk: latestOrderPrice(cell, "product", "ask", PRODUCER_AGENT),
      foodBid: latestOrderPrice(cell, "food", "bid", consumer),
      foodAsk: latestOrderPrice(cell, "food", "ask", FARM_PRODUCER_AGENT),
      laborBid: latestOrderPrice(cell, "labor", "bid", PRODUCER_AGENT) ?? latestOrderPrice(cell, "labor", "bid", FARM_PRODUCER_AGENT),
      laborAsk: latestOrderPrice(cell, "labor", "ask", consumer),
    },
    balances: ledgerSnapshot(state, cell),
    last: {
      productBid: latestOrderTotals(cell, "product", "bid", [consumer]),
      productAsk: latestOrderTotals(cell, "product", "ask", [PRODUCER_AGENT]),
      foodBid: latestOrderTotals(cell, "food", "bid", [consumer]),
      foodAsk: latestOrderTotals(cell, "food", "ask", [FARM_PRODUCER_AGENT]),
      laborBid: latestOrderTotals(cell, "labor", "bid", [PRODUCER_AGENT, FARM_PRODUCER_AGENT]),
      laborAsk: latestOrderTotals(cell, "labor", "ask", [consumer]),
    },
    logistics: {
      productStock: cellLedgerData(state, cell).logisticsProduct,
      foodStock: cellLedgerData(state, cell).logisticsFood,
      movedProduct: cellLedgerData(state, cell).movedProduct,
      productFieldBid: cell.fieldBid,
      productBidVolume: cell.bidVolume,
      foodFieldBid: cell.foodFieldBid,
      foodBidVolume: cell.foodBidVolume,
    },
  };
}

export type PriceLogisticsDebugSession = ReturnType<typeof createPriceLogisticsDebugSession>;

export function createPriceLogisticsDebugSession(options: PriceLogisticsDebugSessionOptions = {}) {
  let state = createPriceLogisticsState(options.width, options.height);
  let selected: CellCoord | null = null;

  const selectCell = (x: number, y: number) => {
    const coord = { x, y };
    validateCell(state, coord);
    selected = coord;
    return selected;
  };

  if (options.cell) selectCell(options.cell.x, options.cell.y);

  const selectedCell = () => selected ? logisticsCell(state, selected.x, selected.y) : null;
  const requireSelectedCell = () => {
    const cell = selectedCell();
    if (!cell) throw new Error("no selected cell");
    return cell;
  };

  const session = {
    get state() {
      return state;
    },
    get selected() {
      return selected;
    },
    reset(resetOptions: PriceLogisticsDebugSessionOptions = {}) {
      const keepSelected = resetOptions.cell === undefined ? selected : resetOptions.cell;
      state = createPriceLogisticsState(resetOptions.width ?? options.width, resetOptions.height ?? options.height);
      selected = null;
      if (keepSelected) {
        validateCell(state, keepSelected);
        selected = { ...keepSelected };
      }
      return session.summary();
    },
    step(count = 1) {
      if (!Number.isInteger(count) || count < 1) throw new Error(`step count must be a positive integer: ${count}`);
      for (let index = 0; index < count; index += 1) state = stepAgentSim(state);
      return {
        ...session.summary(),
        cell: selected ? session.cellSnapshot() : null,
      };
    },
    selectCell,
    cellAt(x: number, y: number) {
      const coord = { x, y };
      validateCell(state, coord);
      return logisticsCell(state, x, y);
    },
    selectedCell,
    cellSnapshot(coord = selected) {
      if (!coord) throw new Error("no selected cell");
      validateCell(state, coord);
      return createCellSnapshot(state, logisticsCell(state, coord.x, coord.y));
    },
    marketHistory(resource: MarketResource, coord = selected) {
      if (!coord) throw new Error("no selected cell");
      validateCell(state, coord);
      return logisticsCell(state, coord.x, coord.y).marketHistory.map((tick) => ({
        turn: tick.turn,
        orders: tick.resources[resource].orders,
        trades: tick.resources[resource].trades,
      }));
    },
    summary(): PriceLogisticsSessionSummary {
      return {
        turn: state.turn,
        selected: selected ? { ...selected } : null,
        ...summarizePriceLogisticsState(state),
      };
    },
    sameSelected(coord: CellCoord | null) {
      return sameCoord(selected, coord);
    },
  };

  return session;
}

function createEvalContext(session: PriceLogisticsDebugSession) {
  const cell = session.selectedCell();
  const account = cell ? accountOfCell(cell) : null;
  return {
    state: session.state,
    selected: cell,
    cell,
    account,
    consumer: cell ? consumerAgentForCell(cell) : null,
    step: (count = 1) => session.step(count),
    reset: (options?: PriceLogisticsDebugSessionOptions) => session.reset(options),
    select: (x: number, y: number) => session.selectCell(x, y),
    cellAt: (x: number, y: number) => session.cellAt(x, y),
    accountOfCell,
    consumerAgentForCell,
    getLedgerBalance,
    setLedgerBalance,
    addLedgerBalance,
    summary: () => session.summary(),
    MONEY_ACCOUNT,
    LOGISTICS_AGENT,
    PRODUCER_AGENT,
    FARM_PRODUCER_AGENT,
  };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

export async function evaluateInSession(session: PriceLogisticsDebugSession, source: string): Promise<EvalResult> {
  const context = createEvalContext(session);
  const names = Object.keys(context);
  const values = Object.values(context);

  try {
    let fn: (...args: unknown[]) => Promise<unknown>;
    try {
      fn = new AsyncFunction(...names, `"use strict"; return (${source});`);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      fn = new AsyncFunction(...names, `"use strict"; ${source}`);
    }
    return { ok: true, value: await fn(...values) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
