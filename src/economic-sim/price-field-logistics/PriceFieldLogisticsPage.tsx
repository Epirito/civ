import React, { useEffect, useMemo, useRef, useState } from "react";
import { DollarSign, Factory, FastForward, Package, Pause, Play, RotateCcw, SkipForward, Users } from "lucide-react";
import {
  effectiveProductBid,
  logisticsCell,
  type PriceLogisticsCell,
  type PriceLogisticsEvent,
  type PriceLogisticsState,
} from "./engine";
import { stepPriceLogistics } from "./agents";
import { createPriceLogisticsState } from "./scenario";
import { fieldCell } from "../priceFieldAutomaton";

function drawLogistics(canvas: HTMLCanvasElement, state: PriceLogisticsState) {
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
  const maxBid = state.bidField.cells.reduce((max, cell) => Math.max(max, cell.price), 1);

  context.save();
  context.translate(originX, originY);

  for (const cell of state.cells) {
    const x = cell.x * cellSize;
    const y = cell.y * cellSize;
    const field = fieldCell(state.bidField, cell.x, cell.y);
    const bidT = Math.max(0, Math.min(1, field.price / maxBid));
    context.fillStyle = `rgba(${Math.round(28 + bidT * 208)}, ${Math.round(44 + bidT * 166)}, ${Math.round(68 + bidT * 20)}, 0.92)`;
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
      context.fillStyle = "#22c55e";
      context.fillRect(x + 3, y + cellSize - Math.max(7, cellSize * 0.24), Math.max(4, cellSize * 0.2), Math.max(4, cellSize * 0.2));
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
  return (
    <>
      <strong>Cell {cell.x},{cell.y}</strong>
      <div className="cell-hover-summary">
        <span><DollarSign size={13} />{Math.round(cell.consumerMoney)}</span>
        <span><Users size={13} />{cell.population}</span>
        <span><Factory size={13} />{cell.localAsk || "-"}</span>
      </div>
      <div className="cell-resource-table">
        <div className="cell-resource-header">
          <span>Resource</span>
          <span>Price</span>
          <span>Consumer</span>
          <span>Producer</span>
          <span>Logistics</span>
          <span>Last</span>
          <span>Signal</span>
        </div>
        <div className="cell-resource-row">
          <span><Package size={13} />Product</span>
          <span>bid {bid || "-"} / ask {cell.localAsk || "-"}</span>
          <span>demand {cell.bidVolume}</span>
          <span>{cell.producerStock}</span>
          <span>{cell.logisticsStock}+{cell.movedStock}</span>
          <span>b {cell.lastBidFilled}/{cell.lastBidUnfilled}; a {cell.lastAskFilled}/{cell.lastAskUnfilled}</span>
          <span>{field.price.toFixed(1)} x {field.volume.toFixed(1)}</span>
        </div>
        <div className="cell-resource-row">
          <span><Users size={13} />Labor</span>
          <span>ask {cell.laborAsk || "-"}</span>
          <span>{cell.laborStock}/{cell.population}</span>
          <span>-</span>
          <span>-</span>
          <span>{cell.lastLaborFilled}/{cell.lastLaborUnfilled}</span>
          <span>-</span>
        </div>
        <div className="cell-resource-row">
          <span><DollarSign size={13} />Money</span>
          <span>-</span>
          <span>{Math.round(cell.consumerMoney)}</span>
          <span>{Math.round(state.producerMoney)}</span>
          <span>{Math.round(state.money)}</span>
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
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const totals = useMemo(
    () => ({
      producer: state.cells.reduce((sum, cell) => sum + cell.producerStock, 0),
      logistics: state.cells.reduce((sum, cell) => sum + cell.logisticsStock, 0),
      moved: state.cells.reduce((sum, cell) => sum + cell.movedStock, 0),
      demand: state.cells.reduce((sum, cell) => sum + cell.bidVolume, 0),
      population: state.cells.reduce((sum, cell) => sum + cell.population, 0),
      labor: state.cells.reduce((sum, cell) => sum + cell.laborStock, 0),
      consumerMoney: state.cells.reduce((sum, cell) => sum + cell.consumerMoney, 0),
    }),
    [state],
  );
  const hoveredCell = hover ? logisticsCell(state, hover.x, hover.y) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    drawLogistics(canvas, state);
    const onResize = () => drawLogistics(canvas, state);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [state]);

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
          <span>Demand</span>
          <strong>{totals.demand}</strong>
          <span>Labor</span>
          <strong>{totals.labor}</strong>
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
              <span>Moved</span>
              <span>Demand</span>
              <span>Labor</span>
            </div>
            <div className="field-agent-row">
              <span><i style={{ background: "#f59e0b" }} />Producer</span>
              <span>{Math.round(state.producerMoney)}</span>
              <span>{totals.producer}</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
            </div>
            <div className="field-agent-row">
              <span><i style={{ background: "#ffffff" }} />Logistics</span>
              <span>{Math.round(state.money)}</span>
              <span>{totals.logistics}</span>
              <span>{totals.moved}</span>
              <span>-</span>
              <span>-</span>
            </div>
            <div className="field-agent-row">
              <span><i style={{ background: "#38bdf8" }} />Consumers</span>
              <span>{Math.round(totals.consumerMoney)}</span>
              <span>-</span>
              <span>-</span>
              <span>{totals.demand}</span>
              <span>{totals.labor}/{totals.population}</span>
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
