import { resetAgentPolicyState } from "./agents";
import { stepSimulation } from "./engine";
import { RESOURCES } from "./constants";
import { totalResource } from "./ledger";
import { createBenchmarkState } from "./scenario";
import type { Resource, SimState } from "./types";

export type HeadlessBenchmarkOptions = {
  seed?: number;
  turns?: number;
};

export type HeadlessBenchmarkSummary = {
  seed: number;
  turns: number;
  elapsedMs: number;
  finalTurn: number;
  nextOrderId: number;
  trades: number;
  transports: number;
  totals: Record<Resource, number>;
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

export function runHeadlessBenchmark({
  seed = 1,
  turns = 20,
}: HeadlessBenchmarkOptions = {}): HeadlessBenchmarkSummary {
  resetAgentPolicyState();
  const random = createSeededRandom(seed);
  let state = createBenchmarkState();
  const startedAt = performance.now();

  for (let turn = 0; turn < turns; turn += 1) {
    state = stepSimulation(state, { random });
  }

  return {
    seed,
    turns,
    elapsedMs: performance.now() - startedAt,
    ...summarizeState(state),
  };
}
