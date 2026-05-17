import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flame, Grid3X3, Move, Pause, Play, Rabbit, RotateCcw, StepForward, ZoomIn, ZoomOut } from "lucide-react";
import { cellFromPointer, drawSim, type SimViewport } from "./canvas";
import { AGENTS, GRID_HEIGHT, GRID_WIDTH, LOGISTICS_AGENTS, RESOURCES, agentColor } from "./constants";
import { stepSimulation } from "./engine";
import { accountOf, cellsWith, getBalance, totalAgentResource } from "./ledger";
import { createLogisticsMarketPlanner } from "./logisticsPlanner";
import { createInitialState } from "./scenario";
import type { Coord, Order, Resource, Side, Trade } from "./types";

function averageTradePrice(trades: Trade[]) {
  let quantity = 0;
  let value = 0;
  for (const trade of trades) {
    quantity += trade.quantity;
    value += trade.quantity * trade.price;
  }
  return quantity === 0 ? null : { quantity, price: value / quantity };
}

function orderSummary(orders: Order[], side: Side) {
  const matchingOrders = orders.filter((order) => order.side === side);
  let quantity = 0;
  let value = 0;
  for (const order of matchingOrders) {
    quantity += order.quantity;
    value += order.quantity * order.price;
  }
  if (quantity === 0) return null;
  return { quantity, price: value / quantity };
}

const visualizationLogisticsPlanner = createLogisticsMarketPlanner();
const INITIAL_VIEWPORT: SimViewport = { scale: 1, offsetX: 0, offsetY: 0 };
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;

function clampZoom(scale: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
}

export function EconomicSimPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState(createInitialState);
  const [running, setRunning] = useState(true);
  const [fastMode, setFastMode] = useState(false);
  const [hover, setHover] = useState<Coord | null>(null);
  const [showValueHeatmap, setShowValueHeatmap] = useState(false);
  const [showRoadHeatmap, setShowRoadHeatmap] = useState(false);
  const [viewport, setViewport] = useState<SimViewport>(INITIAL_VIEWPORT);
  const panRef = useRef<{ pointerId: number; x: number; y: number; viewport: SimViewport } | null>(null);

  const modeledValueByCell = useMemo(
    () =>
      visualizationLogisticsPlanner.valueByCell(
        {
          balance: (account, resource) =>
            LOGISTICS_AGENTS.reduce((sum, agent) => sum + getBalance(state.ledger, agent, account, resource), 0),
          observeCells: (agent, resource) => cellsWith(state.ledger, agent, resource),
        },
        state.trades,
      ),
    [state.ledger, state.trades],
  );
  const drawOptions = useMemo(
    () => ({
      valueHeatmap: showValueHeatmap ? modeledValueByCell : undefined,
      showRoadHeatmap,
      viewport,
    }),
    [modeledValueByCell, showRoadHeatmap, showValueHeatmap, viewport],
  );

  useEffect(() => {
    if (!running) return undefined;
    if (fastMode) {
      let frame = window.requestAnimationFrame(function step() {
        setState(stepSimulation);
        frame = window.requestAnimationFrame(step);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const interval = window.setInterval(() => setState(stepSimulation), 650);
    return () => window.clearInterval(interval);
  }, [fastMode, running]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawSim(canvas, state, hover, drawOptions);
  }, [drawOptions, hover, state]);

  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current;
      if (canvas) drawSim(canvas, state, hover, drawOptions);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawOptions, hover, state]);

  useEffect(() => {
    console.log("Economic sim turn", state.turn);
  }, [state.turn]);

  const agentTotals = useMemo(
    () =>
      AGENTS.map((agent) => ({
        agent,
        totals: Object.fromEntries(
          RESOURCES.map((resource) => [resource, totalAgentResource(state.ledger, agent, resource)]),
        ) as Record<Resource, number>,
      })),
    [state.ledger],
  );

  const hoverAccount = hover ? accountOf(hover.x, hover.y) : null;
  const hoverLines = hoverAccount
    ? (() => {
        const [hoverX, hoverY] = hoverAccount.split(",").map(Number);
        const cellTrades = state.trades.filter((trade) => trade.x === hoverX && trade.y === hoverY);
        const cellOrders = state.orders.filter((order) => order.account === hoverAccount);
        const averageTrade = averageTradePrice(cellTrades);
        const lastBid = orderSummary(cellOrders, "bid");
        const lastAsk = orderSummary(cellOrders, "ask");
        const modeledValue = modeledValueByCell.get(hoverAccount);
        const road = getBalance(state.ledger, "Common", hoverAccount, "road");
        const congestion = getBalance(state.ledger, "Common", hoverAccount, "congestion");
        const lastCongestion = getBalance(state.ledger, "Common", hoverAccount, "last-congestion");
        const modeledValueText =
          modeledValue === undefined
            ? null
            : modeledValue === Number.POSITIVE_INFINITY
              ? "Modeled widget value: unknown"
              : `Modeled widget value: ${modeledValue.toFixed(1)}`;
        return [
          ...AGENTS.map((agent) => {
            const widgets = getBalance(state.ledger, agent, hoverAccount, "widget");
            const factories = getBalance(state.ledger, agent, hoverAccount, "factory");
            const population = getBalance(state.ledger, agent, hoverAccount, "population");
            return `${agent}: ${widgets} widget, ${factories} factory, ${population} population`;
          }),
          ...(modeledValueText ? [modeledValueText] : []),
          `Road: ${road}, congestion: ${congestion}, last: ${lastCongestion}`,
          ...(lastBid ? [`Last bid avg: ${lastBid.price.toFixed(1)} over ${lastBid.quantity}`] : []),
          ...(lastAsk ? [`Last ask avg: ${lastAsk.price.toFixed(1)} over ${lastAsk.quantity}`] : []),
          ...(averageTrade ? [`Last trade avg: ${averageTrade.price.toFixed(1)} over ${averageTrade.quantity}`] : []),
        ];
      })()
    : ["Hover a cell to inspect balances"];

  return (
    <main className="sim-app">
      <aside className="panel sim-panel">
        <div>
          <p className="eyebrow">Agent economic sim</p>
          <h1>Grid markets, locked orders, and logistics flows</h1>
        </div>

        <div className="status">
          <span>Turn {state.turn}</span>
          <strong>{state.note}</strong>
        </div>

        <section>
          <h2>Controls</h2>
          <div className="controls sim-controls">
            <button onClick={() => setRunning((value) => !value)} title={running ? "Pause" : "Run"}>
              {running ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={() => setState(stepSimulation)} title="Step one turn">
              <StepForward size={18} />
            </button>
            <button onClick={() => setState(createInitialState())} title="Reset simulation">
              <RotateCcw size={18} />
            </button>
            <button
              className={showValueHeatmap ? "active" : undefined}
              onClick={() => setShowValueHeatmap((value) => !value)}
              title="Toggle modeled widget value heatmap"
            >
              <Flame size={18} />
            </button>
            <button
              className={showRoadHeatmap ? "active" : undefined}
              onClick={() => setShowRoadHeatmap((value) => !value)}
              title="Toggle road heatmap"
            >
              <Grid3X3 size={18} />
            </button>
            <button
              className={fastMode ? "active" : undefined}
              onClick={() => setFastMode((value) => !value)}
              title="Run as fast as possible while rendering each state"
            >
              <Rabbit size={18} />
            </button>
            <button
              onClick={() => setViewport((value) => ({ ...value, scale: clampZoom(value.scale * 1.2) }))}
              title="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => setViewport((value) => ({ ...value, scale: clampZoom(value.scale / 1.2) }))}
              title="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <button onClick={() => setViewport(INITIAL_VIEWPORT)} title="Reset view">
              <Move size={18} />
            </button>
          </div>
        </section>

        <section>
          <h2>Agents</h2>
          <div className="sim-legend">
            {AGENTS.map((agent) => (
              <div key={agent}>
                <span className="swatch" style={{ background: agentColor(agent) }} />
                <span>{agent}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Agent totals</h2>
          <div className="agent-resource-table">
            <div className="agent-resource-header">
              <span />
              <span>Money</span>
              <span>Widgets</span>
              <span>Factories</span>
              <span>Pop</span>
              <span>Road</span>
              <span>Cong</span>
              <span>Last</span>
            </div>
            {agentTotals.map(({ agent, totals: row }) => (
              <div className="agent-resource-row" key={agent}>
                <span>
                  <i style={{ background: agentColor(agent) }} />
                  {agent}
                </span>
                <span>{row.money}</span>
                <span>{row.widget}</span>
                <span>{row.factory}</span>
                <span>{row.population}</span>
                <span>{row.road}</span>
                <span>{row.congestion}</span>
                <span>{row["last-congestion"]}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="note">
          Bids reserve money from the abstract account, asks reserve widgets from the cell account, and every
          unmatched reserve is refunded after clearing. Transport follows the cheapest road-adjusted path and records
          congestion on Common-owned cells.
        </p>
      </aside>

      <section className="sim-stage">
        <canvas
          ref={canvasRef}
          onWheel={(event) => {
            event.preventDefault();
            const canvas = canvasRef.current;
            if (!canvas) return;
            const bounds = canvas.getBoundingClientRect();
            const pointerX = event.clientX - bounds.left;
            const pointerY = event.clientY - bounds.top;
            setViewport((current) => {
              const nextScale = clampZoom(current.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
              const worldX = (pointerX - current.offsetX) / current.scale;
              const worldY = (pointerY - current.offsetY) / current.scale;
              return {
                scale: nextScale,
                offsetX: pointerX - worldX * nextScale,
                offsetY: pointerY - worldY * nextScale,
              };
            });
          }}
          onPointerDown={(event) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport };
            canvas.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const canvas = canvasRef.current;
            const pan = panRef.current;
            if (pan?.pointerId === event.pointerId) {
              setViewport({
                ...pan.viewport,
                offsetX: pan.viewport.offsetX + event.clientX - pan.x,
                offsetY: pan.viewport.offsetY + event.clientY - pan.y,
              });
            }
            if (canvas) setHover(cellFromPointer(canvas, event.clientX, event.clientY, viewport));
          }}
          onPointerUp={(event) => {
            if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
          }}
          onPointerCancel={(event) => {
            if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
          }}
          onPointerLeave={() => {
            setHover(null);
          }}
        />
        <div className="readout sim-readout">
          <strong>{hoverAccount ? `Cell ${hoverAccount}` : `${GRID_WIDTH} x ${GRID_HEIGHT} world`}</strong>
          {hoverLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </section>
    </main>
  );
}
