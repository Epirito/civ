import { describe, expect, it } from "vitest";
import { runPriceLogisticsBenchmark } from "./headlessBenchmark";
import { createPriceLogisticsState } from "./scenario";

describe("price-field logistics benchmark", () => {
  it("runs the world scenario headlessly", () => {
    const summary = runPriceLogisticsBenchmark({ turns: 1, profile: true });

    console.info(
      `price-field logistics benchmark: ${summary.turns} turn in ${summary.elapsedMs.toFixed(1)}ms, ` +
        `${summary.trades} trades, ${summary.events} events`,
    );
    console.table(
      summary.profile?.slice(0, 8).map((entry) => ({
        name: entry.name,
        totalMs: entry.totalMs.toFixed(2),
        calls: entry.calls,
        averageMs: entry.averageMs.toFixed(3),
      })),
    );

    expect(summary.finalTurn).toBe(1);
    expect(summary.nextOrderId).toBeGreaterThan(1);
    expect(summary.totals.labor).toBeGreaterThan(0);
    expect(summary.profile?.length).toBeGreaterThan(0);
  }, 120_000);

  it("keeps the default scenario at the tile-study world scale", () => {
    const state = createPriceLogisticsState();

    expect(state.width).toBe(64);
    expect(state.height).toBe(36);
    expect(state.cells.some((cell) => cell.land)).toBe(true);
    expect(state.cells.some((cell) => !cell.land)).toBe(true);
  });
});
