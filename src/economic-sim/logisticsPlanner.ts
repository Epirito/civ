import { CONSUMER_AGENTS, MONEY_ACCOUNT } from "./constants";
import { transportTotalCost } from "./engine";
import { checkedAdd, checkedMul, parseAccount } from "./ledger";
import type { Account, AgentApi, AgentPolicyContext, CellBalance, OrderResult, Trade } from "./types";

const HISTORY_LIMIT = 6;
const DISCOUNT = 0.92;
const BOOTSTRAP_ASK_PRICE = 12;
const BOOTSTRAP_FACTORY_BID_PRICE = 10;
const MAX_ORDER_PRICE = 32;
const MAX_BUY_CHUNKS_PER_SOURCE = 6;
const MAX_PLANNING_CHUNKS = 128;

type SaleTurn = {
  quantity: number;
  value: number;
  bidQuantity: number;
  bidValue: number;
  logisticsSaleQuantity: number;
  askFilled: number | null;
  askUnfilled: number | null;
  unfilledBidQuantity: number;
};

type DestinationState = CellBalance & {
  model: OptimisticLocalSaleValueModel;
  virtualInventory: number;
};

type Candidate =
  | {
      kind: "move";
      source: Account;
      destination: DestinationState;
      value: number;
      cashCost: number;
    }
  | {
      kind: "buy";
      source: Account;
      price: number;
      destination: DestinationState;
      value: number;
      cashCost: number;
    };

function sortByValueDesc<T>(items: T[], value: (item: T) => number) {
  return [...items].sort((a, b) => value(b) - value(a));
}

function accountCoord(account: Account) {
  const coord = parseAccount(account);
  if (!coord) throw new Error(`Expected physical account, got ${account || "abstract"}`);
  return coord;
}

function sameCellTrade(account: Account, trade: Trade) {
  const coord = accountCoord(account);
  return trade.x === coord.x && trade.y === coord.y;
}

function observedWidgetPrice(trades: Trade[], account: Account) {
  let quantity = 0;
  let value = 0;
  for (const trade of trades) {
    if ((trade.resource ?? "widget") !== "widget") continue;
    if (!sameCellTrade(account, trade)) continue;
    quantity += trade.quantity;
    value += trade.quantity * trade.price;
  }
  return quantity === 0 ? null : value / quantity;
}

function maxObservedMapPrice(trades: Trade[]) {
  let maxPrice: number | null = null;
  for (const trade of trades) {
    if ((trade.resource ?? "widget") !== "widget") continue;
    maxPrice = Math.max(maxPrice ?? trade.price, trade.price);
  }
  return maxPrice;
}

function lastAskResult(results: OrderResult[], account: Account) {
  return results.find((result) => result.side === "ask" && result.resource === "widget" && result.account === account);
}

function bidResults(results: OrderResult[], account: Account) {
  return results.filter((result) => result.side === "bid" && result.resource === "widget" && result.account === account);
}

function isLogisticsAgent(agent: string) {
  return agent.startsWith("Logistics-");
}

/**
 * Maintains an optimistic value model for selling logistics-owned widgets at one
 * destination cell. The model treats the destination sale as the final subgame:
 * expected price comes from recent weighted trade prices, and marginal value is
 * discounted by the virtual inventory already waiting to be sold there.
 */
export class OptimisticLocalSaleValueModel {
  private readonly history: SaleTurn[] = [];
  private averageBid: number | null = null;
  private residualDemand = 0;

  constructor(readonly account: Account) {}

  /**
   * Incorporates one public market-clearing snapshot for this cell. Bid prices,
   * filled or not, update local price. Logistics' own completed sales and all
   * unmet bids update residual demand as logistics-met bid volume plus unfilled
   * bid quantity.
   */
  observeTurn(trades: Trade[], publicOrderResults: OrderResult[], privateOrderResults: OrderResult[]) {
    const askResult = lastAskResult(privateOrderResults, this.account);
    const bids = bidResults(publicOrderResults, this.account);
    let quantity = 0;
    let value = 0;
    let logisticsSaleQuantity = 0;
    for (const trade of trades) {
      if ((trade.resource ?? "widget") !== "widget") continue;
      if (!sameCellTrade(this.account, trade)) continue;
      quantity += trade.quantity;
      value += checkedMul(trade.quantity, trade.price, "local trade value");
      if (isLogisticsAgent(trade.seller)) logisticsSaleQuantity += trade.quantity;
    }

    this.history.push({
      quantity,
      value,
      bidQuantity: bids.reduce((sum, result) => sum + result.quantity, 0),
      bidValue: bids.reduce((sum, result) => sum + checkedMul(result.quantity, result.price, "local bid value"), 0),
      logisticsSaleQuantity,
      askFilled: askResult?.filled ?? null,
      askUnfilled: askResult?.unfilled ?? null,
      unfilledBidQuantity: bids.reduce((sum, result) => sum + result.unfilled, 0),
    });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();

    const bidQuantity = this.history.reduce((sum, turn) => sum + turn.bidQuantity, 0);
    if (bidQuantity > 0) {
      const bidValue = this.history.reduce((sum, turn) => sum + turn.bidValue, 0);
      this.averageBid = bidValue / bidQuantity;
    }

    const askTurns = this.history.filter((turn) => turn.askFilled !== null && turn.askUnfilled !== null);
    const hasObservedDemand = askTurns.length > 0 || this.history.some((turn) => turn.unfilledBidQuantity > 0);
    if (hasObservedDemand) {
      const unmetBids = this.history.reduce((sum, turn) => sum + turn.unfilledBidQuantity, 0);
      const logisticsSaleVolume = this.history.reduce((sum, turn) => sum + turn.logisticsSaleQuantity, 0);
      this.residualDemand = logisticsSaleVolume + unmetBids;
    }
  }

  /**
   * Returns the best available price estimate. If this destination has no price
   * history, the model falls back to the highest public map price, then to
   * Infinity so the planner explores unknown destinations optimistically.
   */
  expectedLocalBid(globalMaxPrice: number | null) {
    return this.averageBid ?? globalMaxPrice ?? Number.POSITIVE_INFINITY;
  }

  /**
   * Converts expected sale price into a marginal present value for one more
   * widget. Existing virtual inventory lengthens the expected time-to-sale, so
   * repeated allocations to the same destination face diminishing value.
   */
  expectedSalePriceOfMarginalInventory(virtualInventory: number, globalMaxPrice: number | null) {
    if (this.residualDemand <= 0) return 0;
    const price = this.expectedLocalBid(globalMaxPrice);
    if (price === Number.POSITIVE_INFINITY) return price;
    return price * DISCOUNT ** (virtualInventory / this.residualDemand);
  }

  private modeledAskFloor(globalMaxPrice: number | null) {
    const price = this.expectedLocalBid(globalMaxPrice);
    const finitePrice = Number.isFinite(price) ? price : BOOTSTRAP_ASK_PRICE;
    return Math.max(1, Math.min(MAX_ORDER_PRICE, Math.round(finitePrice)));
  }

  /**
   * Chooses an aggressive ask price. The model price is only the floor: if
   * recent asks filled, Logistics probes upward to find how much destination
   * buyers will tolerate; complete misses walk the price back down.
   */
  askPrice(globalMaxPrice: number | null, askResult: OrderResult | undefined) {
    const floor = this.modeledAskFloor(globalMaxPrice);
    if (!askResult) return floor;
    if (askResult.filled > 0) {
      const raise = askResult.unfilled === 0 ? 2 : 1;
      return Math.min(MAX_ORDER_PRICE, Math.max(floor, checkedAdd(askResult.price, raise, "logistics ask raise")));
    }
    return Math.max(floor, askResult.price - 1);
  }
}

/**
 * Allocates logistics choices one widget at a time. Immediate actions such as
 * transport and sale orders use the real API as soon as they are selected.
 * Source purchases are delayed by market clearing, so those selected bids only
 * update virtual destination inventory for marginal-value feedback.
 */
export class LogisticsMarketPlanner {
  private readonly saleModels = new Map<Account, OptimisticLocalSaleValueModel>();

  run(api: AgentApi, { lastTrades, publicLastOrderResults }: AgentPolicyContext) {
    const destinations = this.destinationStates(api, lastTrades, publicLastOrderResults);
    if (destinations.length === 0) return;

    const virtualSourceInventory = new Map(api.cellsWith("widget").map((cell) => [cell.account, cell.amount]));
    const virtualBuySupply = new Map(
      api.observeCells("Producer", "factory").map((cell) => [
        cell.account,
        checkedMul(cell.amount, MAX_BUY_CHUNKS_PER_SOURCE, "producer source buy chunks"),
      ]),
    );

    for (let chunk = 0; chunk < MAX_PLANNING_CHUNKS; chunk += 1) {
      const candidate = this.bestCandidate(api, lastTrades, destinations, virtualSourceInventory, virtualBuySupply);
      if (!candidate || candidate.value <= candidate.cashCost) break;

      candidate.destination.virtualInventory = checkedAdd(
        candidate.destination.virtualInventory,
        1,
        "destination virtual inventory",
      );

      if (candidate.kind === "move") {
        virtualSourceInventory.set(candidate.source, (virtualSourceInventory.get(candidate.source) ?? 0) - 1);
        api.requestTransport(candidate.source, candidate.destination.account, "widget", 1);
      } else {
        virtualBuySupply.set(candidate.source, (virtualBuySupply.get(candidate.source) ?? 0) - 1);
        api.placeBid(candidate.source, "widget", candidate.price, 1);
      }
    }

    for (const destination of destinations) {
      const available = api.balance(destination.account, "widget");
      const askResult = lastAskResult(api.lastOrderResults, destination.account);
      if (available > 0) {
        api.placeAsk(
          destination.account,
          "widget",
          destination.model.askPrice(maxObservedMapPrice(lastTrades), askResult),
          available,
        );
      }
    }
  }

  /**
   * Returns the current modeled widget value by destination cell without
   * advancing rolling history. The visualization uses this as a read-only
   * snapshot of the same destination models the planner uses for allocation.
   */
  valueByCell(api: Pick<AgentApi, "balance" | "observeCells">, lastTrades: Trade[]) {
    const globalMaxPrice = maxObservedMapPrice(lastTrades);
    return new Map(
      CONSUMER_AGENTS.flatMap((agent) => api.observeCells(agent, "population")).map((cell) => {
        const model = this.modelFor(cell.account);
        const value = model.expectedSalePriceOfMarginalInventory(api.balance(cell.account, "widget"), globalMaxPrice);
        return [cell.account, value] as const;
      }),
    );
  }

  private destinationStates(api: AgentApi, lastTrades: Trade[], publicLastOrderResults: OrderResult[]) {
    const globalMaxPrice = maxObservedMapPrice(lastTrades);
    return CONSUMER_AGENTS.flatMap((agent) => api.observeCells(agent, "population")).map((cell): DestinationState => {
      const model = this.modelFor(cell.account);
      model.observeTurn(lastTrades, publicLastOrderResults, api.lastOrderResults);
      return {
        ...cell,
        model,
        virtualInventory: api.balance(cell.account, "widget"),
      };
    });
  }

  private modelFor(account: Account) {
    const model = this.saleModels.get(account) ?? new OptimisticLocalSaleValueModel(account);
    this.saleModels.set(account, model);
    return model;
  }

  private bestCandidate(
    api: AgentApi,
    lastTrades: Trade[],
    destinations: DestinationState[],
    virtualSourceInventory: Map<Account, number>,
    virtualBuySupply: Map<Account, number>,
  ) {
    const globalMaxPrice = maxObservedMapPrice(lastTrades);
    const candidates: Candidate[] = [];

    // Already-owned widgets can be transported now, then listed for sale in
    // this same policy run. If the source is also a destination market, moving
    // the widget gives up its local sale value there, so include that as
    // opportunity cost.
    for (const [source, quantity] of virtualSourceInventory) {
      if (quantity <= 0) continue;
      const sourceDestination = destinations.find((destination) => destination.account === source);
      const opportunityCost = sourceDestination
        ? sourceDestination.model.expectedSalePriceOfMarginalInventory(sourceDestination.virtualInventory, globalMaxPrice)
        : 0;
      for (const destination of destinations) {
        if (source === destination.account) continue;
        const cashCost = transportTotalCost(1, api.transportUnitCost(source, destination.account));
        if (cashCost > api.balance(MONEY_ACCOUNT, "money")) continue;
        candidates.push({
          kind: "move",
          source,
          destination,
          cashCost: cashCost + opportunityCost,
          value: destination.model.expectedSalePriceOfMarginalInventory(destination.virtualInventory, globalMaxPrice),
        });
      }
    }

    // Source buys are delayed until market clearing, but they still need to
    // clear both the bid price and the eventual transport cost to be worth
    // reserving cash for now.
    for (const [source, quantity] of virtualBuySupply) {
      if (quantity <= 0) continue;
      const sourceBidPrice = this.sourceBidPrice(lastTrades, source);
      for (const destination of destinations) {
        const transportCost = transportTotalCost(1, api.transportUnitCost(source, destination.account));
        const cashCost = checkedAdd(sourceBidPrice, transportCost, "buy and move cost");
        if (sourceBidPrice > api.balance(MONEY_ACCOUNT, "money")) continue;
        candidates.push({
          kind: "buy",
          source,
          price: sourceBidPrice,
          destination,
          cashCost,
          value: destination.model.expectedSalePriceOfMarginalInventory(destination.virtualInventory, globalMaxPrice),
        });
      }
    }

    // Choose the chunk with the largest modeled surplus. The caller applies one
    // chunk, updates virtual inventory, and asks again for diminishing returns.
    return sortByValueDesc(candidates, (candidate) => candidate.value - candidate.cashCost)[0];
  }

  private sourceBidPrice(lastTrades: Trade[], source: Account) {
    const observedPrice = observedWidgetPrice(lastTrades, source) ?? BOOTSTRAP_FACTORY_BID_PRICE;
    return Math.max(1, Math.min(MAX_ORDER_PRICE, Math.round(observedPrice)));
  }
}

export function createLogisticsMarketPlanner() {
  return new LogisticsMarketPlanner();
}
