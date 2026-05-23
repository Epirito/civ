import { describe, expect, it } from "vitest";
import { accountOf } from "./ledger";
import { PowerGridInfrastructure } from "./powerGridInfrastructure";

describe("PowerGridInfrastructure", () => {
  it("merges adjacent powered components when a bridge cell becomes powered", () => {
    const infrastructure = new PowerGridInfrastructure();
    infrastructure.set({ x: 1, y: 1 }, 1);
    infrastructure.set({ x: 3, y: 1 }, 1);
    infrastructure.update();

    expect(infrastructure.gridCount()).toBe(2);

    infrastructure.set({ x: 2, y: 1 }, 1);
    infrastructure.update();

    expect(infrastructure.gridCount()).toBe(1);
    expect(infrastructure.gridIdAt(accountOf(1, 1))).toBe(infrastructure.gridIdAt(accountOf(3, 1)));
  });

  it("splits a powered component when a bridge cell is removed", () => {
    const infrastructure = new PowerGridInfrastructure();
    infrastructure.set({ x: 1, y: 1 }, 1);
    infrastructure.set({ x: 2, y: 1 }, 1);
    infrastructure.set({ x: 3, y: 1 }, 1);
    infrastructure.update();

    infrastructure.set({ x: 2, y: 1 }, 0);
    infrastructure.update();

    expect(infrastructure.gridCount()).toBe(2);
    expect(infrastructure.gridIdAt(accountOf(1, 1))).not.toBe(infrastructure.gridIdAt(accountOf(3, 1)));
    expect(infrastructure.gridIdAt(accountOf(2, 1))).toBeNull();
  });

  it("returns current values before topology updates are committed", () => {
    const infrastructure = new PowerGridInfrastructure();
    infrastructure.set({ x: 1, y: 1 }, 2);

    expect(infrastructure.get({ x: 1, y: 1 })).toBe(2);
    expect(infrastructure.gridIdAt(accountOf(1, 1))).toBeNull();

    infrastructure.update();

    expect(infrastructure.gridIdAt(accountOf(1, 1))).not.toBeNull();
  });

  it("handles multiple removals in one update pass", () => {
    const infrastructure = new PowerGridInfrastructure();
    infrastructure.set({ x: 1, y: 1 }, 1);
    infrastructure.set({ x: 2, y: 1 }, 1);
    infrastructure.set({ x: 3, y: 1 }, 1);
    infrastructure.update();

    infrastructure.set({ x: 2, y: 1 }, 0);
    infrastructure.set({ x: 3, y: 1 }, 0);
    infrastructure.update();

    expect(infrastructure.gridCount()).toBe(1);
    expect(infrastructure.gridIdAt(accountOf(1, 1))).not.toBeNull();
    expect(infrastructure.gridIdAt(accountOf(2, 1))).toBeNull();
    expect(infrastructure.gridIdAt(accountOf(3, 1))).toBeNull();
  });
});
