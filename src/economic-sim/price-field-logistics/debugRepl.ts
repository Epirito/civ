import {
  evaluateInSession,
  type CellDebugSnapshot,
  type PriceLogisticsDebugSession,
  type PriceLogisticsSessionSummary,
} from "./debugSession";
import type { MarketResource, OrderResult, Trade } from "./engine";

export type ReplRuntime = {
  session: PriceLogisticsDebugSession;
  json: boolean;
  watch: boolean;
};

export type ReplCommandResult = {
  ok: boolean;
  kind: string;
  data?: unknown;
  message?: string;
  exit?: boolean;
};

const MARKET_RESOURCES: MarketResource[] = ["product", "food", "labor"];

function words(input: string) {
  return input.trim().split(/\s+/).filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, label: string) {
  const parsed = value === undefined ? 1 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseCellArgs(args: string[]) {
  if (args.length === 1 && args[0].includes(",")) {
    const [x, y] = args[0].split(",").map(Number);
    return { x, y };
  }
  if (args.length >= 2) return { x: Number(args[0]), y: Number(args[1]) };
  throw new Error("expected cell coordinates as x y or x,y");
}

function parseResource(value: string | undefined): MarketResource {
  const resource = value ?? "product";
  if (!MARKET_RESOURCES.includes(resource as MarketResource)) {
    throw new Error(`resource must be one of ${MARKET_RESOURCES.join(", ")}`);
  }
  return resource as MarketResource;
}

function parseResetOptions(args: string[]) {
  const options: { width?: number; height?: number } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--width") {
      options.width = Number(args[++index]);
    } else if (arg === "--height") {
      options.height = Number(args[++index]);
    } else {
      throw new Error(`unknown reset option: ${arg}`);
    }
  }
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width < 1)) {
    throw new Error("--width must be a positive integer");
  }
  if (options.height !== undefined && (!Number.isInteger(options.height) || options.height < 1)) {
    throw new Error("--height must be a positive integer");
  }
  return options;
}

export function shouldStartMultilineEval(input: string) {
  return input.trim() === "eval";
}

export async function executeReplCommand(runtime: ReplRuntime, input: string): Promise<ReplCommandResult> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, kind: "empty" };

  try {
    const [command = "", ...args] = words(trimmed);
    if (command === "help") return { ok: true, kind: "help", data: helpText() };
    if (command === "quit" || command === "exit") return { ok: true, kind: "quit", exit: true, message: "bye" };

    if (command === "status") return { ok: true, kind: "status", data: runtime.session.summary() };

    if (command === "select") {
      const { x, y } = parseCellArgs(args);
      return { ok: true, kind: "select", data: runtime.session.selectCell(x, y) };
    }

    if (command === "cell") {
      if (args.length === 0) return { ok: true, kind: "cell", data: runtime.session.cellSnapshot() };
      const { x, y } = parseCellArgs(args);
      return { ok: true, kind: "cell", data: runtime.session.cellSnapshot({ x, y }) };
    }

    if (command === "step") {
      const count = parsePositiveInteger(args[0], "step count");
      const result = runtime.session.step(count);
      return {
        ok: true,
        kind: "step",
        data: runtime.watch ? result : runtime.session.summary(),
      };
    }

    if (command === "history" || command === "orders" || command === "trades") {
      const resource = parseResource(args[0]);
      const history = runtime.session.marketHistory(resource);
      if (command === "orders") {
        return { ok: true, kind: "orders", data: history.map(({ turn, orders }) => ({ turn, orders })) };
      }
      if (command === "trades") {
        return { ok: true, kind: "trades", data: history.map(({ turn, trades }) => ({ turn, trades })) };
      }
      return { ok: true, kind: "history", data: history };
    }

    if (command === "watch") {
      const setting = args[0];
      if (setting !== "on" && setting !== "off") throw new Error("watch expects on or off");
      runtime.watch = setting === "on";
      return { ok: true, kind: "watch", data: { watch: runtime.watch } };
    }

    if (command === "json") {
      const setting = args[0];
      if (setting !== "on" && setting !== "off") throw new Error("json expects on or off");
      runtime.json = setting === "on";
      return { ok: true, kind: "json", data: { json: runtime.json } };
    }

    if (command === "reset") return { ok: true, kind: "reset", data: runtime.session.reset(parseResetOptions(args)) };

    if (command === "eval") {
      const source = trimmed.slice("eval".length).trim();
      if (!source) return { ok: true, kind: "eval-start", message: "enter JavaScript, finish with .end" };
      const result = await evaluateInSession(runtime.session, source);
      return result.ok
        ? { ok: true, kind: "eval", data: result.value }
        : { ok: false, kind: "eval", message: result.error };
    }

    return { ok: false, kind: "error", message: `unknown command: ${command}` };
  } catch (error) {
    return { ok: false, kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeEvalBlock(runtime: ReplRuntime, source: string): Promise<ReplCommandResult> {
  const result = await evaluateInSession(runtime.session, source);
  return result.ok
    ? { ok: true, kind: "eval", data: result.value }
    : { ok: false, kind: "eval", message: result.error };
}

export function helpText() {
  return [
    "help",
    "status",
    "select x y | select x,y",
    "cell [x y]",
    "step [n]",
    "history [product|food|labor]",
    "orders [product|food|labor]",
    "trades [product|food|labor]",
    "watch on|off",
    "json on|off",
    "reset [--width n --height n]",
    "eval <js> | eval ... .end",
    "quit",
  ];
}

function compactJson(value: unknown) {
  return JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "number") return Number.isInteger(entry) ? entry : Number(entry.toFixed(4));
    return entry;
  }, 2);
}

function renderSummary(summary: PriceLogisticsSessionSummary) {
  return [
    `turn ${summary.turn} | orders 0 | trades ${summary.trades} | events ${summary.events}`,
    `nextOrderId ${summary.nextOrderId} | logisticsMoney ${summary.logisticsMoney}`,
    `totals money=${summary.totals.money} product=${summary.totals.product} food=${summary.totals.food} labor=${summary.totals.labor} factory=${summary.totals.factory} farm=${summary.totals.farm}`,
    `selected ${summary.selected ? `${summary.selected.x},${summary.selected.y}` : "-"}`,
  ].join("\n");
}

function renderCell(cell: CellDebugSnapshot) {
  return [
    `cell ${cell.x},${cell.y} turn ${cell.turn} account ${cell.account} ${cell.land ? "land" : "water"}`,
    `population ${cell.population.toFixed(2)} | malnutrition ${cell.malnutritionBurden.toFixed(3)} | foodConsumed ${cell.foodConsumed}`,
    `latest orders product ${cell.latestOrderPrices.productBid}/${cell.latestOrderPrices.productAsk} | food ${cell.latestOrderPrices.foodBid}/${cell.latestOrderPrices.foodAsk} | labor ${cell.latestOrderPrices.laborBid}/${cell.latestOrderPrices.laborAsk}`,
    `consumer money=${cell.balances.consumer.money} product=${cell.balances.consumer.product} food=${cell.balances.consumer.food} labor=${cell.balances.consumer.labor}`,
    `producer product=${cell.balances.producer.product} food=${cell.balances.producer.food} factory=${cell.balances.producer.factory}`,
    `farm food=${cell.balances.farm.food} farm=${cell.balances.farm.farm}`,
    `logistics product=${cell.balances.logistics.product} food=${cell.balances.logistics.food} moved=${cell.logistics.movedProduct}`,
  ].join("\n");
}

function summarizeOrder(order: OrderResult) {
  return `${order.side} ${order.agent} ${order.filled}/${order.quantity} @ ${order.price}${order.unfilled ? ` open=${order.unfilled}` : ""}`;
}

function summarizeTrade(trade: Trade) {
  return `${trade.buyer} <- ${trade.seller} ${trade.quantity} @ ${trade.price}`;
}

function renderHistory(data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return "no history";
  return data.map((tick) => {
    const orders = "orders" in tick && Array.isArray(tick.orders) && tick.orders.length > 0
      ? tick.orders.map(summarizeOrder).join("; ")
      : "-";
    const trades = "trades" in tick && Array.isArray(tick.trades) && tick.trades.length > 0
      ? tick.trades.map(summarizeTrade).join("; ")
      : "-";
    return `turn ${tick.turn}: orders ${orders} | trades ${trades}`;
  }).join("\n");
}

export function renderReplResult(runtime: ReplRuntime, result: ReplCommandResult) {
  if (runtime.json) return compactJson(result);
  if (!result.ok) return `error: ${result.message ?? "unknown error"}`;
  if (result.message) return result.message;
  if (result.kind === "empty") return "";
  if (result.kind === "help") return Array.isArray(result.data) ? result.data.join("\n") : "";
  if (result.kind === "status" || result.kind === "reset") return renderSummary(result.data as PriceLogisticsSessionSummary);
  if (result.kind === "step") {
    const data = result.data as { cell?: CellDebugSnapshot | null } & PriceLogisticsSessionSummary;
    return data.cell ? `${renderSummary(data)}\n\n${renderCell(data.cell)}` : renderSummary(data);
  }
  if (result.kind === "select") {
    const selected = result.data as { x: number; y: number };
    return `selected ${selected.x},${selected.y}`;
  }
  if (result.kind === "cell") return renderCell(result.data as CellDebugSnapshot);
  if (result.kind === "history" || result.kind === "orders" || result.kind === "trades") return renderHistory(result.data);
  if (result.kind === "watch" || result.kind === "json") return compactJson(result.data);
  if (result.kind === "eval") return result.data === undefined ? "undefined" : compactJson(result.data);
  return result.data === undefined ? "" : compactJson(result.data);
}
