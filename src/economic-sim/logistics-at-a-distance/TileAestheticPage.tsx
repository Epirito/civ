import React, { useEffect, useRef } from "react";
import { OCEAN, regionBlocks, TILE_STUDY_COLUMNS, TILE_STUDY_ROWS } from "./tileStudyData";

function drawTile(context: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const gap = size >= 13 ? 1 : 0;
  const px = x + gap * 0.5;
  const py = y + gap * 0.5;
  const tileSize = size - gap;

  context.fillStyle = color;
  context.fillRect(px, py, tileSize, tileSize);
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
  context.fillStyle = OCEAN;
  context.fillRect(0, 0, bounds.width, bounds.height);

  const tileSize = Math.max(11, Math.floor(Math.min(bounds.width / TILE_STUDY_COLUMNS, bounds.height / TILE_STUDY_ROWS)));
  const gridWidth = TILE_STUDY_COLUMNS * tileSize;
  const gridHeight = TILE_STUDY_ROWS * tileSize;
  const originX = Math.floor((bounds.width - gridWidth) / 2);
  const originY = Math.floor((bounds.height - gridHeight) / 2) + Math.floor(tileSize * 0.4);

  context.save();
  context.translate(originX, originY);
  for (const block of regionBlocks()) {
    drawTile(context, block.x * tileSize, block.y * tileSize, tileSize, block.color);
  }
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
      <canvas ref={canvasRef} aria-label="Economic tile color palette study" />
    </main>
  );
}
