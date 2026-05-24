import { describe, expect, it } from "vitest";
import { AGENTS } from "./constants";
import { runHeadlessBenchmark } from "./headlessBenchmark";
import { accountOf, getBalance } from "./ledger";
import { BENCHMARK_CELLS, createBenchmarkState } from "./scenario";
import type { Resource } from "./types";

const CELL_RESOURCES: Resource[] = ["widget", "factory", "population", "road", "electricity", "power-line", "power-plant"];

function cellTotal(state: ReturnType<typeof createBenchmarkState>, x: number, y: number, resource: Resource) {
  const account = accountOf(x, y);
  return AGENTS.reduce((sum, agent) => sum + getBalance(state.ledger, agent, account, resource), 0);
}

describe("headless economic sim benchmark", () => {
  it("is deterministic for the benchmark scenario with a seeded policy order", () => {
    const first = runHeadlessBenchmark({ seed: 12345, turns: 1 });
    const second = runHeadlessBenchmark({ seed: 12345, turns: 1 });

    expect({ ...first, elapsedMs: 0 }).toEqual({ ...second, elapsedMs: 0 });
  }, 120_000);

  it("keeps the benchmark scenario sparse enough to exercise missing-cell edge cases", () => {
    const state = createBenchmarkState();

    for (const resource of CELL_RESOURCES) {
      let present = 0;
      let absent = 0;
      for (const { x, y } of BENCHMARK_CELLS) {
        if (cellTotal(state, x, y, resource) > 0) present += 1;
        else absent += 1;
      }
      expect(present, `${resource} should exist somewhere`).toBeGreaterThan(0);
      expect(absent, `${resource} should be absent from several benchmark cells`).toBeGreaterThanOrEqual(3);
    }
  });

  it("runs the smaller scenario headlessly for performance profiling", () => {
    const summary = runHeadlessBenchmark({ seed: 20260524, turns: 1 });
    console.info(
      `economic-sim benchmark: ${summary.turns} turns in ${summary.elapsedMs.toFixed(1)}ms, ` +
        `${summary.trades} trades, ${summary.transports} transports`,
    );

    expect(summary.finalTurn).toBe(1);
    expect(summary.nextOrderId).toBeGreaterThan(1);
    expect(summary.totals.population).toBeGreaterThan(0);
  }, 120_000);
});
