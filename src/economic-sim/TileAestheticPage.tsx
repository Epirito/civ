import React, { useEffect, useRef } from "react";
import { hash, OCEAN, OCEAN_DARK, regionBlocks, shade, TILE_STUDY_COLUMNS, TILE_STUDY_ROWS } from "./tileStudyData";

const TILE_EDGE = "rgba(4, 11, 17, 0.66)";

function drawTile(context: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const gap = size >= 13 ? 1 : 0;
  const px = x + gap * 0.5;
  const py = y + gap * 0.5;
  const tileSize = size - gap;
  const noise = hash(x, y) % 1;
  const lift = Math.round((noise - 0.5) * 7);

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.44)";
  context.shadowBlur = size * 0.1;
  context.shadowOffsetX = Math.max(1, size * 0.04);
  context.shadowOffsetY = Math.max(1, size * 0.06);
  context.fillStyle = shade(color, lift);
  context.fillRect(px, py, tileSize, tileSize);
  context.restore();

  const faceLight = context.createLinearGradient(px, py, px + tileSize, py + tileSize);
  faceLight.addColorStop(0, "rgba(255, 255, 255, 0.05)");
  faceLight.addColorStop(0.58, "rgba(255, 255, 255, 0)");
  faceLight.addColorStop(1, "rgba(0, 0, 0, 0.13)");
  context.fillStyle = faceLight;
  context.fillRect(px + 1, py + 1, Math.max(0, tileSize - 2), Math.max(0, tileSize - 2));

  context.strokeStyle = "rgba(255, 255, 255, 0.1)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(px + 1.5, py + tileSize - 1.5);
  context.lineTo(px + 1.5, py + 1.5);
  context.lineTo(px + tileSize - 1.5, py + 1.5);
  context.stroke();

  context.strokeStyle = "rgba(0, 0, 0, 0.2)";
  context.beginPath();
  context.moveTo(px + tileSize - 1.5, py + 1.5);
  context.lineTo(px + tileSize - 1.5, py + tileSize - 1.5);
  context.lineTo(px + 1.5, py + tileSize - 1.5);
  context.stroke();

  context.strokeStyle = TILE_EDGE;
  context.lineWidth = 1;
  context.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);

  const fleckSize = Math.max(1, Math.round(size * 0.06));
  context.fillStyle = "rgba(255, 255, 255, 0.055)";
  context.fillRect(px + tileSize * 0.24, py + tileSize * 0.2, fleckSize, fleckSize);
  context.fillStyle = "rgba(0, 0, 0, 0.085)";
  context.fillRect(px + tileSize * 0.7, py + tileSize * 0.72, fleckSize, fleckSize);
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, tileSize: number) {
  const gradient = context.createRadialGradient(width * 0.52, height * 0.44, 0, width * 0.52, height * 0.44, width * 0.76);
  gradient.addColorStop(0, OCEAN);
  gradient.addColorStop(1, OCEAN_DARK);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.34;
  context.strokeStyle = "#0a3156";
  context.lineWidth = 1;
  for (let x = 0; x < width; x += tileSize) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += tileSize) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.globalAlpha = 0.22;
  context.setLineDash([1, 7]);
  for (let x = tileSize / 2; x < width; x += tileSize) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = tileSize / 2; y < height; y += tileSize) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

function drawTileStudy(canvas: HTMLCanvasElement) {
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

  const tileSize = Math.max(11, Math.floor(Math.min(bounds.width / TILE_STUDY_COLUMNS, bounds.height / TILE_STUDY_ROWS)));
  const gridWidth = TILE_STUDY_COLUMNS * tileSize;
  const gridHeight = TILE_STUDY_ROWS * tileSize;
  const originX = Math.floor((bounds.width - gridWidth) / 2);
  const originY = Math.floor((bounds.height - gridHeight) / 2) + Math.floor(tileSize * 0.4);

  drawBackground(context, bounds.width, bounds.height, tileSize);

  context.save();
  context.translate(originX, originY);
  for (const block of regionBlocks()) {
    drawTile(context, block.x * tileSize, block.y * tileSize, tileSize, block.color);
  }
  context.restore();

  context.save();
  context.globalCompositeOperation = "screen";
  const light = context.createLinearGradient(0, 0, bounds.width, bounds.height);
  light.addColorStop(0, "rgba(180, 210, 255, 0.16)");
  light.addColorStop(0.42, "rgba(255, 214, 102, 0.04)");
  light.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = light;
  context.fillRect(0, 0, bounds.width, bounds.height);
  context.restore();
}

export function TileAestheticPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    drawTileStudy(canvas);
    const onResize = () => drawTileStudy(canvas);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <main className="tile-study-app">
      <canvas ref={canvasRef} aria-label="Economic tile aesthetic study" />
    </main>
  );
}
