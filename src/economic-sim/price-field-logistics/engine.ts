import {
  fieldCell,
  fieldNeighbors,
  stepPriceField,
  type PriceFieldSource,
  type PriceFieldState,
} from "./priceFieldAutomaton";
import type { Account, Agent } from "../shared/types";

export type PriceResource = "money" | "product" | "food" | "labor" | "factory" | "farm";
export type PriceMarketResource = "product" | "food" | "labor";
export type PriceLogisticsResource = "product" | "food";
export type PriceAgent = Agent;

export type PriceLogisticsCell = {
  x: number;
  y: number;
  land: boolean;
  consumerMoney: number;
  population: number;
  malnutritionBurden: number;
  foodConsumed: number;
  laborStock: number;
  fieldBid: number;
  bidVolume: number;
  foodFieldBid: number;
  foodBidVolume: number;
  producerStock: number;
  producerFoodStock: number;
  farmProducerFoodStock: number;
  farmStock: number;
  logisticsStock: number;
  logisticsFoodStock: number;
  movedStock: number;
  marketHistory: PriceMarketTickHistory[];
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

export type PriceMarketResourceHistory = {
  orders: PriceOrderResult[];
  trades: PriceTrade[];
};

export type PriceMarketTickHistory = {
  turn: number;
  resources: Record<PriceMarketResource, PriceMarketResourceHistory>;
};

export type PriceLedger = Partial<Record<PriceAgent, Partial<Record<Account, Partial<Record<PriceResource, number>>>>>>;
export type PriceResourceBundle = Partial<Record<PriceResource, number>>;

export type PriceRecipe = {
  id: string;
  inputs: PriceResourceBundle;
  requirements: PriceResourceBundle;
  outputs: PriceResourceBundle;
};

export type PriceLogisticsState = {
  width: number;
  height: number;
  turn: number;
  nextOrderId: number;
  ledger: PriceLedger;
  orders: PriceOrder[];
  lastOrderResults: PriceOrderResult[];
  trades: PriceTrade[];
  recipes: PriceRecipe[];
  logisticsResources: PriceLogisticsResource[];
  money: number;
  producerMoney: number;
  farmProducerMoney: number;
  cells: PriceLogisticsCell[];
  bidField: PriceFieldState;
  bidFields: Record<PriceLogisticsResource, PriceFieldState>;
  events: PriceLogisticsEvent[];
};

export type PriceAgentApi = {
  agent: PriceAgent;
  balance: (account: Account, resource: PriceResource) => number;
  balanceOf: (agent: PriceAgent, account: Account, resource: PriceResource) => number;
  accounts: () => Account[];
  local: (account: Account) => PriceLogisticsCell | null;
  placeBid: (account: Account, resource: PriceMarketResource, price: number, quantity: number) => void;
  placeAsk: (account: Account, resource: PriceMarketResource, price: number, quantity: number) => void;
  bestBid: (account: Account, resource: PriceMarketResource) => { price: number; quantity: number } | null;
  bestAsk: (account: Account, resource: PriceMarketResource) => { price: number; quantity: number } | null;
  recipes: () => PriceRecipe[];
  moveResource: (resource: PriceLogisticsResource, from: Account, to: Account, value: number) => boolean;
  moveProduct: (from: Account, to: Account, value: number) => boolean;
  diffusedBid: (account: Account, resource?: PriceLogisticsResource) => number;
  bestMoveNeighbor: (account: Account, resource?: PriceLogisticsResource) => { account: Account; bid: number } | null;
  consumerAgentForAccount: (account: Account) => Agent | null;
};

export type PriceAgentPolicy = {
  agent: PriceAgent;
  run: (api: PriceAgentApi) => void;
};

export type PriceFieldStepWork = {
  resource: PriceLogisticsResource;
  field: PriceFieldState;
  sources: PriceFieldSource[];
  land: boolean[];
  width: number;
  height: number;
};

export type PriceFieldBatchStepper = (
  work: PriceFieldStepWork[],
) => Promise<Record<PriceLogisticsResource, PriceFieldState>>;

export type PriceStepProfiler = {
  record: (name: string, durationMs: number) => void;
};

export type PriceCellBehavior = {
  fieldSources: (state: PriceLogisticsState, resource: PriceLogisticsResource) => PriceFieldSource[];
  afterMarket: (state: PriceLogisticsState) => void;
};

export const MOVE_COST = 1;
export const MAX_OPTIONS_PER_TURN = Infinity;
export const MIN_PRICE = 1;
export const MAX_PRICE = 32;
export const LOGISTICS_AGENT: Agent = "Logistics-0";
export const PRODUCER_AGENT: Agent = "Producer";
export const FARM_PRODUCER_AGENT: Agent = "FarmProducer";
export const MONEY_ACCOUNT: Account = "";
export const NORMAL_MORTALITY_PER_WEEK = 0.003;
export const BASE_FERTILITY_PER_WEEK = 0.01;
export const SEA_TRAVEL_COST = Number.POSITIVE_INFINITY;

function assertIntegerQuantity(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a non-negative integer quantity: ${value}`);
  }
}

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
  return ledger[agent]?.[account]?.[resource] ?? 0;
}

export function addLedgerBalance(
  ledger: PriceLedger,
  agent: PriceAgent,
  account: Account,
  resource: PriceResource,
  amount: number,
) {
  if (!Number.isSafeInteger(amount)) throw new Error(`${agent} ${resource} delta is not an integer quantity: ${amount}`);
  const balances = ensureAccount(ledger, agent, account);
  const next = (balances[resource] ?? 0) + amount;
  assertIntegerQuantity(next, `${agent} ${resource}`);
  balances[resource] = next;
}

export function setLedgerBalance(
  ledger: PriceLedger,
  agent: PriceAgent,
  account: Account,
  resource: PriceResource,
  amount: number,
) {
  assertIntegerQuantity(amount, `${agent} ${resource}`);
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

export function consumerAgentForAccount(state: PriceLogisticsState, account: Account): Agent | null {
  const cell = cellForAccount(state, account);
  return cell ? consumerAgentForCell(cell) : null;
}

function cellForAccount(state: PriceLogisticsState, account: Account) {
  const coord = parseAccount(account);
  if (!coord || coord.x < 0 || coord.x >= state.width || coord.y < 0 || coord.y >= state.height) return null;
  return logisticsCell(state, coord.x, coord.y);
}

function travelCost(state: PriceLogisticsState, from: { x: number; y: number }, to: { x: number; y: number }) {
  const fromCell = logisticsCell(state, from.x, from.y);
  const toCell = logisticsCell(state, to.x, to.y);
  return fromCell.land && toCell.land ? 1 : SEA_TRAVEL_COST;
}

export function refreshCellBalances(state: PriceLogisticsState) {
  state.money = getLedgerBalance(state.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money");
  state.producerMoney = getLedgerBalance(state.ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money");
  state.farmProducerMoney = getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money");
  for (const cell of state.cells) {
    const account = accountOfCell(cell);
    const consumer = consumerAgentForCell(cell);
    cell.consumerMoney = getLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money");
    cell.laborStock = getLedgerBalance(state.ledger, consumer, account, "labor");
    cell.producerStock = getLedgerBalance(state.ledger, PRODUCER_AGENT, account, "product");
    cell.producerFoodStock = getLedgerBalance(state.ledger, PRODUCER_AGENT, account, "food");
    cell.farmProducerFoodStock = getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "food");
    cell.farmStock = getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "farm");
    cell.logisticsStock = getLedgerBalance(state.ledger, LOGISTICS_AGENT, account, "product");
    cell.logisticsFoodStock = getLedgerBalance(state.ledger, LOGISTICS_AGENT, account, "food");
  }
}

function priceFieldOptions(land: boolean[], width: number) {
  return {
    priceDecay: 0.9,
    volumeDecay: 0.96,
    closePriceRatio: 0.9,
    minimumVolume: 0.0005,
    movementCost: (from: { x: number; y: number }, to: { x: number; y: number }) =>
      land[from.y * width + from.x] && land[to.y * width + to.x] ? 1 : SEA_TRAVEL_COST,
  };
}

function landMask(state: PriceLogisticsState) {
  return state.cells.map((cell) => cell.land);
}

function priceFieldStepWork(state: PriceLogisticsState, behavior: PriceCellBehavior): PriceFieldStepWork[] {
  const land = landMask(state);
  return state.logisticsResources.map((resource) => ({
    resource,
    field: state.bidFields[resource],
    sources: behavior.fieldSources(state, resource),
    land,
    width: state.width,
    height: state.height,
  }));
}

export function stepPriceFieldsSync(work: PriceFieldStepWork[]) {
  return Object.fromEntries(
    work.map(({ resource, field, sources, land, width }) => [
      resource,
      stepPriceField(field, sources, priceFieldOptions(land, width)),
    ]),
  ) as Record<PriceLogisticsResource, PriceFieldState>;
}

export function diffusedBid(state: PriceLogisticsState, x: number, y: number, resource: PriceLogisticsResource = "product") {
  return fieldCell(state.bidFields[resource], x, y).price;
}

export function bestMoveNeighbor(state: PriceLogisticsState, cell: PriceLogisticsCell, resource: PriceLogisticsResource = "product") {
  let best: { x: number; y: number; bid: number } | null = null;
  for (const neighbor of fieldNeighbors(state, cell)) {
    if (!Number.isFinite(travelCost(state, cell, neighbor))) continue;
    const bid = diffusedBid(state, neighbor.x, neighbor.y, resource);
    if (!best || bid > best.bid) best = { x: neighbor.x, y: neighbor.y, bid };
  }
  return best;
}

function midpointPrice(bidPrice: number, askPrice: number) {
  return Math.round((bidPrice + askPrice) / 2);
}

export function parseAccount(account: Account) {
  if (!account) return null;
  const [x, y] = account.split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function placeOrder(state: PriceLogisticsState, order: Omit<PriceOrder, "id" | "remaining">) {
  if (order.quantity <= 0 || order.price < 0) return null;
  assertIntegerQuantity(order.quantity, `${order.agent} ${order.resource} order quantity`);
  if (order.side === "bid") {
    addLedgerBalance(state.ledger, order.agent, MONEY_ACCOUNT, "money", -order.quantity * order.price);
  } else {
    addLedgerBalance(state.ledger, order.agent, order.account, order.resource, -order.quantity);
  }
  const placedOrder = { ...order, id: state.nextOrderId, remaining: order.quantity };
  state.orders.push(placedOrder);
  state.nextOrderId += 1;
  return placedOrder;
}

function bestOpenOrder(state: PriceLogisticsState, account: Account, resource: PriceMarketResource, side: "bid" | "ask") {
  let best: PriceOrder | null = null;
  for (const order of state.orders) {
    if (order.account !== account || order.resource !== resource || order.side !== side || order.remaining <= 0) continue;
    if (!best) {
      best = order;
      continue;
    }
    if (side === "bid") {
      if (order.price > best.price || (order.price === best.price && order.id < best.id)) best = order;
    } else if (order.price < best.price || (order.price === best.price && order.id < best.id)) {
      best = order;
    }
  }
  return best ? { price: best.price, quantity: best.remaining } : null;
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

function emptyMarketResourceHistory(): Record<PriceMarketResource, PriceMarketResourceHistory> {
  return {
    product: { orders: [], trades: [] },
    food: { orders: [], trades: [] },
    labor: { orders: [], trades: [] },
  };
}

function cloneMarketHistory(history: PriceMarketTickHistory[]): PriceMarketTickHistory[] {
  return history.map((tick) => ({
    turn: tick.turn,
    resources: {
      product: { orders: [...tick.resources.product.orders], trades: [...tick.resources.product.trades] },
      food: { orders: [...tick.resources.food.orders], trades: [...tick.resources.food.trades] },
      labor: { orders: [...tick.resources.labor.orders], trades: [...tick.resources.labor.trades] },
    },
  }));
}

function recordCellMarketHistory(state: PriceLogisticsState) {
  const entriesByAccount = new Map<Account, Record<PriceMarketResource, PriceMarketResourceHistory>>();
  const ensureEntry = (account: Account) => {
    const entry = entriesByAccount.get(account) ?? emptyMarketResourceHistory();
    entriesByAccount.set(account, entry);
    return entry;
  };

  for (const result of state.lastOrderResults) {
    if (!parseAccount(result.account)) continue;
    ensureEntry(result.account)[result.resource].orders.push(result);
  }

  for (const trade of state.trades) {
    ensureEntry(trade.account)[trade.resource].trades.push(trade);
  }

  for (const cell of state.cells) {
    const resources = entriesByAccount.get(accountOfCell(cell)) ?? emptyMarketResourceHistory();
    const seed = cell.marketHistory.find((tick) => tick.turn === 0);
    const recent = [{ turn: state.turn, resources }, ...cell.marketHistory.filter((tick) => tick.turn !== 0)].slice(0, 5);
    cell.marketHistory = seed ? [...recent, seed] : recent;
  }
}

function syncTradeEffects(state: PriceLogisticsState) {
  for (const trade of state.trades) {
    const cell = logisticsCell(state, trade.x, trade.y);
    if (trade.resource === "product" && trade.buyer === LOGISTICS_AGENT && trade.seller === PRODUCER_AGENT) {
      state.events.push({ kind: "buy", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
    if (trade.resource === "product" && trade.buyer === consumerAgentForCell(cell) && trade.seller === LOGISTICS_AGENT) {
      state.events.push({ kind: "sell", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
    if (trade.resource === "food" && trade.buyer === consumerAgentForCell(cell)) {
      state.events.push({ kind: "sell", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
    if (
      trade.resource === "labor" &&
      (trade.buyer === PRODUCER_AGENT || trade.buyer === FARM_PRODUCER_AGENT) &&
      trade.seller === consumerAgentForCell(cell)
    ) {
      state.events.push({ kind: "labor", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
  }
}

function recipeQuantity(resources: Partial<Record<PriceResource, number>>, recipe: PriceRecipe) {
  let quantity = Number.POSITIVE_INFINITY;
  for (const [resource, amount] of Object.entries(recipe.inputs) as Array<[PriceResource, number]>) {
    if (amount > 0) quantity = Math.min(quantity, Math.floor((resources[resource] ?? 0) / amount));
  }
  for (const [resource, amount] of Object.entries(recipe.requirements) as Array<[PriceResource, number]>) {
    if (amount > 0) quantity = Math.min(quantity, Math.floor((resources[resource] ?? 0) / amount));
  }
  return Number.isFinite(quantity) ? quantity : 0;
}

function agentCanRunRecipe(agent: PriceAgent, recipe: PriceRecipe) {
  if (agent === PRODUCER_AGENT) return (recipe.requirements.factory ?? 0) > 0;
  if (agent === FARM_PRODUCER_AGENT) return (recipe.requirements.farm ?? 0) > 0;
  return false;
}

function generateProducts(state: PriceLogisticsState) {
  for (const [agent, accounts] of Object.entries(state.ledger) as Array<[PriceAgent, NonNullable<PriceLedger[PriceAgent]>]>) {
    if (agent !== PRODUCER_AGENT && agent !== FARM_PRODUCER_AGENT) continue;
    for (const [account, resources] of Object.entries(accounts) as Array<[Account, Partial<Record<PriceResource, number>>]>) {
      for (const recipe of state.recipes) {
        if (!agentCanRunRecipe(agent, recipe)) continue;
        const quantity = recipeQuantity(resources, recipe);
        if (quantity <= 0) continue;
        for (const [resource, amount] of Object.entries(recipe.inputs) as Array<[PriceResource, number]>) {
          addLedgerBalance(state.ledger, agent, account, resource, -quantity * amount);
        }
        for (const [resource, amount] of Object.entries(recipe.outputs) as Array<[PriceResource, number]>) {
          addLedgerBalance(state.ledger, agent, account, resource, quantity * amount);
        }
      }
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function laborProductivity(cell: Pick<PriceLogisticsCell, "malnutritionBurden">) {
  return 1 - 0.6 * cell.malnutritionBurden ** 2;
}

function updateFoodAndPopulation(state: PriceLogisticsState) {
  for (const cell of state.cells) {
    const account = accountOfCell(cell);
    const consumer = consumerAgentForCell(cell);
    if (cell.population <= 0) {
      cell.foodConsumed = 0;
      cell.malnutritionBurden = 0;
      continue;
    }

    const requiredFood = cell.population;
    const availableFood = getLedgerBalance(state.ledger, consumer, account, "food");
    const consumed = Math.min(availableFood, Math.ceil(requiredFood * 1.5));
    if (consumed > 0) addLedgerBalance(state.ledger, consumer, account, "food", -consumed);

    const adequacy = consumed / requiredFood;
    cell.foodConsumed = consumed;
    const burdenBeforeDeaths = clamp(cell.malnutritionBurden + (1 - adequacy) * (7 / 180), 0, 1);

    const starvationDeathRate = 0.19 * burdenBeforeDeaths ** 4;
    cell.malnutritionBurden = starvationDeathRate >= 1
      ? 0
      : clamp((burdenBeforeDeaths - starvationDeathRate) / (1 - starvationDeathRate), 0, 1);

    const mortality = NORMAL_MORTALITY_PER_WEEK + starvationDeathRate;
    const fertility = BASE_FERTILITY_PER_WEEK * (1 - cell.malnutritionBurden) ** 2;
    cell.population = Math.max(0, cell.population * (1 - mortality + fertility));
  }
}

function createAgentApi(state: PriceLogisticsState, agent: PriceAgent): PriceAgentApi {
  let accounts: Account[] | undefined;
  let bestOrders:
    | Map<string, { bid?: PriceOrder; ask?: PriceOrder }>
    | undefined;
  const orderKey = (account: Account, resource: PriceMarketResource) => `${account}|${resource}`;
  const isBetterOrder = (order: PriceOrder, current: PriceOrder | undefined) => {
    if (!current) return true;
    if (order.side === "bid") return order.price > current.price || (order.price === current.price && order.id < current.id);
    return order.price < current.price || (order.price === current.price && order.id < current.id);
  };
  const ensureBestOrders = () => {
    if (bestOrders) return bestOrders;
    bestOrders = new Map();
    for (const order of state.orders) {
      if (order.remaining <= 0) continue;
      const key = orderKey(order.account, order.resource);
      const entry = bestOrders.get(key) ?? {};
      if (isBetterOrder(order, entry[order.side])) entry[order.side] = order;
      bestOrders.set(key, entry);
    }
    return bestOrders;
  };
  const addIndexedOrder = (order: PriceOrder | null) => {
    if (!order || !bestOrders) return;
    const key = orderKey(order.account, order.resource);
    const entry = bestOrders.get(key) ?? {};
    if (isBetterOrder(order, entry[order.side])) entry[order.side] = order;
    bestOrders.set(key, entry);
  };
  const moveResource = (resource: PriceLogisticsResource, from: Account, to: Account, value: number) => {
    const fromCell = cellForAccount(state, from);
    const toCell = cellForAccount(state, to);
    if (!fromCell || !toCell) return false;
    if (!Number.isFinite(travelCost(state, fromCell, toCell))) return false;
    if (getLedgerBalance(state.ledger, agent, from, resource) < 1) return false;
    if (getLedgerBalance(state.ledger, agent, MONEY_ACCOUNT, "money") < MOVE_COST) return false;
    addLedgerBalance(state.ledger, agent, from, resource, -1);
    addLedgerBalance(state.ledger, agent, MONEY_ACCOUNT, "money", -MOVE_COST);
    if (resource === "product") toCell.movedStock += 1;
    else addLedgerBalance(state.ledger, agent, to, resource, 1);
    state.events.push({ kind: "move", fromX: fromCell.x, fromY: fromCell.y, toX: toCell.x, toY: toCell.y, value });
    return true;
  };
  return {
    agent,
    balance: (account, resource) => getLedgerBalance(state.ledger, agent, account, resource),
    balanceOf: (targetAgent, account, resource) => getLedgerBalance(state.ledger, targetAgent, account, resource),
    accounts: () => {
      accounts ??= state.cells.map(accountOfCell);
      return accounts;
    },
    local: (account) => cellForAccount(state, account),
    placeBid: (account, resource, price, quantity) =>
      addIndexedOrder(placeOrder(state, { agent, account, resource, side: "bid", price, quantity })),
    placeAsk: (account, resource, price, quantity) =>
      addIndexedOrder(placeOrder(state, { agent, account, resource, side: "ask", price, quantity })),
    bestBid: (account, resource) => {
      const best = ensureBestOrders().get(orderKey(account, resource))?.bid;
      return best ? { price: best.price, quantity: best.remaining } : null;
    },
    bestAsk: (account, resource) => {
      const best = ensureBestOrders().get(orderKey(account, resource))?.ask;
      return best ? { price: best.price, quantity: best.remaining } : null;
    },
    recipes: () => state.recipes,
    moveResource,
    moveProduct: (from, to, value) => moveResource("product", from, to, value),
    diffusedBid: (account, resource = "product") => {
      const cell = cellForAccount(state, account);
      return cell ? diffusedBid(state, cell.x, cell.y, resource) : 0;
    },
    bestMoveNeighbor: (account, resource = "product") => {
      const cell = cellForAccount(state, account);
      const neighbor = cell ? bestMoveNeighbor(state, cell, resource) : null;
      return neighbor ? { account: `${neighbor.x},${neighbor.y}`, bid: neighbor.bid } : null;
    },
    consumerAgentForAccount: (account) => consumerAgentForAccount(state, account),
  };
}

function profile<T>(profiler: PriceStepProfiler | undefined, name: string, work: () => T): T {
  const startedAt = profiler ? performance.now() : 0;
  const result = work();
  profiler?.record(name, performance.now() - startedAt);
  return result;
}

async function profileAsync<T>(profiler: PriceStepProfiler | undefined, name: string, work: () => Promise<T>): Promise<T> {
  const startedAt = profiler ? performance.now() : 0;
  const result = await work();
  profiler?.record(name, performance.now() - startedAt);
  return result;
}

export function stepSimEngine(
  state: PriceLogisticsState,
  policies: PriceAgentPolicy[],
  behavior: PriceCellBehavior,
  profiler?: PriceStepProfiler,
): PriceLogisticsState {
  const next: PriceLogisticsState = profile(profiler, "cloneState", () => ({
    ...state,
    turn: state.turn + 1,
    nextOrderId: state.nextOrderId,
    ledger: cloneLedger(state.ledger),
    cells: state.cells.map((cell) => ({ ...cell, marketHistory: cloneMarketHistory(cell.marketHistory) })),
    orders: [],
    lastOrderResults: [],
    trades: [],
    events: [],
  }));
  setLedgerBalance(next.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money", state.money);
  setLedgerBalance(next.ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money", state.producerMoney);
  setLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money", state.farmProducerMoney);

  profile(profiler, "syncLedgerAndCells", () => {
    for (const cell of next.cells) {
      const account = accountOfCell(cell);
      const consumer = consumerAgentForCell(cell);
      setLedgerBalance(next.ledger, consumer, MONEY_ACCOUNT, "money", cell.consumerMoney);
      setLedgerBalance(next.ledger, consumer, account, "labor", cell.laborStock);
      setLedgerBalance(next.ledger, PRODUCER_AGENT, account, "product", cell.producerStock);
      setLedgerBalance(next.ledger, PRODUCER_AGENT, account, "food", cell.producerFoodStock);
      setLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "food", cell.farmProducerFoodStock);
      setLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "farm", cell.farmStock);
      setLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "product", cell.logisticsStock);
      setLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "food", cell.logisticsFoodStock);
      const labor = getLedgerBalance(next.ledger, consumer, account, "labor");
      const generatedLabor = Math.floor(cell.population * laborProductivity(cell));
      setLedgerBalance(next.ledger, consumer, account, "labor", Math.min(12, labor + generatedLabor));
      const moved = cell.movedStock;
      if (moved > 0) addLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "product", moved);
      cell.movedStock = 0;
    }
  });
  profile(profiler, "refreshBeforeFields", () => refreshCellBalances(next));
  next.bidFields = profile(profiler, "priceFields", () => stepPriceFieldsSync(priceFieldStepWork(next, behavior)));
  next.bidField = next.bidFields.product;

  profile(profiler, "policies", () => {
    let consumerPolicyStartedAt = profiler ? performance.now() : 0;
    let consumerPolicyOpen = false;
    for (const policy of policies) {
      if (policy.agent.startsWith("Consumer-")) {
        consumerPolicyOpen = true;
        policy.run(createAgentApi(next, policy.agent));
        continue;
      }
      if (consumerPolicyOpen) {
        profiler?.record("policy:Consumers", performance.now() - consumerPolicyStartedAt);
        consumerPolicyOpen = false;
      }
      profile(profiler, `policy:${policy.agent}`, () => policy.run(createAgentApi(next, policy.agent)));
      consumerPolicyStartedAt = profiler ? performance.now() : 0;
    }
    if (consumerPolicyOpen) {
      profiler?.record("policy:Consumers", performance.now() - consumerPolicyStartedAt);
    }
  });

  profile(profiler, "clearLocalAuctions", () => clearLocalAuctions(next, ["labor", "product", "food"]));
  profile(profiler, "recordCellMarketHistory", () => recordCellMarketHistory(next));
  profile(profiler, "syncTradeEffects", () => syncTradeEffects(next));
  profile(profiler, "generateProducts", () => generateProducts(next));
  profile(profiler, "foodAndPopulation", () => updateFoodAndPopulation(next));
  profile(profiler, "afterMarket", () => behavior.afterMarket(next));
  profile(profiler, "refreshAfterMarket", () => refreshCellBalances(next));
  return next;
}

export async function stepSimAsync(
  state: PriceLogisticsState,
  policies: PriceAgentPolicy[],
  behavior: PriceCellBehavior,
  stepPriceFields: PriceFieldBatchStepper,
  profiler?: PriceStepProfiler,
): Promise<PriceLogisticsState> {
  const next: PriceLogisticsState = profile(profiler, "cloneState", () => ({
    ...state,
    turn: state.turn + 1,
    nextOrderId: state.nextOrderId,
    ledger: cloneLedger(state.ledger),
    cells: state.cells.map((cell) => ({ ...cell, marketHistory: cloneMarketHistory(cell.marketHistory) })),
    orders: [],
    lastOrderResults: [],
    trades: [],
    events: [],
  }));
  setLedgerBalance(next.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money", state.money);
  setLedgerBalance(next.ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money", state.producerMoney);
  setLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money", state.farmProducerMoney);

  profile(profiler, "syncLedgerAndCells", () => {
    for (const cell of next.cells) {
      const account = accountOfCell(cell);
      const consumer = consumerAgentForCell(cell);
      setLedgerBalance(next.ledger, consumer, MONEY_ACCOUNT, "money", cell.consumerMoney);
      setLedgerBalance(next.ledger, consumer, account, "labor", cell.laborStock);
      setLedgerBalance(next.ledger, PRODUCER_AGENT, account, "product", cell.producerStock);
      setLedgerBalance(next.ledger, PRODUCER_AGENT, account, "food", cell.producerFoodStock);
      setLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "food", cell.farmProducerFoodStock);
      setLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, account, "farm", cell.farmStock);
      setLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "product", cell.logisticsStock);
      setLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "food", cell.logisticsFoodStock);
      const labor = getLedgerBalance(next.ledger, consumer, account, "labor");
      const generatedLabor = Math.floor(cell.population * laborProductivity(cell));
      setLedgerBalance(next.ledger, consumer, account, "labor", Math.min(12, labor + generatedLabor));
      const moved = cell.movedStock;
      if (moved > 0) addLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "product", moved);
      cell.movedStock = 0;
    }
  });
  profile(profiler, "refreshBeforeFields", () => refreshCellBalances(next));
  next.bidFields = await profileAsync(profiler, "priceFields", () => stepPriceFields(priceFieldStepWork(next, behavior)));
  next.bidField = next.bidFields.product;

  profile(profiler, "policies", () => {
    let consumerPolicyStartedAt = profiler ? performance.now() : 0;
    let consumerPolicyOpen = false;
    for (const policy of policies) {
      if (policy.agent.startsWith("Consumer-")) {
        consumerPolicyOpen = true;
        policy.run(createAgentApi(next, policy.agent));
        continue;
      }
      if (consumerPolicyOpen) {
        profiler?.record("policy:Consumers", performance.now() - consumerPolicyStartedAt);
        consumerPolicyOpen = false;
      }
      profile(profiler, `policy:${policy.agent}`, () => policy.run(createAgentApi(next, policy.agent)));
      consumerPolicyStartedAt = profiler ? performance.now() : 0;
    }
    if (consumerPolicyOpen) {
      profiler?.record("policy:Consumers", performance.now() - consumerPolicyStartedAt);
    }
  });

  profile(profiler, "clearLocalAuctions", () => clearLocalAuctions(next, ["labor", "product", "food"]));
  profile(profiler, "recordCellMarketHistory", () => recordCellMarketHistory(next));
  profile(profiler, "syncTradeEffects", () => syncTradeEffects(next));
  profile(profiler, "generateProducts", () => generateProducts(next));
  profile(profiler, "foodAndPopulation", () => updateFoodAndPopulation(next));
  profile(profiler, "afterMarket", () => behavior.afterMarket(next));
  profile(profiler, "refreshAfterMarket", () => refreshCellBalances(next));
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
    recipes: [],
    logisticsResources: ["product", "food"],
    money: 0,
    producerMoney: 0,
    farmProducerMoney: 0,
    cells: [{
      x: 0,
      y: 0,
      land: true,
      consumerMoney: 0,
      population: 0,
      malnutritionBurden: 0,
      foodConsumed: 0,
      laborStock: 0,
      fieldBid: 0,
      bidVolume: 0,
      foodFieldBid: 0,
      foodBidVolume: 0,
      producerStock: 0,
      producerFoodStock: 0,
      farmProducerFoodStock: 0,
      farmStock: 0,
      logisticsStock: 0,
      logisticsFoodStock: 0,
      movedStock: 0,
      marketHistory: [],
    }],
    bidField: { width: 1, height: 1, turn: 0, cells: [] },
    bidFields: { product: { width: 1, height: 1, turn: 0, cells: [] }, food: { width: 1, height: 1, turn: 0, cells: [] } },
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
