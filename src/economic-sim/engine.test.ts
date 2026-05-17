import { describe, expect, it } from "vitest";
import { clearMarket, transportUnitCost } from "./engine";
import { MONEY_ACCOUNT } from "./constants";
import { accountOf, addBalance, makeLedger } from "./ledger";
import type { Account, Ledger, Order } from "./types";

function order(overrides: Partial<Order> & Pick<Order, "id" | "agent" | "side" | "price" | "quantity">): Order {
  return {
    account: accountOf(1, 1),
    resource: "widget",
    remaining: overrides.quantity,
    ...overrides,
  };
}

function balance(ledger: Ledger, agent: keyof Ledger, account: Account, resource: keyof Ledger[keyof Ledger][string]) {
  return ledger[agent][account]?.[resource] ?? 0;
}

function marketLedger() {
  const ledger = makeLedger();
  ledger.Producer = {};
  ledger["Consumer-1,1"] = {};
  ledger["Logistics-0"] = {};
  return ledger;
}

describe("clearMarket", () => {
  it("splits crossed spread at the rounded midpoint and refunds the buyer reserve", () => {
    const cell = accountOf(1, 1);
    const ledger = marketLedger();
    ledger.Producer = { [cell]: { widget: 3 }, [MONEY_ACCOUNT]: {} };
    ledger["Consumer-1,1"] = { [MONEY_ACCOUNT]: { money: 80 } };

    const result = clearMarket(ledger, [
      order({ id: 1, agent: "Consumer-1,1", side: "bid", price: 10, quantity: 2 }),
      order({ id: 2, agent: "Producer", side: "ask", price: 8, quantity: 2 }),
    ]);

    expect(result.trades).toEqual([{ x: 1, y: 1, buyer: "Consumer-1,1", seller: "Producer", quantity: 2, price: 9 }]);
    expect(balance(ledger, "Consumer-1,1", MONEY_ACCOUNT, "money")).toBe(82);
    expect(balance(ledger, "Consumer-1,1", cell, "widget")).toBe(2);
    expect(balance(ledger, "Producer", MONEY_ACCOUNT, "money")).toBe(18);
  });

  it("rounds odd midpoint prices toward the nearest integer", () => {
    const cell = accountOf(1, 1);
    const ledger = marketLedger();
    ledger.Producer = { [cell]: { widget: 0 } };
    ledger["Consumer-1,1"] = { [MONEY_ACCOUNT]: { money: 89 } };

    const result = clearMarket(ledger, [
      order({ id: 1, agent: "Consumer-1,1", side: "bid", price: 11, quantity: 1 }),
      order({ id: 2, agent: "Producer", side: "ask", price: 8, quantity: 1 }),
    ]);

    expect(result.trades[0]?.price).toBe(10);
    expect(balance(ledger, "Consumer-1,1", MONEY_ACCOUNT, "money")).toBe(90);
    expect(balance(ledger, "Producer", MONEY_ACCOUNT, "money")).toBe(10);
  });

  it("refunds both sides when the best bid does not cross the best ask", () => {
    const cell = accountOf(1, 1);
    const ledger = marketLedger();
    ledger.Producer = { [cell]: { widget: 4 } };
    ledger["Consumer-1,1"] = { [MONEY_ACCOUNT]: { money: 92 } };

    const result = clearMarket(ledger, [
      order({ id: 1, agent: "Consumer-1,1", side: "bid", price: 8, quantity: 1 }),
      order({ id: 2, agent: "Producer", side: "ask", price: 10, quantity: 1 }),
    ]);

    expect(result.trades).toEqual([]);
    expect(balance(ledger, "Consumer-1,1", MONEY_ACCOUNT, "money")).toBe(100);
    expect(balance(ledger, "Producer", cell, "widget")).toBe(5);
  });

  it("partially fills larger orders and refunds the unfilled ask quantity", () => {
    const cell = accountOf(1, 1);
    const ledger = marketLedger();
    ledger.Producer = { [cell]: { widget: 2 } };
    ledger["Consumer-1,1"] = { [MONEY_ACCOUNT]: { money: 90 } };

    const result = clearMarket(ledger, [
      order({ id: 1, agent: "Consumer-1,1", side: "bid", price: 10, quantity: 1 }),
      order({ id: 2, agent: "Producer", side: "ask", price: 6, quantity: 3 }),
    ]);

    expect(result.trades).toEqual([{ x: 1, y: 1, buyer: "Consumer-1,1", seller: "Producer", quantity: 1, price: 8 }]);
    expect(result.orderResults).toEqual([
      expect.objectContaining({ id: 1, filled: 1, unfilled: 0 }),
      expect.objectContaining({ id: 2, filled: 1, unfilled: 2 }),
    ]);
    expect(balance(ledger, "Producer", cell, "widget")).toBe(4);
  });

  it("keeps markets local to each physical account", () => {
    const bidCell = accountOf(1, 1);
    const askCell = accountOf(2, 2);
    const ledger = marketLedger();
    ledger.Producer = { [askCell]: { widget: 0 } };
    ledger["Consumer-1,1"] = { [MONEY_ACCOUNT]: { money: 90 } };

    const result = clearMarket(ledger, [
      order({ id: 1, agent: "Consumer-1,1", account: bidCell, side: "bid", price: 10, quantity: 1 }),
      order({ id: 2, agent: "Producer", account: askCell, side: "ask", price: 1, quantity: 1 }),
    ]);

    expect(result.trades).toEqual([]);
    expect(balance(ledger, "Consumer-1,1", MONEY_ACCOUNT, "money")).toBe(100);
    expect(balance(ledger, "Producer", askCell, "widget")).toBe(1);
  });
});

describe("transportUnitCost", () => {
  it("finds the cheapest path around congested cells using roads as local offsets", () => {
    const ledger = makeLedger();
    addBalance(ledger, "Common", accountOf(1, 0), "last-congestion", 8);
    addBalance(ledger, "Common", accountOf(1, 0), "road", 1);
    addBalance(ledger, "Common", accountOf(0, 1), "road", 3);
    addBalance(ledger, "Common", accountOf(1, 1), "road", 3);
    addBalance(ledger, "Common", accountOf(2, 1), "road", 3);

    expect(transportUnitCost(ledger, accountOf(0, 0), accountOf(2, 0))).toBe(9);
  });

  it("adds a fixed unit penalty when entering cells without roads", () => {
    const ledger = makeLedger();

    expect(transportUnitCost(ledger, accountOf(0, 0), accountOf(1, 0))).toBe(6);
  });

  it("uses a symmetric canonical source-destination pair for unit cost", () => {
    const ledger = makeLedger();
    addBalance(ledger, "Common", accountOf(1, 0), "road", 10);

    expect(transportUnitCost(ledger, accountOf(0, 0), accountOf(1, 0))).toBe(1);
    expect(transportUnitCost(ledger, accountOf(1, 0), accountOf(0, 0))).toBe(1);
  });
});
