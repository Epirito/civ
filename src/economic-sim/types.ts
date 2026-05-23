import type { PowerGridInfrastructure } from "./powerGridInfrastructure";

export type ConsumerAgent = `Consumer-${number},${number}`;
export type LogisticsAgent = `Logistics-${number}`;
export type Agent = "Common" | "Producer" | LogisticsAgent | ConsumerAgent;
export type AgentFamily = "Common" | "Producer" | "Consumer" | "Logistics";
export type TradableResource = "widget" | "electricity";
export type Resource =
  | "money"
  | TradableResource
  | "factory"
  | "population"
  | "road"
  | "power-grid-infrastructure"
  | "congestion"
  | "last-congestion";
export type Account = "" | `${number},${number}`;
export type Side = "bid" | "ask";

export type Coord = {
  x: number;
  y: number;
};

export type CellBalance = Coord & { account: Account; amount: number };

export type Order = {
  id: number;
  agent: Agent;
  account: Account;
  resource: TradableResource;
  side: Side;
  price: number;
  quantity: number;
  remaining: number;
};

export type OrderResult = {
  id: number;
  agent: Agent;
  account: Account;
  resource: TradableResource;
  side: Side;
  price: number;
  quantity: number;
  filled: number;
  unfilled: number;
};

export type Trade = {
  x: number;
  y: number;
  resource?: TradableResource;
  buyer: Agent;
  seller: Agent;
  quantity: number;
  price: number;
};

export type Transport = {
  agent: Agent;
  from: Account;
  to: Account;
  resource: "widget";
  quantity: number;
  cost: number;
  path: Account[];
};

export type Ledger = Record<Agent, Record<string, Partial<Record<Resource, number>>>>;

export type SimState = {
  turn: number;
  nextOrderId: number;
  ledger: Ledger;
  powerGridInfrastructure: PowerGridInfrastructure;
  orders: Order[];
  lastOrderResults: OrderResult[];
  trades: Trade[];
  transports: Transport[];
  note: string;
};

export type AgentApi = {
  balance: (account: Account, resource: Resource) => number;
  cellsWith: (resource: Resource) => CellBalance[];
  observeCells: (agent: Agent, resource: Resource) => CellBalance[];
  /**
   * Results from this same agent's orders in the previous turn. The engine
   * filters identity before exposing them, so policy code can learn from fills
   * and misses without tagging orders with its own agent name.
   */
  lastOrderResults: OrderResult[];
  placeBid: (account: Account, resource: TradableResource, price: number, quantity: number) => void;
  placeAsk: (account: Account, resource: TradableResource, price: number, quantity: number) => void;
  transportUnitCost: (from: Account, to: Account) => number;
  requestTransport: (from: Account, to: Account, resource: "widget", quantity: number) => void;
};

export type AgentPolicyContext = {
  lastTrades: Trade[];
  publicLastOrderResults: OrderResult[];
};

export type AgentPolicy = {
  agent: Agent;
  run: (api: AgentApi, context: AgentPolicyContext) => void;
};
