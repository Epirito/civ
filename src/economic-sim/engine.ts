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
import type { Account, Agent, AgentApi, Ledger, MarketResource, Order, OrderResult, SimState, Trade, Transport } from "./types";

type TransportQuote = {
  path: Account[];
  unitCost: number;
};

type ElectricityTransportQuote = {
  path: Account[];
  deliveryFactor: number;
};

type TransportQuoteCache = Map<string, TransportQuote>;
type ElectricityRouteTree = {
  previous: Map<Account, Account>;
  distance: Map<Account, number>;
};
type ElectricityTransportQuoteCache = {
  quotes: Map<string, ElectricityTransportQuote | null>;
  routeTrees: Map<Account, ElectricityRouteTree | null>;
};
const ELECTRICITY_LINE_EFFICIENCY = 19 / 20;

export type SimulationOptions = {
  random?: () => number;
  profiler?: SimulationProfiler;
};

export type SimulationProfiler = {
  record: (name: string, durationMs: number) => void;
};

class MinPriorityQueue<T> {
  private readonly heap: Array<{ item: T; priority: number }> = [];

  get size() {
    return this.heap.length;
  }

  push(item: T, priority: number) {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    const min = this.heap[0];
    const last = this.heap.pop();
    if (!last || !min) return undefined;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return min;
  }

  private bubbleUp(index: number) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.heap[parent].priority <= this.heap[current].priority) break;
      [this.heap[parent], this.heap[current]] = [this.heap[current], this.heap[parent]];
      current = parent;
    }
  }

  private bubbleDown(index: number) {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;
      if (left < this.heap.length && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < this.heap.length && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === current) break;
      [this.heap[current], this.heap[smallest]] = [this.heap[smallest], this.heap[current]];
      current = smallest;
    }
  }
}

function sortByValueAsc<T>(items: T[], value: (item: T) => number, value2?: (item: T) => number) {
  return [...items].sort((a, b) => {
    const primary = value(a) - value(b);
    if (primary !== 0 || !value2) return primary;
    return value2(a) - value2(b);
  });
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
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

export function clearMarket(ledger: Ledger, orders: Order[]) {
  const trades: Trade[] = [];
  const grouped = new Map<string, { account: Account; resource: MarketResource; bids: Order[]; asks: Order[] }>();

  for (const order of orders) {
    const key = `${order.account}|${order.resource}`;
    const group = grouped.get(key) ?? { account: order.account, resource: order.resource, bids: [], asks: [] };
    if (order.side === "bid") group.bids.push(order);
    else group.asks.push(order);
    grouped.set(key, group);
  }

  for (const { account, resource, bids: groupBids, asks: groupAsks } of grouped.values()) {
    const coord = parseAccount(account);
    if (!coord) continue;
    const bids = sortByValueAsc(groupBids, (order) => -order.price, (order) => order.id);
    const asks = sortByValueAsc(groupAsks, (order) => order.price, (order) => order.id);
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

      addBalance(ledger, ask.agent, MONEY_ACCOUNT, "money", payment);
      addBalance(ledger, bid.agent, account, resource, quantity);
      if (refund > 0) addBalance(ledger, bid.agent, MONEY_ACCOUNT, "money", refund);

      bid.remaining = checkedSub(bid.remaining, quantity, "bid remaining");
      ask.remaining = checkedSub(ask.remaining, quantity, "ask remaining");
      trades.push({ ...coord, resource, buyer: bid.agent, seller: ask.agent, quantity, price });

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

function hasPowerLine(ledger: Ledger, account: Account) {
  return getBalance(ledger, "Common", account, "power-line") > 0;
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
  const unsettled = new MinPriorityQueue<Account>();
  unsettled.push(from, 0);

  while (unsettled.size > 0) {
    const next = unsettled.pop();
    if (!next) break;
    const { item: current, priority: currentCost } = next;
    if (currentCost > (best.get(current) ?? Number.POSITIVE_INFINITY)) continue;
    if (current === to) break;
    const currentCoord = parseAccount(current);
    if (!currentCoord) continue;
    for (const neighbor of neighbors(currentCoord)) {
      const account = `${neighbor.x},${neighbor.y}` as Account;
      const nextCost = currentCost + localTransportUnitCost(ledger, account);
      if (nextCost >= (best.get(account) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(account, nextCost);
      previous.set(account, current);
      unsettled.push(account, nextCost);
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

export function electricityTransportPath(ledger: Ledger, from: Account, to: Account) {
  const fromCoord = parseAccount(from);
  const toCoord = parseAccount(to);
  if (!fromCoord || !toCoord) throw new Error("Electricity transport requires physical cell accounts");
  if (!hasPowerLine(ledger, from) || !hasPowerLine(ledger, to)) return null;
  if (from === to) return [from];

  const queue: Account[] = [from];
  const seen = new Set<Account>([from]);
  const previous = new Map<Account, Account>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current === to) break;
    const coord = parseAccount(current);
    if (!coord) continue;
    for (const neighbor of neighbors(coord)) {
      const account = `${neighbor.x},${neighbor.y}` as Account;
      if (seen.has(account) || !hasPowerLine(ledger, account)) continue;
      seen.add(account);
      previous.set(account, current);
      queue.push(account);
    }
  }

  if (!seen.has(to)) return null;
  const path = [to];
  while (path[0] !== from) {
    const before = previous.get(path[0]);
    if (!before) return null;
    path.unshift(before);
  }
  return path;
}

function createElectricityRouteTree(ledger: Ledger, from: Account): ElectricityRouteTree | null {
  const fromCoord = parseAccount(from);
  if (!fromCoord) throw new Error("Electricity transport requires physical cell accounts");
  if (!hasPowerLine(ledger, from)) return null;

  const queue: Account[] = [from];
  const seen = new Set<Account>([from]);
  const previous = new Map<Account, Account>();
  const distance = new Map<Account, number>([[from, 0]]);
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const coord = parseAccount(current);
    if (!coord) continue;
    for (const neighbor of neighbors(coord)) {
      const account = `${neighbor.x},${neighbor.y}` as Account;
      if (seen.has(account) || !hasPowerLine(ledger, account)) continue;
      seen.add(account);
      previous.set(account, current);
      distance.set(account, (distance.get(current) ?? 0) + 1);
      queue.push(account);
    }
  }

  return { previous, distance };
}

function electricityTransportPathFromTree(tree: ElectricityRouteTree | null, from: Account, to: Account) {
  if (!tree || !tree.distance.has(to)) return null;
  const path = [to];
  while (path[0] !== from) {
    const before = tree.previous.get(path[0]);
    if (!before) return null;
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
  return {
    path,
    unitCost: pathUnitCost(ledger, path),
  };
}

function transportQuote(
  ledger: Ledger,
  cache: TransportQuoteCache,
  from: Account,
  to: Account,
  profiler?: SimulationProfiler,
) {
  const key = transportPairKey(from, to);
  const cached = cache.get(key);
  if (cached) {
    profiler?.record("transportQuote.cacheHit", 0);
    return cached;
  }
  const startedAt = profiler ? performance.now() : 0;
  const quote = createTransportQuote(ledger, from, to);
  profiler?.record("transportQuote.create", performance.now() - startedAt);
  cache.set(key, quote);
  return quote;
}

function createElectricityTransportQuote(ledger: Ledger, from: Account, to: Account): ElectricityTransportQuote | null {
  const [canonicalFrom, canonicalTo] = canonicalTransportPair(from, to);
  const path = electricityTransportPath(ledger, canonicalFrom, canonicalTo);
  if (!path) return null;
  return {
    path,
    deliveryFactor: ELECTRICITY_LINE_EFFICIENCY ** Math.max(0, path.length - 1),
  };
}

function electricityTransportQuote(
  ledger: Ledger,
  cache: ElectricityTransportQuoteCache,
  from: Account,
  to: Account,
  profiler?: SimulationProfiler,
) {
  const key = transportPairKey(from, to);
  if (cache.quotes.has(key)) {
    profiler?.record("electricityTransportQuote.cacheHit", 0);
    return cache.quotes.get(key) ?? null;
  }
  const startedAt = profiler ? performance.now() : 0;
  let tree = cache.routeTrees.get(from);
  if (!cache.routeTrees.has(from)) {
    const treeStartedAt = profiler ? performance.now() : 0;
    tree = createElectricityRouteTree(ledger, from);
    profiler?.record("electricityRouteTree.create", performance.now() - treeStartedAt);
    cache.routeTrees.set(from, tree ?? null);
  }
  const path = electricityTransportPathFromTree(tree ?? null, from, to);
  const quote = path
    ? {
        path,
        deliveryFactor: ELECTRICITY_LINE_EFFICIENCY ** Math.max(0, path.length - 1),
      }
    : null;
  profiler?.record("electricityTransportQuote.create", performance.now() - startedAt);
  cache.quotes.set(key, quote);
  return quote;
}

function quotePathForDirection(quote: { path: Account[] }, from: Account, to: Account) {
  if (quote.path[0] === from && quote.path[quote.path.length - 1] === to) return quote.path;
  return [...quote.path].reverse();
}

export function transportUnitCost(ledger: Ledger, from: Account, to: Account) {
  return createTransportQuote(ledger, from, to).unitCost;
}

export function electricityDeliveryFactor(ledger: Ledger, from: Account, to: Account) {
  return createElectricityTransportQuote(ledger, from, to)?.deliveryFactor ?? null;
}

export function electricityTransportLoss(grossQuantity: number, deliveryFactor: number) {
  assertSafeAmount(grossQuantity, "gross electricity transport quantity");
  if (!Number.isFinite(deliveryFactor) || deliveryFactor < 0 || deliveryFactor > 1) {
    throw new Error(`electricity delivery factor is invalid: ${deliveryFactor}`);
  }
  return Math.min(grossQuantity, Math.ceil(grossQuantity * (1 - deliveryFactor)));
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
  electricityTransportQuoteCache: ElectricityTransportQuoteCache,
  lastOrderResults: OrderResult[],
  getNextOrderId: () => number,
  setNextOrderId: (nextOrderId: number) => void,
  profiler?: SimulationProfiler,
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
    transportUnitCost: (from, to) => transportQuote(ledger, transportQuoteCache, from, to, profiler).unitCost,
    electricityDeliveryFactor: (from, to) =>
      electricityTransportQuote(ledger, electricityTransportQuoteCache, from, to, profiler)?.deliveryFactor ?? null,
    requestTransport: (from, to, resource, requestedQuantity) => {
      assertSafeAmount(requestedQuantity, "transport quantity");
      if (requestedQuantity === 0 || from === to) return;
      const quote = transportQuote(ledger, transportQuoteCache, from, to, profiler);
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
      for (const account of path) {
        addBalance(ledger, "Common", account, "congestion", quantity);
      }
      transports.push({ agent, from, to, resource, quantity, cost: totalCost, path });
    },
    requestElectricityTransportGross: (from, to, grossQuantity) => {
      assertSafeAmount(grossQuantity, "gross electricity transport quantity");
      if (grossQuantity === 0 || from === to) return;
      const quote = electricityTransportQuote(ledger, electricityTransportQuoteCache, from, to, profiler);
      if (!quote) return;
      const path = quotePathForDirection(quote, from, to);
      const available = getBalance(ledger, agent, from, "electricity");
      const grossSpent = Math.min(grossQuantity, available);
      if (grossSpent <= 0) return;
      const loss = electricityTransportLoss(grossSpent, quote.deliveryFactor);
      const deliveredQuantity = checkedSub(grossSpent, loss, "delivered electricity");
      reserveBalance(ledger, agent, from, "electricity", grossSpent);
      addBalance(ledger, agent, to, "electricity", deliveredQuantity);
      transports.push({
        agent,
        from,
        to,
        resource: "electricity",
        quantity: grossSpent,
        deliveredQuantity,
        cost: loss,
        path,
      });
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
    for (const powerPlant of cellsWith(ledger, agent, "power-plant")) {
      addBalance(ledger, agent, powerPlant.account, "electricity", checkedMul(powerPlant.amount, 80, "power output"));
    }
    for (const factory of cellsWith(ledger, agent, "factory")) {
      const availableElectricity = getBalance(ledger, agent, factory.account, "electricity");
      const poweredFactories = Math.min(factory.amount, Math.floor(availableElectricity));
      if (poweredFactories > 0) {
        reserveBalance(ledger, agent, factory.account, "electricity", poweredFactories);
        addBalance(ledger, agent, factory.account, "widget", checkedMul(poweredFactories, 5, "factory output"));
      }
    }
    for (const population of cellsWith(ledger, agent, "population")) {
      const consumedElectricity = Math.min(population.amount, getBalance(ledger, agent, population.account, "electricity"));
      if (consumedElectricity > 0) {
        reserveBalance(ledger, agent, population.account, "electricity", consumedElectricity);
      }
      addBalance(ledger, agent, MONEY_ACCOUNT, "money", checkedMul(population.amount, 6, "population income"));
    }
  }
}

export function stepSimulation(state: SimState, options: SimulationOptions = {}): SimState {
  const random = options.random ?? Math.random;
  const profiler = options.profiler;
  const cloneStartedAt = profiler ? performance.now() : 0;
  const ledger = cloneLedger(state.ledger);
  profiler?.record("step.cloneLedger", performance.now() - cloneStartedAt);
  const orders: Order[] = [];
  const transports: Transport[] = [];
  const transportQuoteCache: TransportQuoteCache = new Map();
  const electricityTransportQuoteCache: ElectricityTransportQuoteCache = { quotes: new Map(), routeTrees: new Map() };
  let nextOrderId = state.nextOrderId;

  const generationStartedAt = profiler ? performance.now() : 0;
  applyResourceGeneration(ledger);
  profiler?.record("step.resourceGeneration", performance.now() - generationStartedAt);

  const apiFor = (agent: Agent) =>
    createAgentApi(
      agent,
      ledger,
      orders,
      transports,
      transportQuoteCache,
      electricityTransportQuoteCache,
      state.lastOrderResults.filter((result) => result.agent === agent),
      () => nextOrderId,
      (updatedNextOrderId) => {
        nextOrderId = updatedNextOrderId;
      },
      profiler,
    );

  for (const policy of shuffled(AGENT_POLICIES, random)) {
    const policyStartedAt = profiler ? performance.now() : 0;
    policy.run(apiFor(policy.agent), {
      lastTrades: state.trades,
      publicLastOrderResults: state.lastOrderResults,
    });
    profiler?.record(`policy.${policy.agent}`, performance.now() - policyStartedAt);
  }

  const marketStartedAt = profiler ? performance.now() : 0;
  const { trades, orderResults } = clearMarket(ledger, orders);
  profiler?.record("step.clearMarket", performance.now() - marketStartedAt);

  return {
    turn: checkedAdd(state.turn, 1, "turn"),
    nextOrderId,
    ledger,
    orders,
    lastOrderResults: orderResults,
    trades,
    transports,
    note: `${trades.length} trades, ${transports.length} transports`,
  };
}
