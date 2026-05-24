import { CONSUMER_AGENTS, ELECTRICITY_LOGISTICS_AGENT, LOGISTICS_AGENTS, MONEY_ACCOUNT } from "./constants";
import {
  OptimisticLocalSaleValueModel,
  createElectricityLogisticsPlanner,
  createLogisticsMarketPlanner,
} from "./logisticsPlanner";
import type {
  Account,
  AgentPolicy,
  ConsumerAgent,
  ElectricityLogisticsAgent,
  LogisticsAgent,
  OrderResult,
  Trade,
} from "./types";

const PRODUCER_BOOTSTRAP_WIDGET_ASK = 8;
const PRODUCER_MIN_WIDGET_ASK = 1;
const PRODUCER_MAX_WIDGET_ASK = 32;
const WIDGETS_PER_ELECTRICITY = 5;
const PRODUCER_ELECTRICITY_BID_CEILING = 32;

function consumerPolicy(agent: ConsumerAgent): AgentPolicy {
  return {
    agent,
    run(api) {
      for (const population of api.cellsWith("population")) {
        const widgetBudget = Math.floor(api.balance(MONEY_ACCOUNT, "money") * 0.65);
        const lastWidgetBid = api.lastOrderResults.find(
          (result) => result.side === "bid" && result.resource === "widget" && result.account === population.account,
        );
        const widgetPrice = lastWidgetBid ? 
          (lastWidgetBid.unfilled > 0 ? 
            lastWidgetBid.price + 2 
          : Math.max(lastWidgetBid.price - 2, 1))
        : 14;
        const widgetQuantity = Math.min(population.amount, Math.floor(widgetBudget / widgetPrice));
        api.placeBid(population.account, "widget", widgetPrice, widgetQuantity);

        const lastElectricityBid = api.lastOrderResults.find(
          (result) =>
            result.side === "bid" && result.resource === "electricity" && result.account === population.account,
        );
        const electricityPrice = lastElectricityBid
          ? lastElectricityBid.unfilled > 0
            ? lastElectricityBid.price + 1
            : Math.max(lastElectricityBid.price - 1, 1)
          : 5;
        const electricityQuantity = Math.min(
          population.amount,
          Math.floor(api.balance(MONEY_ACCOUNT, "money") / electricityPrice),
        );
        api.placeBid(population.account, "electricity", electricityPrice, electricityQuantity);
      }
    },
  };
}

const logisticsPlanners = new Map<LogisticsAgent, ReturnType<typeof createLogisticsMarketPlanner>>();
const electricityLogisticsPlanners = new Map<
  ElectricityLogisticsAgent,
  ReturnType<typeof createElectricityLogisticsPlanner>
>();
const producerFactoryWidgetModels = new Map<Account, OptimisticLocalSaleValueModel>();

function plannerFor(agent: LogisticsAgent) {
  const planner = logisticsPlanners.get(agent) ?? createLogisticsMarketPlanner();
  logisticsPlanners.set(agent, planner);
  return planner;
}

function logisticsPolicy(agent: LogisticsAgent): AgentPolicy {
  return {
    agent,
    run(api, { lastTrades, publicLastOrderResults }) {
      plannerFor(agent).run(api, { lastTrades, publicLastOrderResults });
    },
  };
}

function electricityPlannerFor(agent: ElectricityLogisticsAgent) {
  const planner = electricityLogisticsPlanners.get(agent) ?? createElectricityLogisticsPlanner();
  electricityLogisticsPlanners.set(agent, planner);
  return planner;
}

function electricityLogisticsPolicy(agent: ElectricityLogisticsAgent): AgentPolicy {
  return {
    agent,
    run(api, { lastTrades, publicLastOrderResults }) {
      electricityPlannerFor(agent).run(api, { lastTrades, publicLastOrderResults });
    },
  };
}

function producerWidgetAskPrice(lastOrderResults: OrderResult[], account: Account) {
  const lastAsk = lastOrderResults.find(
    (result) => result.side === "ask" && result.resource === "widget" && result.account === account,
  );
  if (!lastAsk) return PRODUCER_BOOTSTRAP_WIDGET_ASK;
  if (lastAsk.filled === 0) return Math.max(PRODUCER_MIN_WIDGET_ASK, lastAsk.price - 1);
  const raise = lastAsk.unfilled === 0 ? 2 : 1;
  return Math.min(PRODUCER_MAX_WIDGET_ASK, lastAsk.price + raise);
}

function producerFactoryModel(account: Account) {
  const model = producerFactoryWidgetModels.get(account) ?? new OptimisticLocalSaleValueModel(account);
  producerFactoryWidgetModels.set(account, model);
  return model;
}

function maxObservedWidgetPrice(trades: Trade[]) {
  let maxPrice: number | null = null;
  for (const trade of trades) {
    if (trade.resource !== "widget") continue;
    maxPrice = Math.max(maxPrice ?? trade.price, trade.price);
  }
  return maxPrice;
}

function electricityBidPriceForNextFactoryChunk(
  model: OptimisticLocalSaleValueModel,
  virtualWidgetInventory: number,
  globalMaxWidgetPrice: number | null,
) {
  let value = 0;
  for (let widget = 0; widget < WIDGETS_PER_ELECTRICITY; widget += 1) {
    const marginalValue = model.expectedSalePriceOfMarginalInventory(virtualWidgetInventory + widget, globalMaxWidgetPrice);
    if (marginalValue === Number.POSITIVE_INFINITY) return PRODUCER_ELECTRICITY_BID_CEILING;
    value += marginalValue;
  }
  return Math.max(0, Math.min(PRODUCER_ELECTRICITY_BID_CEILING, Math.floor(value)));
}

export const AGENT_POLICIES: AgentPolicy[] = [
  {
    agent: "Common",
    run() {},
  },
  {
    agent: "Producer",
    run(api, { lastTrades, publicLastOrderResults }) {
      const globalMaxWidgetPrice = maxObservedWidgetPrice(lastTrades);
      for (const factory of api.cellsWith("factory")) {
        const model = producerFactoryModel(factory.account);
        model.observeTurn(lastTrades, publicLastOrderResults, api.lastOrderResults);
        let virtualWidgetInventory = api.balance(factory.account, "widget");
        let virtualElectricity = api.balance(factory.account, "electricity");
        while (virtualElectricity < factory.amount) {
          const price = electricityBidPriceForNextFactoryChunk(model, virtualWidgetInventory, globalMaxWidgetPrice);
          if (price <= 0 || price > api.balance(MONEY_ACCOUNT, "money")) break;
          api.placeBid(factory.account, "electricity", price, 1);
          virtualElectricity += 1;
          virtualWidgetInventory += WIDGETS_PER_ELECTRICITY;
        }
        const available = api.balance(factory.account, "widget");
        const askResult = api.lastOrderResults.find(
          (result) =>
            result.side === "ask" && result.resource === "widget" && result.account === factory.account,
        );
        api.placeAsk(
          factory.account,
          "widget",
          model.askPrice(globalMaxWidgetPrice, askResult) || producerWidgetAskPrice(api.lastOrderResults, factory.account),
          available,
        );
      }
      for (const powerPlant of api.cellsWith("power-plant")) {
        api.placeAsk(powerPlant.account, "electricity", 3, Math.floor(api.balance(powerPlant.account, "electricity")));
      }
    },
  },
  ...CONSUMER_AGENTS.map(consumerPolicy),
  ...LOGISTICS_AGENTS.map(logisticsPolicy),
  electricityLogisticsPolicy(ELECTRICITY_LOGISTICS_AGENT),
];
