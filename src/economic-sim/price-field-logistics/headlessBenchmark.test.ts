// @ts-expect-error Node fs is available under Vitest; the app build does not ship this test.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type PriceLogisticsBenchmarkSummary, runPriceLogisticsBenchmark } from "./headlessBenchmark";
import { createPriceLogisticsState } from "./scenario";

const EXPECTED_SUMMARY_URL = new URL("./headlessBenchmark.expected.json", import.meta.url);

function stableSummary(summary: PriceLogisticsBenchmarkSummary) {
  const { elapsedMs: _elapsedMs, profile: _profile, ...stable } = summary;
  return stable;
}

describe("price-field logistics benchmark", () => {
  it("matches the saved deterministic benchmark trajectory", () => {
    const summary = stableSummary(runPriceLogisticsBenchmark({ turns: 3, trace: true }));
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;

    if (!existsSync(EXPECTED_SUMMARY_URL)) {
      writeFileSync(EXPECTED_SUMMARY_URL, serialized);
      console.info(`created benchmark expectation at ${EXPECTED_SUMMARY_URL.pathname}`);
    }

    expect(JSON.parse(readFileSync(EXPECTED_SUMMARY_URL, "utf8"))).toEqual(summary);
  }, 120_000);

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
