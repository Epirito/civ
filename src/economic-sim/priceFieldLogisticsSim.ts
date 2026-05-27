import {
  createPriceFieldState,
  fieldCell,
  fieldNeighbors,
  stepPriceField,
  type PriceFieldSource,
  type PriceFieldState,
} from "./priceFieldAutomaton";
import { clearMarket, placeOrder } from "./engine";
import { MONEY_ACCOUNT } from "./constants";
import { accountOf, addBalance, getBalance, makeLedger } from "./ledger";
import type { Account, Agent, Order, OrderResult, Trade } from "./types";

export type PriceLogisticsCell = {
  x: number;
  y: number;
  localBid: number;
  consumerMoney: number;
  // Unfilled local consumer bid volume. This is the source volume for the
  // propagated bid field, so satisfied demand stops pulling product.
  bidVolume: number;
  localAsk: number;
  producerStock: number;
  logisticsStock: number;
  movedStock: number;
  lastBidFilled: number;
  lastBidUnfilled: number;
  lastAskFilled: number;
  lastAskUnfilled: number;
};

export type PriceLogisticsEvent =
  | { kind: "buy"; x: number; y: number; price: number }
  | { kind: "move"; fromX: number; fromY: number; toX: number; toY: number; value: number }
  | { kind: "sell"; x: number; y: number; quantity: number; price: number };

export type PriceLogisticsState = {
  width: number;
  height: number;
  turn: number;
  money: number;
  producerMoney: number;
  cells: PriceLogisticsCell[];
  bidField: PriceFieldState;
  events: PriceLogisticsEvent[];
};

const MOVE_COST = 1;
const MAX_OPTIONS_PER_TURN = 120;
const MIN_PRICE = 1;
const MAX_PRICE = 32;
const LOGISTICS_AGENT: Agent = "Logistics-0";
const PRODUCER_AGENT: Agent = "Producer";

function index(width: number, x: number, y: number) {
  return y * width + x;
}

export function logisticsCell(state: PriceLogisticsState, x: number, y: number) {
  return state.cells[index(state.width, x, y)];
}

function bidSources(cells: PriceLogisticsCell[]): PriceFieldSource[] {
  return cells
    .filter((cell) => cell.localBid > 0 && cell.bidVolume > 0)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      price: cell.localBid,
      volume: cell.bidVolume,
      active: true,
    }));
}

function stepBidField(field: PriceFieldState, cells: PriceLogisticsCell[]) {
  return stepPriceField(field, bidSources(cells), {
    priceDecay: 0.9,
    volumeDecay: 0.96,
    closePriceRatio: 0.9,
    minimumVolume: 0.0005,
  });
}

function diffusedBid(state: PriceLogisticsState, x: number, y: number) {
  return fieldCell(state.bidField, x, y).price;
}

function bestMoveNeighbor(state: PriceLogisticsState, cell: PriceLogisticsCell) {
  let best: { x: number; y: number; bid: number } | null = null;
  for (const neighbor of fieldNeighbors(state, cell)) {
    const bid = diffusedBid(state, neighbor.x, neighbor.y);
    if (!best || bid > best.bid) best = { x: neighbor.x, y: neighbor.y, bid };
  }
  return best;
}

export function createPriceLogisticsState(width = 18, height = 12): PriceLogisticsState {
  const cells: PriceLogisticsCell[] = Array.from({ length: height }, (_row, y) =>
    Array.from({ length: width }, (_column, x): PriceLogisticsCell => {
      const demand = (x + y * 2) % 9 === 0 || (x === 14 && y === 8);
      const factory = (x * 3 + y) % 11 === 0 || (x === 3 && y === 3);
      return {
        x,
        y,
        localBid: demand ? 9 + ((x * 5 + y * 3) % 15) : 0,
        consumerMoney: demand ? (1 + ((x + y) % 4)) * (9 + ((x * 5 + y * 3) % 15)) : 0,
        bidVolume: demand ? 1 + ((x + y) % 4) : 0,
        localAsk: factory ? 4 + ((x * 2 + y) % 7) : 0,
        producerStock: factory ? 6 + ((x + y * 2) % 6) : 0,
        logisticsStock: (x + y) % 17 === 0 ? 2 : 0,
        movedStock: 0,
        lastBidFilled: 0,
        lastBidUnfilled: demand ? 1 : 0,
        lastAskFilled: 0,
        lastAskUnfilled: factory ? 1 : 0,
      };
    }),
  ).flat();

  return {
    width,
    height,
    turn: 0,
    money: 180,
    producerMoney: 0,
    cells,
    bidField: createPriceFieldState(width, height),
    events: [],
  };
}

type Candidate =
  | {
      kind: "move";
      cell: PriceLogisticsCell;
      toX: number;
      toY: number;
      value: number;
      reserve: number;
    }
  | {
      kind: "buy";
      cell: PriceLogisticsCell;
      value: number;
      bidPrice: number;
      reserve: number;
    };

type PriceLogisticsAuctionResult = {
  trades: Trade[];
  orderResults: OrderResult[];
  buyerMoney: number;
  buyerWidget: number;
  sellerMoney: number;
  sellerWidget: number;
};

function bestCandidate(state: PriceLogisticsState): Candidate | null {
  let best: Candidate | null = null;
  const consider = (candidate: Candidate) => {
    if (candidate.kind === "move" ? candidate.value <= candidate.reserve : candidate.value <= 0) return;
    if (candidate.reserve > state.money) return;
    if (!best || candidate.value - candidate.reserve > best.value - best.reserve) best = candidate;
  };

  for (const cell of state.cells) {
    if (cell.logisticsStock > 0) {
      const neighbor = bestMoveNeighbor(state, cell);
      if (neighbor && neighbor.bid > cell.localBid) {
        consider({
          kind: "move",
          cell,
          toX: neighbor.x,
          toY: neighbor.y,
          value: neighbor.bid - cell.localBid,
          reserve: MOVE_COST,
        });
      }
    }

    if (cell.producerStock > 0 && cell.localAsk > 0) {
      const reachableBid = Math.max(cell.localBid, diffusedBid(state, cell.x, cell.y));
      const bidPrice = Math.max(0, Math.floor(reachableBid));
      consider({
        kind: "buy",
        cell,
        value: reachableBid - cell.localAsk,
        bidPrice,
        reserve: bidPrice,
      });
    }
  }

  return best;
}

function consumerAgentForCell(cell: PriceLogisticsCell): Agent {
  return `Consumer-${cell.x},${cell.y}`;
}

export function runAuction({
  account,
  buyer,
  seller,
  bidPrice,
  askPrice,
  quantity,
  buyerMoney,
  sellerWidget,
}: {
  account: Account;
  buyer: Agent;
  seller: Agent;
  bidPrice: number;
  askPrice: number;
  quantity: number;
  buyerMoney: number;
  sellerWidget: number;
}): PriceLogisticsAuctionResult {
  const affordableQuantity = bidPrice <= 0 ? quantity : Math.floor(buyerMoney / bidPrice);
  const orderQuantity = Math.min(quantity, sellerWidget, affordableQuantity);
  if (orderQuantity <= 0) {
    return {
      trades: [],
      orderResults: [],
      buyerMoney,
      buyerWidget: 0,
      sellerMoney: 0,
      sellerWidget,
    };
  }

  const ledger = makeLedger();
  const orders: Order[] = [];
  let nextOrderId = 1;
  addBalance(ledger, buyer, MONEY_ACCOUNT, "money", buyerMoney);
  addBalance(ledger, seller, account, "widget", sellerWidget);
  nextOrderId = placeOrder(ledger, orders, nextOrderId, {
    agent: seller,
    account,
    resource: "widget",
    side: "ask",
    price: askPrice,
    quantity: orderQuantity,
  });
  placeOrder(ledger, orders, nextOrderId, {
    agent: buyer,
    account,
    resource: "widget",
    side: "bid",
    price: bidPrice,
    quantity: orderQuantity,
  });
  const { trades, orderResults } = clearMarket(ledger, orders);
  return {
    trades,
    orderResults,
    buyerMoney: getBalance(ledger, buyer, MONEY_ACCOUNT, "money"),
    buyerWidget: getBalance(ledger, buyer, account, "widget"),
    sellerMoney: getBalance(ledger, seller, MONEY_ACCOUNT, "money"),
    sellerWidget: getBalance(ledger, seller, account, "widget"),
  };
}

function sellLocalDemand(state: PriceLogisticsState, events: PriceLogisticsEvent[]) {
  for (const cell of state.cells) {
    cell.lastBidFilled = 0;
    if (cell.localBid <= 0 || cell.bidVolume <= 0 || cell.logisticsStock <= 0) continue;
    const quantity = Math.min(cell.logisticsStock, cell.bidVolume);
    const result = runAuction({
      account: accountOf(cell.x, cell.y),
      buyer: consumerAgentForCell(cell),
      seller: LOGISTICS_AGENT,
      bidPrice: cell.localBid,
      askPrice: cell.localBid,
      quantity,
      buyerMoney: cell.consumerMoney,
      sellerWidget: cell.logisticsStock,
    });
    const sold = result.trades.reduce((sum: number, trade: Trade) => sum + trade.quantity, 0);
    if (sold <= 0) continue;
    cell.logisticsStock = result.sellerWidget;
    cell.bidVolume -= sold;
    cell.lastBidFilled = sold;
    cell.consumerMoney = result.buyerMoney;
    state.money += result.sellerMoney;
    events.push({ kind: "sell", x: cell.x, y: cell.y, quantity: sold, price: cell.localBid });
  }
  for (const cell of state.cells) {
    cell.lastBidUnfilled = cell.localBid > 0 ? cell.bidVolume : 0;
  }
}

function adaptConsumerBid(cell: PriceLogisticsCell) {
  if (cell.localBid <= 0) return 0;
  if (cell.lastBidUnfilled > 0) return Math.min(MAX_PRICE, cell.localBid + 2);
  if (cell.lastBidFilled > 0) return Math.max(MIN_PRICE, cell.localBid - 2);
  return cell.localBid;
}

function adaptProducerAsk(cell: PriceLogisticsCell) {
  if (cell.localAsk <= 0) return 0;
  if (cell.lastAskFilled === 0 && cell.lastAskUnfilled > 0) return Math.max(MIN_PRICE, cell.localAsk - 1);
  if (cell.lastAskFilled > 0) return Math.min(MAX_PRICE, cell.localAsk + (cell.lastAskUnfilled === 0 ? 2 : 1));
  return cell.localAsk;
}

export function stepPriceLogistics(state: PriceLogisticsState): PriceLogisticsState {
  const cells = state.cells.map((cell) => ({
    ...cell,
    localBid: adaptConsumerBid(cell),
    localAsk: adaptProducerAsk(cell),
    consumerMoney: cell.consumerMoney + (cell.localBid > 0 ? cell.localBid : 0),
    logisticsStock: cell.logisticsStock + cell.movedStock,
    movedStock: 0,
    bidVolume: Math.min(8, cell.bidVolume + (cell.localBid > 0 ? 1 : 0)),
    producerStock: Math.min(18, cell.producerStock + (cell.localAsk > 0 ? 1 : 0)),
    lastBidFilled: 0,
    lastBidUnfilled: 0,
    lastAskFilled: 0,
    lastAskUnfilled: 0,
  }));
  const next: PriceLogisticsState = {
    ...state,
    turn: state.turn + 1,
    cells,
    bidField: stepBidField(state.bidField, cells),
    events: [],
  };

  for (let option = 0; option < MAX_OPTIONS_PER_TURN; option += 1) {
    const candidate = bestCandidate(next);
    if (!candidate) break;

    if (candidate.kind === "move") {
      candidate.cell.logisticsStock -= 1;
      logisticsCell(next, candidate.toX, candidate.toY).movedStock += 1;
      next.money -= candidate.reserve;
      next.events.push({
        kind: "move",
        fromX: candidate.cell.x,
        fromY: candidate.cell.y,
        toX: candidate.toX,
        toY: candidate.toY,
        value: candidate.value,
      });
    } else {
      const result = runAuction({
        account: accountOf(candidate.cell.x, candidate.cell.y),
        buyer: LOGISTICS_AGENT,
        seller: PRODUCER_AGENT,
        bidPrice: candidate.bidPrice,
        askPrice: candidate.cell.localAsk,
        quantity: 1,
        buyerMoney: next.money,
        sellerWidget: candidate.cell.producerStock,
      });
      if (result.buyerWidget <= 0) break;
      candidate.cell.producerStock = result.sellerWidget;
      candidate.cell.logisticsStock += result.buyerWidget;
      candidate.cell.lastAskFilled += result.buyerWidget;
      next.money = result.buyerMoney;
      next.producerMoney += result.sellerMoney;
      next.events.push({ kind: "buy", x: candidate.cell.x, y: candidate.cell.y, price: result.trades[0]?.price ?? 0 });
    }
  }

  sellLocalDemand(next, next.events);
  for (const cell of next.cells) {
    cell.lastAskUnfilled = cell.localAsk > 0 ? cell.producerStock : 0;
  }
  return next;
}
