import { describe, expect, it } from "vitest";
import {
  createPriceLogisticsDebugSession,
  evaluateInSession,
} from "./debugSession";
import {
  executeReplCommand,
  type ReplRuntime,
} from "./debugRepl";
import {
  MONEY_ACCOUNT,
  accountOfCell,
  consumerAgentForCell,
  getLedgerBalance,
} from "./engine";

function runtime(): ReplRuntime {
  return {
    session: createPriceLogisticsDebugSession({ width: 5, height: 1 }),
    json: false,
    watch: true,
  };
}

describe("price logistics debug session", () => {
  it("initializes and summarizes the default world", () => {
    const session = createPriceLogisticsDebugSession();

    expect(session.state.turn).toBe(0);
    expect(session.state.width).toBe(64);
    expect(session.summary().totals.money).toBeGreaterThan(0);
  });

  it("selects cells and preserves selection across steps", () => {
    const session = createPriceLogisticsDebugSession({ width: 5, height: 1 });
    session.selectCell(3, 0);

    const stepped = session.step(2);

    expect(stepped.turn).toBe(2);
    expect(session.selected).toEqual({ x: 3, y: 0 });
    expect(session.cellSnapshot().x).toBe(3);
  });

  it("returns selected-cell snapshots and market history", () => {
    const session = createPriceLogisticsDebugSession({ width: 5, height: 1, cell: { x: 0, y: 0 } });
    session.step(1);

    expect(session.cellSnapshot().account).toBe("0,0");
    expect(session.marketHistory("product")).toHaveLength(2);
  });

  it("reset restores turn zero and preserves a valid selected cell", () => {
    const session = createPriceLogisticsDebugSession({ width: 5, height: 1, cell: { x: 2, y: 0 } });
    session.step(3);

    const summary = session.reset();

    expect(summary.turn).toBe(0);
    expect(session.selected).toEqual({ x: 2, y: 0 });
  });

  it("eval can read, mutate, step, return values, and report errors", async () => {
    const session = createPriceLogisticsDebugSession({ width: 5, height: 1, cell: { x: 0, y: 0 } });
    const cell = session.selectedCell();
    expect(cell).not.toBeNull();
    const account = accountOfCell(cell!);
    const consumer = consumerAgentForCell(cell!);
    const before = getLedgerBalance(session.state.ledger, consumer, MONEY_ACCOUNT, "money");

    const read = await evaluateInSession(session, "cell.x");
    expect(read).toEqual({ ok: true, value: 0 });

    const mutated = await evaluateInSession(
      session,
      'addLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money", 500); return getLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money");',
    );
    expect(mutated).toEqual({ ok: true, value: before + 500 });

    const stepped = await evaluateInSession(session, "await step(1); return summary().turn;");
    expect(stepped).toEqual({ ok: true, value: 1 });
    expect(getLedgerBalance(session.state.ledger, consumer, MONEY_ACCOUNT, "money")).toBeGreaterThanOrEqual(before);
    expect(account).toBe("0,0");

    const invalid = await evaluateInSession(session, "throw new Error('boom')");
    expect(invalid).toEqual({ ok: false, error: "boom" });
  });
});

describe("price logistics debug REPL commands", () => {
  it("parses select, step, history, json, and eval commands", async () => {
    const repl = runtime();

    expect(await executeReplCommand(repl, "select 3 0")).toMatchObject({ ok: true, kind: "select" });
    expect(repl.session.selected).toEqual({ x: 3, y: 0 });

    expect(await executeReplCommand(repl, "select 3,0")).toMatchObject({ ok: true, kind: "select" });
    expect(await executeReplCommand(repl, "step")).toMatchObject({ ok: true, kind: "step" });
    expect(await executeReplCommand(repl, "step 10")).toMatchObject({ ok: true, kind: "step" });
    expect(await executeReplCommand(repl, "history food")).toMatchObject({ ok: true, kind: "history" });

    expect(await executeReplCommand(repl, "json on")).toMatchObject({ ok: true, kind: "json" });
    expect(repl.json).toBe(true);

    expect(await executeReplCommand(repl, "eval 1 + 1")).toEqual({ ok: true, kind: "eval", data: 2 });
  });
});
