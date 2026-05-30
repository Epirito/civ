import type { Account, Coord } from "./types";

export function accountOf(x: number, y: number): Account {
  return `${x},${y}`;
}

export function parseAccount(account: Account): Coord | null {
  if (account === "") return null;
  const [x, y] = account.split(",").map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}
