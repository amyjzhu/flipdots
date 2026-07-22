// Build a field of "dots" from a UV-mapped mesh.
//
// The idea (Approach A from uv-mesh-pipeline.md): lay a regular W x H grid over
// the [0,1]^2 UV square. Each grid cell is one flipdot. For each cell center we
// find which mesh triangle contains that UV point, then use barycentric
// interpolation to recover the dot's 3D position and surface normal.
//
// The result is the association we need:
//   grid cell (gx,gy)  <->  UV coord  <->  3D position/normal  <->  faceIndex
// which is exactly what coordToIndex / indexToCoord need later in hardware.ts.

import * as THREE from 'three';

export type Dot = {
  gx: number;                  // grid column
  gy: number;                  // grid row (v increases upward, like UV space)
  uv: [number, number];        // UV coord of the cell center
  faceIndex: number;           // triangle the dot landed in
  position: THREE.Vector3;     // 3D surface position
  normal: THREE.Vector3;       // 3D surface normal (interpolated, unit)
  spacing: number;             // 3D distance to nearest grid-neighbor dot (Infinity if isolated)
};

export type DotField = {
  width: number;
  height: number;
  dots: Dot[];                       // only cells that landed on the surface
  grid: (Dot | null)[][];            // [gy][gx]; null = UV gap (no triangle)
  coverage: number;                  // fraction of cells that hit the surface
  merged: number;                    // cells that share another cell's disc (overlaps merged)
  // Physical spacing stats (world units), derived from the UV->3D distortion.
  // A large max/min ratio means the UV map stretches unevenly => uneven density.
  // `spacing` is each dot's distance to its nearest neighbor in 3D (not in the
  // grid), so it also catches discs that clip across UV-island seams.
  spacing: { min: number; median: number; max: number };
};

// Uniform-grid spatial hash over 3D points, for nearest-neighbor queries and
// the min-distance cull. Cell size should be ~ the query radius.
class SpatialHash {
  private cell: number;
  private map = new Map<string, number[]>();
  constructor(cell: number) {
    this.cell = Math.max(cell, 1e-9);
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(idx: number, p: THREE.Vector3) {
    const k = this.key(p.x, p.y, p.z);
    let a = this.map.get(k);
    if (!a) { a = []; this.map.set(k, a); }
    a.push(idx);
  }
  // Indices in the 3x3x3 block of cells around p (covers everything within
  // one cell size, i.e. within `cell` units).
  near(p: THREE.Vector3): number[] {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    const out: number[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const a = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (a) out.push(...a);
        }
    return out;
  }
}

// Barycentric coords of point p within triangle (a,b,c) in 2D. Returns
// [wa,wb,wc] or null if the triangle is degenerate.
function bary2d(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): [number, number, number] | null {
  const v0x = bx - ax, v0y = by - ay;
  const v1x = cx - ax, v1y = cy - ay;
  const v2x = px - ax, v2y = py - ay;
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;
  const denom = d00 * d11 - d01 * d01;
  if (denom === 0) return null;
  const wb = (d11 * d20 - d01 * d21) / denom;
  const wc = (d00 * d21 - d01 * d20) / denom;
  const wa = 1 - wb - wc;
  return [wa, wb, wc];
}

export function buildDotField(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
  opts: { flipNormals?: boolean; minDist?: number } = {},
): DotField {
  const sign = opts.flipNormals ? -1 : 1;
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!uv) throw new Error('buildDotField: geometry has no UV attribute');
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal;

  const faceCount = pos.count / 3;

  // --- Acceleration: bucket triangles into a coarse UV bin grid so each dot
  // only tests the handful of triangles near it, not all of them. ---
  const BINS = 64;
  const bins: number[][] = Array.from({ length: BINS * BINS }, () => []);
  const clampBin = (n: number) => Math.max(0, Math.min(BINS - 1, n));

  for (let f = 0; f < faceCount; f++) {
    const i0 = 3 * f, i1 = 3 * f + 1, i2 = 3 * f + 2;
    const u0 = uv.getX(i0), v0 = uv.getY(i0);
    const u1 = uv.getX(i1), v1 = uv.getY(i1);
    const u2 = uv.getX(i2), v2 = uv.getY(i2);
    const minU = Math.min(u0, u1, u2), maxU = Math.max(u0, u1, u2);
    const minV = Math.min(v0, v1, v2), maxV = Math.max(v0, v1, v2);
    const bx0 = clampBin(Math.floor(minU * BINS));
    const bx1 = clampBin(Math.floor(maxU * BINS));
    const by0 = clampBin(Math.floor(minV * BINS));
    const by1 = clampBin(Math.floor(maxV * BINS));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        bins[by * BINS + bx].push(f);
      }
    }
  }

  const dots: Dot[] = [];
  const grid: (Dot | null)[][] = Array.from({ length: height }, () =>
    Array(width).fill(null),
  );

  const EPS = 1e-6;

  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      const u = (gx + 0.5) / width;
      const v = (gy + 0.5) / height;

      const bx = clampBin(Math.floor(u * BINS));
      const by = clampBin(Math.floor(v * BINS));
      const candidates = bins[by * BINS + bx];

      let hit: Dot | null = null;
      for (const f of candidates) {
        const i0 = 3 * f, i1 = 3 * f + 1, i2 = 3 * f + 2;
        const w = bary2d(
          u, v,
          uv.getX(i0), uv.getY(i0),
          uv.getX(i1), uv.getY(i1),
          uv.getX(i2), uv.getY(i2),
        );
        if (!w) continue;
        const [wa, wb, wc] = w;
        if (wa < -EPS || wb < -EPS || wc < -EPS) continue;

        // Inside this triangle — interpolate 3D position + normal.
        const position = new THREE.Vector3(
          wa * pos.getX(i0) + wb * pos.getX(i1) + wc * pos.getX(i2),
          wa * pos.getY(i0) + wb * pos.getY(i1) + wc * pos.getY(i2),
          wa * pos.getZ(i0) + wb * pos.getZ(i1) + wc * pos.getZ(i2),
        );
        const normal = new THREE.Vector3(
          wa * nor.getX(i0) + wb * nor.getX(i1) + wc * nor.getX(i2),
          wa * nor.getY(i0) + wb * nor.getY(i1) + wc * nor.getY(i2),
          wa * nor.getZ(i0) + wb * nor.getZ(i1) + wc * nor.getZ(i2),
        ).normalize().multiplyScalar(sign);

        hit = { gx, gy, uv: [u, v], faceIndex: f, position, normal, spacing: Infinity };
        break;
      }

      if (hit) {
        grid[gy][gx] = hit;
        dots.push(hit);
      }
    }
  }

  // --- Merge overlaps (seam-aware, works in 3D so it doesn't care about UV
  // islands or triangles). When several grid cells land within minDist of each
  // other on the surface -- e.g. the duplicate coverage where two UV islands
  // meet along a seam -- collapse them into ONE disc and point every cell in the
  // cluster at it. Unlike culling, no UV cell is thrown away.
  //
  // The disc is placed at the AVERAGE of its cluster's positions (and normals)
  // rather than on one member, so it sits between the overlapping dots and
  // doesn't leave a gap where the others were. ---
  const hitCells = dots.length;
  let merged = 0;
  let kept = dots;
  if (opts.minDist && opts.minDist > 0) {
    const minDist2 = opts.minDist * opts.minDist;
    const hash = new SpatialHash(opts.minDist);
    const reps: Dot[] = [];
    const sumPos: THREE.Vector3[] = [];
    const sumNor: THREE.Vector3[] = [];
    const counts: number[] = [];
    for (const d of dots) {
      // Cluster on the seed position (reps[j].position isn't averaged until the
      // loop finishes, so proximity tests stay stable during clustering).
      let repIdx = -1;
      for (const j of hash.near(d.position)) {
        if (reps[j].position.distanceToSquared(d.position) < minDist2) { repIdx = j; break; }
      }
      if (repIdx >= 0) {
        sumPos[repIdx].add(d.position);
        sumNor[repIdx].add(d.normal);
        counts[repIdx]++;
        grid[d.gy][d.gx] = reps[repIdx]; // this cell shares the representative disc
        merged++;
      } else {
        hash.add(reps.length, d.position);
        reps.push(d);
        sumPos.push(d.position.clone());
        sumNor.push(d.normal.clone());
        counts.push(1);
      }
    }
    // Move each representative to its cluster centroid.
    for (let j = 0; j < reps.length; j++) {
      reps[j].position.copy(sumPos[j]).divideScalar(counts[j]);
      reps[j].normal.copy(sumNor[j]).normalize();
    }
    kept = reps;
  }

  // --- Physical spacing: each kept dot's distance to its nearest neighbor in
  // 3D (not in the grid), via a spatial hash. Because it's 3D-based it also
  // reports crowding across UV seams, which grid-neighbor spacing missed. ---
  const probe = spacingProbe(kept);
  const hash = new SpatialHash(probe);
  kept.forEach((d, i) => hash.add(i, d.position));
  for (let i = 0; i < kept.length; i++) {
    const d = kept[i];
    for (const j of hash.near(d.position)) {
      if (j === i) continue;
      const dist = d.position.distanceTo(kept[j].position);
      if (dist < d.spacing) d.spacing = dist;
    }
  }

  const finiteSpacings = kept
    .map((d) => d.spacing)
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);
  const spacing = finiteSpacings.length
    ? {
        min: finiteSpacings[0],
        median: finiteSpacings[Math.floor(finiteSpacings.length / 2)],
        max: finiteSpacings[finiteSpacings.length - 1],
      }
    : { min: 0, median: 0, max: 0 };

  return {
    width,
    height,
    dots: kept,
    grid,
    coverage: hitCells / (width * height),
    merged,
    spacing,
  };
}

// Cell size for the nearest-neighbor hash: a few times the mean grid step so
// the 3x3x3 block almost always contains the true nearest neighbor.
function spacingProbe(dots: Dot[]): number {
  if (dots.length < 2) return 1;
  const box = new THREE.Box3();
  for (const d of dots) box.expandByPoint(d.position);
  const diag = box.getSize(new THREE.Vector3()).length();
  // Assume dots roughly cover a 2D surface embedded in 3D => ~sqrt(n) per side.
  return Math.max((diag / Math.sqrt(dots.length)) * 2, 1e-6);
}

// --- Driving discs from a UV-space image ------------------------------------
// Sample an image drawn in UV space and decide each disc's on/off state. This
// is one way to drive the dots (freeform images/effects); the order-based path
// (see hardware integration) is the other. Each disc is sampled ONCE at its own
// UV coord -- merged discs adopt their representative cell's UV, so there is no
// cross-island combine step.

export type SampleOpts = {
  threshold?: number; // luminance cutoff in [0,1] (default 0.5)
  invert?: boolean;   // flip on/off (default false)
};

// Returns 0/1 per disc, in field.dots order (== instance order).
export function sampleField(
  field: DotField,
  img: ImageData,
  opts: SampleOpts = {},
): Uint8Array {
  const threshold = opts.threshold ?? 0.5;
  const invert = opts.invert ?? false;
  const { width: iw, height: ih, data } = img;
  const out = new Uint8Array(field.dots.length);
  for (let i = 0; i < field.dots.length; i++) {
    const [u, v] = field.dots[i].uv;
    // V-flip: UV origin is bottom-left, image data origin is top-left.
    let x = Math.floor(u * iw);
    let y = Math.floor((1 - v) * ih);
    x = x < 0 ? 0 : x >= iw ? iw - 1 : x;
    y = y < 0 ? 0 : y >= ih ? ih - 1 : y;
    const o = (y * iw + x) * 4;
    const lum = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
    const on = invert ? lum < threshold : lum >= threshold;
    out[i] = on ? 1 : 0;
  }
  return out;
}
