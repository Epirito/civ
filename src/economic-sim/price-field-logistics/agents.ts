import {
  FARM_PRODUCER_AGENT,
  LOGISTICS_AGENT,
  MAX_OPTIONS_PER_TURN,
  MAX_PRICE,
  MIN_PRICE,
  MONEY_ACCOUNT,
  MOVE_COST,
  PRODUCER_AGENT,
  accountOfCell,
  consumerAgentForCell,
  stepSimEngine,
  type PriceAgentApi,
  type PriceAgentPolicy,
  type PriceCellBehavior,
  type Cell,
  type LogisticsResource,
  type State,
  type MarketResource,
  type OrderResult,
  type Recipe,
  type PriceResource,
  type PriceStepProfiler,
} from "./engine";
import type { PriceFieldSource } from "./priceFieldAutomaton";
import type { Account, Agent } from "../shared/types";
import { recipes } from "./recipes";

const LOGISTICS_DEMAND_ALPHA = 0.35;
const LOGISTICS_DEMAND_DECAY = 0.9;
const CONSUMER_FOOD_BUFFER_TURNS = 5;
const INITIAL_CONSUMER_FOOD_BID = 4

function foodNeedPerTurn(cell: Cell) {
  return Math.ceil(cell.population * 1.5);
}

function consumerFoodTarget(cell: Cell) {
  return foodNeedPerTurn(cell) * (CONSUMER_FOOD_BUFFER_TURNS + 1);
}

function consumerFoodDemand(cell: Cell, consumerMoney: number, currentFood: number, agent: Agent) {
  const price = Math.min(adaptBidFromHistory({cell, resource: 'food', agent})??INITIAL_CONSUMER_FOOD_BID, Math.floor(consumerMoney));
  const neededFood = Math.max(0, consumerFoodTarget(cell) - currentFood);
  return {
    price,
    quantity: price > 0 ? Math.min(neededFood, Math.floor(consumerMoney / price)) : 0,
  };
}
function consumerProductDemand(cell: Cell, consumerMoney: number, agent: Agent) {
  const price = Math.min(adaptBidFromHistory({cell, resource: 'product', agent})??INITIAL_CONSUMER_FOOD_BID, Math.floor(consumerMoney));
  return {
    price,
    quantity: price > 0 ? Math.min(Math.floor(cell.population), Math.floor(consumerMoney / price)) : 0,
  };
}

function clampPrice(price: number) {
  return Math.max(MIN_PRICE, Math.min(MAX_PRICE, Math.round(price)));
}

function orderQuantity(orders: OrderResult[], field: "filled" | "unfilled") {
  return orders.reduce((sum, order) => sum + order[field], 0);
}

function ownOrders(
  cell: Cell,
  resource: MarketResource,
  side: "bid" | "ask",
  agent: Agent
) {
  return [...cell.marketHistory]
    .reverse()
    .flatMap((tick) => tick.resources[resource].orders)
    .filter((order) => order.side === side && order.agent === agent);
}

function initialQuote(
  cell: Cell,
  resource: MarketResource,
  side: "bid" | "ask",
  agent: Agent,
) {
  return ownOrders(cell, resource, side, agent)[0]?.price;
}

function matchingUnfilledOppositePrice(
  orders: OrderResult[],
  side: "bid" | "ask",
  price: number,
) {
  const oppositeSide = side === "bid" ? "ask" : "bid";
  const opposite = orders.filter((order) => order.side === oppositeSide && order.unfilled > 0);
  if (side === "bid") {
    return opposite
      .filter((order) => order.price < price)
      .sort((a, b) => a.price - b.price)[0]?.price;
  }
  return opposite
    .filter((order) => order.price > price)
    .sort((a, b) => b.price - a.price)[0]?.price;
}

/**
 * 
 * adaptive pricing based on their own last bid. undefined if it's the agent's first bid
 */
function adaptBidFromHistory({
  cell,
  resource,
  agent,
  filledStep = 1,
  unfilledStep = 1,
}: {
  cell: Cell;
  resource: MarketResource;
  agent: Agent
  filledStep?: number;
  unfilledStep?: number;
}) {
  const base = initialQuote(cell, resource, "bid", agent);
  if (base === undefined) return undefined
  if (base <= 0) return 0;
  let price = clampPrice(base);
  const history = [...cell.marketHistory].reverse();
  for (const tick of history) {
    const orders = tick.resources[resource].orders;
    const match = matchingUnfilledOppositePrice(orders, "bid", price);
    if (match !== undefined) {
      price = clampPrice(match);
      continue;
    }
    const own = orders.filter((order) => order.side === "bid" && order.agent===agent);
    const unfilled = orderQuantity(own, "unfilled");
    const filled = orderQuantity(own, "filled");
    if (unfilled > 0) price = clampPrice(price + unfilledStep);
    else if (filled > 0) price = clampPrice(price - filledStep);
  }
  return price;
}

function adaptAskFromHistory({
  cell,
  resource,
  agent,
}: {
  cell: Cell;
  resource: MarketResource;
  agent: Agent
}) {
  const base = initialQuote(cell, resource, "ask", agent);
  if (base <= 0) return 0;
  let price = clampPrice(base);
  const history = [...cell.marketHistory].reverse();
  for (const tick of history) {
    const orders = tick.resources[resource].orders;
    const match = matchingUnfilledOppositePrice(orders, "ask", price);
    if (match !== undefined) {
      price = clampPrice(match);
      continue;
    }
    const own = orders.filter((order) => order.side === "ask" && order.agent ===agent);
    const unfilled = orderQuantity(own, "unfilled");
    const filled = orderQuantity(own, "filled");
    if (unfilled > 0) price = clampPrice(price - 1);
    else if (filled > 0) price = clampPrice(price + 1);
  }
  return price;
}

function logisticResidualDemandSources(state: State, resource: MarketResource): PriceFieldSource[] {
  return state.cells
    .map((cell) => ({
      cell,
      fieldBid: resource === "food" ? cell.foodFieldBid : cell.fieldBid,
      bidVolume: resource === "food" ? cell.foodBidVolume : cell.bidVolume,
    }))
    .filter(({ fieldBid, bidVolume }) => fieldBid > 0 && bidVolume > 0)
    .map(({ cell, fieldBid, bidVolume }) => ({
      x: cell.x,
      y: cell.y,
      price: fieldBid,
      volume: bidVolume,
      active: true,
    }));
}

function addResidualDemand(
  observations: Map<Account, { quantity: number; value: number }>,
  account: Account,
  price: number,
  quantity: number,
) {
  if (price <= 0 || quantity <= 0) return;
  const observation = observations.get(account) ?? { quantity: 0, value: 0 };
  observation.quantity += quantity;
  observation.value += price * quantity;
  observations.set(account, observation);
}

function updateLogisticsResidualDemandForResource(state: State, resource: MarketResource) {
  const observations = new Map<Account, { quantity: number; value: number }>();
  const cellsByAccount = new Map(state.cells.map((cell) => [accountOfCell(cell), cell]));

  for (const result of state.lastOrderResults) {
    const local = cellsByAccount.get(result.account);
    if (
      local &&
      result.resource === resource &&
      result.side === "bid" &&
      result.agent === consumerAgentForCell(local) &&
      result.unfilled > 0
    ) {
      addResidualDemand(observations, result.account, result.price, result.unfilled);
    }
  }

  for (const trade of state.trades) {
    const local = cellsByAccount.get(trade.account);
    if (
      local &&
      trade.resource === resource &&
      trade.buyer === consumerAgentForCell(local) &&
      trade.seller === LOGISTICS_AGENT
    ) {
      addResidualDemand(observations, trade.account, trade.price, trade.quantity);
    }
  }

  for (const cell of state.cells) {
    const account = accountOfCell(cell);
    const observation = observations.get(account);
    const fieldBidKey = resource === "food" ? "foodFieldBid" : "fieldBid";
    const bidVolumeKey = resource === "food" ? "foodBidVolume" : "bidVolume";
    if (!observation) {
      cell[bidVolumeKey] *= LOGISTICS_DEMAND_DECAY;
      if (cell[bidVolumeKey] < 0.01) {
        cell[bidVolumeKey] = 0;
        cell[fieldBidKey] = 0;
      }
      continue;
    }

    const observedPrice = observation.value / observation.quantity;
    cell[bidVolumeKey] = cell[bidVolumeKey] * (1 - LOGISTICS_DEMAND_ALPHA) + observation.quantity * LOGISTICS_DEMAND_ALPHA;
    cell[fieldBidKey] = cell[fieldBidKey] <= 0
      ? observedPrice
      : cell[fieldBidKey] * (1 - LOGISTICS_DEMAND_ALPHA) + observedPrice * LOGISTICS_DEMAND_ALPHA;
  }
}

function updateLogisticsResidualDemand(state: State) {
  for (const resource of state.logisticsResources) updateLogisticsResidualDemandForResource(state, resource);
}

export const priceCellBehavior: PriceCellBehavior = {
  fieldSources: logisticResidualDemandSources,
  afterMarket: updateLogisticsResidualDemand,
};

function resourceValue(api: PriceAgentApi, account: Account, local: Cell, resource:MarketResource, agent:Agent) {
  return Math.max(api.bestBid(account, resource)?.price??0, api.diffusedBid(account, "product"));
}

function outputValue(api: PriceAgentApi, account: Account, local: Cell, recipe: Recipe, agent:Agent) {
  let v = 0;
  for (const [r, amount] of Object.entries(recipe.outputs) as Array<[MarketResource, number]>) {
    const value = api.bestBid(account, r)?.price
    if (value===undefined) return undefined
    v += value * amount;
  }
  return v;
}

function hasRequirements(api: PriceAgentApi, account: Account, recipe: Recipe) {
  return (Object.entries(recipe.requirements) as Array<[PriceResource, number]>)
    .every(([resource, amount]) => api.balance(account, resource) >= amount);
}

function missingMarketInput(api: PriceAgentApi, account: Account, recipe: Recipe) {
  for (const [resource, amount] of Object.entries(recipe.inputs) as Array<[PriceResource, number]>) {
    if (amount <= 0 || api.balance(account, resource) >= amount) continue;
    if (resource === "product" || resource === "food" || resource === "labor") return resource;
  }
  return null;
}

function inputBidLimit(
  local: Cell,
  resource: MarketResource,
  recipeValue: number,
  agent: typeof PRODUCER_AGENT | typeof FARM_PRODUCER_AGENT,
) {
    const adaptiveBid = adaptBidFromHistory({cell: local, resource, agent})
    return Math.min(Math.floor(recipeValue), adaptiveBid??Infinity)
}

export function createConsumerPolicies(state: State): PriceAgentPolicy[] {
  return state.cells
    .filter((cell) => cell.population > 0)
    .map((cell) => {
      const account = accountOfCell(cell);
      const agent = consumerAgentForCell(cell)
      return {
        agent,
        run(api) {
          const local = api.local(account);
          if (!local) return;

          const money = api.balance(MONEY_ACCOUNT, "money");
          const currentFood = api.balance(account, "food");
          const foodTarget = consumerFoodTarget(local);
          const { price: foodPrice, quantity: foodQuantity } = consumerFoodDemand(local, money, currentFood, agent);
          if (foodQuantity > 0) api.placeBid(account, "food", foodPrice, foodQuantity);

          const remainingMoney = Math.max(0, money - foodPrice * foodQuantity);
          if (currentFood >= foodTarget) {
            const { price: effectiveBid, quantity: bidQuantity } = consumerProductDemand(local, remainingMoney, agent);
            if (bidQuantity > 0) api.placeBid(account, "product", effectiveBid, bidQuantity);
          }

          const labor = api.balance(account, "labor");
          const laborAsk = adaptAskFromHistory({cell: local, resource: 'labor', agent});
          if (laborAsk > 0 && labor > 0) api.placeAsk(account, "labor", laborAsk, labor);
        },
      };
    });
}

function recipeUsesRequirement(recipe: Recipe, resource: PriceResource) {
  return (recipe.requirements[resource] ?? 0) > 0;
}

function createProducerPolicy({
  agent,
  recipe
}: {
  agent: typeof PRODUCER_AGENT | typeof FARM_PRODUCER_AGENT;
  recipe: Recipe
}): PriceAgentPolicy {
  return {
    agent,
    run(api) {
      const candidates: Array<{
        account: Account;
        resource: MarketResource;
        bid: number;
        value: number;
        quantity: number;
      }> = [];
      for (const account of api.accounts()) {
        const local = api.local(account);
        if (!local) continue;
        if (!hasRequirements(api, account, recipe)) continue;
        const input = missingMarketInput(api, account, recipe);
        if (!input) continue
        const ask = api.bestAsk(account, input);
        if (!ask) continue;

        const recipeValue = outputValue(api, account, local, recipe, agent);
        if (recipeValue === undefined) {
          // lowball
          candidates.push({account, resource: input, bid: 1, value: 1, quantity: 1})
          continue;
        }
          const bid = inputBidLimit(local, input, recipeValue, agent);
          const expectedCost = Math.round((bid + ask.price) / 2);
          const value = recipeValue - expectedCost;
          if (value <= 0 || bid <= 0 || api.balance(MONEY_ACCOUNT, "money") < bid) {
            // lowball
            candidates.push({account, resource: input, bid: 1, value: 1, quantity: 1})
            continue;
          }
          candidates.push({ account, resource: input, bid, value, quantity: ask.quantity });
        }

      let placed = 0;
      for (const candidate of candidates.sort((a, b) => b.value - a.value)) {
        if (placed >= MAX_OPTIONS_PER_TURN) break;
        const affordable = Math.floor(api.balance(MONEY_ACCOUNT, "money") / candidate.bid);
        const quantity = Math.min(candidate.quantity, affordable, MAX_OPTIONS_PER_TURN - placed);
        if (quantity <= 0) continue;
        api.placeBid(candidate.account, candidate.resource, candidate.bid, quantity);
        placed += quantity;
      }

      for (const account of api.accounts()) {
        const local = api.local(account);
        if (!local) continue;
        for (const soldResource of Object.keys(recipe.outputs) as MarketResource[]) {
          const stock = api.balance(account, soldResource);
          const ask = adaptAskFromHistory({cell: local, agent, resource: soldResource});
          if (stock > 0 && ask > 0) api.placeAsk(account, soldResource, ask, stock);
        }
      }
    },
  };
}

export const producerPolicy = createProducerPolicy({
  agent: PRODUCER_AGENT,
  recipe: recipes.find(r=>r.id==='factory-product')!
});

export const farmProducerPolicy = createProducerPolicy({
  agent: FARM_PRODUCER_AGENT,
  recipe: recipes.find(r=>r.id==='subsistence-food')!
});

export const logisticsPolicy: PriceAgentPolicy = {
  agent: LOGISTICS_AGENT,
  run(api) {/*
    const resources: PriceLogisticsResource[] = ["product", "food"];
    for (const resource of resources) {
      for (let option = 0; option < MAX_OPTIONS_PER_TURN; option += 1) {
        let best:
          | { kind: "move"; account: Account; to: Account; value: number; surplus: number }
          | { kind: "buy"; account: Account; bid: number; value: number; surplus: number }
          | null = null;

        for (const account of api.accounts()) {
          const local = api.local(account);
          if (!local) continue;

          const held = api.balance(account, resource);
          if (held > 0) {
            const neighbor = api.bestMoveNeighbor(account, resource);
            const localBid = api.bestBid(account, resource)?.price ?? 0;
            if (neighbor && neighbor.bid > localBid && api.balance(MONEY_ACCOUNT, "money") >= MOVE_COST) {
              const value = neighbor.bid - localBid;
              const candidate = { kind: "move" as const, account, to: neighbor.account, value, surplus: value - MOVE_COST };
              if (!best || candidate.surplus > best.surplus) best = candidate;
            }
          }

          const ask = api.bestAsk(account, resource);
          if (ask) {
            const reachableBid = Math.max(bidFromHi, api.diffusedBid(account, resource));
            const bid = Math.floor(reachableBid);
            const value = reachableBid - ask.price;
            if (value > 0 && bid > 0 && api.balance(MONEY_ACCOUNT, "money") >= bid) {
              const candidate = { kind: "buy" as const, account, bid, value, surplus: value };
              if (!best || candidate.surplus > best.surplus) best = candidate;
            }
          }
        }

        if (!best) break;
        if (best.kind === "move") {
          if (!api.moveResource(resource, best.account, best.to, best.value)) break;
        } else {
          api.placeBid(best.account, resource, best.bid, 1);
        }
      }
    }

    for (const resource of resources) {
      for (const account of api.accounts()) {
        const local = api.local(account);
        const held = api.balance(account, resource);
        const bid = Math.max(localConsumerBid(api, account, resource), api.bestBid(account, resource)?.price ?? 0);
        if (local && held > 0 && bid > 0) api.placeAsk(account, resource, bid, held);
      }
    }
  */},
};

export function policies(state: State) {
  return [...createConsumerPolicies(state), producerPolicy, farmProducerPolicy, logisticsPolicy];
}

export function stepAgentSim(state: Parameters<typeof stepSimEngine>[0], profiler?: PriceStepProfiler) {
  const startedAt = profiler ? performance.now() : 0;
  const agentPolicies = policies(state);
  profiler?.record("createPolicies", performance.now() - startedAt);
  return stepSimEngine(state, agentPolicies, priceCellBehavior, profiler);
}
