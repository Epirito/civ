import { stepPriceLogistics } from "./agents";
import { LOGISTICS_AGENT, MONEY_ACCOUNT, getLedgerBalance, type PriceLogisticsState, type PriceResource } from "./engine";
import { createPriceLogisticsState } from "./scenario";

export type PriceLogisticsBenchmarkOptions = {
  turns?: number;
  width?: number;
  height?: number;
  profile?: boolean;
};

export type PriceLogisticsBenchmarkProfileEntry = {
  name: string;
  totalMs: number;
  calls: number;
  averageMs: number;
};

export type PriceLogisticsBenchmarkSummary = {
  turns: number;
  elapsedMs: number;
  finalTurn: number;
  nextOrderId: number;
  trades: number;
  events: number;
  totals: Record<PriceResource, number>;
  logisticsMoney: number;
  profile?: PriceLogisticsBenchmarkProfileEntry[];
};

const RESOURCES: PriceResource[] = ["money", "product", "food", "labor", "factory", "farm"];

function createBenchmarkProfiler() {
  const timings = new Map<string, { totalMs: number; calls: number }>();
  return {
    record(name: string, durationMs: number) {
      const timing = timings.get(name) ?? { totalMs: 0, calls: 0 };
      timing.totalMs += durationMs;
      timing.calls += 1;
      timings.set(name, timing);
    },
    report(): PriceLogisticsBenchmarkProfileEntry[] {
      return [...timings.entries()]
        .map(([name, timing]) => ({
          name,
          totalMs: timing.totalMs,
          calls: timing.calls,
          averageMs: timing.calls === 0 ? 0 : timing.totalMs / timing.calls,
        }))
        .sort((a, b) => b.totalMs - a.totalMs);
    },
  };
}

function totalResource(state: PriceLogisticsState, resource: PriceResource) {
  let total = 0;
  for (const accounts of Object.values(state.ledger)) {
    if (!accounts) continue;
    for (const resources of Object.values(accounts)) {
      total += resources?.[resource] ?? 0;
    }
  }
  return total;
}

export function summarizePriceLogisticsState(state: PriceLogisticsState) {
  return {
    finalTurn: state.turn,
    nextOrderId: state.nextOrderId,
    trades: state.trades.length,
    events: state.events.length,
    totals: Object.fromEntries(RESOURCES.map((resource) => [resource, totalResource(state, resource)])) as Record<
      PriceResource,
      number
    >,
    logisticsMoney: getLedgerBalance(state.ledger, LOGISTICS_AGENT, MONEY_ACCOUNT, "money"),
  };
}

export function runPriceLogisticsBenchmark({
  turns = 10,
  width,
  height,
  profile = false,
}: PriceLogisticsBenchmarkOptions = {}): PriceLogisticsBenchmarkSummary {
  let state = createPriceLogisticsState(width, height);
  const profiler = profile ? createBenchmarkProfiler() : undefined;
  const startedAt = performance.now();

  for (let turn = 0; turn < turns; turn += 1) {
    const stepStartedAt = performance.now();
    state = stepPriceLogistics(state);
    profiler?.record("stepPriceLogistics", performance.now() - stepStartedAt);
  }

  return {
    turns,
    elapsedMs: performance.now() - startedAt,
    profile: profiler?.report(),
    ...summarizePriceLogisticsState(state),
  };
}
