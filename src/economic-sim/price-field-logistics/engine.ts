import {
  fieldCell,
  fieldNeighbors,
  stepPriceField,
  type PriceFieldSource,
  type PriceFieldState,
} from "../priceFieldAutomaton";
import type { Account, Agent } from "../types";

export type PriceResource = "money" | "product" | "labor";
export type PriceMarketResource = "product" | "labor";
export type PriceAgent = Agent;

export type PriceLogisticsCell = {
  x: number;
  y: number;
  localBid: number;
  consumerMoney: number;
  population: number;
  laborAsk: number;
  laborStock: number;
  bidVolume: number;
  localAsk: number;
  producerStock: number;
  logisticsStock: number;
  movedStock: number;
  lastBidFilled: number;
  lastBidUnfilled: number;
  lastLaborFilled: number;
  lastLaborUnfilled: number;
  lastAskFilled: number;
  lastAskUnfilled: number;
};

export type PriceLogisticsEvent =
  | { kind: "buy"; x: number; y: number; price: number; quantity: number }
  | { kind: "labor"; x: number; y: number; quantity: number; price: number }
  | { kind: "move"; fromX: number; fromY: number; toX: number; toY: number; value: number }
  | { kind: "sell"; x: number; y: number; quantity: number; price: number };

export type PriceOrder = {
  id: number;
  agent: PriceAgent;
  account: Account;
  resource: PriceMarketResource;
  side: "bid" | "ask";
  price: number;
  quantity: number;
  remaining: number;
};

export type PriceOrderResult = Omit<PriceOrder, "remaining"> & {
  filled: number;
  unfilled: number;
};

export type PriceTrade = {
  x: number;
  y: number;
  account: Account;
  resource: PriceMarketResource;
  buyer: PriceAgent;
  seller: PriceAgent;
  quantity: number;
  price: number;
};

export type PriceLedger = Partial<Record<PriceAgent, Partial<Record<Account, Partial<Record<PriceResource, number>>>>>>;

export type PriceLogisticsState = {
  width: number;
  height: number;
  turn: number;
  nextOrderId: number;
  ledger: PriceLedger;
  orders: PriceOrder[];
  lastOrderResults: PriceOrderResult[];
  trades: PriceTrade[];
  money: number;
  producerMoney: number;
  cells: PriceLogisticsCell[];
  bidField: PriceFieldState;
  events: PriceLogisticsEvent[];
};

export type PriceAgentApi = {
  state: PriceLogisticsState;
  agent: PriceAgent;
  balance: (account: Account, resource: PriceResource) => number;
  balanceOf: (agent: PriceAgent, account: Account, resource: PriceResource) => number;
  cell: (x: number, y: number) => PriceLogisticsCell;
  cells: () => PriceLogisticsCell[];
  placeBid: (account: Account, resource: PriceMarketResource, price: number, quantity: number) => void;
  placeAsk: (account: Account, resource: PriceMarketResource, price: number, quantity: number) => void;
  placeBidAs: (agent: PriceAgent, account: Account, resource: PriceMarketResource, price: number, quantity: number) => void;
  placeAskAs: (agent: PriceAgent, account: Account, resource: PriceMarketResource, price: number, quantity: number) => void;
  moveProduct: (from: PriceLogisticsCell, toX: number, toY: number, value: number) => boolean;
  diffusedBid: (x: number, y: number) => number;
  bestMoveNeighbor: (cell: PriceLogisticsCell) => { x: number; y: number; bid: number } | null;
  effectiveProductBid: (cell: PriceLogisticsCell) => number;
  consumerAgentForCell: (cell: PriceLogisticsCell) => Agent;
};

export type PriceAgentPolicy = {
  agent: PriceAgent;
  run: (api: PriceAgentApi) => void;
};

export const MOVE_COST = 1;
export const MAX_OPTIONS_PER_TURN = 120;
export const MIN_PRICE = 1;
export const MAX_PRICE = 32;
export const LOGISTICS_AGENT: Agent = "Logistics-0";
export const PRODUCER_AGENT: Agent = "Producer";
export const MONEY_ACCOUNT: Account = "";

function index(width: number, x: number, y: number) {
  return y * width + x;
}

export function accountOfCell(cell: { x: number; y: number }): Account {
  return `${cell.x},${cell.y}`;
}

export function logisticsCell(state: PriceLogisticsState, x: number, y: number) {
  return state.cells[index(state.width, x, y)];
}

function ensureAgent(ledger: PriceLedger, agent: PriceAgent) {
  ledger[agent] ??= {};
  return ledger[agent]!;
}

function ensureAccount(ledger: PriceLedger, agent: PriceAgent, account: Account) {
  const agentLedger = ensureAgent(ledger, agent);
  agentLedger[account] ??= {};
  return agentLedger[account]!;
}

export function getLedgerBalance(ledger: PriceLedger, agent: PriceAgent, account: Account, resource: PriceResource) {
  return ensureAccount(ledger, agent, account)[resource] ?? 0;
}

export function addLedgerBalance(
  ledger: PriceLedger,
  agent: PriceAgent,
  account: Account,
  resource: PriceResource,
  amount: number,
) {
  const balances = ensureAccount(ledger, agent, account);
  const next = (balances[resource] ?? 0) + amount;
  if (next < -1e-9) throw new Error(`${agent} ${resource} would go negative`);
  balances[resource] = next;
}

export function setLedgerBalance(
  ledger: PriceLedger,
  agent: PriceAgent,
  account: Account,
  resource: PriceResource,
  amount: number,
) {
  if (amount < -1e-9) throw new Error(`${agent} ${resource} would go negative`);
  ensureAccount(ledger, agent, account)[resource] = amount;
}

export function cloneLedger(ledger: PriceLedger): PriceLedger {
  const next: PriceLedger = {};
  for (const [agent, accounts] of Object.entries(ledger) as Array<[PriceAgent, NonNullable<PriceLedger[PriceAgent]>]>) {
    next[agent] = {};
    for (const [account, resources] of Object.entries(accounts) as Array<[Account, Partial<Record<PriceResource, number>>]>) {
      next[agent]![account] = { ...resources };
    }
  }
  return next;
}

export function consumerAgentForCell(cell: PriceLogisticsCell): Agent {
  return `Consumer-${cell.x},${cell.y}`;
}

export function effectiveProductBidForBalance(cell: PriceLogisticsCell, consumerMoney: number) {
  if (cell.population <= 0 || cell.localBid <= 0) return 0;
  return Math.min(cell.localBid, Math.floor(consumerMoney));
}

export function effectiveProductBid(cell: PriceLogisticsCell, state?: PriceLogisticsState) {
  if (!state) return effectiveProductBidForBalance(cell, cell.consumerMoney);
  return effectiveProductBidForBalance(
    cell,
    getLedgerBalance(state.ledger, consumerAgentForCell(cell), MONEY_ACCOUNT, "money"),
  );
}

export function affordableDemandVolume(cell: PriceLogisticsCell, consumerMoney: number) {
  const bid = effectiveProductBidForBalance(cell, consumerMoney);
  if (bid <= 0) return 0;
  return Math.min(cell.population, Math.floor(consumerMoney / bid));
}

export function refreshCellBalances(state: PriceLogisticsState) {
  state.money = getLedgerBalance(state.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money");
  state.producerMoney = getLedgerBalance(state.ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money");
  for (const cell of state.cells) {
    const account = accountOfCell(cell);
    const consumer = consumerAgentForCell(cell);
    cell.consumerMoney = getLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money");
    cell.laborStock = getLedgerBalance(state.ledger, consumer, account, "labor");
    cell.producerStock = getLedgerBalance(state.ledger, PRODUCER_AGENT, account, "product");
    cell.logisticsStock = getLedgerBalance(state.ledger, LOGISTICS_AGENT, account, "product");
    cell.bidVolume = affordableDemandVolume(
      cell,
      cell.consumerMoney,
    );
  }
}

function bidSources(state: PriceLogisticsState): PriceFieldSource[] {
  return state.cells
    .filter((cell) => effectiveProductBid(cell, state) > 0 && cell.bidVolume > 0)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      price: effectiveProductBid(cell, state),
      volume: cell.bidVolume,
      active: true,
    }));
}

function stepBidField(state: PriceLogisticsState) {
  return stepPriceField(state.bidField, bidSources(state), {
    priceDecay: 0.9,
    volumeDecay: 0.96,
    closePriceRatio: 0.9,
    minimumVolume: 0.0005,
  });
}

export function diffusedBid(state: PriceLogisticsState, x: number, y: number) {
  return fieldCell(state.bidField, x, y).price;
}

export function bestMoveNeighbor(state: PriceLogisticsState, cell: PriceLogisticsCell) {
  let best: { x: number; y: number; bid: number } | null = null;
  for (const neighbor of fieldNeighbors(state, cell)) {
    const bid = diffusedBid(state, neighbor.x, neighbor.y);
    if (!best || bid > best.bid) best = { x: neighbor.x, y: neighbor.y, bid };
  }
  return best;
}

function adaptConsumerBid(cell: PriceLogisticsCell) {
  if (cell.population <= 0 || cell.localBid <= 0) return 0;
  if (cell.lastBidUnfilled > 0) return Math.min(MAX_PRICE, cell.localBid + 2);
  if (cell.lastBidFilled > 0) return Math.max(MIN_PRICE, cell.localBid - 2);
  return cell.localBid;
}

function adaptLaborAsk(cell: PriceLogisticsCell) {
  if (cell.population <= 0 || cell.laborAsk <= 0) return 0;
  if (cell.lastLaborUnfilled > 0 && cell.lastLaborFilled === 0) return Math.max(MIN_PRICE, cell.laborAsk - 1);
  if (cell.lastLaborFilled > 0) return Math.min(MAX_PRICE, cell.laborAsk + (cell.lastLaborUnfilled === 0 ? 2 : 1));
  return cell.laborAsk;
}

function adaptProducerAsk(cell: PriceLogisticsCell) {
  if (cell.localAsk <= 0) return 0;
  if (cell.lastAskFilled === 0 && cell.lastAskUnfilled > 0) return Math.max(MIN_PRICE, cell.localAsk - 1);
  if (cell.lastAskFilled > 0) return Math.min(MAX_PRICE, cell.localAsk + (cell.lastAskUnfilled === 0 ? 2 : 1));
  return cell.localAsk;
}

function midpointPrice(bidPrice: number, askPrice: number) {
  return Math.round((bidPrice + askPrice) / 2);
}

function parseAccount(account: Account) {
  if (!account) return null;
  const [x, y] = account.split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function placeOrder(state: PriceLogisticsState, order: Omit<PriceOrder, "id" | "remaining">) {
  if (order.quantity <= 0 || order.price < 0) return;
  if (order.side === "bid") {
    addLedgerBalance(state.ledger, order.agent, MONEY_ACCOUNT, "money", -order.quantity * order.price);
  } else {
    addLedgerBalance(state.ledger, order.agent, order.account, order.resource, -order.quantity);
  }
  state.orders.push({ ...order, id: state.nextOrderId, remaining: order.quantity });
  state.nextOrderId += 1;
}

function clearLocalAuctions(state: PriceLogisticsState, resources: PriceMarketResource[]) {
  const trades: PriceTrade[] = [];
  const resourceSet = new Set(resources);
  const grouped = new Map<string, { account: Account; resource: PriceMarketResource; bids: PriceOrder[]; asks: PriceOrder[] }>();

  for (const order of state.orders) {
    if (!resourceSet.has(order.resource)) continue;
    const key = `${order.account}|${order.resource}`;
    const group = grouped.get(key) ?? { account: order.account, resource: order.resource, bids: [], asks: [] };
    if (order.side === "bid") group.bids.push(order);
    else group.asks.push(order);
    grouped.set(key, group);
  }

  for (const { account, resource, bids: groupBids, asks: groupAsks } of grouped.values()) {
    const coord = parseAccount(account);
    if (!coord) continue;
    const bids = [...groupBids].sort((a, b) => b.price - a.price || a.id - b.id);
    const asks = [...groupAsks].sort((a, b) => a.price - b.price || a.id - b.id);
    let bidIndex = 0;
    let askIndex = 0;

    while (bidIndex < bids.length && askIndex < asks.length) {
      const bid = bids[bidIndex];
      const ask = asks[askIndex];
      if (!bid || !ask || bid.price < ask.price) break;
      const quantity = Math.min(bid.remaining, ask.remaining);
      const price = midpointPrice(bid.price, ask.price);
      addLedgerBalance(state.ledger, ask.agent, MONEY_ACCOUNT, "money", quantity * price);
      addLedgerBalance(state.ledger, bid.agent, account, resource, quantity);
      const refund = quantity * bid.price - quantity * price;
      if (refund > 0) addLedgerBalance(state.ledger, bid.agent, MONEY_ACCOUNT, "money", refund);
      bid.remaining -= quantity;
      ask.remaining -= quantity;
      trades.push({ ...coord, account, resource, buyer: bid.agent, seller: ask.agent, quantity, price });
      if (bid.remaining === 0) bidIndex += 1;
      if (ask.remaining === 0) askIndex += 1;
    }
  }

  state.lastOrderResults = state.orders.map((order) => ({
    id: order.id,
    agent: order.agent,
    account: order.account,
    resource: order.resource,
    side: order.side,
    price: order.price,
    quantity: order.quantity,
    filled: order.quantity - order.remaining,
    unfilled: order.remaining,
  }));

  for (const order of state.orders) {
    if (order.remaining <= 0) continue;
    if (order.side === "bid") addLedgerBalance(state.ledger, order.agent, MONEY_ACCOUNT, "money", order.remaining * order.price);
    else addLedgerBalance(state.ledger, order.agent, order.account, order.resource, order.remaining);
    order.remaining = 0;
  }

  state.trades = trades;
  state.orders = [];
}

function syncTradeEffects(state: PriceLogisticsState) {
  for (const cell of state.cells) {
    cell.lastBidFilled = 0;
    cell.lastBidUnfilled = 0;
    cell.lastLaborFilled = 0;
    cell.lastLaborUnfilled = 0;
    cell.lastAskFilled = 0;
    cell.lastAskUnfilled = 0;
  }
  for (const trade of state.trades) {
    const cell = logisticsCell(state, trade.x, trade.y);
    if (trade.resource === "product" && trade.buyer === LOGISTICS_AGENT && trade.seller === PRODUCER_AGENT) {
      cell.lastAskFilled += trade.quantity;
      state.events.push({ kind: "buy", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
    if (trade.resource === "product" && trade.buyer === consumerAgentForCell(cell) && trade.seller === LOGISTICS_AGENT) {
      cell.lastBidFilled += trade.quantity;
      state.events.push({ kind: "sell", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
    if (trade.resource === "labor" && trade.buyer === PRODUCER_AGENT && trade.seller === consumerAgentForCell(cell)) {
      cell.lastLaborFilled += trade.quantity;
      addLedgerBalance(state.ledger, PRODUCER_AGENT, accountOfCell(cell), "product", trade.quantity);
      state.events.push({ kind: "labor", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
  }
  for (const result of state.lastOrderResults) {
    const coord = parseAccount(result.account);
    if (!coord || result.unfilled <= 0) continue;
    const cell = logisticsCell(state, coord.x, coord.y);
    if (result.resource === "product" && result.side === "bid" && result.agent === consumerAgentForCell(cell)) {
      cell.lastBidUnfilled += result.unfilled;
    }
    if (result.resource === "product" && result.side === "ask" && result.agent === PRODUCER_AGENT) {
      cell.lastAskUnfilled += result.unfilled;
    }
    if (result.resource === "labor" && result.side === "ask" && result.agent === consumerAgentForCell(cell)) {
      cell.lastLaborUnfilled += result.unfilled;
    }
  }
}

function createAgentApi(state: PriceLogisticsState, agent: PriceAgent): PriceAgentApi {
  return {
    state,
    agent,
    balance: (account, resource) => getLedgerBalance(state.ledger, agent, account, resource),
    balanceOf: (targetAgent, account, resource) => getLedgerBalance(state.ledger, targetAgent, account, resource),
    cell: (x, y) => logisticsCell(state, x, y),
    cells: () => state.cells,
    placeBid: (account, resource, price, quantity) => placeOrder(state, { agent, account, resource, side: "bid", price, quantity }),
    placeAsk: (account, resource, price, quantity) => placeOrder(state, { agent, account, resource, side: "ask", price, quantity }),
    placeBidAs: (targetAgent, account, resource, price, quantity) =>
      placeOrder(state, { agent: targetAgent, account, resource, side: "bid", price, quantity }),
    placeAskAs: (targetAgent, account, resource, price, quantity) =>
      placeOrder(state, { agent: targetAgent, account, resource, side: "ask", price, quantity }),
    moveProduct: (from, toX, toY, value) => {
      if (getLedgerBalance(state.ledger, agent, accountOfCell(from), "product") < 1) return false;
      if (getLedgerBalance(state.ledger, agent, MONEY_ACCOUNT, "money") < MOVE_COST) return false;
      addLedgerBalance(state.ledger, agent, accountOfCell(from), "product", -1);
      addLedgerBalance(state.ledger, agent, MONEY_ACCOUNT, "money", -MOVE_COST);
      logisticsCell(state, toX, toY).movedStock += 1;
      state.events.push({ kind: "move", fromX: from.x, fromY: from.y, toX, toY, value });
      return true;
    },
    diffusedBid: (x, y) => diffusedBid(state, x, y),
    bestMoveNeighbor: (cell) => bestMoveNeighbor(state, cell),
    effectiveProductBid: (cell) => effectiveProductBid(cell, state),
    consumerAgentForCell,
  };
}

export function stepPriceLogistics(state: PriceLogisticsState, policies: PriceAgentPolicy[]): PriceLogisticsState {
  const next: PriceLogisticsState = {
    ...state,
    turn: state.turn + 1,
    nextOrderId: state.nextOrderId,
    ledger: cloneLedger(state.ledger),
    cells: state.cells.map((cell) => ({ ...cell })),
    orders: [],
    lastOrderResults: [],
    trades: [],
    events: [],
  };
  setLedgerBalance(next.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money", state.money);
  setLedgerBalance(next.ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money", state.producerMoney);

  for (const cell of next.cells) {
    const account = accountOfCell(cell);
    const consumer = consumerAgentForCell(cell);
    setLedgerBalance(next.ledger, consumer, MONEY_ACCOUNT, "money", cell.consumerMoney);
    setLedgerBalance(next.ledger, consumer, account, "labor", cell.laborStock);
    setLedgerBalance(next.ledger, PRODUCER_AGENT, account, "product", cell.producerStock);
    setLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "product", cell.logisticsStock);
    cell.localBid = adaptConsumerBid(cell);
    cell.laborAsk = adaptLaborAsk(cell);
    cell.localAsk = adaptProducerAsk(cell);
    const labor = getLedgerBalance(next.ledger, consumer, account, "labor");
    setLedgerBalance(next.ledger, consumer, account, "labor", Math.min(12, labor + cell.population));
    const moved = cell.movedStock;
    if (moved > 0) addLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "product", moved);
    cell.movedStock = 0;
  }
  refreshCellBalances(next);
  next.bidField = stepBidField(next);

  for (const policy of policies) {
    policy.run(createAgentApi(next, policy.agent));
  }

  clearLocalAuctions(next, ["labor", "product"]);
  syncTradeEffects(next);
  refreshCellBalances(next);
  return next;
}

export function runAuction({
  account,
  resource = "product",
  buyer,
  seller,
  bidPrice,
  askPrice,
  quantity,
  buyerMoney,
  sellerWidget,
}: {
  account: Account;
  resource?: PriceMarketResource;
  buyer: PriceAgent;
  seller: PriceAgent;
  bidPrice: number;
  askPrice: number;
  quantity: number;
  buyerMoney: number;
  sellerWidget: number;
}) {
  const state: PriceLogisticsState = {
    width: 1,
    height: 1,
    turn: 0,
    nextOrderId: 1,
    ledger: {},
    orders: [],
    lastOrderResults: [],
    trades: [],
    money: 0,
    producerMoney: 0,
    cells: [{
      x: 0,
      y: 0,
      localBid: 0,
      consumerMoney: 0,
      population: 0,
      laborAsk: 0,
      laborStock: 0,
      bidVolume: 0,
      localAsk: 0,
      producerStock: 0,
      logisticsStock: 0,
      movedStock: 0,
      lastBidFilled: 0,
      lastBidUnfilled: 0,
      lastLaborFilled: 0,
      lastLaborUnfilled: 0,
      lastAskFilled: 0,
      lastAskUnfilled: 0,
    }],
    bidField: { width: 1, height: 1, turn: 0, cells: [] },
    events: [],
  };
  addLedgerBalance(state.ledger, buyer, MONEY_ACCOUNT, "money", buyerMoney);
  addLedgerBalance(state.ledger, seller, account, resource, sellerWidget);
  placeOrder(state, { agent: seller, account, resource, side: "ask", price: askPrice, quantity });
  placeOrder(state, { agent: buyer, account, resource, side: "bid", price: bidPrice, quantity });
  clearLocalAuctions(state, [resource]);
  return {
    trades: state.trades,
    orderResults: state.lastOrderResults,
    buyerMoney: getLedgerBalance(state.ledger, buyer, MONEY_ACCOUNT, "money"),
    buyerWidget: getLedgerBalance(state.ledger, buyer, account, resource),
    sellerMoney: getLedgerBalance(state.ledger, seller, MONEY_ACCOUNT, "money"),
    sellerWidget: getLedgerBalance(state.ledger, seller, account, resource),
  };
}
