import {
  FARM_PRODUCER_AGENT,
  LOGISTICS_AGENT,
  MONEY_ACCOUNT,
  PRODUCER_AGENT,
  accountOfCell,
  consumerAgentForCell,
  getLedgerBalance,
  movedAccountOfCell,
  type Cell,
  type PriceResource,
  type State,
} from "./engine";

export type PriceCellLedgerData = {
  consumerMoney: number;
  consumerLabor: number;
  producerProduct: number;
  producerFood: number;
  farmFood: number;
  farm: number;
  logisticsProduct: number;
  logisticsFood: number;
  movedProduct: number;
  movedFood: number;
};

export type PriceStateLedgerData = {
  logisticsMoney: number;
  producerMoney: number;
  farmProducerMoney: number;
};

export function cellLedgerData(state: State, cell: Cell): PriceCellLedgerData {
  const account = accountOfCell(cell);
  const consumer = consumerAgentForCell(cell);
  return {
    consumerMoney: getLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money"),
    consumerLabor: getLedgerBalance(state.ledger, consumer, account, "labor"),
    producerProduct: getLedgerBalance(state.ledger, PRODUCER_AGENT, account, "product"),
    producerFood: getLedgerBalance(state.ledger, PRODUCER_AGENT, account, "food"),
    farmFood: getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "food"),
    farm: getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, "farm"),
    logisticsProduct: getLedgerBalance(state.ledger, LOGISTICS_AGENT, account, "product"),
    logisticsFood: getLedgerBalance(state.ledger, LOGISTICS_AGENT, account, "food"),
    movedProduct: getLedgerBalance(state.ledger, LOGISTICS_AGENT, movedAccountOfCell(cell), "product"),
    movedFood: getLedgerBalance(state.ledger, LOGISTICS_AGENT, movedAccountOfCell(cell), "food"),
  };
}

export function stateLedgerData(state: State): PriceStateLedgerData {
  return {
    logisticsMoney: getLedgerBalance(state.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money"),
    producerMoney: getLedgerBalance(state.ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money"),
    farmProducerMoney: getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money"),
  };
}

export function cellResourceTotal(state: State, cell: Cell, resource: PriceResource) {
  const account = accountOfCell(cell);
  const movedAccount = movedAccountOfCell(cell);
  const consumer = consumerAgentForCell(cell);
  if (resource === "money") return getLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money");
  return (
    getLedgerBalance(state.ledger, consumer, account, resource) +
    getLedgerBalance(state.ledger, PRODUCER_AGENT, account, resource) +
    getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, resource) +
    getLedgerBalance(state.ledger, LOGISTICS_AGENT, account, resource) +
    getLedgerBalance(state.ledger, LOGISTICS_AGENT, movedAccount, resource)
  );
}
