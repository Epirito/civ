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
  stepSimAsync as stepEngineAsync,
  consumerAgentForCell,
  stepSimEngine,
  type PriceAgentApi,
  type PriceAgentPolicy,
  type PriceCellBehavior,
  type PriceLogisticsCell,
  type PriceLogisticsResource,
  type PriceLogisticsState,
  type PriceMarketResource,
  type PriceOrderResult,
  type PriceRecipe,
  type PriceResource,
  type PriceStepProfiler,
} from "./engine";
import type { PriceFieldSource } from "./priceFieldAutomaton";
import type { Account } from "../shared/types";

const LOGISTICS_DEMAND_ALPHA = 0.35;
const LOGISTICS_DEMAND_DECAY = 0.9;
const CONSUMER_FOOD_BUFFER_TURNS = 5;

export function effectiveProductBidForBalance(cell: PriceLogisticsCell, consumerMoney: number) {
  return Math.min(adaptConsumerBid(cell), Math.floor(consumerMoney));
}

export function effectiveProductBid(cell: PriceLogisticsCell) {
  return effectiveProductBidForBalance(cell, cell.consumerMoney);
}

function productDemand(cell: PriceLogisticsCell, consumerMoney: number) {
  const price = Math.min(adaptConsumerBid(cell), Math.floor(consumerMoney));
  return {
    price,
    quantity: price > 0 ? Math.min(Math.floor(cell.population), Math.floor(consumerMoney / price)) : 0,
  };
}

function foodNeedPerTurn(cell: PriceLogisticsCell) {
  return Math.ceil(cell.population * 1.5);
}

function consumerFoodTarget(cell: PriceLogisticsCell) {
  return foodNeedPerTurn(cell) * (CONSUMER_FOOD_BUFFER_TURNS + 1);
}

function foodDemand(cell: PriceLogisticsCell, consumerMoney: number, currentFood: number) {
  const price = Math.min(adaptFoodBid(cell), Math.floor(consumerMoney));
  const neededFood = Math.max(0, consumerFoodTarget(cell) - currentFood);
  return {
    price,
    quantity: price > 0 ? Math.min(neededFood, Math.floor(consumerMoney / price)) : 0,
  };
}

function clampPrice(price: number) {
  return Math.max(MIN_PRICE, Math.min(MAX_PRICE, Math.round(price)));
}

function orderQuantity(orders: PriceOrderResult[], field: "filled" | "unfilled") {
  return orders.reduce((sum, order) => sum + order[field], 0);
}

function ownOrders(
  cell: PriceLogisticsCell,
  resource: PriceMarketResource,
  side: "bid" | "ask",
  ownsOrder: (order: PriceOrderResult) => boolean,
) {
  return [...cell.marketHistory]
    .reverse()
    .flatMap((tick) => tick.resources[resource].orders)
    .filter((order) => order.side === side && ownsOrder(order));
}

function initialQuote(
  cell: PriceLogisticsCell,
  resource: PriceMarketResource,
  side: "bid" | "ask",
  ownsOrder: (order: PriceOrderResult) => boolean,
) {
  return ownOrders(cell, resource, side, ownsOrder)[0]?.price ?? 0;
}

function matchingUnfilledOppositePrice(
  orders: PriceOrderResult[],
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

function adaptBidFromHistory({
  cell,
  resource,
  ownsOrder,
  filledStep = 2,
  unfilledStep = 2,
}: {
  cell: PriceLogisticsCell;
  resource: PriceMarketResource;
  ownsOrder: (order: PriceOrderResult) => boolean;
  filledStep?: number;
  unfilledStep?: number;
}) {
  const base = initialQuote(cell, resource, "bid", ownsOrder);
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
    const own = orders.filter((order) => order.side === "bid" && ownsOrder(order));
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
  ownsOrder,
}: {
  cell: PriceLogisticsCell;
  resource: PriceMarketResource;
  ownsOrder: (order: PriceOrderResult) => boolean;
}) {
  const base = initialQuote(cell, resource, "ask", ownsOrder);
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
    const own = orders.filter((order) => order.side === "ask" && ownsOrder(order));
    const unfilled = orderQuantity(own, "unfilled");
    const filled = orderQuantity(own, "filled");
    if (unfilled > 0 && filled === 0) price = clampPrice(price - 1);
    else if (filled > 0) price = clampPrice(price + (unfilled === 0 ? 2 : 1));
  }
  return price;
}

function adaptConsumerBid(cell: PriceLogisticsCell) {
  if (cell.population <= 0) return 0;
  return adaptBidFromHistory({
    cell,
    resource: "product",
    ownsOrder: (order) => order.agent === consumerAgentForCell(cell),
  });
}

function adaptFoodBid(cell: PriceLogisticsCell) {
  if (cell.population <= 0) return 0;
  const price = adaptBidFromHistory({
    cell,
    resource: "food",
    ownsOrder: (order) => order.agent === consumerAgentForCell(cell),
    filledStep: cell.malnutritionBurden < 0.05 ? 1 : 0,
  });
  return cell.malnutritionBurden > 0.2 ? clampPrice(price + 2) : price;
}

function adaptLaborAsk(cell: PriceLogisticsCell) {
  if (cell.population <= 0) return 0;
  return adaptAskFromHistory({
    cell,
    resource: "labor",
    ownsOrder: (order) => order.agent === consumerAgentForCell(cell),
  });
}

function adaptLaborBid(cell: PriceLogisticsCell, agent: typeof PRODUCER_AGENT | typeof FARM_PRODUCER_AGENT) {
  return adaptBidFromHistory({
    cell,
    resource: "labor",
    ownsOrder: (order) => order.agent === agent,
  });
}

function adaptProducerAsk(cell: PriceLogisticsCell) {
  return adaptAskFromHistory({
    cell,
    resource: "product",
    ownsOrder: (order) => order.agent === PRODUCER_AGENT,
  });
}

function adaptFoodAsk(cell: PriceLogisticsCell) {
  return adaptAskFromHistory({
    cell,
    resource: "food",
    ownsOrder: (order) => order.agent === PRODUCER_AGENT || order.agent === FARM_PRODUCER_AGENT,
  });
}

function logisticResidualDemandSources(state: PriceLogisticsState, resource: PriceMarketResource): PriceFieldSource[] {
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

function updateLogisticsResidualDemandForResource(state: PriceLogisticsState, resource: PriceMarketResource) {
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

function updateLogisticsResidualDemand(state: PriceLogisticsState) {
  for (const resource of state.logisticsResources) updateLogisticsResidualDemandForResource(state, resource);
}

export const priceCellBehavior: PriceCellBehavior = {
  fieldSources: logisticResidualDemandSources,
  afterMarket: updateLogisticsResidualDemand,
};

function localConsumerBid(api: PriceAgentApi, account: Account, resource: PriceMarketResource = "product") {
  const local = api.local(account);
  const consumer = api.consumerAgentForAccount(account);
  if (!local || !consumer) return 0;
  const price = resource === "food" ? adaptFoodBid(local) : adaptConsumerBid(local);
  return Math.min(price, Math.floor(api.balanceOf(consumer, MONEY_ACCOUNT, "money")));
}

function productValue(api: PriceAgentApi, account: Account, local: PriceLogisticsCell) {
  return Math.max(adaptConsumerBid(local), api.diffusedBid(account, "product"));
}

function outputValue(api: PriceAgentApi, account: Account, local: PriceLogisticsCell, recipe: PriceRecipe) {
  let value = 0;
  for (const [resource, amount] of Object.entries(recipe.outputs) as Array<[PriceResource, number]>) {
    if (resource === "product") value += productValue(api, account, local) * amount;
    if (resource === "food") value += Math.max(adaptFoodBid(local), api.diffusedBid(account, "food")) * amount;
  }
  return value;
}

function hasRequirements(api: PriceAgentApi, account: Account, recipe: PriceRecipe) {
  return (Object.entries(recipe.requirements) as Array<[PriceResource, number]>)
    .every(([resource, amount]) => api.balance(account, resource) >= amount);
}

function missingMarketInput(api: PriceAgentApi, account: Account, recipe: PriceRecipe) {
  for (const [resource, amount] of Object.entries(recipe.inputs) as Array<[PriceResource, number]>) {
    if (amount <= 0 || api.balance(account, resource) >= amount) continue;
    if (resource === "product" || resource === "food" || resource === "labor") return resource;
  }
  return null;
}

function inputBidLimit(
  local: PriceLogisticsCell,
  resource: PriceMarketResource,
  recipeValue: number,
  agent: typeof PRODUCER_AGENT | typeof FARM_PRODUCER_AGENT,
) {
  if (resource === "labor") return Math.min(Math.floor(recipeValue), adaptLaborBid(local, agent));
  return Math.floor(recipeValue);
}

export function createConsumerPolicies(state: PriceLogisticsState): PriceAgentPolicy[] {
  return state.cells
    .filter((cell) => cell.population > 0)
    .map((cell) => {
      const account = accountOfCell(cell);
      return {
        agent: consumerAgentForCell(cell),
        run(api) {
          const local = api.local(account);
          if (!local) return;

          const money = api.balance(MONEY_ACCOUNT, "money");
          const currentFood = api.balance(account, "food");
          const foodTarget = consumerFoodTarget(local);
          const { price: foodPrice, quantity: foodQuantity } = foodDemand(local, money, currentFood);
          if (foodQuantity > 0) api.placeBid(account, "food", foodPrice, foodQuantity);

          const remainingMoney = Math.max(0, money - foodPrice * foodQuantity);
          if (currentFood >= foodTarget) {
            const { price: effectiveBid, quantity: bidQuantity } = productDemand(local, remainingMoney);
            if (bidQuantity > 0) api.placeBid(account, "product", effectiveBid, bidQuantity);
          }

          const labor = api.balance(account, "labor");
          const laborAsk = adaptLaborAsk(local);
          if (laborAsk > 0 && labor > 0) api.placeAsk(account, "labor", laborAsk, labor);
        },
      };
    });
}

function recipeUsesRequirement(recipe: PriceRecipe, resource: PriceResource) {
  return (recipe.requirements[resource] ?? 0) > 0;
}

function createProducerPolicy({
  agent,
  acceptsRecipe,
  sellOutputs,
}: {
  agent: typeof PRODUCER_AGENT | typeof FARM_PRODUCER_AGENT;
  acceptsRecipe: (recipe: PriceRecipe) => boolean;
  sellOutputs: PriceMarketResource[];
}): PriceAgentPolicy {
  return {
    agent,
    run(api) {
      const candidates: Array<{
        account: Account;
        resource: PriceMarketResource;
        bid: number;
        value: number;
        quantity: number;
      }> = [];
      for (const account of api.accounts()) {
        const local = api.local(account);
        if (!local) continue;
        for (const recipe of api.recipes()) {
          if (!acceptsRecipe(recipe)) continue;
          if (!hasRequirements(api, account, recipe)) continue;
          const input = missingMarketInput(api, account, recipe);
          const ask = input ? api.bestAsk(account, input) : null;
          if (!input || !ask) continue;

          const recipeValue = outputValue(api, account, local, recipe);
          const bid = inputBidLimit(local, input, recipeValue, agent);
          const expectedCost = Math.round((bid + ask.price) / 2);
          const value = recipeValue - expectedCost;
          if (value <= 0 || bid <= 0 || api.balance(MONEY_ACCOUNT, "money") < bid) continue;
          candidates.push({ account, resource: input, bid, value, quantity: ask.quantity });
        }
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
        if (sellOutputs.includes("product")) {
          const stock = api.balance(account, "product");
          const ask = adaptProducerAsk(local);
          if (stock > 0 && ask > 0) api.placeAsk(account, "product", ask, stock);
        }
        if (sellOutputs.includes("food")) {
          const food = api.balance(account, "food");
          const ask = adaptFoodAsk(local);
          if (food > 0 && ask > 0) api.placeAsk(account, "food", ask, food);
        }
      }
    },
  };
}

export const producerPolicy = createProducerPolicy({
  agent: PRODUCER_AGENT,
  acceptsRecipe: (recipe) => recipeUsesRequirement(recipe, "factory"),
  sellOutputs: ["product"],
});

export const farmProducerPolicy = createProducerPolicy({
  agent: FARM_PRODUCER_AGENT,
  acceptsRecipe: (recipe) => recipeUsesRequirement(recipe, "farm"),
  sellOutputs: ["food"],
});

export const logisticsPolicy: PriceAgentPolicy = {
  agent: LOGISTICS_AGENT,
  run(api) {
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
            const localConsumerPrice = Math.max(localConsumerBid(api, account, resource), api.bestBid(account, resource)?.price ?? 0);
            if (neighbor && neighbor.bid > localConsumerPrice && api.balance(MONEY_ACCOUNT, "money") >= MOVE_COST) {
              const value = neighbor.bid - localConsumerPrice;
              const candidate = { kind: "move" as const, account, to: neighbor.account, value, surplus: value - MOVE_COST };
              if (!best || candidate.surplus > best.surplus) best = candidate;
            }
          }

          const ask = api.bestAsk(account, resource);
          const localProducerPrice = resource === "food" ? adaptFoodAsk(local) : adaptProducerAsk(local);
          if (ask && localProducerPrice > 0) {
            const reachableBid = Math.max(localConsumerBid(api, account, resource), api.diffusedBid(account, resource));
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
  },
};

export function policies(state: PriceLogisticsState) {
  return [...createConsumerPolicies(state), producerPolicy, farmProducerPolicy, logisticsPolicy];
}

export function stepAgentSim(state: Parameters<typeof stepSimEngine>[0], profiler?: PriceStepProfiler) {
  const startedAt = profiler ? performance.now() : 0;
  const agentPolicies = policies(state);
  profiler?.record("createPolicies", performance.now() - startedAt);
  return stepSimEngine(state, agentPolicies, priceCellBehavior, profiler);
}
