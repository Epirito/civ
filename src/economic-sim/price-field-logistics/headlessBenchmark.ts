import { stepAgentSim } from "./agents";
import { LOGISTICS_AGENT, MONEY_ACCOUNT, getLedgerBalance, type State, type PriceResource } from "./engine";
import { createPriceLogisticsState } from "./scenario";

export type PriceLogisticsBenchmarkOptions = {
  turns?: number;
  width?: number;
  height?: number;
  profile?: boolean;
  trace?: boolean;
};

export type PriceLogisticsBenchmarkProfileEntry = {
  name: string;
  totalMs: number;
  calls: number;
  averageMs: number;
};

export type PriceLogisticsBenchmarkTraceEntry = {
  turn: number;
  stateHash: string;
  nextOrderId: number;
  orders: number;
  trades: number;
  events: number;
};

export type PriceLogisticsBenchmarkSummary = {
  turns: number;
  elapsedMs: number;
  trajectoryHash?: string;
  trajectory?: PriceLogisticsBenchmarkTraceEntry[];
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

function totalResource(state: State, resource: PriceResource) {
  let total = 0;
  for (const accounts of Object.values(state.ledger)) {
    if (!accounts) continue;
    for (const resources of Object.values(accounts)) {
      total += resources?.[resource] ?? 0;
    }
  }
  return total;
}

function canonicalize(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function stableStringify(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function stateHash(state: State) {
  return fnv1a64(stableStringify(state));
}

function traceEntry(state: State): PriceLogisticsBenchmarkTraceEntry {
  return {
    turn: state.turn,
    stateHash: stateHash(state),
    nextOrderId: state.nextOrderId,
    orders: state.orders.length,
    trades: state.trades.length,
    events: state.events.length,
  };
}

function profiledTraceEntry(
  state: State,
  profiler: ReturnType<typeof createBenchmarkProfiler> | undefined,
) {
  if (!profiler) return traceEntry(state);
  const startedAt = performance.now();
  const entry = traceEntry(state);
  profiler.record("stateHash", performance.now() - startedAt);
  return entry;
}

export function summarizePriceLogisticsState(state: State) {
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
  trace = false,
}: PriceLogisticsBenchmarkOptions = {}): PriceLogisticsBenchmarkSummary {
  let state = createPriceLogisticsState(width, height);
  const profiler = profile ? createBenchmarkProfiler() : undefined;
  const trajectory = trace ? [profiledTraceEntry(state, profiler)] : undefined;
  const startedAt = performance.now();

  for (let turn = 0; turn < turns; turn += 1) {
    const stepStartedAt = performance.now();
    state = stepAgentSim(state, profiler);
    profiler?.record("stepPriceLogistics", performance.now() - stepStartedAt);
    trajectory?.push(profiledTraceEntry(state, profiler));
  }

  return {
    turns,
    elapsedMs: performance.now() - startedAt,
    trajectoryHash: trajectory ? fnv1a64(stableStringify(trajectory)) : undefined,
    trajectory,
    profile: profiler?.report(),
    ...summarizePriceLogisticsState(state),
  };
}
