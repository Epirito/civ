import { CONSUMER_AGENTS, LOGISTICS_AGENTS, MONEY_ACCOUNT } from "./constants";
import { checkedAdd, checkedMul, checkedSub } from "./ledger";
import { createLogisticsMarketPlanner } from "./logisticsPlanner";
import type { AgentPolicy, ConsumerAgent, LogisticsAgent } from "./types";

function consumerPolicy(agent: ConsumerAgent): AgentPolicy {
  return {
    agent,
    run(api) {
      for (const population of api.cellsWith("population")) {
        const budget = api.balance(MONEY_ACCOUNT, "money");
        const lastBid = api.lastOrderResults.find(
          (result) => result.side === "bid" && result.resource === "widget" && result.account === population.account,
        );
        const price = lastBid ? 
          (lastBid.unfilled > 0 ? 
            lastBid.price + 2 
          : Math.max(lastBid.price - 2, 1))
        : 14;
        const quantity = Math.min(population.amount, Math.floor(budget / price));
        api.placeBid(population.account, "widget", price, quantity);

        const lastPowerBid = api.lastOrderResults.find(
          (result) => result.side === "bid" && result.resource === "electricity" && result.account === population.account,
        );
        const powerPrice = lastPowerBid
          ? lastPowerBid.unfilled > 0
            ? lastPowerBid.price + 1
            : Math.max(lastPowerBid.price - 1, 1)
          : 6;
        const powerQuantity = Math.min(population.amount, Math.floor(api.balance(MONEY_ACCOUNT, "money") / powerPrice));
        api.placeBid(population.account, "electricity", powerPrice, powerQuantity);
      }
    },
  };
}

const logisticsPlanners = new Map<LogisticsAgent, ReturnType<typeof createLogisticsMarketPlanner>>();

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

export const AGENT_POLICIES: AgentPolicy[] = [
  {
    agent: "Common",
    run() {},
  },
  {
    agent: "Producer",
    run(api) {
      for (const factory of api.cellsWith("factory")) {
        const available = api.balance(factory.account, "widget");
        api.placeAsk(factory.account, "widget", 8, available);
        const electricity = api.balance(factory.account, "electricity");
        api.placeAsk(factory.account, "electricity", 3, electricity);
      }
    },
  },
  ...CONSUMER_AGENTS.map(consumerPolicy),
  ...LOGISTICS_AGENTS.map(logisticsPolicy),
];
