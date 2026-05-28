export type ConsumerAgent = `Consumer-${number},${number}`;
export type LogisticsAgent = `Logistics-${number}`;
export type ElectricityLogisticsAgent = "ElectricityLogistics";
export type Agent = "Common" | "Producer" | LogisticsAgent | ElectricityLogisticsAgent | ConsumerAgent;
export type AgentFamily = "Common" | "Producer" | "Consumer" | "Logistics" | "ElectricityLogistics";
export type Resource =
  | "money"
  | "widget"
  | "factory"
  | "population"
  | "road"
  | "congestion"
  | "last-congestion"
  | "labor"
  | "electricity"
  | "power-line"
  | "power-plant";
export type MarketResource = "widget" | "labor" | "electricity";
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
  resource: MarketResource;
  side: Side;
  price: number;
  quantity: number;
  remaining: number;
};

export type OrderResult = {
  id: number;
  agent: Agent;
  account: Account;
  resource: MarketResource;
  side: Side;
  price: number;
  quantity: number;
  filled: number;
  unfilled: number;
};

export type Trade = {
  x: number;
  y: number;
  resource: MarketResource;
  buyer: Agent;
  seller: Agent;
  quantity: number;
  price: number;
};

export type Transport = {
  agent: Agent;
  from: Account;
  to: Account;
  resource: MarketResource;
  quantity: number;
  cost: number;
  path: Account[];
  deliveredQuantity?: number;
};

export type Ledger = Record<Agent, Record<string, Partial<Record<Resource, number>>>>;

export type SimState = {
  turn: number;
  nextOrderId: number;
  ledger: Ledger;
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
  placeBid: (account: Account, resource: MarketResource, price: number, quantity: number) => void;
  placeAsk: (account: Account, resource: MarketResource, price: number, quantity: number) => void;
  transportUnitCost: (from: Account, to: Account) => number;
  electricityDeliveryFactor: (from: Account, to: Account) => number | null;
  requestTransport: (from: Account, to: Account, resource: "widget", quantity: number) => void;
  requestElectricityTransportGross: (from: Account, to: Account, grossQuantity: number) => void;
};

export type AgentPolicyContext = {
  lastTrades: Trade[];
  publicLastOrderResults: OrderResult[];
};

export type AgentPolicy = {
  agent: Agent;
  run: (api: AgentApi, context: AgentPolicyContext) => void;
};
