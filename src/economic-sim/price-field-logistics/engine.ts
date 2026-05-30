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
  localBid: number;
  foodBid: number;
  consumerMoney: number;
  population: number;
  malnutritionBurden: number;
  foodConsumed: number;
  laborBid: number;
  laborAsk: number;
  laborStock: number;
  fieldBid: number;
  bidVolume: number;
  foodFieldBid: number;
  foodBidVolume: number;
  localAsk: number;
  foodAsk: number;
  producerStock: number;
  producerFoodStock: number;
  farmProducerFoodStock: number;
  farmStock: number;
  logisticsStock: number;
  logisticsFoodStock: number;
  movedStock: number;
  lastBidFilled: number;
  lastBidUnfilled: number;
  lastFoodBidFilled: number;
  lastFoodBidUnfilled: number;
  lastLaborBidFilled: number;
  lastLaborBidUnfilled: number;
  lastLaborFilled: number;
  lastLaborUnfilled: number;
  lastAskFilled: number;
  lastAskUnfilled: number;
  lastFoodAskFilled: number;
  lastFoodAskUnfilled: number;
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

export type PriceCellBehavior = {
  fieldSources: (state: PriceLogisticsState, resource: PriceLogisticsResource) => PriceFieldSource[];
  afterMarket: (state: PriceLogisticsState) => void;
  adaptCell: (cell: PriceLogisticsCell) => Partial<Pick<PriceLogisticsCell, "localBid" | "foodBid" | "laborBid" | "laborAsk" | "localAsk" | "foodAsk">>;
};

export const MOVE_COST = 1;
export const MAX_OPTIONS_PER_TURN = 120;
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
  return ensureAccount(ledger, agent, account)[resource] ?? 0;
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

function stepBidField(state: PriceLogisticsState, behavior: PriceCellBehavior, resource: PriceLogisticsResource) {
  return stepPriceField(state.bidFields[resource], behavior.fieldSources(state, resource), {
    priceDecay: 0.9,
    volumeDecay: 0.96,
    closePriceRatio: 0.9,
    minimumVolume: 0.0005,
    movementCost: (from, to) => travelCost(state, from, to),
  });
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
  if (order.quantity <= 0 || order.price < 0) return;
  assertIntegerQuantity(order.quantity, `${order.agent} ${order.resource} order quantity`);
  if (order.side === "bid") {
    addLedgerBalance(state.ledger, order.agent, MONEY_ACCOUNT, "money", -order.quantity * order.price);
  } else {
    addLedgerBalance(state.ledger, order.agent, order.account, order.resource, -order.quantity);
  }
  state.orders.push({ ...order, id: state.nextOrderId, remaining: order.quantity });
  state.nextOrderId += 1;
}

function bestOpenOrder(state: PriceLogisticsState, account: Account, resource: PriceMarketResource, side: "bid" | "ask") {
  const orders = state.orders.filter(
    (order) => order.account === account && order.resource === resource && order.side === side && order.remaining > 0,
  );
  const best = orders.sort((a, b) => (
    side === "bid" ? b.price - a.price || a.id - b.id : a.price - b.price || a.id - b.id
  ))[0];
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

function syncTradeEffects(state: PriceLogisticsState) {
  for (const cell of state.cells) {
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
    if (trade.resource === "food" && trade.buyer === consumerAgentForCell(cell)) {
      cell.lastFoodBidFilled += trade.quantity;
      if (trade.seller === PRODUCER_AGENT || trade.seller === FARM_PRODUCER_AGENT) cell.lastFoodAskFilled += trade.quantity;
      state.events.push({ kind: "sell", x: trade.x, y: trade.y, quantity: trade.quantity, price: trade.price });
    }
    if (
      trade.resource === "labor" &&
      (trade.buyer === PRODUCER_AGENT || trade.buyer === FARM_PRODUCER_AGENT) &&
      trade.seller === consumerAgentForCell(cell)
    ) {
      cell.lastLaborBidFilled += trade.quantity;
      cell.lastLaborFilled += trade.quantity;
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
    if (result.resource === "food" && result.side === "bid" && result.agent === consumerAgentForCell(cell)) {
      cell.lastFoodBidUnfilled += result.unfilled;
    }
    if (
      result.resource === "food" &&
      result.side === "ask" &&
      (result.agent === PRODUCER_AGENT || result.agent === FARM_PRODUCER_AGENT)
    ) {
      cell.lastFoodAskUnfilled += result.unfilled;
    }
    if (result.resource === "labor" && result.side === "ask" && result.agent === consumerAgentForCell(cell)) {
      cell.lastLaborUnfilled += result.unfilled;
    }
    if (
      result.resource === "labor" &&
      result.side === "bid" &&
      (result.agent === PRODUCER_AGENT || result.agent === FARM_PRODUCER_AGENT)
    ) {
      cell.lastLaborBidUnfilled += result.unfilled;
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

function generateProducts(state: PriceLogisticsState) {
  for (const [agent, accounts] of Object.entries(state.ledger) as Array<[PriceAgent, NonNullable<PriceLedger[PriceAgent]>]>) {
    for (const [account, resources] of Object.entries(accounts) as Array<[Account, Partial<Record<PriceResource, number>>]>) {
      for (const recipe of state.recipes) {
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
    const deficit = Math.max(0, 1 - adequacy);
    const surplus = Math.max(0, adequacy - 1);
    cell.foodConsumed = consumed;
    cell.malnutritionBurden = clamp(cell.malnutritionBurden + deficit * (7 / 90) - surplus * 0.14, 0, 1);

    const mortality = NORMAL_MORTALITY_PER_WEEK + 0.19 * cell.malnutritionBurden ** 4;
    const fertility = BASE_FERTILITY_PER_WEEK * (1 - cell.malnutritionBurden) ** 2;
    cell.population = Math.max(0, cell.population * (1 - mortality + fertility));
  }
}

function createAgentApi(state: PriceLogisticsState, agent: PriceAgent): PriceAgentApi {
  return {
    agent,
    balance: (account, resource) => getLedgerBalance(state.ledger, agent, account, resource),
    balanceOf: (targetAgent, account, resource) => getLedgerBalance(state.ledger, targetAgent, account, resource),
    accounts: () => state.cells.map(accountOfCell),
    local: (account) => cellForAccount(state, account),
    placeBid: (account, resource, price, quantity) => placeOrder(state, { agent, account, resource, side: "bid", price, quantity }),
    placeAsk: (account, resource, price, quantity) => placeOrder(state, { agent, account, resource, side: "ask", price, quantity }),
    bestBid: (account, resource) => bestOpenOrder(state, account, resource, "bid"),
    bestAsk: (account, resource) => bestOpenOrder(state, account, resource, "ask"),
    recipes: () => state.recipes,
    moveResource: (resource, from, to, value) => {
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
    },
    moveProduct: (from, to, value) => createAgentApi(state, agent).moveResource("product", from, to, value),
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

export function stepPriceLogistics(
  state: PriceLogisticsState,
  policies: PriceAgentPolicy[],
  behavior: PriceCellBehavior,
): PriceLogisticsState {
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
  setLedgerBalance(next.ledger, FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money", state.farmProducerMoney);

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
    Object.assign(cell, behavior.adaptCell(cell));
    const labor = getLedgerBalance(next.ledger, consumer, account, "labor");
    const generatedLabor = Math.floor(cell.population * laborProductivity(cell));
    setLedgerBalance(next.ledger, consumer, account, "labor", Math.min(12, labor + generatedLabor));
    const moved = cell.movedStock;
    if (moved > 0) addLedgerBalance(next.ledger, LOGISTICS_AGENT, account, "product", moved);
    cell.movedStock = 0;
  }
  refreshCellBalances(next);
  next.bidFields = Object.fromEntries(
    next.logisticsResources.map((resource) => [resource, stepBidField(next, behavior, resource)]),
  ) as Record<PriceLogisticsResource, PriceFieldState>;
  next.bidField = next.bidFields.product;

  for (const policy of policies) {
    policy.run(createAgentApi(next, policy.agent));
  }

  clearLocalAuctions(next, ["labor", "product", "food"]);
  syncTradeEffects(next);
  generateProducts(next);
  updateFoodAndPopulation(next);
  behavior.afterMarket(next);
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
    recipes: [],
    logisticsResources: ["product", "food"],
    money: 0,
    producerMoney: 0,
    farmProducerMoney: 0,
    cells: [{
      x: 0,
      y: 0,
      land: true,
      localBid: 0,
      foodBid: 0,
      consumerMoney: 0,
      population: 0,
      malnutritionBurden: 0,
      foodConsumed: 0,
      laborBid: 0,
      laborAsk: 0,
      laborStock: 0,
      fieldBid: 0,
      bidVolume: 0,
      foodFieldBid: 0,
      foodBidVolume: 0,
      localAsk: 0,
      foodAsk: 0,
      producerStock: 0,
      producerFoodStock: 0,
      farmProducerFoodStock: 0,
      farmStock: 0,
      logisticsStock: 0,
      logisticsFoodStock: 0,
      movedStock: 0,
      lastBidFilled: 0,
      lastBidUnfilled: 0,
      lastFoodBidFilled: 0,
      lastFoodBidUnfilled: 0,
      lastLaborBidFilled: 0,
      lastLaborBidUnfilled: 0,
      lastLaborFilled: 0,
      lastLaborUnfilled: 0,
      lastAskFilled: 0,
      lastAskUnfilled: 0,
      lastFoodAskFilled: 0,
      lastFoodAskUnfilled: 0,
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
