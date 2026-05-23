import { AGENT_COLORS, AGENTS, GRID_HEIGHT, GRID_WIDTH, agentFamily } from "./constants";
import { accountOf, parseAccount } from "./ledger";
import type { Account, Coord, SimState } from "./types";

export type ValueHeatmap = Map<Account, number>;
export type SimViewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type DrawSimOptions = {
  valueHeatmap?: ValueHeatmap;
  showRoadHeatmap?: boolean;
  viewport?: SimViewport;
};

function cellMetrics(state: SimState) {
  const metrics = new Map<
    Account,
    {
      logisticsWidgets: number;
      factories: number;
      population: number;
      road: number;
      powerGridInfrastructure: number;
      lastCongestion: number;
    }
  >();
  const ensure = (account: Account) => {
    const current = metrics.get(account) ?? {
      logisticsWidgets: 0,
      factories: 0,
      population: 0,
      road: 0,
      powerGridInfrastructure: 0,
      lastCongestion: 0,
    };
    metrics.set(account, current);
    return current;
  };

  for (const agent of AGENTS) {
    for (const [accountKey, resources] of Object.entries(state.ledger[agent])) {
      const account = accountKey as Account;
      if (account === "") continue;
      const metric = ensure(account);
      if (agentFamily(agent) === "Logistics") metric.logisticsWidgets += resources.widget ?? 0;
      metric.factories += resources.factory ?? 0;
      metric.population += resources.population ?? 0;
      if (agent === "Common") {
        metric.road += resources.road ?? 0;
        metric.powerGridInfrastructure += resources["power-grid-infrastructure"] ?? 0;
        metric.lastCongestion += resources["last-congestion"] ?? 0;
      }
    }
  }

  return metrics;
}

function heatmapIntensity(heatmap: ValueHeatmap, account: Account) {
  const value = heatmap.get(account);
  if (value === undefined) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (!Number.isFinite(value) || value <= 0) return 0;
  const finiteValues = [...heatmap.values()].filter((entry) => Number.isFinite(entry) && entry > 0);
  const maxValue = Math.max(...finiteValues, 1);
  return Math.min(1, value / maxValue);
}

function gridLayout(width: number, height: number) {
  const margin = 18;
  const cellSize = Math.floor(Math.min((width - margin * 2) / GRID_WIDTH, (height - margin * 2) / GRID_HEIGHT));
  const gridWidth = cellSize * GRID_WIDTH;
  const gridHeight = cellSize * GRID_HEIGHT;
  const originX = Math.floor((width - gridWidth) / 2);
  const originY = Math.floor((height - gridHeight) / 2);
  return { cellSize, gridWidth, gridHeight, originX, originY };
}

export function drawSim(canvas: HTMLCanvasElement, state: SimState, hover: Coord | null, options: DrawSimOptions = {}) {
  const parent = canvas.parentElement;
  if (!parent) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const bounds = parent.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(bounds.width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(bounds.height * pixelRatio));
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.fillStyle = "#08100f";
  context.fillRect(0, 0, bounds.width, bounds.height);

  const { valueHeatmap, showRoadHeatmap = false, viewport = { scale: 1, offsetX: 0, offsetY: 0 } } = options;
  const { cellSize, gridWidth, gridHeight, originX, originY } = gridLayout(bounds.width, bounds.height);
  const metrics = cellMetrics(state);

  context.save();
  context.translate(viewport.offsetX, viewport.offsetY);
  context.scale(viewport.scale, viewport.scale);
  context.lineWidth = 1;
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const account = accountOf(x, y);
      const metric = metrics.get(account);
      const px = originX + x * cellSize;
      const py = originY + y * cellSize;
      const logisticsWidgets = metric?.logisticsWidgets ?? 0;
      const population = metric?.population ?? 0;
      const factories = metric?.factories ?? 0;
      const road = metric?.road ?? 0;
      const powerGridInfrastructure = metric?.powerGridInfrastructure ?? 0;
      const lastCongestion = metric?.lastCongestion ?? 0;
      context.fillStyle = "#18312d";
      context.fillRect(px, py, cellSize - 1, cellSize - 1);
      if (showRoadHeatmap && road > 0) {
        const alpha = Math.min(0.65, 0.22 + road * 0.12);
        context.fillStyle = `rgba(148, 163, 184, ${alpha * 0.32})`;
        context.fillRect(px, py, cellSize - 1, cellSize - 1);
        context.strokeStyle = `rgba(203, 213, 225, ${alpha})`;
        context.lineWidth = 1;
        const spacing = Math.max(5, Math.floor(cellSize / 4));
        for (let gx = px + spacing; gx < px + cellSize - 1; gx += spacing) {
          context.beginPath();
          context.moveTo(gx, py + 2);
          context.lineTo(gx, py + cellSize - 3);
          context.stroke();
        }
        for (let gy = py + spacing; gy < py + cellSize - 1; gy += spacing) {
          context.beginPath();
          context.moveTo(px + 2, gy);
          context.lineTo(px + cellSize - 3, gy);
          context.stroke();
        }
        if (lastCongestion > 0) {
          context.fillStyle = `rgba(248, 113, 113, ${Math.min(0.44, 0.1 + lastCongestion * 0.04)})`;
          context.fillRect(px, py, cellSize - 1, cellSize - 1);
        }
      }
      if (powerGridInfrastructure > 0) {
        context.strokeStyle = `rgba(56, 189, 248, ${Math.min(0.82, 0.34 + powerGridInfrastructure * 0.12)})`;
        context.lineWidth = Math.max(1, Math.min(3, powerGridInfrastructure));
        context.beginPath();
        context.moveTo(px + cellSize * 0.18, py + cellSize * 0.5);
        context.lineTo(px + cellSize * 0.82, py + cellSize * 0.5);
        context.moveTo(px + cellSize * 0.5, py + cellSize * 0.18);
        context.lineTo(px + cellSize * 0.5, py + cellSize * 0.82);
        context.stroke();
      }
      if (valueHeatmap) {
        const intensity = heatmapIntensity(valueHeatmap, account);
        if (intensity > 0) {
          context.fillStyle = `rgba(250, 204, 21, ${0.18 + intensity * 0.52})`;
          context.fillRect(px, py, cellSize - 1, cellSize - 1);
        }
      }
      if (population > 0) {
        context.fillStyle = AGENT_COLORS.Consumer;
        context.beginPath();
        context.arc(px + cellSize * 0.28, py + cellSize * 0.7, Math.min(8, 2 + population), 0, Math.PI * 2);
        context.fill();
      }
      if (factories > 0) {
        context.fillStyle = AGENT_COLORS.Producer;
        context.fillRect(px + cellSize * 0.56, py + cellSize * 0.18, cellSize * 0.24, cellSize * 0.52);
      }
      if (logisticsWidgets > 0) {
        const badgeRadius = Math.max(6, Math.min(11, cellSize * 0.23));
        const badgeX = px + cellSize - badgeRadius - 2;
        const badgeY = py + badgeRadius + 2;
        context.fillStyle = AGENT_COLORS.Logistics;
        context.beginPath();
        context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
        context.fill();
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `${Math.max(9, Math.min(14, cellSize * 0.3))}px sans-serif`;
        context.fillText("⚙️", badgeX, badgeY);
        context.fillStyle = "#ffffff";
        context.font = `700 ${Math.max(8, Math.min(11, cellSize * 0.24))}px sans-serif`;
        context.fillText(String(logisticsWidgets), badgeX, badgeY + badgeRadius + 6);
      }
      if (hover?.x === x && hover.y === y) {
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2;
        context.strokeRect(px + 1, py + 1, cellSize - 3, cellSize - 3);
      }
    }
  }

  for (const transport of state.transports) {
    const path = transport.path.map(parseAccount).filter((coord): coord is Coord => coord !== null);
    if (path.length < 2) continue;
    context.strokeStyle = "rgba(167,139,250,0.7)";
    context.lineWidth = Math.max(1, Math.min(5, transport.quantity));
    context.beginPath();
    context.moveTo(originX + (path[0].x + 0.5) * cellSize, originY + (path[0].y + 0.5) * cellSize);
    for (const coord of path.slice(1)) {
      context.lineTo(originX + (coord.x + 0.5) * cellSize, originY + (coord.y + 0.5) * cellSize);
    }
    context.stroke();
  }

  context.strokeStyle = "rgba(232,238,243,0.12)";
  context.lineWidth = 1;
  for (let x = 0; x <= GRID_WIDTH; x += 1) {
    context.beginPath();
    context.moveTo(originX + x * cellSize, originY);
    context.lineTo(originX + x * cellSize, originY + gridHeight);
    context.stroke();
  }
  for (let y = 0; y <= GRID_HEIGHT; y += 1) {
    context.beginPath();
    context.moveTo(originX, originY + y * cellSize);
    context.lineTo(originX + gridWidth, originY + y * cellSize);
    context.stroke();
  }
  context.restore();
}

export function cellFromPointer(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  viewport: SimViewport = { scale: 1, offsetX: 0, offsetY: 0 },
) {
  const parent = canvas.parentElement;
  if (!parent) return null;
  const bounds = parent.getBoundingClientRect();
  const { cellSize, originX, originY } = gridLayout(bounds.width, bounds.height);
  const worldX = (clientX - bounds.left - viewport.offsetX) / viewport.scale;
  const worldY = (clientY - bounds.top - viewport.offsetY) / viewport.scale;
  const x = Math.floor((worldX - originX) / cellSize);
  const y = Math.floor((worldY - originY) / cellSize);
  return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT ? { x, y } : null;
}
