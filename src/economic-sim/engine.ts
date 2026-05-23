import shuffle from "lodash/shuffle";
import { AGENTS, GRID_HEIGHT, GRID_WIDTH, MONEY_ACCOUNT } from "./constants";
import { AGENT_POLICIES } from "./agents";
import {
  addBalance,
  assertSafeAmount,
  cellsWith,
  checkedAdd,
  checkedMul,
  checkedSub,
  cloneLedger,
  getBalance,
  parseAccount,
  reserveBalance,
  setBalance,
} from "./ledger";
import { PowerGridInfrastructure, syncPowerGridInfrastructureToLedger } from "./powerGridInfrastructure";
import type { Account, Agent, AgentApi, Ledger, Order, OrderResult, SimState, Trade, Transport } from "./types";

type TransportQuote = {
  path: Account[];
  unitCost: number;
  congestionAccount: Account | undefined;
};

type TransportQuoteCache = Map<string, TransportQuote>;

function sortByValueAsc<T>(items: T[], value: (item: T) => number, value2?: (item: T) => number) {
  return [...items].sort((a, b) => {
    const primary = value(a) - value(b);
    if (primary !== 0 || !value2) return primary;
    return value2(a) - value2(b);
  });
}

function midpointPrice(bidPrice: number, askPrice: number) {
  return Math.round(checkedAdd(bidPrice, askPrice, "midpoint trade price") / 2);
}

function placeOrder(
  ledger: Ledger,
  orders: Order[],
  nextOrderId: number,
  order: Omit<Order, "id" | "remaining">,
) {
  assertSafeAmount(order.quantity, "order quantity");
  assertSafeAmount(order.price, "order price");
  if (order.quantity === 0) return nextOrderId;

  if (order.side === "bid") {
    reserveBalance(ledger, order.agent, MONEY_ACCOUNT, "money", checkedMul(order.quantity, order.price, "bid reserve"));
  } else {
    reserveBalance(ledger, order.agent, order.account, order.resource, order.quantity);
  }

  orders.push({ ...order, id: nextOrderId, remaining: order.quantity });
  return checkedAdd(nextOrderId, 1, "next order id");
}

function orderAuctionKey(order: Order, powerGridInfrastructure?: PowerGridInfrastructure) {
  if (order.resource === "electricity") {
    const gridId = powerGridInfrastructure?.gridIdAt(order.account);
    return gridId === undefined || gridId === null ? null : `electricity-grid-${gridId}`;
  }
  return `${order.resource}-${order.account}`;
}

export function clearMarket(ledger: Ledger, orders: Order[], powerGridInfrastructure?: PowerGridInfrastructure) {
  const trades: Trade[] = [];
  const grouped = new Map<string, { bids: Order[]; asks: Order[] }>();

  for (const order of orders) {
    const key = orderAuctionKey(order, powerGridInfrastructure);
    if (!key) continue;
    const group = grouped.get(key) ?? { bids: [], asks: [] };
    if (order.side === "bid") group.bids.push(order);
    else group.asks.push(order);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const bids = sortByValueAsc(group.bids, (order) => -order.price, (order) => order.id);
    const asks = sortByValueAsc(group.asks, (order) => order.price, (order) => order.id);
    let bidIndex = 0;
    let askIndex = 0;

    while (bidIndex < bids.length && askIndex < asks.length) {
      const bid = bids[bidIndex];
      const ask = asks[askIndex];
      if (!bid || !ask || bid.price < ask.price) break;
      const quantity = Math.min(bid.remaining, ask.remaining);
      const price = midpointPrice(bid.price, ask.price);
      const payment = checkedMul(quantity, price, "trade payment");
      const bidReserve = checkedMul(quantity, bid.price, "bid reserve spent");
      const refund = checkedSub(bidReserve, payment, "bid price improvement refund");
      const coord = parseAccount(bid.account);
      if (!coord) throw new Error("Market bid requires a physical account");

      addBalance(ledger, ask.agent, MONEY_ACCOUNT, "money", payment);
      addBalance(ledger, bid.agent, bid.account, bid.resource, quantity);
      if (refund > 0) addBalance(ledger, bid.agent, MONEY_ACCOUNT, "money", refund);

      bid.remaining = checkedSub(bid.remaining, quantity, "bid remaining");
      ask.remaining = checkedSub(ask.remaining, quantity, "ask remaining");
      trades.push({ ...coord, resource: bid.resource, buyer: bid.agent, seller: ask.agent, quantity, price });

      if (bid.remaining === 0) bidIndex += 1;
      if (ask.remaining === 0) askIndex += 1;
    }
  }

  const orderResults = orders.map((order): OrderResult => {
    const unfilled = order.remaining;
    return {
      id: order.id,
      agent: order.agent,
      account: order.account,
      resource: order.resource,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      filled: checkedSub(order.quantity, unfilled, "order filled"),
      unfilled,
    };
  });

  for (const order of orders) {
    if (order.remaining === 0) continue;
    if (order.side === "bid") {
      addBalance(
        ledger,
        order.agent,
        MONEY_ACCOUNT,
        "money",
        checkedMul(order.remaining, order.price, "bid refund"),
      );
    } else {
      addBalance(ledger, order.agent, order.account, order.resource, order.remaining);
    }
    order.remaining = 0;
  }

  return { trades, orderResults };
}

function localTransportUnitCost(ledger: Ledger, account: Account) {
  const road = getBalance(ledger, "Common", account, "road");
  const congestionCost = Math.max(1, getBalance(ledger, "Common", account, "last-congestion") - road);
  return congestionCost + (road === 0 ? 5 : 0);
}

function neighbors({ x, y }: { x: number; y: number }) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ].filter((coord) => coord.x >= 0 && coord.x < GRID_WIDTH && coord.y >= 0 && coord.y < GRID_HEIGHT);
}

function comparePhysicalAccounts(a: Account, b: Account) {
  const aCoord = parseAccount(a);
  const bCoord = parseAccount(b);
  if (!aCoord || !bCoord) throw new Error("Transport requires physical cell accounts");
  const xDiff = aCoord.x - bCoord.x;
  return xDiff !== 0 ? xDiff : aCoord.y - bCoord.y;
}

function canonicalTransportPair(from: Account, to: Account): [Account, Account] {
  return comparePhysicalAccounts(from, to) <= 0 ? [from, to] : [to, from];
}

function transportPairKey(from: Account, to: Account) {
  const [a, b] = canonicalTransportPair(from, to);
  return `${a}|${b}`;
}

export function transportPath(ledger: Ledger, from: Account, to: Account) {
  const fromCoord = parseAccount(from);
  const toCoord = parseAccount(to);
  if (!fromCoord || !toCoord) throw new Error("Transport requires physical cell accounts");
  if (from === to) return [from];

  const best = new Map<Account, number>([[from, 0]]);
  const previous = new Map<Account, Account>();
  const unsettled: Account[] = [from];

  while (unsettled.length > 0) {
    unsettled.sort((a, b) => (best.get(a) ?? Number.POSITIVE_INFINITY) - (best.get(b) ?? Number.POSITIVE_INFINITY));
    const current = unsettled.shift();
    if (!current) break;
    if (current === to) break;
    const currentCoord = parseAccount(current);
    if (!currentCoord) continue;
    const currentCost = best.get(current) ?? Number.POSITIVE_INFINITY;
    for (const neighbor of neighbors(currentCoord)) {
      const account = `${neighbor.x},${neighbor.y}` as Account;
      const nextCost = currentCost + localTransportUnitCost(ledger, account);
      if (nextCost >= (best.get(account) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(account, nextCost);
      previous.set(account, current);
      if (!unsettled.includes(account)) unsettled.push(account);
    }
  }

  if (!best.has(to)) throw new Error(`No transport path from ${from} to ${to}`);
  const path = [to];
  while (path[0] !== from) {
    const before = previous.get(path[0]);
    if (!before) throw new Error(`No transport path from ${from} to ${to}`);
    path.unshift(before);
  }
  return path;
}

function pathUnitCost(ledger: Ledger, path: Account[]) {
  return path.slice(1).reduce((sum, account) => sum + localTransportUnitCost(ledger, account), 0);
}

function createTransportQuote(ledger: Ledger, from: Account, to: Account): TransportQuote {
  const [canonicalFrom, canonicalTo] = canonicalTransportPair(from, to);
  const path = transportPath(ledger, canonicalFrom, canonicalTo);
  const congestionAccount = path[Math.floor(Math.random() * path.length)];
  return {
    path,
    unitCost: pathUnitCost(ledger, path),
    congestionAccount,
  };
}

function transportQuote(ledger: Ledger, cache: TransportQuoteCache, from: Account, to: Account) {
  const key = transportPairKey(from, to);
  const cached = cache.get(key);
  if (cached) return cached;
  const quote = createTransportQuote(ledger, from, to);
  cache.set(key, quote);
  return quote;
}

function quotePathForDirection(quote: TransportQuote, from: Account, to: Account) {
  if (quote.path[0] === from && quote.path[quote.path.length - 1] === to) return quote.path;
  return [...quote.path].reverse();
}

export function transportUnitCost(ledger: Ledger, from: Account, to: Account) {
  return createTransportQuote(ledger, from, to).unitCost;
}

export function transportTotalCost(quantity: number, unitCost: number) {
  assertSafeAmount(quantity, "transport cost quantity");
  if (quantity === 0) return 0;
  const totalCost = Math.max(1, Math.ceil(quantity * unitCost));
  assertSafeAmount(totalCost, "transport total cost");
  return totalCost;
}

function affordableTransportQuantity(requestedQuantity: number, money: number, unitCost: number) {
  let quantity = requestedQuantity;
  while (quantity > 0 && transportTotalCost(quantity, unitCost) > money) {
    quantity -= 1;
  }
  return quantity;
}

function createAgentApi(
  agent: Agent,
  ledger: Ledger,
  orders: Order[],
  transports: Transport[],
  transportQuoteCache: TransportQuoteCache,
  lastOrderResults: OrderResult[],
  getNextOrderId: () => number,
  setNextOrderId: (nextOrderId: number) => void,
): AgentApi {
  const submitOrder = (order: Omit<Order, "agent" | "id" | "remaining">) => {
    setNextOrderId(placeOrder(ledger, orders, getNextOrderId(), { ...order, agent }));
  };

  return {
    balance: (account, resource) => getBalance(ledger, agent, account, resource),
    cellsWith: (resource) => cellsWith(ledger, agent, resource),
    observeCells: (observedAgent, resource) => cellsWith(ledger, observedAgent, resource),
    lastOrderResults,
    placeBid: (account, resource, price, quantity) => {
      submitOrder({ account, resource, side: "bid", price, quantity });
    },
    placeAsk: (account, resource, price, quantity) => {
      submitOrder({ account, resource, side: "ask", price, quantity });
    },
    transportUnitCost: (from, to) => transportQuote(ledger, transportQuoteCache, from, to).unitCost,
    requestTransport: (from, to, resource, requestedQuantity) => {
      assertSafeAmount(requestedQuantity, "transport quantity");
      if (requestedQuantity === 0 || from === to) return;
      const quote = transportQuote(ledger, transportQuoteCache, from, to);
      const path = quotePathForDirection(quote, from, to);
      const unitCost = quote.unitCost;
      const money = getBalance(ledger, agent, MONEY_ACCOUNT, "money");
      const available = getBalance(ledger, agent, from, resource);
      const requestedAvailable = Math.min(requestedQuantity, available);
      const quantity = affordableTransportQuantity(requestedAvailable, money, unitCost);
      if (quantity <= 0) return;
      const totalCost = transportTotalCost(quantity, unitCost);
      reserveBalance(ledger, agent, from, resource, quantity);
      reserveBalance(ledger, agent, MONEY_ACCOUNT, "money", totalCost);
      addBalance(ledger, agent, to, resource, quantity);
      if (quote.congestionAccount) {
        addBalance(ledger, "Common", quote.congestionAccount, "congestion", quantity);
      }
      transports.push({ agent, from, to, resource, quantity, cost: totalCost, path });
      if (agent.startsWith("Logistics-")) {
        console.log("Logistics transported widgets", { from, to, quantity, cost: totalCost });
      }
    },
  };
}

function applyResourceGeneration(ledger: Ledger) {
  const commonAccounts = new Set<Account>([
    ...cellsWith(ledger, "Common", "congestion").map((cell) => cell.account),
    ...cellsWith(ledger, "Common", "last-congestion").map((cell) => cell.account),
  ]);
  for (const account of commonAccounts) {
    const congestion = getBalance(ledger, "Common", account, "congestion");
    setBalance(ledger, "Common", account, "last-congestion", congestion);
    setBalance(ledger, "Common", account, "congestion", 0);
  }
  for (const agent of AGENTS) {
    for (const factory of cellsWith(ledger, agent, "factory")) {
      addBalance(ledger, agent, factory.account, "widget", checkedMul(factory.amount, 5, "factory output"));
      addBalance(ledger, agent, factory.account, "electricity", checkedMul(factory.amount, 8, "factory power output"));
    }
    for (const population of cellsWith(ledger, agent, "population")) {
      addBalance(ledger, agent, MONEY_ACCOUNT, "money", checkedMul(population.amount, 6, "population income"));
    }
  }
}

export function stepSimulation(state: SimState): SimState {
  const ledger = cloneLedger(state.ledger);
  const powerGridInfrastructure = state.powerGridInfrastructure.clone();
  const orders: Order[] = [];
  const transports: Transport[] = [];
  const transportQuoteCache: TransportQuoteCache = new Map();
  let nextOrderId = state.nextOrderId;

  powerGridInfrastructure.update();
  syncPowerGridInfrastructureToLedger(ledger, powerGridInfrastructure);
  applyResourceGeneration(ledger);

  const apiFor = (agent: Agent) =>
    createAgentApi(
      agent,
      ledger,
      orders,
      transports,
      transportQuoteCache,
      state.lastOrderResults.filter((result) => result.agent === agent),
      () => nextOrderId,
      (updatedNextOrderId) => {
        nextOrderId = updatedNextOrderId;
      },
    );

  for (const policy of shuffle(AGENT_POLICIES)) {
    policy.run(apiFor(policy.agent), {
      lastTrades: state.trades,
      publicLastOrderResults: state.lastOrderResults,
    });
  }

  const { trades, orderResults } = clearMarket(ledger, orders, powerGridInfrastructure);

  return {
    turn: checkedAdd(state.turn, 1, "turn"),
    nextOrderId,
    ledger,
    powerGridInfrastructure,
    orders,
    lastOrderResults: orderResults,
    trades,
    transports,
    note: `${trades.length} trades, ${transports.length} transports`,
  };
}
