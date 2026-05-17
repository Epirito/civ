import { AGENTS } from "./constants";
import type { Account, Agent, CellBalance, Coord, Ledger, Resource } from "./types";

export function accountOf(x: number, y: number): Account {
  return `${x},${y}`;
}

export function parseAccount(account: Account): Coord | null {
  if (account === "") return null;
  const [x, y] = account.split(",").map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

/**
 * Ledger quantities are modeled as non-negative safe integers only. This guard
 * rejects fractional values, negative balances, NaN/Infinity, and values large
 * enough to make later arithmetic lose precision.
 */
export function assertSafeAmount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a non-negative safe integer: ${value}`);
  }
}

/**
 * Adds two ledger-safe amounts and verifies the result is still safe. Use this
 * instead of raw `+` whenever a value will become a balance, reserve, order
 * quantity, or id tracked by the simulation.
 */
export function checkedAdd(a: number, b: number, label: string) {
  assertSafeAmount(a, `${label} left`);
  assertSafeAmount(b, `${label} right`);
  const result = a + b;
  assertSafeAmount(result, label);
  return result;
}

/**
 * Subtracts one ledger-safe amount from another and throws if the result would
 * go negative. This is the main overdraft check for reservations and fills.
 */
export function checkedSub(a: number, b: number, label: string) {
  assertSafeAmount(a, `${label} left`);
  assertSafeAmount(b, `${label} right`);
  if (b > a) throw new Error(`${label} would go negative`);
  return a - b;
}

/**
 * Multiplies two ledger-safe amounts and verifies the product is still safe.
 * This keeps derived values like bid reserves, trade payments, generation, and
 * transport costs from overflowing JavaScript's exact integer range.
 */
export function checkedMul(a: number, b: number, label: string) {
  assertSafeAmount(a, `${label} left`);
  assertSafeAmount(b, `${label} right`);
  const result = a * b;
  assertSafeAmount(result, label);
  return result;
}

export function makeLedger(): Ledger {
  return Object.fromEntries(AGENTS.map((agent) => [agent, {}])) as Ledger;
}

export function cloneLedger(ledger: Ledger): Ledger {
  const next = makeLedger();
  for (const agent of AGENTS) {
    for (const [account, resources] of Object.entries(ledger[agent])) {
      next[agent][account] = { ...resources };
    }
  }
  return next;
}

export function getBalance(ledger: Ledger, agent: Agent, account: Account, resource: Resource) {
  return ledger[agent][account]?.[resource] ?? 0;
}

export function setBalance(ledger: Ledger, agent: Agent, account: Account, resource: Resource, amount: number) {
  assertSafeAmount(amount, `${agent} ${account || "abstract"} ${resource}`);
  ledger[agent][account] = ledger[agent][account] ?? {};
  ledger[agent][account][resource] = amount;
}

export function addBalance(ledger: Ledger, agent: Agent, account: Account, resource: Resource, amount: number) {
  assertSafeAmount(amount, `credit ${resource}`);
  const current = getBalance(ledger, agent, account, resource);
  setBalance(ledger, agent, account, resource, checkedAdd(current, amount, `credit ${resource}`));
}

export function reserveBalance(ledger: Ledger, agent: Agent, account: Account, resource: Resource, amount: number) {
  assertSafeAmount(amount, `reserve ${resource}`);
  const current = getBalance(ledger, agent, account, resource);
  setBalance(ledger, agent, account, resource, checkedSub(current, amount, `reserve ${resource}`));
}

export function totalResource(ledger: Ledger, resource: Resource) {
  let total = 0;
  for (const agent of AGENTS) {
    for (const account of Object.values(ledger[agent])) {
      total = checkedAdd(total, account[resource] ?? 0, `total ${resource}`);
    }
  }
  return total;
}

export function totalAgentResource(ledger: Ledger, agent: Agent, resource: Resource) {
  let total = 0;
  for (const account of Object.values(ledger[agent])) {
    total = checkedAdd(total, account[resource] ?? 0, `${agent} total ${resource}`);
  }
  return total;
}

/**
 * Returns only physical grid accounts where an agent has a positive balance of
 * the requested resource. The abstract "" account is intentionally excluded, so
 * callers can safely use the result for cell-local production, transport, and
 * market orders without accidentally treating money-like balances as map cells.
 */
export function cellsWith(ledger: Ledger, agent: Agent, resource: Resource) {
  const cells: CellBalance[] = [];
  for (const [account, resources] of Object.entries(ledger[agent])) {
    const coord = parseAccount(account as Account);
    const amount = resources[resource] ?? 0;
    if (coord && amount > 0) cells.push({ ...coord, account: account as Account, amount });
  }
  return cells;
}
