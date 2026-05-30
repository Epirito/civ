export type ConsumerAgent = `Consumer-${number},${number}`;
export type LogisticsAgent = `Logistics-${number}`;
export type ElectricityLogisticsAgent = "ElectricityLogistics";
export type Agent = "Common" | "Producer" | "FarmProducer" | LogisticsAgent | ElectricityLogisticsAgent | ConsumerAgent;
export type AgentFamily = "Common" | "Producer" | "Consumer" | "Logistics" | "ElectricityLogistics";
export type Account = "" | `${number},${number}`;

export type Coord = {
  x: number;
  y: number;
};
