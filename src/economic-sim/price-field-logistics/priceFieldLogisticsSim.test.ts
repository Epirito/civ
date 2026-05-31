import { describe, expect, it } from "vitest";
import {
  FARM_PRODUCER_AGENT,
  LOGISTICS_AGENT,
  PRODUCER_AGENT,
  accountOfCell,
  addLedgerBalance,
  consumerAgentForCell,
  getLedgerBalance,
  logisticsCell,
  movedAccountOfCell,
  runAuction,
  setLedgerBalance,
  type PriceAgent,
  type Cell,
  type State,
  type MarketResource,
  type PriceMarketTickHistory,
  type OrderResult,
} from "./engine";
import { stepAgentSim } from "./agents";
import { createPriceLogisticsState } from "./scenario";
import { accountOf } from "../shared/accounts";
import { fieldCell } from "./priceFieldAutomaton";

function emptyMarketHistory(turn = 0): PriceMarketTickHistory {
  return {
    turn,
    resources: {
      product: { orders: [], trades: [] },
      food: { orders: [], trades: [] },
      labor: { orders: [], trades: [] },
    },
  };
}

function historyTick(cell: Cell, turn: number) {
  let tick = cell.marketHistory.find((entry) => entry.turn === turn);
  if (!tick) {
    tick = emptyMarketHistory(turn);
    const seed = cell.marketHistory.find((entry) => entry.turn === 0);
    cell.marketHistory = turn === 0
      ? [tick, ...cell.marketHistory.filter((entry) => entry.turn !== 0)]
      : [tick, ...cell.marketHistory.filter((entry) => entry.turn !== 0), ...(seed ? [seed] : [])];
  }
  return tick;
}

function seedOrder(
  cell: Cell,
  resource: MarketResource,
  side: "bid" | "ask",
  agent: PriceAgent,
  price: number,
  result: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">> = {},
) {
  if (price <= 0) return;
  const quantity = result.quantity ?? Math.max(1, (result.filled ?? 0) + (result.unfilled ?? 0));
  historyTick(cell, 0).resources[resource].orders.push({
    id: -historyTick(cell, 0).resources[resource].orders.length - 1,
    agent,
    account: accountOfCell(cell),
    resource,
    side,
    price,
    quantity,
    filled: result.filled ?? 0,
    unfilled: result.unfilled ?? 0,
  });
}

function seedConsumerProductBid(cell: Cell, price: number, result?: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">>) {
  seedOrder(cell, "product", "bid", consumerAgentForCell(cell), price, result);
}

function seedConsumerFoodBid(cell: Cell, price: number, result?: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">>) {
  seedOrder(cell, "food", "bid", consumerAgentForCell(cell), price, result);
}

function seedConsumerLaborAsk(cell: Cell, price: number, result?: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">>) {
  seedOrder(cell, "labor", "ask", consumerAgentForCell(cell), price, result);
}

function seedProducerProductAsk(cell: Cell, price: number, result?: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">>) {
  seedOrder(cell, "product", "ask", PRODUCER_AGENT, price, result);
}

function seedFarmFoodAsk(cell: Cell, price: number, result?: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">>) {
  seedOrder(cell, "food", "ask", FARM_PRODUCER_AGENT, price, result);
}

function seedProducerLaborBid(cell: Cell, price: number, result?: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">>) {
  seedOrder(cell, "labor", "bid", PRODUCER_AGENT, price, result);
}

function seedFarmLaborBid(cell: Cell, price: number, result?: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">>) {
  seedOrder(cell, "labor", "bid", FARM_PRODUCER_AGENT, price, result);
}

function addConsumerFoodBuffer(state: State, cell: Cell) {
  addLedgerBalance(
    state.ledger,
    consumerAgentForCell(cell),
    accountOfCell(cell),
    "food",
    Math.ceil(cell.population * 1.5) * 6,
  );
}

function addMarketOrder(
  cell: Cell,
  resource: MarketResource,
  side: "bid" | "ask",
  agent: PriceAgent,
  price: number,
  result: Partial<Pick<OrderResult, "filled" | "unfilled" | "quantity">> = {},
) {
  const quantity = result.quantity ?? Math.max(1, (result.filled ?? 0) + (result.unfilled ?? 0));
  historyTick(cell, 1).resources[resource].orders.push({
    id: 1000 + historyTick(cell, 1).resources[resource].orders.length,
    agent,
    account: accountOfCell(cell),
    resource,
    side,
    price,
    quantity,
    filled: result.filled ?? 0,
    unfilled: result.unfilled ?? 0,
  });
}

function emptyState(width = 5, height = 1): State {
  const state = createPriceLogisticsState(width, height);
  state.ledger = {};
  state.money = 50;
  state.producerMoney = 0;
  state.farmProducerMoney = 0;
  for (const cell of state.cells) {
    cell.marketHistory = [emptyMarketHistory()];
    cell.land = true;
    cell.consumerMoney = 0;
    cell.population = 0;
    cell.malnutritionBurden = 0;
    cell.foodConsumed = 0;
    cell.laborStock = 0;
    cell.fieldBid = 0;
    cell.bidVolume = 0;
    cell.foodFieldBid = 0;
    cell.foodBidVolume = 0;
    cell.producerStock = 0;
    cell.producerFoodStock = 0;
    cell.farmProducerFoodStock = 0;
    cell.farmStock = 0;
    cell.logisticsStock = 0;
    cell.logisticsFoodStock = 0;
  }
  return state;
}

function stepTimes(state: State, count: number) {
  let current = state;
  for (let step = 0; step < count; step += 1) {
    current = stepAgentSim(current);
  }
  return current;
}

describe("price-field logistics sim", () => {
  it("moves owned product one tile toward the diffused bid field", () => {
    const state = emptyState();
    logisticsCell(state, 0, 0).logisticsStock = 1;
    seedConsumerProductBid(logisticsCell(state, 4, 0), 30);
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;
    addConsumerFoodBuffer(state, logisticsCell(state, 4, 0));

    const next = stepTimes(state, 5);

    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(0);
    expect(getLedgerBalance(next.ledger, LOGISTICS_AGENT, movedAccountOfCell(logisticsCell(next, 1, 0)), "product")).toBe(1);
    expect(next.events).toContainEqual(expect.objectContaining({ kind: "move", fromX: 0, fromY: 0, toX: 1, toY: 0 }));
  });

  it("does not move the same product again until the next turn", () => {
    const state = emptyState();
    logisticsCell(state, 0, 0).logisticsStock = 1;
    seedConsumerProductBid(logisticsCell(state, 4, 0), 30);
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;
    addConsumerFoodBuffer(state, logisticsCell(state, 4, 0));

    const first = stepTimes(state, 5);
    const second = stepAgentSim(first);

    expect(getLedgerBalance(first.ledger, LOGISTICS_AGENT, movedAccountOfCell(logisticsCell(first, 1, 0)), "product")).toBe(1);
    expect(getLedgerBalance(first.ledger, LOGISTICS_AGENT, movedAccountOfCell(logisticsCell(first, 2, 0)), "product")).toBe(0);
    expect(logisticsCell(second, 1, 0).logisticsStock).toBe(0);
    expect(getLedgerBalance(second.ledger, LOGISTICS_AGENT, movedAccountOfCell(logisticsCell(second, 2, 0)), "product")).toBe(1);
  });

  it("buys producer stock when propagated bid value beats the local ask", () => {
    const state = emptyState();
    seedProducerProductAsk(logisticsCell(state, 0, 0), 3);
    logisticsCell(state, 0, 0).producerStock = 1;
    seedConsumerProductBid(logisticsCell(state, 4, 0), 30);
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;
    addConsumerFoodBuffer(state, logisticsCell(state, 4, 0));

    const next = stepTimes(state, 6);

    expect(next.events.some((event) => event.kind === "buy" && event.x === 0 && event.y === 0)).toBe(true);
    expect(next.money).toBeLessThan(state.money);
    expect(next.producerMoney).toBeGreaterThan(state.producerMoney);
  });

  it("does not buy or move when money cannot cover the next option", () => {
    const state = emptyState();
    state.money = 0;
    logisticsCell(state, 0, 0).logisticsStock = 1;
    seedProducerProductAsk(logisticsCell(state, 0, 0), 3);
    logisticsCell(state, 0, 0).producerStock = 1;
    seedConsumerProductBid(logisticsCell(state, 4, 0), 30);
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;
    addConsumerFoodBuffer(state, logisticsCell(state, 4, 0));

    const next = stepAgentSim(state);

    expect(next.events.filter((event) => event.kind === "buy" || event.kind === "move")).toHaveLength(0);
    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(1);
    expect(logisticsCell(next, 0, 0).producerStock).toBe(1);
  });

  it("tracks consumer money paid to logistics through local sales", () => {
    const state = emptyState();
    seedConsumerProductBid(logisticsCell(state, 2, 0), 12);
    logisticsCell(state, 2, 0).consumerMoney = 12;
    logisticsCell(state, 2, 0).population = 1;
    addConsumerFoodBuffer(state, logisticsCell(state, 2, 0));
    logisticsCell(state, 2, 0).logisticsStock = 1;

    const next = stepAgentSim(state);

    expect(next.events.some((event) => event.kind === "sell" && event.x === 2 && event.y === 0)).toBe(true);
    expect(next.money).toBeGreaterThan(state.money);
    expect(logisticsCell(next, 2, 0).consumerMoney).toBeLessThan((logisticsCell(state, 2, 0).consumerMoney ?? 0) + 12);
    expect(logisticsCell(next, 2, 0).fieldBid).toBeGreaterThan(0);
    expect(logisticsCell(next, 2, 0).bidVolume).toBeGreaterThan(0);
  });

  it("does not place consumer bids without cell-local money", () => {
    const state = emptyState();
    seedConsumerProductBid(logisticsCell(state, 2, 0), 12);
    logisticsCell(state, 2, 0).consumerMoney = 0;
    logisticsCell(state, 2, 0).population = 3;
    logisticsCell(state, 2, 0).logisticsStock = 3;

    const next = stepAgentSim(state);

    expect(logisticsCell(next, 2, 0).bidVolume).toBe(0);
    expect(logisticsCell(next, 2, 0).consumerMoney).toBe(0);
  });

  it("tracks residual unfilled bid volume as a running average", () => {
    const state = emptyState();
    seedConsumerProductBid(logisticsCell(state, 2, 0), 10);
    logisticsCell(state, 2, 0).consumerMoney = 25;
    logisticsCell(state, 2, 0).population = 4;
    addConsumerFoodBuffer(state, logisticsCell(state, 2, 0));

    const next = stepAgentSim(state);

    expect(logisticsCell(next, 2, 0).fieldBid).toBeGreaterThan(0);
    expect(logisticsCell(next, 2, 0).bidVolume).toBeCloseTo(0.7);
  });

  it("caps the effective product bid by cell-local consumer money", () => {
    const state = emptyState();
    seedConsumerProductBid(logisticsCell(state, 2, 0), 20);
    logisticsCell(state, 2, 0).consumerMoney = 7;
    logisticsCell(state, 2, 0).population = 3;
    addConsumerFoodBuffer(state, logisticsCell(state, 2, 0));
    logisticsCell(state, 2, 0).logisticsStock = 1;

    const next = stepAgentSim(state);

    expect(logisticsCell(next, 2, 0).consumerMoney).toBe(0);
    expect(next.events).toContainEqual(expect.objectContaining({ kind: "sell", price: 7 }));
  });

  it("updates the existing price field one tick at a time", () => {
    const state = emptyState();
    seedConsumerProductBid(logisticsCell(state, 4, 0), 12);
    logisticsCell(state, 4, 0).consumerMoney = 12;
    logisticsCell(state, 4, 0).population = 1;
    addConsumerFoodBuffer(state, logisticsCell(state, 4, 0));

    const first = stepAgentSim(state);
    const second = stepAgentSim(first);
    const third = stepAgentSim(second);

    expect(first.bidField.turn).toBe(state.bidField.turn + 1);
    expect(second.bidField.turn).toBe(first.bidField.turn + 1);
    expect(third.bidField.turn).toBe(second.bidField.turn + 1);
    expect(fieldCell(first.bidField, 4, 0).price).toBe(0);
    expect(fieldCell(second.bidField, 4, 0).price).toBeGreaterThan(0);
    expect(fieldCell(second.bidField, 3, 0).price).toBe(0);
    expect(fieldCell(third.bidField, 3, 0).price).toBeGreaterThan(0);
  });

  it("does not propagate price fields or move goods across sea cells", () => {
    const state = emptyState(3, 1);
    logisticsCell(state, 1, 0).land = false;
    logisticsCell(state, 0, 0).logisticsStock = 1;
    seedConsumerProductBid(logisticsCell(state, 2, 0), 30);
    logisticsCell(state, 2, 0).consumerMoney = 120;
    logisticsCell(state, 2, 0).population = 4;
    addConsumerFoodBuffer(state, logisticsCell(state, 2, 0));

    const next = stepTimes(state, 5);

    expect(fieldCell(next.bidFields.product, 0, 0).price).toBe(0);
    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(1);
    expect(next.events.some((event) => event.kind === "move")).toBe(false);
  });

  it("adapts consumer bids from market history", () => {
    const unfilled = emptyState();
    logisticsCell(unfilled, 0, 0).population = 2;
    seedConsumerProductBid(logisticsCell(unfilled, 0, 0), 10, { unfilled: 2 });
    logisticsCell(unfilled, 0, 0).consumerMoney = 24;
    addConsumerFoodBuffer(unfilled, logisticsCell(unfilled, 0, 0));

    const raised = stepAgentSim(unfilled);
    expect(raised.lastOrderResults.some((order) => order.resource === "product" && order.side === "bid" && order.price === 12)).toBe(true);

    const filled = emptyState();
    logisticsCell(filled, 0, 0).population = 1;
    seedConsumerProductBid(logisticsCell(filled, 0, 0), 10, { filled: 1 });
    logisticsCell(filled, 0, 0).consumerMoney = 8;
    addConsumerFoodBuffer(filled, logisticsCell(filled, 0, 0));

    const lowered = stepAgentSim(filled);
    expect(lowered.lastOrderResults.some((order) => order.resource === "product" && order.side === "bid" && order.price === 8)).toBe(true);
  });

  it("adapts producer asks from market history", () => {
    const missed = emptyState();
    seedProducerProductAsk(logisticsCell(missed, 0, 0), 10, { unfilled: 1 });
    logisticsCell(missed, 0, 0).producerStock = 1;

    const lowered = stepAgentSim(missed);
    expect(lowered.lastOrderResults.some((order) => order.resource === "product" && order.side === "ask" && order.price === 9)).toBe(true);

    const filled = emptyState();
    seedProducerProductAsk(logisticsCell(filled, 0, 0), 10, { filled: 1 });
    logisticsCell(filled, 0, 0).producerStock = 1;

    const raised = stepAgentSim(filled);
    expect(raised.lastOrderResults.some((order) => order.resource === "product" && order.side === "ask" && order.price === 12)).toBe(true);
  });

  it("adapts labor asks from market history", () => {
    const missed = emptyState();
    logisticsCell(missed, 0, 0).population = 1;
    seedConsumerLaborAsk(logisticsCell(missed, 0, 0), 10, { unfilled: 1 });
    logisticsCell(missed, 0, 0).laborStock = 1;

    const lowered = stepAgentSim(missed);
    expect(lowered.lastOrderResults.some((order) => order.resource === "labor" && order.side === "ask" && order.price === 9)).toBe(true);

    const filled = emptyState();
    logisticsCell(filled, 0, 0).population = 1;
    seedConsumerLaborAsk(logisticsCell(filled, 0, 0), 10, { filled: 1 });
    logisticsCell(filled, 0, 0).laborStock = 1;

    const raised = stepAgentSim(filled);
    expect(raised.lastOrderResults.some((order) => order.resource === "labor" && order.side === "ask" && order.price === 12)).toBe(true);
  });

  it("adapts local producer labor bids from market history", () => {
    const missed = emptyState();
    missed.producerMoney = 10;
    seedConsumerProductBid(logisticsCell(missed, 0, 0), 20);
    seedProducerProductAsk(logisticsCell(missed, 0, 0), 8);
    seedProducerLaborBid(logisticsCell(missed, 0, 0), 8, { unfilled: 1 });
    seedConsumerLaborAsk(logisticsCell(missed, 0, 0), 12);
    logisticsCell(missed, 0, 0).laborStock = 1;
    logisticsCell(missed, 0, 0).population = 1;
    logisticsCell(missed, 0, 0).consumerMoney = 0;
    addLedgerBalance(missed.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(missed, 0, 0)), "factory", 1);

    const raised = stepAgentSim(missed);
    expect(raised.lastOrderResults.some((order) => order.resource === "labor" && order.side === "bid" && order.price === 10)).toBe(true);

    const filled = emptyState();
    filled.producerMoney = 10;
    seedConsumerProductBid(logisticsCell(filled, 0, 0), 20);
    seedProducerProductAsk(logisticsCell(filled, 0, 0), 8);
    seedProducerLaborBid(logisticsCell(filled, 0, 0), 8, { filled: 1 });
    seedConsumerLaborAsk(logisticsCell(filled, 0, 0), 12);
    logisticsCell(filled, 0, 0).laborStock = 1;
    logisticsCell(filled, 0, 0).population = 1;
    logisticsCell(filled, 0, 0).consumerMoney = 0;
    addLedgerBalance(filled.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(filled, 0, 0)), "factory", 1);

    const lowered = stepAgentSim(filled);
    expect(lowered.lastOrderResults.some((order) => order.resource === "labor" && order.side === "bid" && order.price === 6)).toBe(true);
  });

  it("jumps adaptive quotes to better unfilled opposite-side prices", () => {
    const bidState = emptyState(1, 1);
    const bidCell = logisticsCell(bidState, 0, 0);
    bidCell.population = 1;
    seedConsumerProductBid(bidCell, 10);
    bidCell.consumerMoney = 10;
    addConsumerFoodBuffer(bidState, bidCell);
    addMarketOrder(bidCell, "product", "ask", PRODUCER_AGENT, 7, { unfilled: 1 });

    const jumpedBid = stepAgentSim(bidState);
    expect(jumpedBid.lastOrderResults.some((order) => order.resource === "product" && order.side === "bid" && order.price === 7)).toBe(true);

    const askState = emptyState(1, 1);
    const askCell = logisticsCell(askState, 0, 0);
    seedProducerProductAsk(askCell, 10);
    askCell.producerStock = 1;
    addMarketOrder(askCell, "product", "bid", "Consumer-0,0", 14, { unfilled: 1 });

    const jumpedAsk = stepAgentSim(askState);
    expect(jumpedAsk.lastOrderResults.some((order) => order.resource === "product" && order.side === "ask" && order.price === 14)).toBe(true);
  });

  it("buys local labor to produce factory stock when expected revenue covers input cost", () => {
    const state = emptyState(1, 1);
    state.money = 0;
    state.producerMoney = 20;
    seedConsumerProductBid(logisticsCell(state, 0, 0), 20);
    seedProducerProductAsk(logisticsCell(state, 0, 0), 8);
    addLedgerBalance(state.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(state, 0, 0)), "factory", 1);
    logisticsCell(state, 0, 0).population = 1;
    seedProducerLaborBid(logisticsCell(state, 0, 0), 8);
    seedConsumerLaborAsk(logisticsCell(state, 0, 0), 2);

    const next = stepAgentSim(state);

    expect(next.events.some((event) => event.kind === "labor" && event.x === 0 && event.y === 0)).toBe(true);
    expect(logisticsCell(next, 0, 0).producerStock).toBe(1);
    expect(next.producerMoney).toBeLessThan(state.producerMoney);
    expect(logisticsCell(next, 0, 0).consumerMoney).toBeGreaterThan(0);
  });

  it("does not produce factory stock without a local factory", () => {
    const state = emptyState(1, 1);
    state.money = 0;
    state.producerMoney = 20;
    seedConsumerProductBid(logisticsCell(state, 0, 0), 20);
    seedProducerProductAsk(logisticsCell(state, 0, 0), 8);
    logisticsCell(state, 0, 0).population = 1;
    seedProducerLaborBid(logisticsCell(state, 0, 0), 8);
    seedConsumerLaborAsk(logisticsCell(state, 0, 0), 2);
    logisticsCell(state, 0, 0).laborStock = 1;

    const next = stepAgentSim(state);

    expect(next.events.some((event) => event.kind === "labor")).toBe(false);
    expect(logisticsCell(next, 0, 0).producerStock).toBe(0);
  });

  it("runs recipes with arbitrary input, output, and durable requirement bundles", () => {
    const state = emptyState(1, 1);
    const account = accountOfCell(logisticsCell(state, 0, 0));
    state.recipes = [{
      id: "batch-product",
      inputs: { labor: 2 },
      requirements: { factory: 1 },
      outputs: { product: 3 },
    }];
    addLedgerBalance(state.ledger, PRODUCER_AGENT, account, "labor", 4);
    addLedgerBalance(state.ledger, PRODUCER_AGENT, account, "factory", 1);

    const next = stepAgentSim(state);

    expect(getLedgerBalance(next.ledger, PRODUCER_AGENT, account, "labor")).toBe(2);
    expect(getLedgerBalance(next.ledger, PRODUCER_AGENT, account, "factory")).toBe(1);
    expect(getLedgerBalance(next.ledger, PRODUCER_AGENT, account, "product")).toBe(3);
  });

  it("runs farm recipes for subsistence food without consuming the farm", () => {
    const state = emptyState(1, 1);
    const account = accountOfCell(logisticsCell(state, 0, 0));
    logisticsCell(state, 0, 0).farmStock = 1;
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "labor", 1);
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "farm", 1);

    const next = stepAgentSim(state);

    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "labor")).toBe(0);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "farm")).toBe(1);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "food")).toBe(3);
  });

  it("farm producer buys local labor to run farms when expected food revenue covers input cost", () => {
    const state = emptyState(1, 1);
    const account = accountOfCell(logisticsCell(state, 0, 0));
    state.money = 0;
    state.farmProducerMoney = 20;
    state.recipes = [{
      id: "subsistence-food",
      inputs: { labor: 1 },
      requirements: { farm: 1 },
      outputs: { food: 1 },
    }];
    seedConsumerFoodBid(logisticsCell(state, 0, 0), 20);
    seedFarmFoodAsk(logisticsCell(state, 0, 0), 8);
    logisticsCell(state, 0, 0).population = 1;
    seedFarmLaborBid(logisticsCell(state, 0, 0), 8);
    seedConsumerLaborAsk(logisticsCell(state, 0, 0), 2);
    logisticsCell(state, 0, 0).farmStock = 1;
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "farm", 1);

    const next = stepAgentSim(state);

    expect(next.events.some((event) => event.kind === "labor" && event.x === 0 && event.y === 0)).toBe(true);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "food")).toBe(1);
    expect(next.farmProducerMoney).toBeLessThan(state.farmProducerMoney);
    expect(logisticsCell(next, 0, 0).producerStock).toBe(0);
  });

  it("runs factory farming with product input and a larger farm requirement", () => {
    const state = emptyState(1, 1);
    const account = accountOfCell(logisticsCell(state, 0, 0));
    logisticsCell(state, 0, 0).farmStock = 2;
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "labor", 1);
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "product", 1);
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "farm", 2);

    const next = stepAgentSim(state);

    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "labor")).toBe(0);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "product")).toBe(0);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "farm")).toBe(2);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "food")).toBe(6);
  });

  it("prioritizes consumer food bids before product bids", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    const account = accountOfCell(cell);
    const consumer = "Consumer-0,0";
    cell.population = 1;
    seedConsumerFoodBid(cell, 10);
    seedConsumerProductBid(cell, 10);
    seedFarmFoodAsk(cell, 10);
    seedProducerProductAsk(cell, 10);
    cell.consumerMoney = 10;
    cell.farmProducerFoodStock = 1;
    cell.logisticsStock = 1;
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "food", 1);

    const next = stepAgentSim(state);
    expect(next.lastOrderResults.some((order) => order.resource === "product" && order.side === "bid" && order.filled > 0)).toBe(false);
    expect(getLedgerBalance(next.ledger, consumer, account, "food")).toBe(0);
    expect(logisticsCell(next, 0, 0).foodConsumed).toBe(1);
    expect(logisticsCell(next, 0, 0).consumerMoney).toBe(0);
  });

  it("only buys factory products after the local food buffer is full", () => {
    const hungry = emptyState(1, 1);
    const hungryCell = logisticsCell(hungry, 0, 0);
    hungryCell.population = 1;
    seedConsumerFoodBid(hungryCell, 10);
    seedConsumerProductBid(hungryCell, 10);
    seedFarmFoodAsk(hungryCell, 10);
    hungryCell.consumerMoney = 60;
    hungryCell.farmProducerFoodStock = 6;
    hungryCell.logisticsStock = 1;
    addLedgerBalance(hungry.ledger, FARM_PRODUCER_AGENT, accountOfCell(hungryCell), "food", 6);

    const stillStockingFood = stepAgentSim(hungry);
    expect(stillStockingFood.lastOrderResults.some((order) => order.resource === "food" && order.side === "bid" && order.filled > 0)).toBe(true);
    expect(stillStockingFood.lastOrderResults.some((order) => order.resource === "product" && order.side === "bid")).toBe(false);

    const buffered = emptyState(1, 1);
    const bufferedCell = logisticsCell(buffered, 0, 0);
    bufferedCell.population = 1;
    seedConsumerFoodBid(bufferedCell, 10);
    seedConsumerProductBid(bufferedCell, 10);
    bufferedCell.consumerMoney = 10;
    bufferedCell.logisticsStock = 1;
    addConsumerFoodBuffer(buffered, bufferedCell);

    const buyingProducts = stepAgentSim(buffered);
    expect(buyingProducts.lastOrderResults.some((order) => order.resource === "food" && order.side === "bid")).toBe(false);
    expect(buyingProducts.lastOrderResults.some((order) => order.resource === "product" && order.side === "bid" && order.filled === 1)).toBe(true);
  });

  it("raises malnutrition burden and mortality when food is missing", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    cell.population = 10;
    cell.malnutritionBurden = 1;

    const next = stepAgentSim(state);

    expect(logisticsCell(next, 0, 0).foodConsumed).toBe(0);
    expect(logisticsCell(next, 0, 0).malnutritionBurden).toBe(1);
    expect(logisticsCell(next, 0, 0).population).toBeLessThan(9);
  });

  it("cools survivor malnutrition by removing starvation deaths from the fully malnourished tail", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    cell.population = 10;
    cell.malnutritionBurden = 0.8;

    const burdenBeforeDeaths = Math.min(1, 0.8 + 7 / 180);
    const starvationDeathRate = 0.19 * burdenBeforeDeaths ** 4;
    const expectedBurden = (burdenBeforeDeaths - starvationDeathRate) / (1 - starvationDeathRate);

    const next = stepAgentSim(state);

    expect(logisticsCell(next, 0, 0).foodConsumed).toBe(0);
    expect(logisticsCell(next, 0, 0).malnutritionBurden).toBeCloseTo(expectedBurden);
    expect(logisticsCell(next, 0, 0).malnutritionBurden).toBeLessThan(burdenBeforeDeaths);
  });

  it("rejects fractional ledger quantities", () => {
    const state = emptyState(1, 1);
    const account = accountOfCell(logisticsCell(state, 0, 0));

    expect(() => addLedgerBalance(state.ledger, PRODUCER_AGENT, account, "food", 0.5)).toThrow(/integer quantity/);
    expect(() => setLedgerBalance(state.ledger, PRODUCER_AGENT, account, "labor", 1.25)).toThrow(/integer quantity/);
  });

  it("keeps population-derived labor and food ledger flows integer", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    const account = accountOfCell(cell);
    const consumer = "Consumer-0,0";
    cell.population = 2.7;
    cell.malnutritionBurden = 0.5;
    addLedgerBalance(state.ledger, consumer, account, "food", 4);

    const next = stepAgentSim(state);

    expect(Number.isInteger(getLedgerBalance(next.ledger, consumer, account, "labor"))).toBe(true);
    expect(Number.isInteger(getLedgerBalance(next.ledger, consumer, account, "food"))).toBe(true);
  });

  it("floors fractional population before placing product demand orders", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    cell.population = 0.9966214214995466;
    seedConsumerProductBid(cell, 10);
    cell.consumerMoney = 20;
    cell.logisticsStock = 1;

    expect(() => stepAgentSim(state)).not.toThrow();
    expect(stepAgentSim(state).trades).toHaveLength(0);
  });

  it("allocates producer money to the factory with the larger labor margin first", () => {
    const state = emptyState(2, 1);
    state.money = 0;
    state.producerMoney = 20;
    seedConsumerProductBid(logisticsCell(state, 0, 0), 20);
    seedProducerProductAsk(logisticsCell(state, 0, 0), 8);
    addLedgerBalance(state.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(state, 0, 0)), "factory", 1);
    logisticsCell(state, 0, 0).population = 1;
    seedProducerLaborBid(logisticsCell(state, 0, 0), 8);
    seedConsumerLaborAsk(logisticsCell(state, 0, 0), 5);
    seedConsumerProductBid(logisticsCell(state, 1, 0), 12);
    seedProducerProductAsk(logisticsCell(state, 1, 0), 8);
    addLedgerBalance(state.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(state, 1, 0)), "factory", 1);
    logisticsCell(state, 1, 0).population = 1;
    seedProducerLaborBid(logisticsCell(state, 1, 0), 8);
    seedConsumerLaborAsk(logisticsCell(state, 1, 0), 2);

    const next = stepAgentSim(state);

    expect(logisticsCell(next, 0, 0).producerStock).toBe(1);
    expect(logisticsCell(next, 1, 0).producerStock).toBe(1);
    expect(next.events.find((event) => event.kind === "labor")).toEqual(expect.objectContaining({ x: 0, y: 0 }));
  });

  it("submits non-crossing orders to the auction and lets them miss", () => {
    const result = runAuction({
      account: accountOf(0, 0),
      buyer: "Logistics-0",
      seller: "Producer",
      bidPrice: 10,
      askPrice: 20,
      quantity: 1,
      buyerMoney: 10,
      sellerWidget: 1,
    });

    expect(result.trades).toHaveLength(0);
    expect(result.orderResults).toEqual([
      expect.objectContaining({ side: "ask", quantity: 1, filled: 0, unfilled: 1 }),
      expect.objectContaining({ side: "bid", quantity: 1, filled: 0, unfilled: 1 }),
    ]);
    expect(result.buyerMoney).toBe(10);
    expect(result.buyerWidget).toBe(0);
    expect(result.sellerMoney).toBe(0);
    expect(result.sellerWidget).toBe(1);
  });
});
