// Minimal 3D mesh viewer — first step toward the UV -> flipdot pipeline.
// Loads a .glb (which, unlike STL, carries UV coordinates) and just shows it.
// See uv-mesh-pipeline.md for the full plan; this is Phase 1 ("load with UVs").

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildDotField, type DotField } from './uvdots';
import { FlipdotSim } from './flipdotsim';
import { hardwareFromDotField } from './hardware';
import type { FlipdotSimHardware } from './hardware';
import {
  GridOrder, AllAtOnce, BottomUp, TopDown, LeftToRight, RightToLeft, Diagonal,
  OutFromCentre, SpiralIn, SpiralOut, BottomLeftWildfire, PingPong, Tile,
} from './order';

const container = document.getElementById('render')!;
const statusEl = document.getElementById('status')!;
const meshSelect = document.getElementById('mesh-select') as HTMLSelectElement;
const wireframeBox = document.getElementById('wireframe') as HTMLInputElement;
const uvBox = document.getElementById('show-uv') as HTMLInputElement;
const resetBtn = document.getElementById('reset-view') as HTMLButtonElement;
const resWInput = document.getElementById('res-w') as HTMLInputElement;
const resHInput = document.getElementById('res-h') as HTMLInputElement;
const showDotsBox = document.getElementById('show-dots') as HTMLInputElement;
const showMeshBox = document.getElementById('show-mesh') as HTMLInputElement;
const rebuildBtn = document.getElementById('rebuild-dots') as HTMLButtonElement;
const flipNormalsBox = document.getElementById('flip-normals') as HTMLInputElement;
const showNormalsBox = document.getElementById('show-normals') as HTMLInputElement;
const densityColorsBox = document.getElementById('density-colors') as HTMLInputElement;
const mergeOverlapsBox = document.getElementById('merge-overlaps') as HTMLInputElement;
const uvPanel = document.getElementById('uv-panel') as HTMLCanvasElement;
const uvCtx = uvPanel.getContext('2d')!;
const orderSelect = document.getElementById('order-select') as HTMLSelectElement;
const orderPlayBtn = document.getElementById('order-play') as HTMLButtonElement;
const orderRestartBtn = document.getElementById('order-restart') as HTMLButtonElement;
const orderSpeed = document.getElementById('order-speed') as HTMLInputElement;
const orderStatus = document.getElementById('order-status')!;
const colFront = document.getElementById('col-front') as HTMLInputElement;
const colBack = document.getElementById('col-back') as HTMLInputElement;
const colBacking = document.getElementById('col-backing') as HTMLInputElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

// Soft studio environment so the metallic discs have something to reflect —
// without this, metal reads as near-black under direct lights alone.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting — ambient + a couple of directionals so any orientation is legible.
scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(1, 2, 3);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.4);
fill.position.set(-2, -1, -2);
scene.add(fill);

const loader = new GLTFLoader();
let current: THREE.Group | null = null;

function resize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// Frame the camera to whatever the model's bounding box is, so meshes of any
// scale/position show up centered.
function frameObject(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));
  camera.position.copy(center).add(new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(dist * 1.8));
  camera.near = maxDim / 100;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

// Give each face a color from its UV centroid (u -> red, v -> green) so we can
// eyeball whether the mesh actually has a sane UV map before building anything
// on top of it.
// NOTE: writes the color attribute onto the mesh's OWN geometry (converting it
// non-indexed in place if needed). Setting colors on a throwaway copy is why an
// earlier version rendered all black — the mesh kept rendering its original,
// color-less geometry.
function uvColorMaterial(mesh: THREE.Mesh): THREE.Material {
  if (mesh.geometry.index) {
    mesh.geometry = mesh.geometry.toNonIndexed();
  }
  const g = mesh.geometry;
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  if (uv) {
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3 + 0] = uv.getX(i);
      colors[i * 3 + 1] = uv.getY(i);
      colors[i * 3 + 2] = 0.3;
    }
  } else {
    // No UVs — paint it magenta so it's unmistakable (not black/ambiguous).
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3 + 0] = 1;
      colors[i * 3 + 2] = 1;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
}

function reportGeometry(obj: THREE.Object3D) {
  let meshes = 0, faces = 0, hasUV = false;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      meshes++;
      const g = m.geometry as THREE.BufferGeometry;
      const count = g.index ? g.index.count : g.attributes.position.count;
      faces += count / 3;
      if (g.attributes.uv) hasUV = true;
    }
  });
  baseStatus = `${meshes} mesh(es), ${faces} faces, UVs: ${hasUV ? 'yes' : 'NO'}`;
  refreshStatus();
  console.log('[3d viewer]', { meshes, faces, hasUV });
}

let baseStatus = '';
function refreshStatus(extra?: string) {
  statusEl.textContent = baseStatus + (extra ? ` | ${extra}` : '');
}

function primaryMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !found) found = m;
  });
  return found;
}

// The backing = the mesh surface the discs sit on. Held here so it can be set
// live from the picker and reused when the material is rebuilt.
let backingColor = '#cccccc';

function applyMaterialMode() {
  if (!current) return;
  current.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (uvBox.checked) {
      m.material = uvColorMaterial(m);
    } else {
      // Unlit so the backing renders its exact color regardless of the (now
      // strong) ambient/environment lighting used for the metallic discs.
      m.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(backingColor),
        side: THREE.DoubleSide, wireframe: wireframeBox.checked,
      });
    }
    (m.material as any).wireframe = wireframeBox.checked;
  });
}

// Set the backing color live (and remember it for future material rebuilds).
function setBackingColor(hex: string) {
  backingColor = hex;
  if (!current) return;
  current.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || uvBox.checked) return;
    const mat = m.material as THREE.MeshBasicMaterial;
    if (mat && mat.color) mat.color.set(hex);
  });
}

// ── Dot field + board simulation ─────────────────────────────────────────────
let dotField: DotField | null = null;
let normalsHelper: VertexNormalsHelper | null = null;

// Board-sim config (owned by the viewer/UI, handed to the DOM-free FlipdotSim).
const DISC_FILL = 0.9;   // drawn disc radius as a fraction of the cell half-pitch
const BASE_LIFT = 0.25;  // resting standoff off the surface, in disc radii
const FLIP_SEC = 0.3;    // seconds for one 180° flip

// The actual flipdot board simulation. The viewer only pushes on/off states in.
const sim = new FlipdotSim({ fill: DISC_FILL, baseLift: BASE_LIFT, flipSeconds: FLIP_SEC });
scene.add(sim.object3d);

// Draw the mesh's own vertex normals (green) so we can see whether the asset's
// normals point outward or inward — the ground truth behind "flip normals".
function updateNormalsHelper() {
  if (normalsHelper) { scene.remove(normalsHelper); normalsHelper = null; }
  if (!showNormalsBox.checked || !current) return;
  const mesh = primaryMesh(current);
  if (!mesh) return;
  const box = new THREE.Box3().setFromObject(mesh);
  const len = box.getSize(new THREE.Vector3()).length() * 0.03;
  normalsHelper = new VertexNormalsHelper(mesh, len, 0x33ff88);
  scene.add(normalsHelper);
}

function readRes(): [number, number] {
  const clamp = (n: number) => Math.max(2, Math.min(256, n | 0));
  return [clamp(parseInt(resWInput.value) || 48), clamp(parseInt(resHInput.value) || 48)];
}

function rebuildDots() {
  sim.dispose();
  dotField = null;
  if (!current) return;
  const mesh = primaryMesh(current);
  if (!mesh) { refreshStatus('no mesh for dots'); return; }
  current.updateMatrixWorld(true);

  const geo = mesh.geometry as THREE.BufferGeometry;
  const [W, H] = readRes();

  // buildDotField works in geometry-LOCAL coords, so the cull distance and the
  // "crowded" threshold must be in local units too. Derive a local cell radius
  // from the geometry's own bounding box.
  geo.computeBoundingBox();
  const localDiag = geo.boundingBox!.getSize(new THREE.Vector3()).length();
  const rLocal = (localDiag / Math.max(W, H)) * 0.5;

  let field: DotField;
  try {
    field = buildDotField(geo, W, H, {
      flipNormals: flipNormalsBox.checked,
      minDist: mergeOverlapsBox.checked ? 2 * rLocal : undefined,
    });
  } catch (e) {
    refreshStatus(`dots failed: ${e}`);
    return;
  }
  dotField = field;

  // Cell half-pitch in WORLD units (the mesh node may carry a scale). The sim
  // shrinks it by DISC_FILL for the drawn disc; spacing/merge use the full cell.
  const worldMat = mesh.matrixWorld;
  const wScale = new THREE.Vector3();
  worldMat.decompose(new THREE.Vector3(), new THREE.Quaternion(), wScale);
  const s = (wScale.x + wScale.y + wScale.z) / 3;
  const cellR = rLocal * s;

  // Hand the placement to the board simulation.
  sim.build(field, worldMat, cellR);
  sim.visible = showDotsBox.checked;

  // "Crowded" = neighbour closer than one drawn-disc diameter (discs collide).
  // Compared in LOCAL units, matching field.spacing (drawn radius = rLocal·FILL).
  const overlapDist = 2 * rLocal * DISC_FILL;
  let crowded = 0;
  for (const d of field.dots) if (d.spacing < overlapDist) crowded++;

  drawUvPanel(field, geo);
  updateNormalsHelper();
  (window as any).dotField = dotField; // expose for console inspection

  // Build the headless FlipdotSimHardware from this dot placement and (re)build
  // the current order's projection onto it.
  hw = hardwareFromDotField(field);
  (window as any).flipdotHw = hw;
  rebuildOrder();
  applyDensityMode();

  const sp = field.spacing;
  const ratio = sp.min > 0 ? (sp.max / sp.min).toFixed(1) : '∞';
  const mergedStr = field.merged > 0 ? ` · merged ${field.merged}` : '';
  refreshStatus(
    `dots ${field.dots.length}/${W * H} (${(field.coverage * 100).toFixed(0)}%) · ` +
    `spacing min ${sp.min.toFixed(3)} / med ${sp.median.toFixed(3)} / max ${sp.max.toFixed(3)} ` +
    `(${ratio}× spread) · ${crowded} crowded${mergedStr}`,
  );
}

// Density heatmap: a placement-debug view. Freezes the discs flat and colors
// each by its 3D spacing (red = crowded, green ~ typical, blue = sparse). Off =>
// the sim resumes normal flip animation.
function applyDensityMode() {
  if (!dotField) return;
  if (!densityColorsBox.checked) { sim.setStaticColors(null); return; }
  const median = dotField.spacing.median || 1;
  const colors = dotField.dots.map((d) => {
    const t = Math.max(0, Math.min(1, d.spacing / (2 * median)));
    return new THREE.Color().setHSL(0.7 * t, 0.9, 0.5);
  });
  sim.setStaticColors(colors);
}

// 2D preview of the UV layout with the dot grid overlaid.
function drawUvPanel(field: DotField, geometry: THREE.BufferGeometry) {
  const S = uvPanel.width;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const uv = g.attributes.uv;
  uvCtx.fillStyle = '#000';
  uvCtx.fillRect(0, 0, S, S);
  const fx = (u: number) => u * S;
  const fy = (v: number) => (1 - v) * S; // flip V: UV origin bottom-left, canvas top-left

  // UV triangles
  uvCtx.strokeStyle = 'rgba(120,120,150,0.35)';
  uvCtx.lineWidth = 0.5;
  uvCtx.beginPath();
  const faceCount = uv.count / 3;
  for (let f = 0; f < faceCount; f++) {
    const a = 3 * f, b = 3 * f + 1, c = 3 * f + 2;
    uvCtx.moveTo(fx(uv.getX(a)), fy(uv.getY(a)));
    uvCtx.lineTo(fx(uv.getX(b)), fy(uv.getY(b)));
    uvCtx.lineTo(fx(uv.getX(c)), fy(uv.getY(c)));
    uvCtx.closePath();
  }
  uvCtx.stroke();

  // Dots: lit if they hit the surface, dim if they fell in a UV gap.
  for (let gy = 0; gy < field.height; gy++) {
    for (let gx = 0; gx < field.width; gx++) {
      const x = fx((gx + 0.5) / field.width);
      const y = fy((gy + 0.5) / field.height);
      if (field.grid[gy][gx]) {
        uvCtx.fillStyle = '#ffcc33';
        uvCtx.fillRect(x - 1, y - 1, 2, 2);
      } else {
        uvCtx.fillStyle = 'rgba(90,90,90,0.6)';
        uvCtx.fillRect(x - 0.5, y - 0.5, 1, 1);
      }
    }
  }
}

// ── Orders → dots ────────────────────────────────────────────────────────────
// Generate a GridOrder over a W×H rectangle at the dot resolution, then project
// the ordering onto the physical discs via the headless FlipdotSimHardware's
// coordToIndex. This is exactly your proposed "overlay the generated grid onto
// the dots": projection = hw.coordToIndex.
let hw: FlipdotSimHardware | null = null;
let orderTimeFn: ((t: number) => number[]) | null = null;
let orderMaxTime = 0;
let animTime = 0;
let playing = true;
let lastNow = performance.now();

function makeOrder(name: string): GridOrder {
  switch (name) {
    case 'TopDown': return new TopDown();
    case 'LeftToRight': return new LeftToRight();
    case 'RightToLeft': return new RightToLeft();
    case 'Diagonal': return new Diagonal();
    case 'OutFromCentre': return new OutFromCentre();
    case 'SpiralIn': return new SpiralIn();
    case 'SpiralOut': return new SpiralOut();
    case 'BottomLeftWildfire': return new BottomLeftWildfire();
    case 'PingPong': return new PingPong();
    case 'AllAtOnce': return new AllAtOnce();
    // Tiled orders: run the sub-order in every tile at once ('parallel'), so
    // many regions of the surface are active simultaneously.
    case 'Tile2x2BottomUp': return new Tile([2, 2], new BottomUp(), 'parallel');
    case 'Tile3x3BottomUp': return new Tile([3, 3], new BottomUp(), 'parallel');
    case 'Tile4x4Diagonal': return new Tile([4, 4], new Diagonal(), 'parallel');
    case 'Tile2x2OutFromCentre': return new Tile([2, 2], new OutFromCentre(), 'parallel');
    case 'Tile3x3SpiralIn': return new Tile([3, 3], new SpiralIn(), 'parallel');
    // Sequential-snake tiling: tiles fire one after another, snaking across.
    case 'Tile3x3BottomUpSnake': return new Tile([3, 3], new BottomUp(), 'sequential', 'snake');
    default: return new BottomUp();
  }
}

function rebuildOrder() {
  orderTimeFn = null;
  if (!dotField || !hw) return;
  const order = makeOrder(orderSelect.value);
  // mask: which UV grid cells carry a dot
  const mask = dotField.grid.map((row) => row.map((c) => !!c));
  const [ordered, times] = order.applyMask(mask);
  orderTimeFn = order.getTimeFunction(ordered, ([x, y]) => hw!.coordToIndex([x, y]));
  orderMaxTime = times.length ? times[times.length - 1] : 0;
  animTime = 0;
}

async function load(name: string) {
  baseStatus = `loading ${name}…`;
  refreshStatus();
  sim.dispose();
  if (current) { scene.remove(current); current = null; }
  try {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${name}`);
    current = gltf.scene;
    scene.add(current);
    reportGeometry(current);
    applyMaterialMode();
    frameObject(current);
    rebuildDots();
  } catch (err) {
    baseStatus = `failed to load ${name}: ${err}`;
    refreshStatus();
    console.error(err);
  }
}

meshSelect.addEventListener('change', () => load(meshSelect.value));
wireframeBox.addEventListener('change', applyMaterialMode);
uvBox.addEventListener('change', applyMaterialMode);
resetBtn.addEventListener('click', () => current && frameObject(current));
rebuildBtn.addEventListener('click', rebuildDots);
flipNormalsBox.addEventListener('change', rebuildDots);
showNormalsBox.addEventListener('change', updateNormalsHelper);
densityColorsBox.addEventListener('change', applyDensityMode);
mergeOverlapsBox.addEventListener('change', rebuildDots);
showDotsBox.addEventListener('change', () => { sim.visible = showDotsBox.checked; });
showMeshBox.addEventListener('change', () => { if (current) current.visible = showMeshBox.checked; });
orderSelect.addEventListener('change', rebuildOrder);
orderRestartBtn.addEventListener('click', () => { animTime = 0; });
orderPlayBtn.addEventListener('click', () => {
  playing = !playing;
  orderPlayBtn.textContent = playing ? 'Pause' : 'Play';
});
colFront.addEventListener('input', () => sim.setColors(colFront.value, undefined));
colBack.addEventListener('input', () => sim.setColors(undefined, colBack.value));
colBacking.addEventListener('input', () => setBackingColor(colBacking.value));

// Apply the pickers' initial values (also settable programmatically later via
// window.flipdotSim.setColors(...) and setting the backing material color).
sim.setColors(colFront.value, colBack.value);
backingColor = colBacking.value;
(window as any).flipdotSim = sim;

resize();
load(meshSelect.value);

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Drive the board: advance the order clock, push the target on/off states
  // into the sim, then let the sim animate its flips. (Density mode freezes the
  // sim and owns the colors, so we skip pushing states then.)
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.05); // clamp to avoid huge jumps
  if (!densityColorsBox.checked && orderTimeFn) {
    if (playing) {
      const speed = parseFloat(orderSpeed.value); // order time-units per second
      animTime += dt * speed;
      // Loop with a short pause on the full board before restarting.
      if (animTime > orderMaxTime + speed * 0.75) animTime = 0;
    }
    const on = new Set(orderTimeFn(animTime));
    sim.setStates(on);
    orderStatus.textContent =
      `t ${animTime.toFixed(1)} / ${orderMaxTime} · ${on.size}/${sim.unitCount} on`;
  }
  sim.update(dt); // keeps flips animating even while the order clock is paused
  lastNow = now;

  renderer.render(scene, camera);
}
animate();
