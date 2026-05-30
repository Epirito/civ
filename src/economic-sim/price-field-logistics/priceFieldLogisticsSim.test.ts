import { describe, expect, it } from "vitest";
import {
  FARM_PRODUCER_AGENT,
  PRODUCER_AGENT,
  accountOfCell,
  addLedgerBalance,
  getLedgerBalance,
  logisticsCell,
  runAuction,
  setLedgerBalance,
  type PriceLogisticsState,
} from "./engine";
import { effectiveProductBid, stepPriceLogistics } from "./agents";
import { createPriceLogisticsState } from "./scenario";
import { accountOf } from "../shared/accounts";
import { fieldCell } from "./priceFieldAutomaton";

function emptyState(width = 5, height = 1): PriceLogisticsState {
  const state = createPriceLogisticsState(width, height);
  state.ledger = {};
  state.money = 50;
  state.producerMoney = 0;
  state.farmProducerMoney = 0;
  for (const cell of state.cells) {
    cell.localBid = 0;
    cell.land = true;
    cell.foodBid = 0;
    cell.consumerMoney = 0;
    cell.population = 0;
    cell.malnutritionBurden = 0;
    cell.foodConsumed = 0;
    cell.laborBid = 0;
    cell.laborAsk = 0;
    cell.laborStock = 0;
    cell.fieldBid = 0;
    cell.bidVolume = 0;
    cell.foodFieldBid = 0;
    cell.foodBidVolume = 0;
    cell.localAsk = 0;
    cell.foodAsk = 0;
    cell.producerStock = 0;
    cell.producerFoodStock = 0;
    cell.farmProducerFoodStock = 0;
    cell.farmStock = 0;
    cell.logisticsStock = 0;
    cell.logisticsFoodStock = 0;
    cell.movedStock = 0;
    cell.lastBidFilled = 0;
    cell.lastBidUnfilled = 0;
    cell.lastFoodBidFilled = 0;
    cell.lastFoodBidUnfilled = 0;
    cell.lastLaborBidFilled = 0;
    cell.lastLaborBidUnfilled = 0;
    cell.lastLaborFilled = 0;
    cell.lastLaborUnfilled = 0;
    cell.lastAskFilled = 0;
    cell.lastAskUnfilled = 0;
    cell.lastFoodAskFilled = 0;
    cell.lastFoodAskUnfilled = 0;
  }
  return state;
}

function stepTimes(state: PriceLogisticsState, count: number) {
  let current = state;
  for (let step = 0; step < count; step += 1) {
    current = stepPriceLogistics(current);
  }
  return current;
}

describe("price-field logistics sim", () => {
  it("moves owned product one tile toward the diffused bid field", () => {
    const state = emptyState();
    logisticsCell(state, 0, 0).logisticsStock = 1;
    logisticsCell(state, 4, 0).localBid = 30;
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;

    const next = stepTimes(state, 5);

    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(0);
    expect(logisticsCell(next, 1, 0).movedStock).toBe(1);
    expect(next.events).toContainEqual(expect.objectContaining({ kind: "move", fromX: 0, fromY: 0, toX: 1, toY: 0 }));
  });

  it("does not move the same product again until the next turn", () => {
    const state = emptyState();
    logisticsCell(state, 0, 0).logisticsStock = 1;
    logisticsCell(state, 4, 0).localBid = 30;
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;

    const first = stepTimes(state, 5);
    const second = stepPriceLogistics(first);

    expect(logisticsCell(first, 1, 0).movedStock).toBe(1);
    expect(logisticsCell(first, 2, 0).movedStock).toBe(0);
    expect(logisticsCell(second, 1, 0).logisticsStock).toBe(0);
    expect(logisticsCell(second, 2, 0).movedStock).toBe(1);
  });

  it("buys producer stock when propagated bid value beats the local ask", () => {
    const state = emptyState();
    logisticsCell(state, 0, 0).localAsk = 3;
    logisticsCell(state, 0, 0).producerStock = 1;
    logisticsCell(state, 4, 0).localBid = 30;
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;

    const next = stepTimes(state, 6);

    expect(next.events.some((event) => event.kind === "buy" && event.x === 0 && event.y === 0)).toBe(true);
    expect(next.money).toBeLessThan(state.money);
    expect(next.producerMoney).toBeGreaterThan(state.producerMoney);
  });

  it("does not buy or move when money cannot cover the next option", () => {
    const state = emptyState();
    state.money = 0;
    logisticsCell(state, 0, 0).logisticsStock = 1;
    logisticsCell(state, 0, 0).localAsk = 3;
    logisticsCell(state, 0, 0).producerStock = 1;
    logisticsCell(state, 4, 0).localBid = 30;
    logisticsCell(state, 4, 0).consumerMoney = 120;
    logisticsCell(state, 4, 0).population = 4;

    const next = stepPriceLogistics(state);

    expect(next.events.filter((event) => event.kind === "buy" || event.kind === "move")).toHaveLength(0);
    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(1);
    expect(logisticsCell(next, 0, 0).producerStock).toBe(1);
  });

  it("tracks consumer money paid to logistics through local sales", () => {
    const state = emptyState();
    logisticsCell(state, 2, 0).localBid = 12;
    logisticsCell(state, 2, 0).consumerMoney = 12;
    logisticsCell(state, 2, 0).population = 1;
    logisticsCell(state, 2, 0).logisticsStock = 1;

    const next = stepPriceLogistics(state);

    expect(next.events.some((event) => event.kind === "sell" && event.x === 2 && event.y === 0)).toBe(true);
    expect(next.money).toBeGreaterThan(state.money);
    expect(logisticsCell(next, 2, 0).consumerMoney).toBeLessThan(logisticsCell(state, 2, 0).consumerMoney + 12);
    expect(logisticsCell(next, 2, 0).fieldBid).toBeGreaterThan(0);
    expect(logisticsCell(next, 2, 0).bidVolume).toBeGreaterThan(0);
  });

  it("does not place consumer bids without cell-local money", () => {
    const state = emptyState();
    logisticsCell(state, 2, 0).localBid = 12;
    logisticsCell(state, 2, 0).consumerMoney = 0;
    logisticsCell(state, 2, 0).population = 3;
    logisticsCell(state, 2, 0).logisticsStock = 3;

    const next = stepPriceLogistics(state);

    expect(logisticsCell(next, 2, 0).lastBidFilled).toBe(0);
    expect(logisticsCell(next, 2, 0).bidVolume).toBe(0);
    expect(logisticsCell(next, 2, 0).consumerMoney).toBe(0);
  });

  it("tracks residual unfilled bid volume as a running average", () => {
    const state = emptyState();
    logisticsCell(state, 2, 0).localBid = 10;
    logisticsCell(state, 2, 0).consumerMoney = 25;
    logisticsCell(state, 2, 0).population = 4;

    const next = stepPriceLogistics(state);

    expect(logisticsCell(next, 2, 0).fieldBid).toBeGreaterThan(0);
    expect(logisticsCell(next, 2, 0).bidVolume).toBeCloseTo(0.7);
  });

  it("caps the effective product bid by cell-local consumer money", () => {
    const state = emptyState();
    logisticsCell(state, 2, 0).localBid = 20;
    logisticsCell(state, 2, 0).consumerMoney = 7;
    logisticsCell(state, 2, 0).population = 3;
    logisticsCell(state, 2, 0).logisticsStock = 1;

    const next = stepPriceLogistics(state);

    expect(logisticsCell(next, 2, 0).lastBidFilled).toBe(1);
    expect(logisticsCell(next, 2, 0).consumerMoney).toBe(0);
    expect(effectiveProductBid(logisticsCell(next, 2, 0))).toBe(0);
    expect(next.events).toContainEqual(expect.objectContaining({ kind: "sell", price: 7 }));
  });

  it("updates the existing price field one tick at a time", () => {
    const state = emptyState();
    logisticsCell(state, 4, 0).localBid = 12;
    logisticsCell(state, 4, 0).consumerMoney = 12;
    logisticsCell(state, 4, 0).population = 1;

    const first = stepPriceLogistics(state);
    const second = stepPriceLogistics(first);
    const third = stepPriceLogistics(second);

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
    logisticsCell(state, 2, 0).localBid = 30;
    logisticsCell(state, 2, 0).consumerMoney = 120;
    logisticsCell(state, 2, 0).population = 4;

    const next = stepTimes(state, 5);

    expect(fieldCell(next.bidFields.product, 0, 0).price).toBe(0);
    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(1);
    expect(next.events.some((event) => event.kind === "move")).toBe(false);
  });

  it("raises unfilled consumer bids and lowers filled consumer bids", () => {
    const unfilled = emptyState();
    logisticsCell(unfilled, 0, 0).population = 2;
    logisticsCell(unfilled, 0, 0).localBid = 10;
    logisticsCell(unfilled, 0, 0).lastBidUnfilled = 2;

    const raised = stepPriceLogistics(unfilled);
    expect(logisticsCell(raised, 0, 0).localBid).toBe(12);

    const filled = emptyState();
    logisticsCell(filled, 0, 0).population = 1;
    logisticsCell(filled, 0, 0).localBid = 10;
    logisticsCell(filled, 0, 0).lastBidFilled = 1;

    const lowered = stepPriceLogistics(filled);
    expect(logisticsCell(lowered, 0, 0).localBid).toBe(8);
  });

  it("adapts producer asks from previous fills and misses", () => {
    const missed = emptyState();
    logisticsCell(missed, 0, 0).localAsk = 10;
    logisticsCell(missed, 0, 0).lastAskUnfilled = 1;

    const lowered = stepPriceLogistics(missed);
    expect(logisticsCell(lowered, 0, 0).localAsk).toBe(9);

    const filled = emptyState();
    logisticsCell(filled, 0, 0).localAsk = 10;
    logisticsCell(filled, 0, 0).lastAskFilled = 1;

    const raised = stepPriceLogistics(filled);
    expect(logisticsCell(raised, 0, 0).localAsk).toBe(12);
  });

  it("adapts labor asks from previous fills and misses", () => {
    const missed = emptyState();
    logisticsCell(missed, 0, 0).population = 1;
    logisticsCell(missed, 0, 0).laborAsk = 10;
    logisticsCell(missed, 0, 0).lastLaborUnfilled = 1;

    const lowered = stepPriceLogistics(missed);
    expect(logisticsCell(lowered, 0, 0).laborAsk).toBe(9);

    const filled = emptyState();
    logisticsCell(filled, 0, 0).population = 1;
    logisticsCell(filled, 0, 0).laborAsk = 10;
    logisticsCell(filled, 0, 0).lastLaborFilled = 1;

    const raised = stepPriceLogistics(filled);
    expect(logisticsCell(raised, 0, 0).laborAsk).toBe(12);
  });

  it("adapts local producer labor bids from previous fills and misses", () => {
    const missed = emptyState();
    logisticsCell(missed, 0, 0).localAsk = 8;
    logisticsCell(missed, 0, 0).laborBid = 8;
    logisticsCell(missed, 0, 0).lastLaborBidUnfilled = 1;

    const raised = stepPriceLogistics(missed);
    expect(logisticsCell(raised, 0, 0).laborBid).toBe(10);

    const filled = emptyState();
    logisticsCell(filled, 0, 0).localAsk = 8;
    logisticsCell(filled, 0, 0).laborBid = 8;
    logisticsCell(filled, 0, 0).lastLaborBidFilled = 1;

    const lowered = stepPriceLogistics(filled);
    expect(logisticsCell(lowered, 0, 0).laborBid).toBe(6);
  });

  it("buys local labor to produce factory stock when expected revenue covers input cost", () => {
    const state = emptyState(1, 1);
    state.money = 0;
    state.producerMoney = 20;
    logisticsCell(state, 0, 0).localBid = 20;
    logisticsCell(state, 0, 0).localAsk = 8;
    addLedgerBalance(state.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(state, 0, 0)), "factory", 1);
    logisticsCell(state, 0, 0).population = 1;
    logisticsCell(state, 0, 0).laborBid = 8;
    logisticsCell(state, 0, 0).laborAsk = 2;

    const next = stepPriceLogistics(state);

    expect(next.events.some((event) => event.kind === "labor" && event.x === 0 && event.y === 0)).toBe(true);
    expect(logisticsCell(next, 0, 0).producerStock).toBe(1);
    expect(logisticsCell(next, 0, 0).lastLaborFilled).toBe(1);
    expect(next.producerMoney).toBeLessThan(state.producerMoney);
    expect(logisticsCell(next, 0, 0).consumerMoney).toBeGreaterThan(0);
  });

  it("does not produce factory stock without a local factory", () => {
    const state = emptyState(1, 1);
    state.money = 0;
    state.producerMoney = 20;
    logisticsCell(state, 0, 0).localBid = 20;
    logisticsCell(state, 0, 0).localAsk = 8;
    logisticsCell(state, 0, 0).population = 1;
    logisticsCell(state, 0, 0).laborBid = 8;
    logisticsCell(state, 0, 0).laborAsk = 2;
    logisticsCell(state, 0, 0).laborStock = 1;

    const next = stepPriceLogistics(state);

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

    const next = stepPriceLogistics(state);

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

    const next = stepPriceLogistics(state);

    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "labor")).toBe(0);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "farm")).toBe(1);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "food")).toBe(1);
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
    logisticsCell(state, 0, 0).foodBid = 20;
    logisticsCell(state, 0, 0).foodAsk = 8;
    logisticsCell(state, 0, 0).population = 1;
    logisticsCell(state, 0, 0).laborBid = 8;
    logisticsCell(state, 0, 0).laborAsk = 2;
    logisticsCell(state, 0, 0).farmStock = 1;
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "farm", 1);

    const next = stepPriceLogistics(state);

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

    const next = stepPriceLogistics(state);

    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "labor")).toBe(0);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "product")).toBe(0);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "farm")).toBe(2);
    expect(getLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "food")).toBe(3);
  });

  it("prioritizes consumer food bids before product bids", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    const account = accountOfCell(cell);
    const consumer = "Consumer-0,0";
    cell.population = 1;
    cell.foodBid = 10;
    cell.localBid = 10;
    cell.foodAsk = 10;
    cell.localAsk = 10;
    cell.consumerMoney = 10;
    cell.farmProducerFoodStock = 1;
    cell.logisticsStock = 1;
    addLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "food", 1);

    const next = stepPriceLogistics(state);

    expect(logisticsCell(next, 0, 0).lastFoodBidFilled).toBe(1);
    expect(logisticsCell(next, 0, 0).lastBidFilled).toBe(0);
    expect(getLedgerBalance(next.ledger, consumer, account, "food")).toBe(0);
    expect(logisticsCell(next, 0, 0).foodConsumed).toBe(1);
    expect(logisticsCell(next, 0, 0).consumerMoney).toBe(0);
  });

  it("raises malnutrition burden and mortality when food is missing", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    cell.population = 10;
    cell.malnutritionBurden = 1;

    const next = stepPriceLogistics(state);

    expect(logisticsCell(next, 0, 0).foodConsumed).toBe(0);
    expect(logisticsCell(next, 0, 0).malnutritionBurden).toBe(1);
    expect(logisticsCell(next, 0, 0).population).toBeLessThan(9);
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

    const next = stepPriceLogistics(state);

    expect(Number.isInteger(getLedgerBalance(next.ledger, consumer, account, "labor"))).toBe(true);
    expect(Number.isInteger(getLedgerBalance(next.ledger, consumer, account, "food"))).toBe(true);
  });

  it("floors fractional population before placing product demand orders", () => {
    const state = emptyState(1, 1);
    const cell = logisticsCell(state, 0, 0);
    cell.population = 0.9966214214995466;
    cell.localBid = 10;
    cell.consumerMoney = 20;
    cell.logisticsStock = 1;

    expect(() => stepPriceLogistics(state)).not.toThrow();
    expect(stepPriceLogistics(state).trades).toHaveLength(0);
  });

  it("allocates producer money to the factory with the larger labor margin first", () => {
    const state = emptyState(2, 1);
    state.money = 0;
    state.producerMoney = 20;
    logisticsCell(state, 0, 0).localBid = 20;
    logisticsCell(state, 0, 0).localAsk = 8;
    addLedgerBalance(state.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(state, 0, 0)), "factory", 1);
    logisticsCell(state, 0, 0).population = 1;
    logisticsCell(state, 0, 0).laborBid = 8;
    logisticsCell(state, 0, 0).laborAsk = 5;
    logisticsCell(state, 1, 0).localBid = 12;
    logisticsCell(state, 1, 0).localAsk = 8;
    addLedgerBalance(state.ledger, PRODUCER_AGENT, accountOfCell(logisticsCell(state, 1, 0)), "factory", 1);
    logisticsCell(state, 1, 0).population = 1;
    logisticsCell(state, 1, 0).laborBid = 8;
    logisticsCell(state, 1, 0).laborAsk = 2;

    const next = stepPriceLogistics(state);

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
