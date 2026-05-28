import {
  LOGISTICS_AGENT,
  MAX_OPTIONS_PER_TURN,
  MONEY_ACCOUNT,
  MOVE_COST,
  PRODUCER_AGENT,
  accountOfCell,
  stepPriceLogistics as stepPriceLogisticsEngine,
  type PriceAgentPolicy,
  type PriceLogisticsCell,
} from "./engine";

function productValue(api: Parameters<PriceAgentPolicy["run"]>[0], cell: PriceLogisticsCell) {
  return Math.max(cell.localBid, api.diffusedBid(cell.x, cell.y));
}

export const consumerPolicies: PriceAgentPolicy[] = [];

export const consumerSwarmPolicy: PriceAgentPolicy = {
  agent: "Common",
  run(api) {
    for (const cell of api.cells()) {
      const account = accountOfCell(cell);
      const consumer = api.consumerAgentForCell(cell);
      const money = api.balanceOf(consumer, MONEY_ACCOUNT, "money");
      const effectiveBid = api.effectiveProductBid(cell);
      const bidQuantity = effectiveBid > 0 ? Math.min(cell.population, Math.floor(money / effectiveBid)) : 0;
      if (bidQuantity > 0) {
        api.placeBidAs(consumer, account, "product", effectiveBid, bidQuantity);
      }

      const labor = api.balanceOf(consumer, account, "labor");
      if (cell.laborAsk > 0 && labor > 0) {
        api.placeAskAs(consumer, account, "labor", cell.laborAsk, labor);
      }
    }
  },
};

export const producerPolicy: PriceAgentPolicy = {
  agent: PRODUCER_AGENT,
  run(api) {
    for (let option = 0; option < MAX_OPTIONS_PER_TURN; option += 1) {
      let best: { cell: PriceLogisticsCell; bid: number; value: number } | null = null;
      for (const cell of api.cells()) {
        const account = accountOfCell(cell);
        if (cell.localAsk <= 0 || cell.population <= 0 || cell.laborAsk <= 0) continue;
        if (cell.laborStock <= 0) continue;
        const bid = Math.floor(productValue(api, cell));
        const expectedCost = Math.round((bid + cell.laborAsk) / 2);
        const value = productValue(api, cell) - expectedCost;
        if (value <= 0 || bid <= 0 || api.balance(MONEY_ACCOUNT, "money") < bid) continue;
        if (!best || value > best.value) best = { cell, bid, value };
      }
      if (!best) break;
      api.placeBid(accountOfCell(best.cell), "labor", best.bid, 1);
    }

    for (const cell of api.cells()) {
      const account = accountOfCell(cell);
      const stock = api.balance(account, "product");
      if (stock > 0 && cell.localAsk > 0) {
        api.placeAsk(account, "product", cell.localAsk, stock);
      }
    }
  },
};

export const logisticsPolicy: PriceAgentPolicy = {
  agent: LOGISTICS_AGENT,
  run(api) {
    for (let option = 0; option < MAX_OPTIONS_PER_TURN; option += 1) {
      let best:
        | { kind: "move"; cell: PriceLogisticsCell; toX: number; toY: number; value: number; surplus: number }
        | { kind: "buy"; cell: PriceLogisticsCell; bid: number; value: number; surplus: number }
        | null = null;

      for (const cell of api.cells()) {
        const account = accountOfCell(cell);
        const held = api.balance(account, "product");
        if (held > 0) {
          const neighbor = api.bestMoveNeighbor(cell);
          const localBid = api.effectiveProductBid(cell);
          if (neighbor && neighbor.bid > localBid && api.balance(MONEY_ACCOUNT, "money") >= MOVE_COST) {
            const value = neighbor.bid - localBid;
            const candidate = { kind: "move" as const, cell, toX: neighbor.x, toY: neighbor.y, value, surplus: value - MOVE_COST };
            if (!best || candidate.surplus > best.surplus) best = candidate;
          }
        }

        if (cell.producerStock > 0 && cell.localAsk > 0) {
          const reachableBid = Math.max(api.effectiveProductBid(cell), api.diffusedBid(cell.x, cell.y));
          const bid = Math.floor(reachableBid);
          const value = reachableBid - cell.localAsk;
          if (value > 0 && bid > 0 && api.balance(MONEY_ACCOUNT, "money") >= bid) {
            const candidate = { kind: "buy" as const, cell, bid, value, surplus: value };
            if (!best || candidate.surplus > best.surplus) best = candidate;
          }
        }
      }

      if (!best) break;
      if (best.kind === "move") {
        if (!api.moveProduct(best.cell, best.toX, best.toY, best.value)) break;
      } else {
        api.placeBid(accountOfCell(best.cell), "product", best.bid, 1);
      }
    }

    for (const cell of api.cells()) {
      const account = accountOfCell(cell);
      const held = api.balance(account, "product");
      const bid = cell.population <= 0 || cell.localBid <= 0 ? 0 : Math.min(cell.localBid, Math.floor(cell.consumerMoney));
      if (held > 0 && bid > 0) api.placeAsk(account, "product", bid, held);
    }
  },
};

export const PRICE_LOGISTICS_POLICIES = [consumerSwarmPolicy, producerPolicy, logisticsPolicy];

export function stepPriceLogistics(state: Parameters<typeof stepPriceLogisticsEngine>[0]) {
  return stepPriceLogisticsEngine(state, PRICE_LOGISTICS_POLICIES);
}
