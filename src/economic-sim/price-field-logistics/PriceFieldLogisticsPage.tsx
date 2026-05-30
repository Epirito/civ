import React, { useEffect, useMemo, useRef, useState } from "react";
import { DollarSign, Factory, FastForward, HeartPulse, Package, Pause, Play, RotateCcw, SkipForward, Users, Wheat } from "lucide-react";
import {
  FARM_PRODUCER_AGENT,
  LOGISTICS_AGENT,
  MONEY_ACCOUNT,
  PRODUCER_AGENT,
  accountOfCell,
  consumerAgentForCell,
  getLedgerBalance,
  logisticsCell,
  type PriceAgent,
  type PriceLogisticsCell,
  type PriceLogisticsEvent,
  type PriceLogisticsState,
  type PriceResource,
} from "./engine";
import type { Account } from "../shared/types";
import { effectiveProductBid, stepPriceLogistics } from "./agents";
import { createPriceLogisticsState } from "./scenario";
import { fieldCell } from "./priceFieldAutomaton";

type HeatmapMode =
  | "none"
  | "price:product"
  | "price:food"
  | "resource:money"
  | "resource:product"
  | "resource:food"
  | "resource:labor"
  | "resource:factory"
  | "resource:farm"
  | "malnutrition";

function cellResourceTotal(state: PriceLogisticsState, cell: PriceLogisticsCell, resource: PriceResource) {
  const account = accountOfCell(cell);
  const consumer = consumerAgentForCell(cell);
  if (resource === "money") {
    return getLedgerBalance(state.ledger, consumer, MONEY_ACCOUNT, "money");
  }
  return (
    getLedgerBalance(state.ledger, consumer, account, resource) +
    getLedgerBalance(state.ledger, PRODUCER_AGENT, account, resource) +
    getLedgerBalance(state.ledger, FARM_PRODUCER_AGENT, account, resource) +
    getLedgerBalance(state.ledger, LOGISTICS_AGENT, account, resource)
  );
}

function heatmapValue(state: PriceLogisticsState, cell: PriceLogisticsCell, mode: HeatmapMode) {
  if (mode === "price:product") return fieldCell(state.bidFields.product, cell.x, cell.y).price;
  if (mode === "price:food") return fieldCell(state.bidFields.food, cell.x, cell.y).price;
  if (mode === "malnutrition") return cell.malnutritionBurden;
  if (mode.startsWith("resource:")) return cellResourceTotal(state, cell, mode.slice("resource:".length) as PriceResource);
  return 0;
}

function heatColor(t: number, mode: HeatmapMode) {
  if (mode === "malnutrition") {
    return `rgba(${Math.round(58 + t * 197)}, ${Math.round(180 - t * 120)}, ${Math.round(75 - t * 45)}, 0.92)`;
  }
  return `rgba(${Math.round(28 + t * 208)}, ${Math.round(44 + t * 166)}, ${Math.round(68 + t * 20)}, 0.92)`;
}

function drawLogistics(canvas: HTMLCanvasElement, state: PriceLogisticsState, heatmap: HeatmapMode) {
  const parent = canvas.parentElement;
  if (!parent) return;
  const bounds = parent.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(bounds.width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(bounds.height * pixelRatio));
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#071014";
  context.fillRect(0, 0, bounds.width, bounds.height);

  const margin = 28;
  const cellSize = Math.floor(Math.min((bounds.width - margin * 2) / state.width, (bounds.height - margin * 2) / state.height));
  const gridWidth = state.width * cellSize;
  const gridHeight = state.height * cellSize;
  const originX = Math.floor((bounds.width - gridWidth) / 2);
  const originY = Math.floor((bounds.height - gridHeight) / 2);
  const maxHeat = Math.max(...state.cells.map((cell) => heatmapValue(state, cell, heatmap)), 1);

  context.save();
  context.translate(originX, originY);

  for (const cell of state.cells) {
    const x = cell.x * cellSize;
    const y = cell.y * cellSize;
    const field = fieldCell(state.bidFields.product, cell.x, cell.y);
    const heat = heatmapValue(state, cell, heatmap);
    const heatT = Math.max(0, Math.min(1, heat / maxHeat));
    context.fillStyle = !cell.land
      ? "#001836"
      : heatmap === "none"
        ? "#123022"
        : heatColor(heatT, heatmap);
    context.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    context.strokeStyle = "rgba(232, 238, 243, 0.08)";
    context.strokeRect(x + 0.5, y + 0.5, cellSize, cellSize);

    if (cell.localBid > 0) {
      context.fillStyle = "#38bdf8";
      context.fillRect(x + 3, y + 3, Math.max(4, cellSize * 0.2), Math.max(4, cellSize * 0.2));
    }
    if (cell.localAsk > 0) {
      context.fillStyle = "#f59e0b";
      context.fillRect(x + cellSize - Math.max(7, cellSize * 0.24), y + 3, Math.max(4, cellSize * 0.2), Math.max(4, cellSize * 0.2));
    }
    if (cell.population > 0) {
      const burden = Math.max(0, Math.min(1, cell.malnutritionBurden));
      context.fillStyle = burden > 0.4 ? "#ef4444" : "#22c55e";
      context.fillRect(x + 3, y + cellSize - Math.max(7, cellSize * 0.24), Math.max(4, cellSize * 0.2), Math.max(4, cellSize * 0.2));
    }
    if (cell.foodAsk > 0) {
      context.fillStyle = "#a3e635";
      context.beginPath();
      context.arc(x + cellSize - Math.max(7, cellSize * 0.22), y + cellSize - Math.max(7, cellSize * 0.22), Math.max(3, cellSize * 0.1), 0, Math.PI * 2);
      context.fill();
    }
    if (cell.logisticsStock > 0 || cell.movedStock > 0) {
      context.fillStyle = cell.movedStock > 0 ? "#fef08a" : "#ffffff";
      context.beginPath();
      context.arc(x + cellSize / 2, y + cellSize / 2, Math.max(3, cellSize * 0.13), 0, Math.PI * 2);
      context.fill();
    }
    if (cellSize >= 28 && (cell.localBid > 0 || cell.localAsk > 0 || cell.logisticsStock > 0)) {
      context.fillStyle = "rgba(255,255,255,0.88)";
      context.font = "10px ui-sans-serif, system-ui";
      context.textAlign = "center";
      context.fillText(
        `${Math.round(field.price)}/${cell.logisticsStock + cell.movedStock}`,
        x + cellSize / 2,
        y + cellSize - 7,
      );
    }
  }

  context.restore();
}

function eventLabel(event: PriceLogisticsEvent) {
  if (event.kind === "buy") return `buy ${event.x},${event.y} @ ${event.price}`;
  if (event.kind === "labor") return `labor ${event.quantity} at ${event.x},${event.y} @ ${event.price}`;
  if (event.kind === "sell") return `sell ${event.quantity} at ${event.x},${event.y} @ ${event.price}`;
  return `move ${event.fromX},${event.fromY} -> ${event.toX},${event.toY}`;
}

function cellFromPointer(canvas: HTMLCanvasElement, state: PriceLogisticsState, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  const margin = 28;
  const cellSize = Math.floor(Math.min((bounds.width - margin * 2) / state.width, (bounds.height - margin * 2) / state.height));
  if (cellSize <= 0) return null;
  const gridWidth = state.width * cellSize;
  const gridHeight = state.height * cellSize;
  const x = Math.floor((clientX - bounds.left - Math.floor((bounds.width - gridWidth) / 2)) / cellSize);
  const y = Math.floor((clientY - bounds.top - Math.floor((bounds.height - gridHeight) / 2)) / cellSize);
  return x >= 0 && y >= 0 && x < state.width && y < state.height ? { x, y } : null;
}

function CellHoverReadout({ state, cell }: { state: PriceLogisticsState; cell: PriceLogisticsCell | null }) {
  if (!cell) return <strong>{state.width} x {state.height} field logistics</strong>;
  const field = fieldCell(state.bidField, cell.x, cell.y);
  const bid = effectiveProductBid(cell);
  const account = accountOfCell(cell);
  const consumer = consumerAgentForCell(cell);
  const balance = (agent: PriceAgent, ledgerAccount: Account, resource: PriceResource) =>
    getLedgerBalance(state.ledger, agent, ledgerAccount, resource);
  return (
    <>
      <strong>Cell {cell.x},{cell.y}</strong>
      <div className="cell-hover-summary">
        <span><DollarSign size={13} />{Math.round(cell.consumerMoney)}</span>
        <span><Users size={13} />{cell.population.toFixed(1)}</span>
        <span><HeartPulse size={13} />{cell.malnutritionBurden.toFixed(2)}</span>
      </div>
      <div className="cell-resource-table">
        <div className="cell-resource-header">
          <span>Resource</span>
          <span>Price</span>
          <span>Consumer</span>
          <span>Producer</span>
          <span>Farm</span>
          <span>Logistics</span>
          <span>Last</span>
          <span>Signal</span>
        </div>
        <div className="cell-resource-row">
          <span><Package size={13} />Product</span>
          <span>bid {bid || "-"} / ask {cell.localAsk || "-"}</span>
          <span>{balance(consumer, account, "product")}</span>
          <span>{balance(PRODUCER_AGENT, account, "product")}</span>
          <span>{balance(FARM_PRODUCER_AGENT, account, "product")}</span>
          <span>{balance(LOGISTICS_AGENT, account, "product")}</span>
          <span>b {cell.lastBidFilled}/{cell.lastBidUnfilled}; a {cell.lastAskFilled}/{cell.lastAskUnfilled}; m {cell.movedStock}</span>
          <span>src {cell.fieldBid.toFixed(1)} x {cell.bidVolume.toFixed(1)}; field {field.price.toFixed(1)} x {field.volume.toFixed(1)}</span>
        </div>
        <div className="cell-resource-row">
          <span><Wheat size={13} />Food</span>
          <span>bid {cell.foodBid || "-"} / ask {cell.foodAsk || "-"}</span>
          <span>{balance(consumer, account, "food")}</span>
          <span>{balance(PRODUCER_AGENT, account, "food")}</span>
          <span>{balance(FARM_PRODUCER_AGENT, account, "food")}</span>
          <span>{balance(LOGISTICS_AGENT, account, "food")}</span>
          <span>b {cell.lastFoodBidFilled}/{cell.lastFoodBidUnfilled}; a {cell.lastFoodAskFilled}/{cell.lastFoodAskUnfilled}; ate {cell.foodConsumed.toFixed(1)}</span>
          <span>burden {cell.malnutritionBurden.toFixed(2)}</span>
        </div>
        <div className="cell-resource-row">
          <span><Users size={13} />Labor</span>
          <span>bid {cell.laborBid || "-"} / ask {cell.laborAsk || "-"}</span>
          <span>{balance(consumer, account, "labor")}</span>
          <span>{balance(PRODUCER_AGENT, account, "labor")}</span>
          <span>{balance(FARM_PRODUCER_AGENT, account, "labor")}</span>
          <span>{balance(LOGISTICS_AGENT, account, "labor")}</span>
          <span>b {cell.lastLaborBidFilled}/{cell.lastLaborBidUnfilled}; a {cell.lastLaborFilled}/{cell.lastLaborUnfilled}</span>
          <span>-</span>
        </div>
        <div className="cell-resource-row">
          <span><Factory size={13} />Factory</span>
          <span>-</span>
          <span>{balance(consumer, account, "factory")}</span>
          <span>{balance(PRODUCER_AGENT, account, "factory")}</span>
          <span>{balance(FARM_PRODUCER_AGENT, account, "factory")}</span>
          <span>{balance(LOGISTICS_AGENT, account, "factory")}</span>
          <span>-</span>
          <span>-</span>
        </div>
        <div className="cell-resource-row">
          <span><Wheat size={13} />Farm</span>
          <span>-</span>
          <span>{balance(consumer, account, "farm")}</span>
          <span>{balance(PRODUCER_AGENT, account, "farm")}</span>
          <span>{balance(FARM_PRODUCER_AGENT, account, "farm")}</span>
          <span>{balance(LOGISTICS_AGENT, account, "farm")}</span>
          <span>-</span>
          <span>-</span>
        </div>
        <div className="cell-resource-row">
          <span><DollarSign size={13} />Money</span>
          <span>-</span>
          <span>{Math.round(balance(consumer, MONEY_ACCOUNT, "money"))}</span>
          <span>{Math.round(balance(PRODUCER_AGENT, MONEY_ACCOUNT, "money"))}</span>
          <span>{Math.round(balance(FARM_PRODUCER_AGENT, MONEY_ACCOUNT, "money"))}</span>
          <span>{Math.round(balance(LOGISTICS_AGENT, MONEY_ACCOUNT, "money"))}</span>
          <span>-</span>
          <span>-</span>
        </div>
      </div>
      <span className="cell-channel-line">
        Channels {field.channels.map((channel) => `${channel.sourceId}:${channel.price.toFixed(1)}`).join(", ") || "-"}
      </span>
    </>
  );
}

export function PriceFieldLogisticsPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState(createPriceLogisticsState);
  const [running, setRunning] = useState(true);
  const [fast, setFast] = useState(false);
  const [heatmap, setHeatmap] = useState<HeatmapMode>("price:product");
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const totals = useMemo(
    () => ({
      producer: state.cells.reduce((sum, cell) => sum + cell.producerStock, 0),
      producerFood: state.cells.reduce((sum, cell) => sum + cell.producerFoodStock, 0),
      farmFood: state.cells.reduce((sum, cell) => sum + cell.farmProducerFoodStock, 0),
      logistics: state.cells.reduce((sum, cell) => sum + cell.logisticsStock, 0),
      logisticsFood: state.cells.reduce((sum, cell) => sum + cell.logisticsFoodStock, 0),
      moved: state.cells.reduce((sum, cell) => sum + cell.movedStock, 0),
      residualDemand: state.cells.reduce((sum, cell) => sum + cell.bidVolume, 0),
      population: state.cells.reduce((sum, cell) => sum + cell.population, 0),
      malnutrition: state.cells.reduce((sum, cell) => sum + cell.malnutritionBurden * cell.population, 0),
      foodConsumed: state.cells.reduce((sum, cell) => sum + cell.foodConsumed, 0),
      labor: state.cells.reduce((sum, cell) => sum + cell.laborStock, 0),
      consumerMoney: state.cells.reduce((sum, cell) => sum + cell.consumerMoney, 0),
    }),
    [state],
  );
  const hoveredCell = hover ? logisticsCell(state, hover.x, hover.y) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    drawLogistics(canvas, state, heatmap);
    const onResize = () => drawLogistics(canvas, state, heatmap);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [heatmap, state]);

  useEffect(() => {
    if (!running) return undefined;
    if (fast) {
      let frame = 0;
      const runFrame = () => {
        setState((current) => {
          let next = current;
          const startedAt = performance.now();
          let steps = 0;
          while (performance.now() - startedAt < 12 && steps < 100) {
            next = stepPriceLogistics(next);
            steps += 1;
          }
          return next;
        });
        frame = window.requestAnimationFrame(runFrame);
      };
      frame = window.requestAnimationFrame(runFrame);
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setInterval(() => setState((current) => stepPriceLogistics(current)), 450);
    return () => window.clearInterval(timer);
  }, [fast, running]);

  return (
    <main className="field-experiment-app">
      <aside className="field-panel">
        <section>
          <p className="eyebrow">Field logistics</p>
          <h1>Gradient trade</h1>
        </section>
        <section className="field-buttons" aria-label="Simulation controls">
          <button onClick={() => setRunning((current) => !current)}>{running ? <Pause size={18} /> : <Play size={18} />}</button>
          <button onClick={() => setState((current) => stepPriceLogistics(current))}>
            <SkipForward size={18} />
          </button>
          <button className={fast ? "active" : ""} onClick={() => setFast((current) => !current)} title="Run fast">
            <FastForward size={18} />
          </button>
          <button onClick={() => setState(createPriceLogisticsState())}>
            <RotateCcw size={18} />
          </button>
        </section>
        <section>
          <select value={heatmap} onChange={(event) => setHeatmap(event.target.value as HeatmapMode)} aria-label="Heatmap">
            <option value="none">No heatmap</option>
            <option value="price:product">Product price field</option>
            <option value="price:food">Food price field</option>
            <option value="resource:money">Money by cell</option>
            <option value="resource:product">Product by cell</option>
            <option value="resource:food">Food by cell</option>
            <option value="resource:labor">Labor by cell</option>
            <option value="resource:factory">Factory by cell</option>
            <option value="resource:farm">Farm by cell</option>
            <option value="malnutrition">Malnutrition</option>
          </select>
        </section>
        <section className="field-stats">
          <span>Turn</span>
          <strong>{state.turn}</strong>
          <span>Money</span>
          <strong>{Math.round(state.money)}</strong>
          <span>Producer</span>
          <strong>{totals.producer}</strong>
          <span>Logistics</span>
          <strong>{totals.logistics}</strong>
          <span>Moved</span>
          <strong>{totals.moved}</strong>
          <span>Residual</span>
          <strong>{totals.residualDemand.toFixed(1)}</strong>
          <span>Labor</span>
          <strong>{totals.labor}</strong>
          <span>Food</span>
          <strong>{Math.round(totals.producerFood + totals.farmFood + totals.logisticsFood)}/{totals.foodConsumed.toFixed(1)}</strong>
          <span>Malnut.</span>
          <strong>{totals.population > 0 ? (totals.malnutrition / totals.population).toFixed(2) : "0.00"}</strong>
          <span>Center</span>
          <strong>{Math.round(fieldCell(state.bidField, 9, 6).price)}</strong>
        </section>
        <section>
          <h2>Agent totals</h2>
          <div className="field-agent-table">
            <div className="field-agent-header">
              <span />
              <span>Money</span>
              <span>Product</span>
              <span>Food</span>
              <span>Moved</span>
              <span>Labor</span>
            </div>
            <div className="field-agent-row">
              <span><i style={{ background: "#f59e0b" }} />Producer</span>
              <span>{Math.round(state.producerMoney)}</span>
              <span>{totals.producer}</span>
              <span>{totals.producerFood}</span>
              <span>-</span>
              <span>-</span>
            </div>
            <div className="field-agent-row">
              <span><i style={{ background: "#a3e635" }} />Farm</span>
              <span>{Math.round(state.farmProducerMoney)}</span>
              <span>-</span>
              <span>{totals.farmFood}</span>
              <span>-</span>
              <span>-</span>
            </div>
            <div className="field-agent-row">
              <span><i style={{ background: "#ffffff" }} />Logistics</span>
              <span>{Math.round(state.money)}</span>
              <span>{totals.logistics}</span>
              <span>{totals.logisticsFood}</span>
              <span>{totals.moved}</span>
              <span>-</span>
            </div>
            <div className="field-agent-row">
              <span><i style={{ background: "#38bdf8" }} />Consumers</span>
              <span>{Math.round(totals.consumerMoney)}</span>
              <span>-</span>
              <span>{totals.foodConsumed.toFixed(1)}</span>
              <span>-</span>
              <span>{totals.labor.toFixed(1)}/{totals.population.toFixed(1)}</span>
            </div>
          </div>
        </section>
        <section className="field-source-list">
          {state.events.slice(0, 12).map((event, index) => (
            <button key={`${state.turn}-${index}`}>
              <span>{eventLabel(event)}</span>
            </button>
          ))}
        </section>
      </aside>
      <section className="field-canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label="Price-field logistics simulation"
          onPointerDown={(event) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            setHover(cellFromPointer(canvas, state, event.clientX, event.clientY));
          }}
          onPointerMove={(event) => {
            const canvas = canvasRef.current;
            if (canvas) setHover(cellFromPointer(canvas, state, event.clientX, event.clientY));
          }}
          onPointerLeave={() => setHover(null)}
        />
        <div className="readout sim-readout">
          <CellHoverReadout state={state} cell={hoveredCell} />
        </div>
      </section>
    </main>
  );
}
