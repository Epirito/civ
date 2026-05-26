import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward, Trash2 } from "lucide-react";
import {
  createPriceFieldState,
  fieldCell,
  maxFieldPrice,
  stepPriceField,
  totalFieldVolume,
  type PriceFieldSource,
  type PriceFieldState,
} from "./priceFieldAutomaton";

const FIELD_WIDTH = 28;
const FIELD_HEIGHT = 18;
const INITIAL_SOURCES: PriceFieldSource[] = [
  { x: 5, y: 4, price: 16, volume: 18, active: true },
  { x: 21, y: 13, price: 10, volume: 14, active: true },
];

function colorForCell(price: number, volume: number, maxPrice: number) {
  if (volume <= 0 || maxPrice <= 0) return "rgba(11, 25, 29, 1)";
  const priceT = Math.max(0, Math.min(1, price / maxPrice));
  const volumeT = Math.max(0, Math.min(1, Math.log1p(volume) / Math.log1p(18)));
  const green = Math.round(0);
  const red = Math.round(78 + priceT * 151);
  const blue = Math.round(volumeT * 255);
  return `rgba(${red}, ${green}, ${blue}, ${0.25 + volumeT * 0.72})`;
}

function drawPriceField(canvas: HTMLCanvasElement, state: PriceFieldState, sources: PriceFieldSource[]) {
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
  const gridWidth = cellSize * state.width;
  const gridHeight = cellSize * state.height;
  const originX = Math.floor((bounds.width - gridWidth) / 2);
  const originY = Math.floor((bounds.height - gridHeight) / 2);
  const maxPrice = maxFieldPrice(state);

  context.save();
  context.translate(originX, originY);

  for (const cell of state.cells) {
    const x = cell.x * cellSize;
    const y = cell.y * cellSize;
    context.fillStyle = colorForCell(cell.price, cell.volume, maxPrice);
    context.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    context.strokeStyle = "rgba(232, 238, 243, 0.08)";
    context.strokeRect(x + 0.5, y + 0.5, cellSize, cellSize);

    if (cell.volume > 0 && cellSize >= 22) {
      context.fillStyle = "rgba(255, 255, 255, 0.82)";
      context.font = "10px ui-sans-serif, system-ui";
      context.textAlign = "center";
      context.fillText(cell.volume.toFixed(cell.volume >= 10 ? 0 : 1), x + cellSize / 2, y + cellSize / 2 + 3);
    }

    if (cell.channels.length > 1 && cellSize >= 18) {
      const barWidth = (cellSize - 6) / 4;
      for (let channelIndex = 0; channelIndex < cell.channels.length; channelIndex += 1) {
        const channel = cell.channels[channelIndex];
        const channelT = Math.max(0., Math.min(1, channel.price / Math.max(1, maxPrice)));
        context.fillStyle = `rgba(255, 255, 255, ${channelT})`;
        context.fillRect(x + 3 + channelIndex * barWidth, y + cellSize - 5, Math.max(1, barWidth - 1), 2);
      }
    }
  }

  for (const source of sources) {
    const x = source.x * cellSize + cellSize / 2;
    const y = source.y * cellSize + cellSize / 2;
    context.fillStyle = source.active ? "#ffffff" : "rgba(255,255,255,0.32)";
    context.beginPath();
    context.arc(x, y, Math.max(5, cellSize * 0.18), 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = source.active ? "#facc15" : "rgba(250,204,21,0.4)";
    context.lineWidth = 2;
    context.stroke();
  }

  context.restore();
}

function cellFromPointer(canvas: HTMLCanvasElement, state: PriceFieldState, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  const margin = 28;
  const cellSize = Math.floor(Math.min((bounds.width - margin * 2) / state.width, (bounds.height - margin * 2) / state.height));
  if (cellSize <= 0) return null;
  const gridWidth = cellSize * state.width;
  const gridHeight = cellSize * state.height;
  const originX = Math.floor((bounds.width - gridWidth) / 2);
  const originY = Math.floor((bounds.height - gridHeight) / 2);
  const x = Math.floor((clientX - bounds.left - originX) / cellSize);
  const y = Math.floor((clientY - bounds.top - originY) / cellSize);
  return x >= 0 && x < state.width && y >= 0 && y < state.height ? { x, y } : null;
}

export function PriceFieldExperimentPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState(() => createPriceFieldState(FIELD_WIDTH, FIELD_HEIGHT));
  const [sources, setSources] = useState(INITIAL_SOURCES);
  const [running, setRunning] = useState(true);
  const [priceDecay, setPriceDecay] = useState(0.92);
  const [volumeDecay, setVolumeDecay] = useState(0.98);
  const [sourcePrice, setSourcePrice] = useState(14);
  const [sourceVolume, setSourceVolume] = useState(16);

  const options = useMemo(() => ({ priceDecay, volumeDecay }), [priceDecay, volumeDecay]);
  const activeVolume = totalFieldVolume(state);
  const activeCells = state.cells.filter((cell) => cell.volume > 0).length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    drawPriceField(canvas, state, sources);
    const onResize = () => drawPriceField(canvas, state, sources);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sources, state]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setState((current) => stepPriceField(current, sources, options));
    }, 180);
    return () => window.clearInterval(timer);
  }, [options, running, sources]);

  function reset() {
    setState(createPriceFieldState(FIELD_WIDTH, FIELD_HEIGHT));
    setSources(INITIAL_SOURCES);
  }

  function upsertSource(x: number, y: number) {
    setSources((current) => {
      const existing = current.find((source) => source.x === x && source.y === y);
      if (existing) {
        return current.map((source) => (source === existing ? { ...source, active: !source.active } : source));
      }
      return [...current, { x, y, price: sourcePrice, volume: sourceVolume, active: true }];
    });
  }

  function removeSource(x: number, y: number) {
    setSources((current) => current.filter((source) => source.x !== x || source.y !== y));
  }

  return (
    <main className="field-experiment-app">
      <aside className="field-panel">
        <section>
          <p className="eyebrow">Field CA</p>
          <h1>Price diffusion</h1>
        </section>
        <section className="field-buttons" aria-label="Simulation controls">
          <button onClick={() => setRunning((current) => !current)}>{running ? <Pause size={18} /> : <Play size={18} />}</button>
          <button onClick={() => setState((current) => stepPriceField(current, sources, options))}>
            <SkipForward size={18} />
          </button>
          <button onClick={reset}>
            <RotateCcw size={18} />
          </button>
        </section>
        <section className="field-stats">
          <span>Turn</span>
          <strong>{state.turn}</strong>
          <span>Volume</span>
          <strong>{activeVolume.toFixed(1)}</strong>
          <span>Active cells</span>
          <strong>{activeCells}</strong>
          <span>Center</span>
          <strong>{fieldCell(state, 14, 9).volume.toFixed(1)}</strong>
        </section>
        <section className="field-sliders">
          <label>
            <span>New price</span>
            <input
              type="range"
              min="1"
              max="32"
              step="1"
              value={sourcePrice}
              onChange={(event) => setSourcePrice(Number(event.target.value))}
            />
            <strong>{sourcePrice}</strong>
          </label>
          <label>
            <span>New volume</span>
            <input
              type="range"
              min="1"
              max="32"
              step="1"
              value={sourceVolume}
              onChange={(event) => setSourceVolume(Number(event.target.value))}
            />
            <strong>{sourceVolume}</strong>
          </label>
          <label>
            <span>Price decay</span>
            <input
              type="range"
              min="0.75"
              max="0.99"
              step="0.01"
              value={priceDecay}
              onChange={(event) => setPriceDecay(Number(event.target.value))}
            />
            <strong>{priceDecay.toFixed(2)}</strong>
          </label>
          <label>
            <span>Volume decay</span>
            <input
              type="range"
              min="0.75"
              max="1"
              step="0.01"
              value={volumeDecay}
              onChange={(event) => setVolumeDecay(Number(event.target.value))}
            />
            <strong>{volumeDecay.toFixed(2)}</strong>
          </label>
        </section>
        <section className="field-source-list">
          {sources.map((source, index) => (
            <button
              key={`${source.x},${source.y}`}
              className={source.active ? "active" : ""}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest(".field-remove-source")) return;
                setSources((current) =>
                  current.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, active: !entry.active } : entry,
                  ),
                );
              }}
            >
              <span>{source.x},{source.y}</span>
              <strong>{source.price}</strong>
              <i>{source.volume}</i>
              <span
                className="field-remove-source"
                role="button"
                tabIndex={0}
                onClick={() => removeSource(source.x, source.y)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") removeSource(source.x, source.y);
                }}
              >
                <Trash2 size={14} />
              </span>
            </button>
          ))}
        </section>
      </aside>
      <section className="field-canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label="Price field cellular automaton"
          onPointerDown={(event) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const cell = cellFromPointer(canvas, state, event.clientX, event.clientY);
            if (!cell) return;
            if (event.button === 2 || event.altKey) removeSource(cell.x, cell.y);
            else upsertSource(cell.x, cell.y);
          }}
          onContextMenu={(event) => event.preventDefault()}
        />
      </section>
    </main>
  );
}
