import { TILE_STUDY_COLUMNS, TILE_STUDY_ROWS, regionBlocks } from "../logistics-at-a-distance/tileStudyData";
import { createPriceFieldState } from "./priceFieldAutomaton";
import {
  FARM_PRODUCER_AGENT,
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

function worldLandSet() {
  return new Set(regionBlocks().map((block) => `${block.x},${block.y}`));
}

function regionalPopulation(x: number, y: number) {
  if (x >= 28 && x <= 36 && y >= 7 && y <= 20) return 2 + ((x + y) % 4);
  if (x >= 40 && x <= 53 && y >= 10 && y <= 18) return 4 + ((x * 3 + y) % 8);
  if (x >= 7 && x <= 18 && y >= 9 && y <= 25) return 1 + ((x + y * 2) % 4);
  if (x >= 33 && x <= 56 && y >= 3 && y <= 10) return 1 + ((x + y) % 3);
  if (x >= 29 && x <= 40 && y >= 14 && y <= 25) return 2 + ((x * 2 + y) % 5);
  if (x >= 52 && x <= 60 && y >= 21 && y <= 27) return 1;
  return 1 + ((x + y) % 2);
}

function farmAmount(x: number, y: number) {
  if (x >= 28 && x <= 36 && y >= 8 && y <= 18) return 3;
  if (x >= 41 && x <= 50 && y >= 11 && y <= 18) return 4;
  if (x >= 8 && x <= 18 && y >= 10 && y <= 17) return 4;
  if (x >= 12 && x <= 18 && y >= 14 && y <= 25) return 3;
  if (x >= 29 && x <= 40 && y >= 14 && y <= 20) return 2;
  if (x >= 52 && x <= 60 && y >= 21 && y <= 27) return 2;
  return (x + y) % 5 === 0 ? 1 : 0;
}

function factoryAmount(x: number, y: number) {
  if (x >= 28 && x <= 36 && y >= 7 && y <= 13) return 2;
  if (x >= 41 && x <= 53 && y >= 10 && y <= 16) return 2;
  if (x >= 7 && x <= 18 && y >= 9 && y <= 13) return 2;
  if (x >= 38 && x <= 55 && y >= 4 && y <= 10) return 1;
  return (x * 3 + y) % 17 === 0 ? 1 : 0;
}

export function createPriceLogisticsState(width = TILE_STUDY_COLUMNS, height = TILE_STUDY_ROWS): PriceLogisticsState {
  const ledger: PriceLedger = {};
  const useWorld = width === TILE_STUDY_COLUMNS && height === TILE_STUDY_ROWS;
  const landSet = worldLandSet();
  const cells: PriceLogisticsCell[] = Array.from({ length: height }, (_row, y) =>
    Array.from({ length: width }, (_column, x): PriceLogisticsCell => {
      const land = useWorld ? landSet.has(`${x},${y}`) : true;
      const factory = land ? factoryAmount(x, y) : 0;
      const farm = land ? farmAmount(x, y) : 0;
      const population = land ? regionalPopulation(x, y) : 0;
      const cell = {
        x,
        y,
        land,
        localBid: population > 0 ? 8 + Math.min(18, population * 2 + ((x + y) % 5)) : 0,
        foodBid: population > 0 ? 14 + Math.min(18, population * 2 + ((x * 2 + y) % 5)) : 0,
        consumerMoney: 0,
        population,
        malnutritionBurden: 0,
        foodConsumed: 0,
        laborBid: factory || farm ? 8 + ((x + y) % 5) : 0,
        laborAsk: population > 0 ? 3 + ((x + y * 2) % 6) : 0,
        laborStock: 0,
        fieldBid: 0,
        bidVolume: 0,
        foodFieldBid: 0,
        foodBidVolume: 0,
        localAsk: factory ? 4 + ((x * 2 + y) % 7) : 0,
        foodAsk: farm ? 5 + ((x + y * 3) % 6) : 0,
        producerStock: 0,
        producerFoodStock: 0,
        farmProducerFoodStock: 0,
        farmStock: farm,
        logisticsStock: 0,
        logisticsFoodStock: 0,
        movedStock: 0,
        lastBidFilled: 0,
        lastBidUnfilled: 0,
        lastFoodBidFilled: 0,
        lastFoodBidUnfilled: population,
        lastLaborBidFilled: 0,
        lastLaborBidUnfilled: factory || farm ? 1 : 0,
        lastLaborFilled: 0,
        lastLaborUnfilled: population,
        lastAskFilled: 0,
        lastAskUnfilled: factory ? 1 : 0,
        lastFoodAskFilled: 0,
        lastFoodAskUnfilled: farm ? 1 : 0,
      };
      if (population > 0) {
        addLedgerBalance(ledger, `Consumer-${x},${y}`, accountOfCell(cell), "labor", population);
        addLedgerBalance(ledger, `Consumer-${x},${y}`, MONEY_ACCOUNT, "money", population * (30 + ((x + y) % 20)));
      }
      if (factory) addLedgerBalance(ledger, PRODUCER_AGENT, accountOfCell(cell), "factory", factory);
      if (farm) addLedgerBalance(ledger, FARM_PRODUCER_AGENT, accountOfCell(cell), "farm", farm);
      if (land && (x + y) % 17 === 0) addLedgerBalance(ledger, LOGISTICS_AGENT, accountOfCell(cell), "product", 2);
      if (land && farm > 0 && (x + y) % 3 === 0) addLedgerBalance(ledger, FARM_PRODUCER_AGENT, accountOfCell(cell), "food", farm);
      return cell;
    }),
  ).flat();

  addLedgerBalance(ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money", 180);
  addLedgerBalance(ledger, PRODUCER_AGENT, MONEY_ACCOUNT, "money", 420);
  addLedgerBalance(ledger, FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money", 420);

  const state: PriceLogisticsState = {
    width,
    height,
    turn: 0,
    nextOrderId: 1,
    ledger,
    orders: [],
    lastOrderResults: [],
    trades: [],
    recipes: [
      {
        id: "factory-product",
        inputs: { labor: 1 },
        requirements: { factory: 1 },
        outputs: { product: 1 },
      },
      {
        id: "factory-farming",
        inputs: { labor: 1, product: 1 },
        requirements: { farm: 2 },
        outputs: { food: 3 },
      },
      {
        id: "subsistence-food",
        inputs: { labor: 1 },
        requirements: { farm: 1 },
        outputs: { food: 1 },
      },
    ],
    logisticsResources: ["product", "food"],
    money: 180,
    producerMoney: 420,
    farmProducerMoney: 420,
    cells,
    bidField: createPriceFieldState(width, height),
    bidFields: {
      product: createPriceFieldState(width, height),
      food: createPriceFieldState(width, height),
    },
    events: [],
  };
  refreshCellBalances(state);
  return state;
}
