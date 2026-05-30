import { describe, expect, it } from "vitest";
import { MONEY_ACCOUNT, consumerAgentFor } from "./constants";
import { accountOf } from "./ledger";
import { createElectricityLogisticsPlanner, createLogisticsMarketPlanner } from "./logisticsPlanner";
import type { Account, Agent, AgentApi, CellBalance, OrderResult, Resource, Trade } from "./types";

type Balances = Partial<Record<Agent, Record<string, Partial<Record<Resource, number>>>>>;

function cell(account: Account, amount: number): CellBalance {
  const [x, y] = account.split(",").map(Number);
  return { account, x, y, amount };
}

function getBalance(balances: Balances, agent: Agent, account: Account, resource: Resource) {
  return balances[agent]?.[account]?.[resource] ?? 0;
}

function setBalance(balances: Balances, agent: Agent, account: Account, resource: Resource, amount: number) {
  balances[agent] = balances[agent] ?? {};
  balances[agent][account] = balances[agent][account] ?? {};
  balances[agent][account][resource] = amount;
}

function addBalance(balances: Balances, agent: Agent, account: Account, resource: Resource, amount: number) {
  setBalance(balances, agent, account, resource, getBalance(balances, agent, account, resource) + amount);
}

function bidResult(agent: Agent, account: Account, price: number, quantity: number, unfilled = 0): OrderResult {
  return {
    id: 1,
    agent,
    account,
    resource: "widget",
    side: "bid",
    price,
    quantity,
    filled: quantity - unfilled,
    unfilled,
  };
}

function makeApi(balances: Balances, self: Agent = "Logistics-0") {
  const transports: Array<{ from: Account; to: Account; quantity: number }> = [];
  const asks: Array<{ account: Account; price: number; quantity: number }> = [];
  const bids: Array<{ account: Account; price: number; quantity: number }> = [];

  const api: AgentApi = {
    balance: (account, resource) => getBalance(balances, self, account, resource),
    cellsWith: (resource) =>
      Object.entries(balances[self] ?? {})
        .filter(([account, resources]) => account !== MONEY_ACCOUNT && (resources[resource] ?? 0) > 0)
        .map(([account, resources]) => cell(account as Account, resources[resource] ?? 0)),
    observeCells: (agent, resource) =>
      Object.entries(balances[agent] ?? {})
        .filter(([account, resources]) => account !== MONEY_ACCOUNT && (resources[resource] ?? 0) > 0)
        .map(([account, resources]) => cell(account as Account, resources[resource] ?? 0)),
    lastOrderResults: [],
    placeBid: (account, _resource, price, quantity) => {
      if (price * quantity > getBalance(balances, self, MONEY_ACCOUNT, "money")) {
        throw new Error("reserve money would go negative");
      }
      addBalance(balances, self, MONEY_ACCOUNT, "money", -price * quantity);
      bids.push({ account, price, quantity });
    },
    placeAsk: (account, _resource, price, quantity) => {
      asks.push({ account, price, quantity });
    },
    transportUnitCost: (from, to) =>
      (Math.abs(Number(from.split(",")[0]) - Number(to.split(",")[0])) +
        Math.abs(Number(from.split(",")[1]) - Number(to.split(",")[1]))) /
      3,
    electricityDeliveryFactor: (from, to) => {
      const distance =
        Math.abs(Number(from.split(",")[0]) - Number(to.split(",")[0])) +
        Math.abs(Number(from.split(",")[1]) - Number(to.split(",")[1]));
      return (19 / 20) ** distance;
    },
    requestTransport: (from, to, _resource, quantity) => {
      const unitCost = api.transportUnitCost(from, to);
      const cost = Math.max(1, Math.ceil(quantity * unitCost));
      addBalance(balances, self, from, "widget", -quantity);
      addBalance(balances, self, MONEY_ACCOUNT, "money", -cost);
      addBalance(balances, self, to, "widget", quantity);
      transports.push({ from, to, quantity });
    },
    requestElectricityTransportGross: (from, to, grossQuantity) => {
      const factor = api.electricityDeliveryFactor(from, to) ?? 0;
      const grossSpent = Math.min(grossQuantity, getBalance(balances, self, from, "electricity"));
      const delivered = grossSpent - Math.ceil(grossSpent * (1 - factor));
      addBalance(balances, self, from, "electricity", -grossSpent);
      addBalance(balances, self, to, "electricity", delivered);
      transports.push({ from, to, quantity: grossSpent });
    },
  };

  return { api, transports, asks, bids };
}

describe("LogisticsMarketPlanner", () => {
  it("moves existing inventory immediately and then asks it at the destination", () => {
    const source = accountOf(2, 5);
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: {},
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [source]: { widget: 1 } },
    };
    const { api, transports, asks, bids } = makeApi(balances);
    api.lastOrderResults.push(bidResult(consumer, destination, 20, 2, 2));
    const trades: Trade[] = [{ x: 5, y: 5, resource: "widget", buyer: consumer, seller: "Producer", quantity: 2, price: 20 }];

    createLogisticsMarketPlanner().run(api, { lastTrades: trades, publicLastOrderResults: api.lastOrderResults });

    expect(transports).toEqual([{ from: source, to: destination, quantity: 1 }]);
    expect(asks).toEqual([{ account: destination, price: 20, quantity: 1 }]);
    expect(bids).toEqual([]);
  });

  it("does not move inventory out of a source market with equal modeled value", () => {
    const source = accountOf(5, 5);
    const destination = accountOf(9, 13);
    const sourceConsumer = consumerAgentFor(5, 5);
    const destinationConsumer = consumerAgentFor(9, 13);
    const balances: Balances = {
      Producer: {},
      [sourceConsumer]: { [source]: { population: 1 } },
      [destinationConsumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [source]: { widget: 1 } },
    };
    const { api, transports, asks } = makeApi(balances);
    api.lastOrderResults.push(bidResult(sourceConsumer, source, 20, 1));
    api.lastOrderResults.push(bidResult(destinationConsumer, destination, 20, 1));
    const trades: Trade[] = [
      { x: 5, y: 5, resource: "widget", buyer: sourceConsumer, seller: "Producer", quantity: 1, price: 20 },
      { x: 9, y: 13, resource: "widget", buyer: destinationConsumer, seller: "Producer", quantity: 1, price: 20 },
    ];

    createLogisticsMarketPlanner().run(api, { lastTrades: trades, publicLastOrderResults: api.lastOrderResults });

    expect(transports).toEqual([]);
    expect(asks).toEqual([{ account: source, price: 20, quantity: 1 }]);
  });

  it("raises destination asks after filled sale orders", () => {
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: {},
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [destination]: { widget: 1 } },
    };
    const { api, asks } = makeApi(balances);
    api.lastOrderResults.push({
      id: 1,
      agent: "Logistics-0",
      account: destination,
      resource: "widget",
      side: "ask",
      price: 20,
      quantity: 1,
      filled: 1,
      unfilled: 0,
    });
    api.lastOrderResults.push(bidResult(consumer, destination, 20, 1));
    const trades: Trade[] = [{ x: 5, y: 5, resource: "widget", buyer: consumer, seller: "Logistics-0", quantity: 1, price: 20 }];

    createLogisticsMarketPlanner().run(api, { lastTrades: trades, publicLastOrderResults: api.lastOrderResults });

    expect(asks).toEqual([{ account: destination, price: 22, quantity: 1 }]);
  });

  it("uses observed traded volume as residual demand after fully filled asks", () => {
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const planner = createLogisticsMarketPlanner();
    const balances: Balances = {
      Producer: {},
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [destination]: { widget: 3 } },
    };
    const { api, asks } = makeApi(balances);
    api.lastOrderResults.push({
      id: 1,
      agent: "Logistics-0",
      account: destination,
      resource: "widget",
      side: "ask",
      price: 20,
      quantity: 1,
      filled: 1,
      unfilled: 0,
    });
    api.lastOrderResults.push(bidResult(consumer, destination, 20, 1));

    planner.run(api, { lastTrades: [{ x: 5, y: 5, resource: "widget", buyer: consumer, seller: "Logistics-0", quantity: 1, price: 20 }], publicLastOrderResults: api.lastOrderResults });

    expect(planner.valueByCell(api, []).get(destination)).toBeCloseTo(20 * 0.92 ** 3);
    expect(asks).toEqual([{ account: destination, price: 22, quantity: 3 }]);
  });

  it("adds unmet bids to residual demand", () => {
    const source = accountOf(2, 5);
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: {},
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [source]: { widget: 1 } },
    };
    const { api, transports, asks } = makeApi(balances);
    api.lastOrderResults.push(bidResult(consumer, destination, 30, 3, 3));

    createLogisticsMarketPlanner().run(api, { lastTrades: [], publicLastOrderResults: api.lastOrderResults });

    expect(transports).toEqual([{ from: source, to: destination, quantity: 1 }]);
    expect(asks).toEqual([{ account: destination, price: 30, quantity: 1 }]);
  });

  it("uses bid prices for local price even when bids are unfilled", () => {
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: {},
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [destination]: { widget: 1 } },
    };
    const { api, asks } = makeApi(balances);
    api.lastOrderResults.push(bidResult(consumer, destination, 31, 2, 2));

    createLogisticsMarketPlanner().run(api, { lastTrades: [], publicLastOrderResults: api.lastOrderResults });

    expect(asks).toEqual([{ account: destination, price: 31, quantity: 1 }]);
  });

  it("does not count other sellers' met bids as residual demand", () => {
    const source = accountOf(2, 5);
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: {},
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [source]: { widget: 1 } },
    };
    const { api, transports, asks } = makeApi(balances);
    api.lastOrderResults.push({
      id: 1,
      agent: "Logistics-0",
      account: destination,
      resource: "widget",
      side: "ask",
      price: 12,
      quantity: 1,
      filled: 0,
      unfilled: 1,
    });
    api.lastOrderResults.push(bidResult(consumer, destination, 30, 3));
    const trades: Trade[] = [{ x: 5, y: 5, resource: "widget", buyer: consumer, seller: "Producer", quantity: 3, price: 30 }];

    createLogisticsMarketPlanner().run(api, { lastTrades: trades, publicLastOrderResults: api.lastOrderResults });

    expect(transports).toEqual([]);
    expect(asks).toEqual([]);
  });

  it("places delayed source bids when buying has positive modeled value", () => {
    const source = accountOf(2, 5);
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: { [source]: { factory: 1 } },
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 } },
    };
    const { api, transports, asks, bids } = makeApi(balances);
    api.lastOrderResults.push(bidResult(consumer, destination, 20, 2, 2));
    const trades: Trade[] = [{ x: 5, y: 5, resource: "widget", buyer: consumer, seller: "Producer", quantity: 2, price: 20 }];

    createLogisticsMarketPlanner().run(api, { lastTrades: trades, publicLastOrderResults: api.lastOrderResults });

    expect(transports).toEqual([]);
    expect(asks).toEqual([]);
    expect(bids).toEqual([
      { account: source, price: 10, quantity: 1 },
      { account: source, price: 10, quantity: 1 },
    ]);
  });

  it("marks a destination with unfilled sale orders as having no immediate throughput", () => {
    const source = accountOf(2, 5);
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: {},
      [consumer]: { [destination]: { population: 1 } },
      "Logistics-0": { [MONEY_ACCOUNT]: { money: 20 }, [source]: { widget: 1 } },
    };
    const { api, transports, asks } = makeApi(balances);
    const unfilledAsk: OrderResult = {
      id: 1,
      agent: "Logistics-0",
      account: destination,
      resource: "widget",
      side: "ask",
      price: 12,
      quantity: 1,
      filled: 0,
      unfilled: 1,
    };
    api.lastOrderResults.push(unfilledAsk);

    createLogisticsMarketPlanner().run(api, { lastTrades: [], publicLastOrderResults: api.lastOrderResults });

    expect(transports).toEqual([]);
    expect(asks).toEqual([]);
  });

  it("does not bid for source electricity when electricity logistics cannot afford it", () => {
    const source = accountOf(2, 2);
    const destination = accountOf(5, 5);
    const consumer = consumerAgentFor(5, 5);
    const balances: Balances = {
      Producer: { [source]: { "power-plant": 1 } },
      [consumer]: { [destination]: { population: 1 } },
      ElectricityLogistics: { [MONEY_ACCOUNT]: { money: 2 } },
    };
    const { api, bids } = makeApi(balances, "ElectricityLogistics");
    api.lastOrderResults.push({
      id: 1,
      agent: consumer,
      account: destination,
      resource: "electricity",
      side: "bid",
      price: 8,
      quantity: 5,
      filled: 0,
      unfilled: 5,
    });

    expect(() =>
      createElectricityLogisticsPlanner().run(api, { lastTrades: [], publicLastOrderResults: api.lastOrderResults }),
    ).not.toThrow();
    expect(bids).toEqual([]);
  });
});
