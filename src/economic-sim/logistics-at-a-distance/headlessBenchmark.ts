import { resetAgentPolicyState } from "./agents";
import { stepSimulation } from "./engine";
import { RESOURCES } from "./constants";
import { totalResource } from "./ledger";
import { createBenchmarkState } from "./scenario";
import type { Resource, SimState } from "./types";

export type HeadlessBenchmarkOptions = {
  seed?: number;
  turns?: number;
  profile?: boolean;
  trace?: boolean;
};

export type BenchmarkProfileEntry = {
  name: string;
  totalMs: number;
  calls: number;
  averageMs: number;
};

export type BenchmarkTraceEntry = {
  turn: number;
  stateHash: string;
  nextOrderId: number;
  orders: number;
  trades: number;
  transports: number;
};

export type HeadlessBenchmarkSummary = {
  seed: number;
  turns: number;
  elapsedMs: number;
  trajectoryHash?: string;
  trajectory?: BenchmarkTraceEntry[];
  finalTurn: number;
  nextOrderId: number;
  trades: number;
  transports: number;
  totals: Record<Resource, number>;
  profile?: BenchmarkProfileEntry[];
};

export function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function summarizeState(state: SimState) {
  return {
    finalTurn: state.turn,
    nextOrderId: state.nextOrderId,
    trades: state.trades.length,
    transports: state.transports.length,
    totals: Object.fromEntries(RESOURCES.map((resource) => [resource, totalResource(state.ledger, resource)])) as Record<
      Resource,
      number
    >,
  };
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

function stateHash(state: SimState) {
  return fnv1a64(stableStringify(state));
}

function traceEntry(state: SimState): BenchmarkTraceEntry {
  return {
    turn: state.turn,
    stateHash: stateHash(state),
    nextOrderId: state.nextOrderId,
    orders: state.orders.length,
    trades: state.trades.length,
    transports: state.transports.length,
  };
}

function createBenchmarkProfiler() {
  const timings = new Map<string, { totalMs: number; calls: number }>();
  return {
    record(name: string, durationMs: number) {
      const timing = timings.get(name) ?? { totalMs: 0, calls: 0 };
      timing.totalMs += durationMs;
      timing.calls += 1;
      timings.set(name, timing);
    },
    report(): BenchmarkProfileEntry[] {
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

export function runHeadlessBenchmark({
  seed = 1,
  turns = 20,
  profile = false,
  trace = false,
}: HeadlessBenchmarkOptions = {}): HeadlessBenchmarkSummary {
  resetAgentPolicyState();
  const random = createSeededRandom(seed);
  let state = createBenchmarkState();
  const profiler = profile ? createBenchmarkProfiler() : undefined;
  const trajectory = trace ? [traceEntry(state)] : undefined;
  const startedAt = performance.now();

  for (let turn = 0; turn < turns; turn += 1) {
    state = stepSimulation(state, { random, profiler });
    trajectory?.push(traceEntry(state));
  }

  return {
    seed,
    turns,
    elapsedMs: performance.now() - startedAt,
    trajectoryHash: trajectory ? fnv1a64(stableStringify(trajectory)) : undefined,
    trajectory,
    profile: profiler?.report(),
    ...summarizeState(state),
  };
}
