import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { fromArrayBuffer } from "geotiff";
import { Activity, BarChart3, Blocks, Box, Eye, EyeOff, LocateFixed, Map, Minus, Plus, RotateCcw, Truck } from "lucide-react";
import {
  EconomicSimPage,
  OneCellPriceFieldLogisticsPage,
  PriceFieldExperimentPage,
  PriceFieldLogisticsPage,
  TileAesthetic3DPage,
  TileAestheticPage,
} from "./economic-sim";
import "./styles.css";

type Position = [number, number];

type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

type Feature = {
  type: "Feature";
  geometry: Geometry | null;
  properties: Record<string, unknown>;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

type LayerKey =
  | "worldpopDensity"
  | "worldpopTotal"
  | "agriculture"
  | "countries"
  | "criticalMinerals"
  | "majorDeposits";

type View = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

type AgricultureManifest = {
  files: Array<{
    label: string;
    url: string;
  }>;
};

type RasterOverlay = {
  label: string;
  canvas: HTMLCanvasElement;
  bounds: [number, number, number, number];
};

const DATA = {
  countries: "/data/countries.geojson",
  criticalMinerals: "/data/critical-minerals.geojson",
  majorDeposits: "/data/major-deposits.geojson",
  worldpopDensity: "/data/worldpop-density.png",
  worldpopTotal: "/data/worldpop-total.png",
  agriculture: "/data/mapspam-harvested-render.json",
  manifest: "/data/manifest.json",
};

const LAYERS: Array<{
  key: LayerKey;
  label: string;
  color: string;
}> = [
  { key: "worldpopDensity", label: "Population density", color: "#f2c94c" },
  { key: "worldpopTotal", label: "Population count", color: "#7dd3fc" },
  { key: "agriculture", label: "Agriculture", color: "#9dc44d" },
  { key: "countries", label: "Borders", color: "#e8eef3" },
  { key: "criticalMinerals", label: "Critical minerals", color: "#ef476f" },
  { key: "majorDeposits", label: "Major deposits", color: "#06d6a0" },
];

const INITIAL_VIEW: View = { zoom: 1, offsetX: 0, offsetY: 0 };

function project(lon: number, lat: number, width: number, height: number, view: View) {
  const baseScale = Math.min(width / 360, height / 170);
  const x = (lon + 180) * baseScale;
  const y = (85 - Math.max(-85, Math.min(85, lat))) * baseScale;
  const mapWidth = 360 * baseScale;
  const mapHeight = 170 * baseScale;
  return {
    x: (x - mapWidth / 2) * view.zoom + width / 2 + view.offsetX,
    y: (y - mapHeight / 2) * view.zoom + height / 2 + view.offsetY,
  };
}

function drawPolygonPath(
  context: CanvasRenderingContext2D,
  rings: Position[][],
  width: number,
  height: number,
  view: View,
) {
  for (const ring of rings) {
    ring.forEach(([lon, lat], index) => {
      const point = project(lon, lat, width, height, view);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
  }
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

async function loadOptionalJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function colorAgriculture(value: number, max: number) {
  const scaled = Math.max(0, Math.min(1, Math.log1p(value) / Math.log1p(max)));
  const low = [33, 95, 73];
  const mid = [157, 196, 77];
  const high = [255, 213, 91];
  const from = scaled < 0.62 ? low : mid;
  const to = scaled < 0.62 ? mid : high;
  const t = scaled < 0.62 ? scaled / 0.62 : (scaled - 0.62) / 0.38;

  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
    Math.round(40 + scaled * 205),
  ];
}

async function loadAgricultureRaster(file: AgricultureManifest["files"][number]): Promise<RasterOverlay> {
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Could not load ${file.url}`);

  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const width = 720;
  const height = Math.max(1, Math.round((width * image.getHeight()) / image.getWidth()));
  const raster = await image.readRasters({
    samples: [0],
    interleave: true,
    width,
    height,
    resampleMethod: "bilinear",
  });
  const values = Array.from(raster as ArrayLike<number>).filter((value) => Number.isFinite(value) && value > 0);
  values.sort((a, b) => a - b);
  const max = values[Math.max(0, Math.floor(values.length * 0.995) - 1)] || 1;
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");

  if (!context) throw new Error("Canvas is unavailable");

  const imageData = context.createImageData(width, height);
  for (let index = 0; index < width * height; index += 1) {
    const value = Number((raster as ArrayLike<number>)[index]);
    const offset = index * 4;
    if (!Number.isFinite(value) || value <= 0) {
      imageData.data[offset + 3] = 0;
      continue;
    }

    const [red, green, blue, alpha] = colorAgriculture(value, max);
    imageData.data[offset] = red;
    imageData.data[offset + 1] = green;
    imageData.data[offset + 2] = blue;
    imageData.data[offset + 3] = alpha;
  }
  context.putImageData(imageData, 0, 0);

  return {
    label: file.label,
    canvas: output,
    bounds: image.getBoundingBox() as [number, number, number, number],
  };
}

function GeoMapPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const [countries, setCountries] = useState<FeatureCollection | null>(null);
  const [criticalMinerals, setCriticalMinerals] = useState<FeatureCollection | null>(null);
  const [majorDeposits, setMajorDeposits] = useState<FeatureCollection | null>(null);
  const [densityImage, setDensityImage] = useState<HTMLImageElement | null>(null);
  const [totalImage, setTotalImage] = useState<HTMLImageElement | null>(null);
  const [agricultureRasters, setAgricultureRasters] = useState<RasterOverlay[]>([]);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [active, setActive] = useState<Record<LayerKey, boolean>>({
    worldpopDensity: true,
    worldpopTotal: false,
    agriculture: true,
    countries: true,
    criticalMinerals: true,
    majorDeposits: true,
  });
  const [hover, setHover] = useState<string>("Move across mineral points");
  const [status, setStatus] = useState("Loading data");

  useEffect(() => {
    Promise.all([
      loadJson<FeatureCollection>(DATA.countries),
      loadJson<FeatureCollection>(DATA.criticalMinerals),
      loadJson<FeatureCollection>(DATA.majorDeposits),
      loadImage(DATA.worldpopDensity),
      loadImage(DATA.worldpopTotal),
      loadOptionalJson<AgricultureManifest>(DATA.agriculture),
      loadJson<unknown>(DATA.manifest),
    ])
      .then(async ([countryData, criticalData, depositsData, density, total, agriculture]) => {
        setCountries(countryData);
        setCriticalMinerals(criticalData);
        setMajorDeposits(depositsData);
        setDensityImage(density);
        setTotalImage(total);
        if (agriculture) {
          const rasters = await Promise.all(agriculture.files.map(loadAgricultureRaster));
          setAgricultureRasters(rasters);
          setStatus("Ready");
        } else {
          setStatus("Ready; agriculture GeoTIFF not downloaded yet");
        }
      })
      .catch((error: Error) => setStatus(error.message));
  }, []);

  const counts = useMemo(
    () => ({
      countries: countries?.features.length ?? 0,
      criticalMinerals: criticalMinerals?.features.length ?? 0,
      majorDeposits: majorDeposits?.features.length ?? 0,
      agriculture: agricultureRasters.length,
    }),
    [agricultureRasters.length, countries, criticalMinerals, majorDeposits],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const bounds = wrap.getBoundingClientRect();
    canvas.width = bounds.width * pixelRatio;
    canvas.height = bounds.height * pixelRatio;
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = "#071014";
    context.fillRect(0, 0, bounds.width, bounds.height);

    const drawRaster = (image: HTMLImageElement, alpha: number) => {
      const nw = project(-180, 85, bounds.width, bounds.height, view);
      const se = project(180, -60, bounds.width, bounds.height, view);
      context.globalAlpha = alpha;
      context.drawImage(image, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
      context.globalAlpha = 1;
    };

    if (active.worldpopTotal && totalImage) drawRaster(totalImage, 0.55);
    if (active.worldpopDensity && densityImage) drawRaster(densityImage, 0.5);

    if (active.agriculture) {
      context.save();
      context.globalCompositeOperation = "screen";
      for (const raster of agricultureRasters) {
        const [minLon, minLat, maxLon, maxLat] = raster.bounds;
        const nw = project(minLon, maxLat, bounds.width, bounds.height, view);
        const se = project(maxLon, minLat, bounds.width, bounds.height, view);
        context.drawImage(raster.canvas, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
      }
      context.restore();
    }

    if (active.countries && countries) {
      context.save();
      context.strokeStyle = "rgba(232,238,243,0.58)";
      context.lineWidth = Math.max(0.45, 0.8 / view.zoom);
      context.beginPath();
      for (const feature of countries.features) {
        if (!feature.geometry) continue;
        if (feature.geometry.type === "Polygon") {
          drawPolygonPath(context, feature.geometry.coordinates, bounds.width, bounds.height, view);
        }
        if (feature.geometry.type === "MultiPolygon") {
          for (const polygon of feature.geometry.coordinates) {
            drawPolygonPath(context, polygon, bounds.width, bounds.height, view);
          }
        }
      }
      context.stroke();
      context.restore();
    }

    const drawPoints = (collection: FeatureCollection | null, color: string, radius: number) => {
      if (!collection) return;
      context.save();
      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = 8;
      for (const feature of collection.features) {
        if (feature.geometry?.type !== "Point") continue;
        const [lon, lat] = feature.geometry.coordinates;
        const point = project(lon, lat, bounds.width, bounds.height, view);
        if (point.x < -20 || point.y < -20 || point.x > bounds.width + 20 || point.y > bounds.height + 20) {
          continue;
        }
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    };

    if (active.criticalMinerals) drawPoints(criticalMinerals, "#ef476f", 2.3);
    if (active.majorDeposits) drawPoints(majorDeposits, "#06d6a0", 1.9);
  }, [active, agricultureRasters, countries, criticalMinerals, densityImage, majorDeposits, totalImage, view]);

  function updateHover(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !criticalMinerals) return;
    const rect = canvas.getBoundingClientRect();
    let closest = { distance: Infinity, label: "" };

    for (const feature of criticalMinerals.features) {
      if (feature.geometry?.type !== "Point") continue;
      const [lon, lat] = feature.geometry.coordinates;
      const point = project(lon, lat, rect.width, rect.height, view);
      const distance = Math.hypot(point.x - (clientX - rect.left), point.y - (clientY - rect.top));
      if (distance < closest.distance && distance < 12) {
        const mineral = String(feature.properties.mineral ?? "Critical mineral");
        const name = String(feature.properties.dep_name ?? feature.properties.location ?? "Unnamed deposit");
        closest = { distance, label: `${mineral}: ${name}` };
      }
    }

    setHover(closest.label || "Move across mineral points");
  }

  return (
    <main className="app">
      <aside className="panel">
        <div>
          <p className="eyebrow">Global geoeconomic canvas</p>
          <h1>Population, agriculture, borders, and mineral resources</h1>
        </div>

        <div className="status">
          <span>{status}</span>
          <strong>{counts.criticalMinerals + counts.majorDeposits} mineral records</strong>
        </div>

        <section>
          <h2>Layers</h2>
          <div className="layers">
            {LAYERS.map((layer) => (
              <button
                className={active[layer.key] ? "layer active" : "layer"}
                key={layer.key}
                onClick={() => setActive((current) => ({ ...current, [layer.key]: !current[layer.key] }))}
              >
                <span className="swatch" style={{ background: layer.color }} />
                <span>{layer.label}</span>
                {active[layer.key] ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Controls</h2>
          <div className="controls">
            <button onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.25) }))} title="Zoom in">
              <Plus size={18} />
            </button>
            <button onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.7, v.zoom / 1.25) }))} title="Zoom out">
              <Minus size={18} />
            </button>
            <button onClick={() => setView(INITIAL_VIEW)} title="Reset view">
              <RotateCcw size={18} />
            </button>
            <button onClick={() => setHover("World extent: -180,-60 to 180,85")} title="Show extent">
              <LocateFixed size={18} />
            </button>
          </div>
        </section>

        <dl className="stats">
          <div>
            <dt>Countries</dt>
            <dd>{counts.countries}</dd>
          </div>
          <div>
            <dt>Critical mineral sites</dt>
            <dd>{counts.criticalMinerals}</dd>
          </div>
          <div>
            <dt>Major deposits</dt>
            <dd>{counts.majorDeposits}</dd>
          </div>
          <div>
            <dt>Agriculture rasters</dt>
            <dd>{counts.agriculture}</dd>
          </div>
        </dl>

        <p className="note">
          MapSPAM agriculture is rendered from unchanged GeoTIFFs extracted from the provider ZIP. The current
          WorldPop PNG previews are server-rendered and still need a value-based raster path for useful gradients.
        </p>
      </aside>

      <section
        className="map"
        ref={wrapRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY, view };
        }}
        onPointerMove={(event) => {
          updateHover(event.clientX, event.clientY);
          if (!dragRef.current) return;
          const dx = event.clientX - dragRef.current.x;
          const dy = event.clientY - dragRef.current.y;
          setView({ ...dragRef.current.view, offsetX: dragRef.current.view.offsetX + dx, offsetY: dragRef.current.view.offsetY + dy });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.12 : 0.88;
          setView((current) => ({ ...current, zoom: Math.max(0.7, Math.min(8, current.zoom * factor)) }));
        }}
      >
        <canvas ref={canvasRef} />
        <div className="readout">{hover}</div>
      </section>
    </main>
  );
}

type RouteKey = "map" | "sim" | "field" | "fieldLogistics" | "fieldLogisticsOneCell" | "tiles" | "tiles3d";

type AppRoute = {
  key: RouteKey;
  path: string;
  label: string;
  icon: React.ReactNode;
  element: React.ReactNode;
};

const ROUTES: AppRoute[] = [
  { key: "map", path: "/", label: "Geo canvas", icon: <Map size={16} />, element: <GeoMapPage /> },
  { key: "sim", path: "/economic-sim", label: "Economic sim", icon: <BarChart3 size={16} />, element: <EconomicSimPage /> },
  {
    key: "field",
    path: "/price-field",
    label: "Price field",
    icon: <Activity size={16} />,
    element: <PriceFieldExperimentPage />,
  },
  {
    key: "fieldLogistics",
    path: "/price-logistics",
    label: "Field logistics",
    icon: <Truck size={16} />,
    element: <PriceFieldLogisticsPage />,
  },
  {
    key: "fieldLogisticsOneCell",
    path: "/price-logistics-1x1",
    label: "One-cell market",
    icon: <Truck size={16} />,
    element: <OneCellPriceFieldLogisticsPage />,
  },
  { key: "tiles", path: "/tile-study", label: "Tile study", icon: <Blocks size={16} />, element: <TileAestheticPage /> },
  { key: "tiles3d", path: "/tile-study-3d", label: "3D tiles", icon: <Box size={16} />, element: <TileAesthetic3DPage /> },
];

const LEGACY_HASH_ROUTES: Record<string, string> = {
  "#sim": "/economic-sim",
  "#tiles": "/tile-study",
  "#tiles3d": "/tile-study-3d",
};

function routeFromLocation() {
  return ROUTES.find((route) => route.path === window.location.pathname) ?? ROUTES[0];
}

function App() {
  const [route, setRoute] = useState(routeFromLocation);

  useEffect(() => {
    const legacyPath = LEGACY_HASH_ROUTES[window.location.hash];
    if (legacyPath) {
      window.history.replaceState(null, "", legacyPath);
      setRoute(routeFromLocation());
    }

    const onPopState = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextRoute: AppRoute) {
    if (nextRoute.path !== window.location.pathname) {
      window.history.pushState(null, "", nextRoute.path);
    }
    setRoute(nextRoute);
  }

  return (
    <>
      <nav className="page-switcher" aria-label="Pages">
        {ROUTES.map((nextRoute) => (
          <a
            key={nextRoute.key}
            className={route.key === nextRoute.key ? "active" : ""}
            href={nextRoute.path}
            onClick={(event) => {
              event.preventDefault();
              navigate(nextRoute);
            }}
          >
            {nextRoute.icon}
            <span>{nextRoute.label}</span>
          </a>
        ))}
      </nav>
      {route.element}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
