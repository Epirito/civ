import {
  LOGISTICS_AGENT,
  MAX_OPTIONS_PER_TURN,
  MAX_PRICE,
  MIN_PRICE,
  MONEY_ACCOUNT,
  MOVE_COST,
  PRODUCER_AGENT,
  accountOfCell,
  consumerAgentForCell,
  stepPriceLogistics as stepPriceLogisticsEngine,
  type PriceAgentApi,
  type PriceAgentPolicy,
  type PriceCellBehavior,
  type PriceLogisticsCell,
  type PriceLogisticsState,
  type PriceMarketResource,
  type PriceRecipe,
  type PriceResource,
} from "./engine";
import type { PriceFieldSource } from "../priceFieldAutomaton";
import type { Account } from "../types";

const LOGISTICS_DEMAND_ALPHA = 0.35;
const LOGISTICS_DEMAND_DECAY = 0.9;

export function effectiveProductBidForBalance(cell: PriceLogisticsCell, consumerMoney: number) {
  if (cell.population <= 0 || cell.localBid <= 0) return 0;
  return Math.min(cell.localBid, Math.floor(consumerMoney));
}

export function effectiveProductBid(cell: PriceLogisticsCell) {
  return effectiveProductBidForBalance(cell, cell.consumerMoney);
}

function productDemand(cell: PriceLogisticsCell, consumerMoney: number) {
  const price = effectiveProductBidForBalance(cell, consumerMoney);
  return {
    price,
    quantity: price > 0 ? Math.min(cell.population, Math.floor(consumerMoney / price)) : 0,
  };
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

function adaptLaborBid(cell: PriceLogisticsCell) {
  if (cell.localAsk <= 0) return 0;
  const current = cell.laborBid > 0 ? cell.laborBid : Math.max(MIN_PRICE, cell.laborAsk);
  if (cell.lastLaborBidUnfilled > 0) return Math.min(MAX_PRICE, current + 2);
  if (cell.lastLaborBidFilled > 0) return Math.max(MIN_PRICE, current - (cell.lastLaborBidUnfilled === 0 ? 2 : 1));
  return current;
}

function adaptProducerAsk(cell: PriceLogisticsCell) {
  if (cell.localAsk <= 0) return 0;
  if (cell.lastAskFilled === 0 && cell.lastAskUnfilled > 0) return Math.max(MIN_PRICE, cell.localAsk - 1);
  if (cell.lastAskFilled > 0) return Math.min(MAX_PRICE, cell.localAsk + (cell.lastAskUnfilled === 0 ? 2 : 1));
  return cell.localAsk;
}

function logisticResidualDemandSources(state: PriceLogisticsState): PriceFieldSource[] {
  return state.cells
    .filter((cell) => cell.fieldBid > 0 && cell.bidVolume > 0)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      price: cell.fieldBid,
      volume: cell.bidVolume,
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

function updateLogisticsResidualDemand(state: PriceLogisticsState) {
  const observations = new Map<Account, { quantity: number; value: number }>();
  const cellsByAccount = new Map(state.cells.map((cell) => [accountOfCell(cell), cell]));

  for (const result of state.lastOrderResults) {
    const local = cellsByAccount.get(result.account);
    if (
      local &&
      result.resource === "product" &&
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
      trade.resource === "product" &&
      trade.buyer === consumerAgentForCell(local) &&
      trade.seller === LOGISTICS_AGENT
    ) {
      addResidualDemand(observations, trade.account, trade.price, trade.quantity);
    }
  }

  for (const cell of state.cells) {
    const account = accountOfCell(cell);
    const observation = observations.get(account);
    if (!observation) {
      cell.bidVolume *= LOGISTICS_DEMAND_DECAY;
      if (cell.bidVolume < 0.01) {
        cell.bidVolume = 0;
        cell.fieldBid = 0;
      }
      continue;
    }

    const observedPrice = observation.value / observation.quantity;
    cell.bidVolume = cell.bidVolume * (1 - LOGISTICS_DEMAND_ALPHA) + observation.quantity * LOGISTICS_DEMAND_ALPHA;
    cell.fieldBid = cell.fieldBid <= 0
      ? observedPrice
      : cell.fieldBid * (1 - LOGISTICS_DEMAND_ALPHA) + observedPrice * LOGISTICS_DEMAND_ALPHA;
  }
}

export const priceCellBehavior: PriceCellBehavior = {
  fieldSources: logisticResidualDemandSources,
  afterMarket: updateLogisticsResidualDemand,
  adaptCell: (cell) => ({
    localBid: adaptConsumerBid(cell),
    laborBid: adaptLaborBid(cell),
    laborAsk: adaptLaborAsk(cell),
    localAsk: adaptProducerAsk(cell),
  }),
};

function localConsumerBid(api: PriceAgentApi, account: Account) {
  const local = api.local(account);
  const consumer = api.consumerAgentForAccount(account);
  if (!local || !consumer) return 0;
  return effectiveProductBidForBalance(local, api.balanceOf(consumer, MONEY_ACCOUNT, "money"));
}

function productValue(api: PriceAgentApi, account: Account, local: PriceLogisticsCell) {
  return Math.max(local.localBid, api.diffusedBid(account));
}

function outputValue(api: PriceAgentApi, account: Account, local: PriceLogisticsCell, recipe: PriceRecipe) {
  let value = 0;
  for (const [resource, amount] of Object.entries(recipe.outputs) as Array<[PriceResource, number]>) {
    if (resource === "product") value += productValue(api, account, local) * amount;
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
    if (resource === "product" || resource === "labor") return resource;
  }
  return null;
}

function inputBidLimit(local: PriceLogisticsCell, resource: PriceMarketResource, recipeValue: number) {
  if (resource === "labor") return Math.min(Math.floor(recipeValue), local.laborBid);
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
          const { price: effectiveBid, quantity: bidQuantity } = productDemand(local, money);
          if (bidQuantity > 0) api.placeBid(account, "product", effectiveBid, bidQuantity);

          const labor = api.balance(account, "labor");
          if (local.laborAsk > 0 && labor > 0) api.placeAsk(account, "labor", local.laborAsk, labor);
        },
      };
    });
}

export const producerPolicy: PriceAgentPolicy = {
  agent: PRODUCER_AGENT,
  run(api) {
    for (let option = 0; option < MAX_OPTIONS_PER_TURN; option += 1) {
      let best: { account: Account; resource: PriceMarketResource; bid: number; value: number } | null = null;
      for (const account of api.accounts()) {
        const local = api.local(account);
        if (!local) continue;
        for (const recipe of api.recipes()) {
          if (!hasRequirements(api, account, recipe)) continue;
          const input = missingMarketInput(api, account, recipe);
          const ask = input ? api.bestAsk(account, input) : null;
          if (!input || !ask) continue;

          const recipeValue = outputValue(api, account, local, recipe);
          const bid = inputBidLimit(local, input, recipeValue);
          const expectedCost = Math.round((bid + ask.price) / 2);
          const value = recipeValue - expectedCost;
          if (value <= 0 || bid <= 0 || api.balance(MONEY_ACCOUNT, "money") < bid) continue;
          if (!best || value > best.value) best = { account, resource: input, bid, value };
        }
      }
      if (!best) break;
      api.placeBid(best.account, best.resource, best.bid, 1);
    }

    for (const account of api.accounts()) {
      const local = api.local(account);
      const stock = api.balance(account, "product");
      if (local && stock > 0 && local.localAsk > 0) api.placeAsk(account, "product", local.localAsk, stock);
    }
  },
};

export const logisticsPolicy: PriceAgentPolicy = {
  agent: LOGISTICS_AGENT,
  run(api) {
    for (let option = 0; option < MAX_OPTIONS_PER_TURN; option += 1) {
      let best:
        | { kind: "move"; account: Account; to: Account; value: number; surplus: number }
        | { kind: "buy"; account: Account; bid: number; value: number; surplus: number }
        | null = null;

      for (const account of api.accounts()) {
        const local = api.local(account);
        if (!local) continue;

        const held = api.balance(account, "product");
        if (held > 0) {
          const neighbor = api.bestMoveNeighbor(account);
          const localBid = Math.max(localConsumerBid(api, account), api.bestBid(account, "product")?.price ?? 0);
          if (neighbor && neighbor.bid > localBid && api.balance(MONEY_ACCOUNT, "money") >= MOVE_COST) {
            const value = neighbor.bid - localBid;
            const candidate = { kind: "move" as const, account, to: neighbor.account, value, surplus: value - MOVE_COST };
            if (!best || candidate.surplus > best.surplus) best = candidate;
          }
        }

        const productAsk = api.bestAsk(account, "product");
        if (productAsk && local.localAsk > 0) {
          const reachableBid = Math.max(localConsumerBid(api, account), api.diffusedBid(account));
          const bid = Math.floor(reachableBid);
          const value = reachableBid - productAsk.price;
          if (value > 0 && bid > 0 && api.balance(MONEY_ACCOUNT, "money") >= bid) {
            const candidate = { kind: "buy" as const, account, bid, value, surplus: value };
            if (!best || candidate.surplus > best.surplus) best = candidate;
          }
        }
      }

      if (!best) break;
      if (best.kind === "move") {
        if (!api.moveProduct(best.account, best.to, best.value)) break;
      } else {
        api.placeBid(best.account, "product", best.bid, 1);
      }
    }

    for (const account of api.accounts()) {
      const local = api.local(account);
      const held = api.balance(account, "product");
      const bid = Math.max(localConsumerBid(api, account), api.bestBid(account, "product")?.price ?? 0);
      if (local && held > 0 && bid > 0) api.placeAsk(account, "product", bid, held);
    }
  },
};

export function priceLogisticsPolicies(state: PriceLogisticsState) {
  return [...createConsumerPolicies(state), producerPolicy, logisticsPolicy];
}

export function stepPriceLogistics(state: Parameters<typeof stepPriceLogisticsEngine>[0]) {
  return stepPriceLogisticsEngine(state, priceLogisticsPolicies(state), priceCellBehavior);
}
