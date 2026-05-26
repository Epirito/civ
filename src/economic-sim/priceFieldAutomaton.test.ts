import { describe, expect, it } from "vitest";
import {
  createPriceFieldState,
  fieldCell,
  stepPriceField,
  totalFieldVolume,
  type PriceFieldSource,
} from "./priceFieldAutomaton";

const OPTIONS = {
  priceDecay: 0.9,
  volumeDecay: 1,
};

describe("price field automaton", () => {
  it("dilutes volume across non-parent neighbors and records parents", () => {
    const center: PriceFieldSource = { x: 2, y: 2, price: 10, volume: 8, active: true };
    const seeded = stepPriceField(createPriceFieldState(5, 5), [center], OPTIONS);
    const propagated = stepPriceField(seeded, [], OPTIONS);

    expect(fieldCell(propagated, 2, 1).volume).toBeCloseTo(2);
    expect(fieldCell(propagated, 2, 1).price).toBeCloseTo(9);
    expect(fieldCell(propagated, 2, 1).parents).toEqual([{ x: 2, y: 2 }]);
    expect(fieldCell(propagated, 2, 2).volume).toBe(0);
  });

  it("does not immediately bounce a signal back into the parent cell", () => {
    const source: PriceFieldSource = { x: 2, y: 2, price: 10, volume: 8, active: true };
    let state = stepPriceField(createPriceFieldState(5, 5), [source], OPTIONS);
    state = stepPriceField(state, [], OPTIONS);
    state = stepPriceField(state, [], OPTIONS);

    expect(fieldCell(state, 2, 2).volume).toBe(0);
  });

  it("does not leave a stale puddle after a finite pulse disappears", () => {
    const source: PriceFieldSource = { x: 3, y: 3, price: 10, volume: 10, active: true };
    let state = stepPriceField(createPriceFieldState(7, 7), [source], OPTIONS);
    for (let turn = 0; turn < 20; turn += 1) {
      state = stepPriceField(state, [], OPTIONS);
    }

    expect(totalFieldVolume(state)).toBe(0);
  });
});
