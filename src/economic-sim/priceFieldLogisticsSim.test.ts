import { describe, expect, it } from "vitest";
import {
  createPriceLogisticsState,
  logisticsCell,
  runAuction,
  stepPriceLogistics,
  type PriceLogisticsState,
} from "./priceFieldLogisticsSim";
import { accountOf } from "./ledger";
import { fieldCell } from "./priceFieldAutomaton";

function emptyState(width = 5, height = 1): PriceLogisticsState {
  const state = createPriceLogisticsState(width, height);
  state.money = 50;
  state.producerMoney = 0;
  for (const cell of state.cells) {
    cell.localBid = 0;
    cell.consumerMoney = 0;
    cell.bidVolume = 0;
    cell.localAsk = 0;
    cell.producerStock = 0;
    cell.logisticsStock = 0;
    cell.movedStock = 0;
    cell.lastBidFilled = 0;
    cell.lastBidUnfilled = 0;
    cell.lastAskFilled = 0;
    cell.lastAskUnfilled = 0;
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
    logisticsCell(state, 4, 0).bidVolume = 4;

    const next = stepTimes(state, 4);

    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(0);
    expect(logisticsCell(next, 1, 0).movedStock).toBe(1);
    expect(next.events).toContainEqual(expect.objectContaining({ kind: "move", fromX: 0, fromY: 0, toX: 1, toY: 0 }));
  });

  it("does not move the same product again until the next turn", () => {
    const state = emptyState();
    logisticsCell(state, 0, 0).logisticsStock = 1;
    logisticsCell(state, 4, 0).localBid = 30;
    logisticsCell(state, 4, 0).bidVolume = 4;

    const first = stepTimes(state, 4);
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
    logisticsCell(state, 4, 0).bidVolume = 4;

    const next = stepTimes(state, 5);

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
    logisticsCell(state, 4, 0).bidVolume = 4;

    const next = stepPriceLogistics(state);

    expect(next.events.filter((event) => event.kind === "buy" || event.kind === "move")).toHaveLength(0);
    expect(logisticsCell(next, 0, 0).logisticsStock).toBe(1);
    expect(logisticsCell(next, 0, 0).producerStock).toBe(2);
  });

  it("tracks consumer money paid to logistics through local sales", () => {
    const state = emptyState();
    logisticsCell(state, 2, 0).localBid = 12;
    logisticsCell(state, 2, 0).consumerMoney = 12;
    logisticsCell(state, 2, 0).bidVolume = 1;
    logisticsCell(state, 2, 0).logisticsStock = 1;

    const next = stepPriceLogistics(state);

    expect(next.events.some((event) => event.kind === "sell" && event.x === 2 && event.y === 0)).toBe(true);
    expect(next.money).toBeGreaterThan(state.money);
    expect(logisticsCell(next, 2, 0).consumerMoney).toBeLessThan(logisticsCell(state, 2, 0).consumerMoney + 12);
  });

  it("clips local consumer bids to cell-local money instead of overdrawing reserves", () => {
    const state = emptyState();
    logisticsCell(state, 2, 0).localBid = 12;
    logisticsCell(state, 2, 0).consumerMoney = 0;
    logisticsCell(state, 2, 0).bidVolume = 3;
    logisticsCell(state, 2, 0).logisticsStock = 3;

    const next = stepPriceLogistics(state);

    expect(logisticsCell(next, 2, 0).lastBidFilled).toBe(1);
    expect(logisticsCell(next, 2, 0).bidVolume).toBe(3);
    expect(logisticsCell(next, 2, 0).consumerMoney).toBe(0);
  });

  it("updates the existing price field one tick at a time", () => {
    const state = emptyState();
    logisticsCell(state, 4, 0).localBid = 12;
    logisticsCell(state, 4, 0).bidVolume = 1;

    const first = stepPriceLogistics(state);
    const second = stepPriceLogistics(first);

    expect(first.bidField.turn).toBe(state.bidField.turn + 1);
    expect(second.bidField.turn).toBe(first.bidField.turn + 1);
    expect(fieldCell(first.bidField, 4, 0).price).toBeGreaterThan(0);
    expect(fieldCell(first.bidField, 3, 0).price).toBe(0);
    expect(fieldCell(second.bidField, 3, 0).price).toBeGreaterThan(0);
  });

  it("raises unfilled consumer bids and lowers filled consumer bids", () => {
    const unfilled = emptyState();
    logisticsCell(unfilled, 0, 0).localBid = 10;
    logisticsCell(unfilled, 0, 0).lastBidUnfilled = 2;

    const raised = stepPriceLogistics(unfilled);
    expect(logisticsCell(raised, 0, 0).localBid).toBe(12);

    const filled = emptyState();
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
