import { createPriceFieldState } from "../priceFieldAutomaton";
import {
  LOGISTICS_AGENT,
  MONEY_ACCOUNT,
  PRODUCER_AGENT,
  accountOfCell,
  addLedgerBalance,
  refreshCellBalances,
  type PriceLedger,
  type PriceLogisticsCell,
  type PriceLogisticsState,
} from "./engine";

export function createPriceLogisticsState(width = 18, height = 12): PriceLogisticsState {
  const ledger: PriceLedger = {};
  const cells: PriceLogisticsCell[] = Array.from({ length: height }, (_row, y) =>
    Array.from({ length: width }, (_column, x): PriceLogisticsCell => {
      const factory = (x * 3 + y) % 11 === 0 || (x === 3 && y === 3);
      const population = (x + y) % 3 === 0 ? 1 + ((x * 2 + y) % 4) : 0;
      const cell = {
        x,
        y,
        localBid: population > 0 ? 9 + ((x * 5 + y * 3) % 15) : 0,
        consumerMoney: 0,
        population,
        laborAsk: population > 0 ? 3 + ((x + y * 2) % 6) : 0,
        laborStock: 0,
        bidVolume: 0,
        localAsk: factory ? 4 + ((x * 2 + y) % 7) : 0,
        producerStock: 0,
        logisticsStock: 0,
        movedStock: 0,
        lastBidFilled: 0,
        lastBidUnfilled: 0,
        lastLaborFilled: 0,
        lastLaborUnfilled: population,
        lastAskFilled: 0,
        lastAskUnfilled: factory ? 1 : 0,
      };
      if (population > 0) addLedgerBalance(ledger, `Consumer-${x},${y}`, accountOfCell(cell), "labor", population);
      if ((x + y) % 17 === 0) addLedgerBalance(ledger, LOGISTICS_AGENT, accountOfCell(cell), "product", 2);
      return cell;
    }),
  ).flat();

  addLedgerBalance(ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money", 180);
  addLedgerBalance(ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money", 120);

  const state: PriceLogisticsState = {
    width,
    height,
    turn: 0,
    nextOrderId: 1,
    ledger,
    orders: [],
    lastOrderResults: [],
    trades: [],
    money: 180,
    producerMoney: 120,
    cells,
    bidField: createPriceFieldState(width, height),
    events: [],
  };
  refreshCellBalances(state);
  return state;
}
