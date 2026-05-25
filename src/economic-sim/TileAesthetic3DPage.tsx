import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { hash, OCEAN, regionBlocks, TILE_STUDY_COLUMNS, TILE_STUDY_ROWS } from "./tileStudyData";

type Vertex = [number, number, number];
type OceanControls = {
  hue: number;
  saturation: number;
  lightness: number;
  emissive: number;
};
type StoredControls = {
  keyIntensity: number;
  topInset: number;
  bodyRoughness: number;
  bodyMetalness: number;
  oceanControls: OceanControls;
};
type CityMarker = {
  x: number;
  y: number;
  strength: number;
};

const STORAGE_KEY = "economic-sim.tile-aesthetic-3d.controls";

const DEFAULT_OCEAN_CONTROLS: OceanControls = (() => {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(OCEAN).getHSL(hsl);
  return {
    hue: hsl.h,
    saturation: hsl.s,
    lightness: hsl.l,
    emissive: 0,
  };
})();

const DEFAULT_CONTROLS: StoredControls = {
  keyIntensity: 9,
  topInset: 0.13,
  bodyRoughness: 0.5,
  bodyMetalness: 0,
  oceanControls: DEFAULT_OCEAN_CONTROLS,
};

function readStoredControls(): StoredControls {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONTROLS;
    const parsed = JSON.parse(raw) as Partial<StoredControls>;
    return {
      keyIntensity: parsed.keyIntensity ?? DEFAULT_CONTROLS.keyIntensity,
      topInset: parsed.topInset ?? DEFAULT_CONTROLS.topInset,
      bodyRoughness: parsed.bodyRoughness ?? DEFAULT_CONTROLS.bodyRoughness,
      bodyMetalness: parsed.bodyMetalness ?? DEFAULT_CONTROLS.bodyMetalness,
      oceanControls: {
        ...DEFAULT_CONTROLS.oceanControls,
        ...(parsed.oceanControls ?? {}),
      },
    };
  } catch {
    return DEFAULT_CONTROLS;
  }
}

function writeStoredControls(controls: StoredControls) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function oceanColorFromControls(controls: OceanControls) {
  return new THREE.Color().setHSL(controls.hue, controls.saturation, controls.lightness);
}

function randomUnit(x: number, y: number, salt = 0) {
  return Math.abs(hash(x + salt * 19.17, y - salt * 23.41) % 1);
}

function tileColorVariant(hex: string, x: number, y: number) {
  const color = new THREE.Color(hex);
  const hueShift = (randomUnit(x, y, 1) - 0.5) * 0.002;
  const saturationShift = (randomUnit(x, y, 2) - 0.5) * 0.014;
  const lightnessShift = (randomUnit(x, y, 3) - 0.5) * 0.026;
  color.offsetHSL(hueShift, saturationShift, lightnessShift);
  return color;
}

function cityMarkers() {
  const hotspots = [
    { x: 12, y: 10, radius: 4.6 },
    { x: 30, y: 10, radius: 3.2 },
    { x: 42, y: 15, radius: 3.8 },
    { x: 49, y: 12, radius: 4.1 },
    { x: 55, y: 23, radius: 2.8 },
    { x: 14, y: 16, radius: 2.6 },
  ];

  return regionBlocks()
    .map((block): CityMarker | null => {
      const cluster = Math.max(
        0,
        ...hotspots.map((hotspot) => {
          const distance = Math.hypot(block.x - hotspot.x, block.y - hotspot.y);
          return 1 - distance / hotspot.radius;
        }),
      );
      const random = randomUnit(block.x, block.y, 7);
      const isCity = cluster > 0.42 || random > 0.965;
      if (!isCity) return null;
      return {
        x: block.x,
        y: block.y,
        strength: Math.max(0.55, Math.min(1, cluster * 0.65 + random * 0.45)),
      };
    })
    .filter((marker): marker is CityMarker => marker !== null);
}

function makeCityGlowTexture() {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 248, 190, 0.9)");
  gradient.addColorStop(0.24, "rgba(255, 212, 47, 0.5)");
  gradient.addColorStop(1, "rgba(255, 180, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeCitySquareTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "rgba(255, 249, 191, 1)";
  context.fillRect(20, 20, 24, 24);
  context.fillStyle = "rgba(255, 207, 36, 0.78)";
  context.fillRect(16, 16, 32, 32);
  context.fillStyle = "rgba(255, 174, 0, 0.35)";
  context.fillRect(10, 10, 44, 44);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.OrthographicCamera,
  container: HTMLElement,
) {
  const { width, height } = container.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(Math.max(1, width), Math.max(1, height), false);

  const aspect = width / Math.max(1, height);
  const viewHeight = 39;
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
}

function makeTileGeometry(topInset = 0.13) {
  // The tile is a low keycap: wide at the base, stepped inward at the
  // shoulder, then inward again for a smaller top face.
  const base = 0.49;
  const inset = Math.max(0.02, Math.min(0.2, topInset));
  const shoulder = base - inset * 0.46;
  const top = base - inset;
  const shoulderHeight = 0.075;
  const height = 0.18;

  const V = {
    baseNw: 0,
    baseNe: 1,
    baseSe: 2,
    baseSw: 3,
    shoulderNw: 4,
    shoulderNe: 5,
    shoulderSe: 6,
    shoulderSw: 7,
    topNw: 8,
    topNe: 9,
    topSe: 10,
    topSw: 11,
  } as const;

  // Each level is ordered clockwise when viewed from above.
  const vertices: Vertex[] = [
    [-base, 0, -base],
    [base, 0, -base],
    [base, 0, base],
    [-base, 0, base],

    [-shoulder, shoulderHeight, -shoulder],
    [shoulder, shoulderHeight, -shoulder],
    [shoulder, shoulderHeight, shoulder],
    [-shoulder, shoulderHeight, shoulder],

    [-top, height, -top],
    [top, height, -top],
    [top, height, top],
    [-top, height, top],
  ];

  const positions = vertices.flat();
  const sideQuad = (nw: number, ne: number, se: number, sw: number) => [nw, se, ne, nw, sw, se];
  const upwardQuad = (nw: number, ne: number, se: number, sw: number) => [nw, se, ne, nw, sw, se];
  const topFace = upwardQuad(V.topNw, V.topNe, V.topSe, V.topSw);
  const lowerNorthBevel = sideQuad(V.baseNw, V.baseNe, V.shoulderNe, V.shoulderNw);
  const lowerOtherBevels = [
    ...sideQuad(V.baseNe, V.baseSe, V.shoulderSe, V.shoulderNe),
    ...sideQuad(V.baseSe, V.baseSw, V.shoulderSw, V.shoulderSe),
    ...sideQuad(V.baseSw, V.baseNw, V.shoulderNw, V.shoulderSw),
  ];
  const upperNorthBevel = sideQuad(V.shoulderNw, V.shoulderNe, V.topNe, V.topNw);
  const upperOtherBevels = [
    ...sideQuad(V.shoulderNe, V.shoulderSe, V.topSe, V.topNe),
    ...sideQuad(V.shoulderSe, V.shoulderSw, V.topSw, V.topSe),
    ...sideQuad(V.shoulderSw, V.shoulderNw, V.topNw, V.topSw),
  ];

  // Indices are triangles. Two triangles make each rectangular face.
  // The winding order is chosen so normals point outward for lighting.
  const indices = [
    // Top face: smaller flat square.
    ...topFace,

    // Lower bevel: bottom footprint to shoulder ledge.
    ...lowerNorthBevel,
    ...lowerOtherBevels,

    // Upper bevel: shoulder ledge to top face.
    ...upperNorthBevel,
    ...upperOtherBevels,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  let groupStart = 0;
  const addMaterialGroup = (count: number, materialIndex: number) => {
    geometry.addGroup(groupStart, count, materialIndex);
    groupStart += count;
  };
  addMaterialGroup(topFace.length, 0);
  addMaterialGroup(lowerNorthBevel.length, 1);
  addMaterialGroup(lowerOtherBevels.length, 0);
  addMaterialGroup(upperNorthBevel.length, 1);
  addMaterialGroup(upperOtherBevels.length, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function addLights(scene: THREE.Scene, keyIntensity: number) {
  //scene.add(new THREE.AmbientLight(0xfff7e4, 0.9));
 // scene.add(new THREE.HemisphereLight(0xcfe1ff, 0x07305c, 1.65));

  const key = new THREE.DirectionalLight(0xffffff, keyIntensity);
  key.position.set(-24, 12, -18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 10;
  key.shadow.blurSamples = 24;
  key.shadow.camera.left = -38;
  key.shadow.camera.right = 38;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  scene.add(key)
  return key;
}

function buildScene(
  container: HTMLElement,
  keyIntensityRef: React.RefObject<number>,
  topInsetRef: React.RefObject<number>,
  bodyRoughnessRef: React.RefObject<number>,
  bodyMetalnessRef: React.RefObject<number>,
  oceanControlsRef: React.RefObject<OceanControls>,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const initialOceanColor = oceanColorFromControls(oceanControlsRef.current);
  renderer.setClearColor(initialOceanColor, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = initialOceanColor.clone();
  scene.fog = new THREE.FogExp2(initialOceanColor.clone(), 0.004);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.set(0, 58, 9);
  camera.lookAt(0, 0, 0);
  resizeRenderer(renderer, camera, container);
  const cameraTarget = new THREE.Vector3(0, 0, 0);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 160),
    new THREE.MeshLambertMaterial({
      color: initialOceanColor,
      emissive: initialOceanColor,
      emissiveIntensity: oceanControlsRef.current.emissive,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.055;
  plane.receiveShadow = true;
  scene.add(plane);

  const keyLight = addLights(scene, keyIntensityRef.current);

  const mouseLight = new THREE.PointLight(0xffd21f, 40.8, 11, 1.8);
  mouseLight.position.set(0, 3.2, 0);
  scene.add(mouseLight);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerWorld = new THREE.Vector3();

  const moveMouseLight = (clientX: number, clientY: number) => {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
    pointer.y = -(((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(dragPlane, pointerWorld)) return;
    mouseLight.position.set(pointerWorld.x, 3.2, pointerWorld.z);
  };

  let tileGeometry = makeTileGeometry(topInsetRef.current);
  let activeTopInset = topInsetRef.current;
  const tileMeshes: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial[]>> = [];
  const materials = new Map<string, THREE.MeshPhysicalMaterial[]>();
  const bodyMaterials: THREE.MeshPhysicalMaterial[] = [];
  const tileSpacing = .99;
  const group = new THREE.Group();
  group.rotation.x = 0;
  group.rotation.z = 0;
  scene.add(group);

  const blocks = regionBlocks();
  for (const block of blocks) {
    const variant = Math.floor(randomUnit(block.x, block.y, 4) * 5);
    const materialKey = `${block.color}:${variant}`;
    let materialSet = materials.get(materialKey);
    if (!materialSet) {
      const tileColor = tileColorVariant(block.color, block.x + variant * 0.1, block.y - variant * 0.1);
      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color: tileColor,
        roughness: bodyRoughnessRef.current,
        metalness: bodyMetalnessRef.current,
        specularColor: new THREE.Color(0xffff00),
        specularIntensity: 1,
        emissive: tileColor.clone().multiplyScalar(0.02),
      });
      const northBevelMaterial = bodyMaterial
      materialSet = [bodyMaterial, northBevelMaterial];
      bodyMaterials.push(bodyMaterial);
      materials.set(materialKey, materialSet);
    }

    const tile = new THREE.Mesh(tileGeometry, materialSet);
    const noise = hash(block.x, block.y) % 1;
    tile.position.set(
      (block.x - TILE_STUDY_COLUMNS / 2 + 0.5) * tileSpacing,
      Math.max(0, noise * 0.03),
      (block.y - TILE_STUDY_ROWS / 2 + 0.5) * tileSpacing,
    );
    tile.castShadow = true;
    tile.receiveShadow = true;
    tileMeshes.push(tile);
    group.add(tile);
  }

  const cityDotGeometry = new THREE.PlaneGeometry(0.14, 0.14);
  cityDotGeometry.rotateX(-Math.PI / 2);
  const citySquareTexture = makeCitySquareTexture();
  const cityDotMaterial = new THREE.MeshBasicMaterial({
    map: citySquareTexture ?? undefined,
    color: new THREE.Color("#ffd22a"),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const cityGlowTexture = makeCityGlowTexture();
  const cityGlowMaterial = new THREE.SpriteMaterial({
    map: cityGlowTexture ?? undefined,
    color: new THREE.Color("#ffd22a"),
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  for (const marker of cityMarkers()) {
    const offsetX = (randomUnit(marker.x, marker.y, 8) - 0.5) * 0.22;
    const offsetZ = (randomUnit(marker.x, marker.y, 9) - 0.5) * 0.22;
    const x = (marker.x - TILE_STUDY_COLUMNS / 2 + 0.5) * tileSpacing + offsetX;
    const z = (marker.y - TILE_STUDY_ROWS / 2 + 0.5) * tileSpacing + offsetZ;
    const y = 0.25;

    const dot = new THREE.Mesh(cityDotGeometry, cityDotMaterial);
    dot.position.set(x, y, z);
    dot.scale.setScalar(0.45 + marker.strength * 1.65);
    dot.renderOrder = 2;
    group.add(dot);

    const glow = new THREE.Sprite(cityGlowMaterial);
    glow.position.set(x, y + 0.025, z);
    glow.scale.setScalar(0.32 + marker.strength * 0.96);
    glow.renderOrder = 1;
    group.add(glow);
  }

  let frame = 0;
  const render = () => {
    frame = window.requestAnimationFrame(render);
    keyLight.intensity = keyIntensityRef.current;
    const oceanColor = oceanColorFromControls(oceanControlsRef.current);
    const oceanMaterial = plane.material as THREE.MeshLambertMaterial;
    renderer.setClearColor(oceanColor, 1);
    scene.background = oceanColor.clone();
    scene.fog?.color.copy(oceanColor);
    oceanMaterial.color.copy(oceanColor);
    oceanMaterial.emissive.copy(oceanColor);
    oceanMaterial.emissiveIntensity = oceanControlsRef.current.emissive;
    for (const material of bodyMaterials) {
      material.roughness = bodyRoughnessRef.current;
      material.metalness = bodyMetalnessRef.current;
    }
    if (topInsetRef.current !== activeTopInset) {
      const nextGeometry = makeTileGeometry(topInsetRef.current);
      for (const tile of tileMeshes) tile.geometry = nextGeometry;
      tileGeometry.dispose();
      tileGeometry = nextGeometry;
      activeTopInset = topInsetRef.current;
    }
    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
  };
  render();

  const onResize = () => resizeRenderer(renderer, camera, container);
  window.addEventListener("resize", onResize);

  const panState = {
    pointerId: -1,
    x: 0,
    y: 0,
    cameraX: 0,
    cameraZ: 0,
    targetX: 0,
    targetZ: 0,
  };

  const clampView = () => {
    const maxX = 17;
    const maxZ = 10;
    const dx = Math.max(-maxX, Math.min(maxX, camera.position.x));
    const dz = Math.max(-maxZ, Math.min(maxZ, camera.position.z));
    const offsetX = dx - camera.position.x;
    const offsetZ = dz - camera.position.z;
    camera.position.x += offsetX;
    camera.position.z += offsetZ;
    cameraTarget.x += offsetX;
    cameraTarget.z += offsetZ;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const nextZoom = camera.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)
    camera.zoom = nextZoom;
    camera.updateProjectionMatrix();
  };

  const onPointerDown = (event: PointerEvent) => {
    moveMouseLight(event.clientX, event.clientY);
    panState.pointerId = event.pointerId;
    panState.x = event.clientX;
    panState.y = event.clientY;
    panState.cameraX = camera.position.x;
    panState.cameraZ = camera.position.z;
    panState.targetX = cameraTarget.x;
    panState.targetZ = cameraTarget.z;
    renderer.domElement.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    moveMouseLight(event.clientX, event.clientY);
    if (panState.pointerId !== event.pointerId) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    const worldPerPixel = (camera.top - camera.bottom) / Math.max(1, bounds.height) / camera.zoom;
    const dx = (event.clientX - panState.x) * worldPerPixel;
    const dz = (event.clientY - panState.y) * worldPerPixel;
    camera.position.x = panState.cameraX - dx;
    camera.position.z = panState.cameraZ - dz;
    cameraTarget.x = panState.targetX - dx;
    cameraTarget.z = panState.targetZ - dz;
    clampView();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (panState.pointerId !== event.pointerId) return;
    panState.pointerId = -1;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerEnd);
  renderer.domElement.addEventListener("pointercancel", onPointerEnd);

  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerEnd);
    renderer.domElement.removeEventListener("pointercancel", onPointerEnd);
    tileGeometry.dispose();
    cityDotGeometry.dispose();
    citySquareTexture?.dispose();
    cityDotMaterial.dispose();
    cityGlowTexture?.dispose();
    cityGlowMaterial.dispose();
    plane.geometry.dispose();
    if (Array.isArray(plane.material)) plane.material.forEach((material) => material.dispose());
    else plane.material.dispose();
    for (const materialSet of materials.values()) {
      materialSet.forEach((material) => material.dispose());
    }
    renderer.dispose();
    renderer.domElement.remove();
  };
}

export function TileAesthetic3DPage() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const initialControls = useRef<StoredControls>(readStoredControls());
  const keyIntensityRef = useRef(initialControls.current.keyIntensity);
  const topInsetRef = useRef(initialControls.current.topInset);
  const bodyRoughnessRef = useRef(initialControls.current.bodyRoughness);
  const bodyMetalnessRef = useRef(initialControls.current.bodyMetalness);
  const oceanControlsRef = useRef<OceanControls>({ ...initialControls.current.oceanControls });
  const [keyIntensity, setKeyIntensity] = useState(keyIntensityRef.current);
  const [topInset, setTopInset] = useState(topInsetRef.current);
  const [bodyRoughness, setBodyRoughness] = useState(bodyRoughnessRef.current);
  const [bodyMetalness, setBodyMetalness] = useState(bodyMetalnessRef.current);
  const [oceanControls, setOceanControls] = useState(oceanControlsRef.current);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    return buildScene(stage, keyIntensityRef, topInsetRef, bodyRoughnessRef, bodyMetalnessRef, oceanControlsRef);
  }, []);

  const setOceanControl = (key: keyof OceanControls, value: number) => {
    const nextControls = { ...oceanControlsRef.current, [key]: value };
    oceanControlsRef.current = nextControls;
    setOceanControls(nextControls);
  };

  useEffect(() => {
    writeStoredControls({
      keyIntensity,
      topInset,
      bodyRoughness,
      bodyMetalness,
      oceanControls,
    });
  }, [bodyMetalness, bodyRoughness, keyIntensity, oceanControls, topInset]);

  return (
    <main className="tile-study-app tile-study-3d" ref={stageRef} aria-label="3D economic tile aesthetic study">
      <div className="tile-controls">
        <label className="tile-control-row">
          <span>Light</span>
          <input
            type="range"
            min="0"
            max="30"
            step="0.1"
            value={keyIntensity}
            onChange={(event) => {
              const nextIntensity = Number(event.currentTarget.value);
              keyIntensityRef.current = nextIntensity;
              setKeyIntensity(nextIntensity);
            }}
          />
          <output>{keyIntensity.toFixed(1)}</output>
        </label>
        <label className="tile-control-row">
          <span>Inset</span>
          <input
            type="range"
            min="0.02"
            max="0.2"
            step="0.005"
            value={topInset}
            onChange={(event) => {
              const nextInset = Number(event.currentTarget.value);
              topInsetRef.current = nextInset;
              setTopInset(nextInset);
            }}
          />
          <output>{topInset.toFixed(3)}</output>
        </label>
        <label className="tile-control-row">
          <span>Rough</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={bodyRoughness}
            onChange={(event) => {
              const nextRoughness = Number(event.currentTarget.value);
              bodyRoughnessRef.current = nextRoughness;
              setBodyRoughness(nextRoughness);
            }}
          />
          <output>{bodyRoughness.toFixed(2)}</output>
        </label>
        <label className="tile-control-row">
          <span>Metal</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={bodyMetalness}
            onChange={(event) => {
              const nextMetalness = Number(event.currentTarget.value);
              bodyMetalnessRef.current = nextMetalness;
              setBodyMetalness(nextMetalness);
            }}
          />
          <output>{bodyMetalness.toFixed(2)}</output>
        </label>
        <label className="tile-control-row">
          <span>Ocn H</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.005"
            value={oceanControls.hue}
            onChange={(event) => setOceanControl("hue", Number(event.currentTarget.value))}
          />
          <output>{oceanControls.hue.toFixed(2)}</output>
        </label>
        <label className="tile-control-row">
          <span>Ocn S</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={oceanControls.saturation}
            onChange={(event) => setOceanControl("saturation", Number(event.currentTarget.value))}
          />
          <output>{oceanControls.saturation.toFixed(2)}</output>
        </label>
        <label className="tile-control-row">
          <span>Ocn L</span>
          <input
            type="range"
            min="0"
            max="0.25"
            step="0.005"
            value={oceanControls.lightness}
            onChange={(event) => setOceanControl("lightness", Number(event.currentTarget.value))}
          />
          <output>{oceanControls.lightness.toFixed(3)}</output>
        </label>
        <label className="tile-control-row">
          <span>Ocn E</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={oceanControls.emissive}
            onChange={(event) => setOceanControl("emissive", Number(event.currentTarget.value))}
          />
          <output>{oceanControls.emissive.toFixed(2)}</output>
        </label>
      </div>
    </main>
  );
}
