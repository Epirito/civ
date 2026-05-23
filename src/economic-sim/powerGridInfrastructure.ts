import { GRID_HEIGHT, GRID_WIDTH } from "./constants";
import { accountOf, parseAccount, setBalance } from "./ledger";
import type { Account, Coord, Ledger } from "./types";

type PowerGrid = {
  id: number;
  accounts: Set<Account>;
};

function coordKey(coord: Coord): Account {
  return accountOf(coord.x, coord.y);
}

function adjacentAccounts(account: Account) {
  const coord = parseAccount(account);
  if (!coord) return [];
  return [
    { x: coord.x + 1, y: coord.y },
    { x: coord.x - 1, y: coord.y },
    { x: coord.x, y: coord.y + 1 },
    { x: coord.x, y: coord.y - 1 },
  ]
    .filter((candidate) => candidate.x >= 0 && candidate.x < GRID_WIDTH && candidate.y >= 0 && candidate.y < GRID_HEIGHT)
    .map((candidate) => accountOf(candidate.x, candidate.y));
}

export class PowerGridInfrastructure {
  private amounts = new Map<Account, number>();
  private committedAmounts = new Map<Account, number>();
  private updatedAccounts = new Set<Account>();
  private gridByAccount = new Map<Account, number>();
  private grids = new Map<number, PowerGrid>();
  private nextGridId = 1;

  clone() {
    const next = new PowerGridInfrastructure();
    next.amounts = new Map(this.amounts);
    next.committedAmounts = new Map(this.committedAmounts);
    next.updatedAccounts = new Set(this.updatedAccounts);
    next.gridByAccount = new Map(this.gridByAccount);
    next.grids = new Map([...this.grids].map(([id, grid]) => [id, { id, accounts: new Set(grid.accounts) }]));
    next.nextGridId = this.nextGridId;
    return next;
  }

  set(coord: Coord, amount: number) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`power-grid-infrastructure amount is not a non-negative safe integer: ${amount}`);
    }
    const account = coordKey(coord);
    this.amounts.set(account, amount);
    this.updatedAccounts.add(account);
  }

  get(coord: Coord) {
    return this.amounts.get(coordKey(coord)) ?? 0;
  }

  update() {
    const updated = [...this.updatedAccounts].sort();
    this.updatedAccounts.clear();

    for (const account of updated) {
      const before = this.committedAmounts.get(account) ?? 0;
      const after = this.amounts.get(account) ?? 0;
      const wasPowered = before > 0;
      const isPowered = after > 0;
      if (!wasPowered && isPowered) this.addPoweredAccount(account);
      if (wasPowered && !isPowered) this.removePoweredAccount(account);
      this.committedAmounts.set(account, after);
    }
  }

  gridIdAt(account: Account) {
    return this.gridByAccount.get(account) ?? null;
  }

  gridAccounts(gridId: number) {
    return new Set(this.grids.get(gridId)?.accounts ?? []);
  }

  entries() {
    return [...this.amounts.entries()].map(([account, amount]) => ({ account, amount }));
  }

  gridCount() {
    return this.grids.size;
  }

  private addPoweredAccount(account: Account) {
    const adjacentGridIds = new Set(
      adjacentAccounts(account)
        .filter((neighbor) => (this.amounts.get(neighbor) ?? 0) > 0)
        .map((neighbor) => this.gridByAccount.get(neighbor))
        .filter((gridId): gridId is number => gridId !== undefined),
    );

    if (adjacentGridIds.size === 0) {
      const grid = { id: this.nextGridId, accounts: new Set<Account>([account]) };
      this.nextGridId += 1;
      this.grids.set(grid.id, grid);
      this.gridByAccount.set(account, grid.id);
      return;
    }

    const [primaryGridId, ...mergedGridIds] = [...adjacentGridIds].sort((a, b) => a - b);
    const primaryGrid = this.grids.get(primaryGridId);
    if (!primaryGrid) throw new Error(`Missing power grid ${primaryGridId}`);
    primaryGrid.accounts.add(account);
    this.gridByAccount.set(account, primaryGrid.id);

    for (const mergedGridId of mergedGridIds) {
      const mergedGrid = this.grids.get(mergedGridId);
      if (!mergedGrid) continue;
      for (const mergedAccount of mergedGrid.accounts) {
        primaryGrid.accounts.add(mergedAccount);
        this.gridByAccount.set(mergedAccount, primaryGrid.id);
      }
      this.grids.delete(mergedGridId);
    }
  }

  private removePoweredAccount(account: Account) {
    const gridId = this.gridByAccount.get(account);
    if (gridId === undefined) return;
    const oldGrid = this.grids.get(gridId);
    this.gridByAccount.delete(account);
    if (!oldGrid) return;

    const remaining = new Set(oldGrid.accounts);
    remaining.delete(account);
    for (const remainingAccount of [...remaining]) {
      if ((this.amounts.get(remainingAccount) ?? 0) === 0) remaining.delete(remainingAccount);
    }
    this.grids.delete(gridId);
    for (const remainingAccount of remaining) this.gridByAccount.delete(remainingAccount);

    while (remaining.size > 0) {
      const start = remaining.values().next().value as Account | undefined;
      if (!start) break;
      const component = this.floodFillPoweredComponent(start, remaining);
      const grid = { id: this.nextGridId, accounts: component };
      this.nextGridId += 1;
      this.grids.set(grid.id, grid);
      for (const componentAccount of component) {
        remaining.delete(componentAccount);
        this.gridByAccount.set(componentAccount, grid.id);
      }
    }
  }

  private floodFillPoweredComponent(start: Account, allowedAccounts: Set<Account>) {
    const component = new Set<Account>();
    const frontier = [start];
    while (frontier.length > 0) {
      const account = frontier.pop();
      if (!account || component.has(account) || !allowedAccounts.has(account) || (this.amounts.get(account) ?? 0) === 0) {
        continue;
      }
      component.add(account);
      for (const neighbor of adjacentAccounts(account)) frontier.push(neighbor);
    }
    return component;
  }
}

export function syncPowerGridInfrastructureToLedger(ledger: Ledger, infrastructure: PowerGridInfrastructure) {
  for (const { account, amount } of infrastructure.entries()) {
    setBalance(ledger, "Common", account, "power-grid-infrastructure", amount);
  }
}
