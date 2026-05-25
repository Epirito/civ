import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { hash, OCEAN, OCEAN_DARK, regionBlocks, TILE_STUDY_COLUMNS, TILE_STUDY_ROWS } from "./tileStudyData";

type Vertex = [number, number, number];

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

function makeTileGeometry() {
  // The tile is a low keycap: wide at the base, stepped inward at the
  // shoulder, then inward again for a smaller top face.
  const base = 0.49;
  const shoulder = 0.44;
  const top = 0.37;
  const shoulderHeight = 0.055;
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

function makeOceanTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const gradient = context.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.8);
  gradient.addColorStop(0, OCEAN);
  gradient.addColorStop(0.58, OCEAN_DARK);
  gradient.addColorStop(1, "#00091a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.strokeStyle = "rgba(10, 49, 86, 0.45)";
  context.lineWidth = 1;
  for (let p = 0; p <= size; p += 24) {
    context.beginPath();
    context.moveTo(p, 0);
    context.lineTo(p, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, p);
    context.lineTo(size, p);
    context.stroke();
  }

  context.setLineDash([1, 7]);
  context.strokeStyle = "rgba(10, 49, 86, 0.24)";
  for (let p = 12; p <= size; p += 24) {
    context.beginPath();
    context.moveTo(p, 0);
    context.lineTo(p, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, p);
    context.lineTo(size, p);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 4);
  return texture;
}

function saturatedTileColor(hex: string) {
  const color = new THREE.Color(hex);
  color.offsetHSL(0, 0.18, 0.025);
  return color;
}

function addLights(scene: THREE.Scene) {
  //scene.add(new THREE.AmbientLight(0xfff7e4, 0.9));
 // scene.add(new THREE.HemisphereLight(0xcfe1ff, 0x07305c, 1.65));

  const key = new THREE.DirectionalLight(0xffe0a2, 3.2);
  key.position.set(-24, 36, -18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 9;
  key.shadow.blurSamples = 20;
  key.shadow.camera.left = -38;
  key.shadow.camera.right = 38;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  scene.add(key);

  //const coolRim = new THREE.DirectionalLight(0xfbfacd, 0.);
  const coolRim = new THREE.DirectionalLight(0xfbfa00, 0.);
  coolRim.position.set(-18, 18, -18);
  //scene.add(coolRim);

  /*
  const oceanBounce = new THREE.PointLight(0x2798ff, 18, 58, 2.1);
  oceanBounce.position.set(6, 6, 10);
  scene.add(oceanBounce);

  const warmGlow = new THREE.PointLight(0xffc04d, 12, 42, 2.2);
  warmGlow.position.set(-16, 8, -3);
  scene.add(warmGlow);*/
}

function buildScene(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(new THREE.Color(OCEAN_DARK), 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.75;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(OCEAN_DARK);
  scene.fog = new THREE.FogExp2(new THREE.Color(OCEAN_DARK), 0.004);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.set(0, 58, 9);
  camera.lookAt(0, 0, 0);
  resizeRenderer(renderer, camera, container);
  const cameraTarget = new THREE.Vector3(0, 0, 0);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 160),
    new THREE.MeshLambertMaterial({
      color: new THREE.Color(OCEAN_DARK),
      emissive: new THREE.Color(OCEAN_DARK),
      emissiveIntensity: 0.55,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.055;
  plane.receiveShadow = true;
  scene.add(plane);

  addLights(scene);

  const mouseLight = new THREE.PointLight(0xffd21f, 4.8, 11, 1.8);
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

  const tileGeometry = makeTileGeometry();
  const materials = new Map<string, THREE.MeshPhysicalMaterial[]>();
  const group = new THREE.Group();
  group.rotation.x = 0;
  group.rotation.z = 0;
  scene.add(group);

  for (const block of regionBlocks()) {
    let materialSet = materials.get(block.color);
    if (!materialSet) {
      const tileColor = saturatedTileColor(block.color);
      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color: tileColor,
        roughness: 0.5,
        metalness: 0.03,
        clearcoat: 0.22,
        clearcoatRoughness: 0.34,
        emissive: tileColor.clone().multiplyScalar(0.08),
        emissiveIntensity: 0.28,
      });
      const northBevelMaterial = new THREE.MeshPhysicalMaterial({
        color: tileColor,
        roughness: 0.24,
        metalness: 0.04,
        clearcoat: 0.72,
        clearcoatRoughness: 0.18,
        emissive: tileColor.clone().multiplyScalar(0.06),
        emissiveIntensity: 0.2,
      });
      materialSet = [bodyMaterial, northBevelMaterial];
      materials.set(block.color, materialSet);
    }

    const tile = new THREE.Mesh(tileGeometry, materialSet);
    const noise = hash(block.x, block.y) % 1;
    tile.position.set(
      block.x - TILE_STUDY_COLUMNS / 2 + 0.5,
      Math.max(0, noise * 0.03),
      block.y - TILE_STUDY_ROWS / 2 + 0.5,
    );
    tile.castShadow = true;
    tile.receiveShadow = true;
    group.add(tile);
  }

  let frame = 0;
  const render = () => {
    frame = window.requestAnimationFrame(render);
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

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    return buildScene(stage);
  }, []);

  return <main className="tile-study-app tile-study-3d" ref={stageRef} aria-label="3D economic tile aesthetic study" />;
}
