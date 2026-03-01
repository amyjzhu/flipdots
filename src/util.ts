// this is just chatgpt
import * as THREE from "three";
import { Colour } from "./language";
export class MinPriorityQueue<T> {
  private heap: { item: T; priority: number }[] = [];

  constructor(private getPriority: (item: T) => number) {}

  private parent(i: number) { return Math.floor((i - 1) / 2); }
  private left(i: number) { return 2 * i + 1; }
  private right(i: number) { return 2 * i + 2; }

  private swap(a: number, b: number) {
    const tmp = this.heap[a];
    this.heap[a] = this.heap[b];
    this.heap[b] = tmp;
  }

  enqueue(item: T) {
    const priority = this.getPriority(item);
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const p = this.parent(i);
      if (this.heap[p].priority <= this.heap[i].priority) break;
      this.swap(i, p);
      i = p;
    }
  }

  dequeue(): T {
    if (this.heap.length === 0) throw new Error("empty queue");

    const root = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return root;
  }

  private bubbleDown(i: number) {
    const n = this.heap.length;
    while (true) {
      const l = this.left(i);
      const r = this.right(i);
      let smallest = i;

      if (l < n && this.heap[l].priority < this.heap[smallest].priority) {
        smallest = l;
      }
      if (r < n && this.heap[r].priority < this.heap[smallest].priority) {
        smallest = r;
      }
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }
}

export function buildFaceAdjacency(geometry: THREE.BufferGeometry): Set<number>[] {
    const pos = geometry.attributes.position.array;
        const faceCount: number = pos.length / 9; // 3 verts per face, 3 coords per vert

        for (let f = 0; f < faceCount; f++) {
            const a = f * 9;
            const tri = [
                [pos[a + 0], pos[a + 1], pos[a + 2]],
                [pos[a + 3], pos[a + 4], pos[a + 5]],
                [pos[a + 6], pos[a + 7], pos[a + 8]],
            ];
        }

        const vertexMap = new Map<String, number>();
        const canonicalIndex: number[] = [];
        let nextId = 0;

        for (let i = 0; i < pos.length; i += 3) {
            const key = `${pos[i].toFixed(5)}_${pos[i + 1].toFixed(5)}_${pos[i + 2].toFixed(5)}`;
            // round to tolerance to handle floating error
            if (!vertexMap.has(key)) vertexMap.set(key, nextId++);
            canonicalIndex.push(vertexMap.get(key)!);
        }

        const faceNeighbors = Array.from({ length: faceCount }, () => new Set<number>());
        const edgeToFaces = new Map<String, number[]>();

        for (let f = 0; f < faceCount; f++) {
            const a = canonicalIndex[3 * f + 0];
            const b = canonicalIndex[3 * f + 1];
            const c = canonicalIndex[3 * f + 2];
            const edges = [[a, b], [b, c], [c, a]];

            for (const [i, j] of edges) {
                const key = i < j ? `${i}_${j}` : `${j}_${i}`;
                if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
                edgeToFaces.get(key)!.push(f);
            }
        }

        for (const faces of edgeToFaces.values()) {
            if (faces.length === 2) {
                const [f1, f2] = faces;
                faceNeighbors[f1].add(f2);
                faceNeighbors[f2].add(f1);
            }
        }

        return faceNeighbors

}

export function buildFaceAdjacencyBad(
  geometry: THREE.BufferGeometry
): Set<number>[] {
  const pos = geometry.attributes.position.array as Float32Array;
  const faceCount = pos.length / 9;

  // adjacency output
  const neighbors: Set<number>[] = Array.from(
    { length: faceCount },
    () => new Set<number>()
  );

  // helper to normalize an edge (so direction doesn't matter)
  const edgeKey = (a: number, b: number) =>
    a < b ? `${a}_${b}` : `${b}_${a}`;

  interface EdgeRecord { a: number; b: number; face: number; }

  const edges = new Map<string, EdgeRecord>();

  // For each face, extract its 3 vertex indices (relative indices)
  for (let f = 0; f < faceCount; f++) {
    const i = f * 9;

    // Positions are not indexed, so vertices are by absolute position index:
    const v0 = i / 3 + 0;
    const v1 = i / 3 + 1;
    const v2 = i / 3 + 2;

    const faceVerts = [v0, v1, v2];
    console.log(faceVerts)

    for (let e = 0; e < 3; e++) {
      const a = faceVerts[e];
      const b = faceVerts[(e + 1) % 3];
      const key = edgeKey(a, b);

      if (!edges.has(key)) {
        edges.set(key, { a, b, face: f });
      } else {
        const other = edges.get(key)!;
        neighbors[f].add(other.face);
        neighbors[other.face].add(f);
      }
    }
    console.log(edges)
  }

  return neighbors;
}

export function faceMostExtremeInDirection(
  geometry: THREE.BufferGeometry,
  direction: THREE.Vector3
): number {

  const pos = geometry.attributes.position.array as Float32Array;
  const faceCount = pos.length / 9;
  const dir = direction.clone().normalize();

  let bestFace = 0;
  let bestDot = -Infinity;

  for (let f = 0; f < faceCount; f++) {
    const i = f * 9;

    const cx =
      (pos[i + 0] + pos[i + 3] + pos[i + 6]) / 3;
    const cy =
      (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    const cz =
      (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;

    const c = new THREE.Vector3(cx, cy, cz);

    const dot = c.dot(dir);
    if (dot > bestDot) {
      bestDot = dot;
      bestFace = f;
    }
  }

  return bestFace;
}


export interface GeodesicInfo {
  dist: number;               // distance from origin face
  finalized: boolean;
}

/**
 * Approximate per-face geodesic distances using centroid distances
 */
export function computeFaceGeodesicDistances(
  startFace: number,
  faceNeighbors: Set<number>[],
  geometry: THREE.BufferGeometry
): GeodesicInfo[] {

  const pos = geometry.attributes.position.array as Float32Array;
  const faceCount = pos.length / 9;

  const centroids = new Array<THREE.Vector3>(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const i = f * 9;
    centroids[f] = new THREE.Vector3(
      (pos[i] + pos[i + 3] + pos[i + 6]) / 3,
      (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3,
      (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3,
    );
  }

  const info: GeodesicInfo[] = Array.from({ length: faceCount }, () => ({
    dist: Infinity,
    finalized: false,
  }));

  info[startFace].dist = 0;

  // Priority queue for geodesic front
  const pq = new MinPriorityQueue<{ face: number, dist: number }>(x => x.dist);

  pq.enqueue({ face: startFace, dist: 0 });

  while (!pq.isEmpty()) {
    const { face: f } = pq.dequeue();

    if (info[f].finalized) continue;
    info[f].finalized = true;

    const cF = centroids[f];

    for (const n of faceNeighbors[f]) {
      const cN = centroids[n];
      const d = info[f].dist + cF.distanceTo(cN); // centroid-to-centroid hop

      if (d < info[n].dist) {
        info[n].dist = d;
        pq.enqueue({ face: n, dist: d });
      }
    }
  }

  return info;
}

export function selectGeodesicRingFaces(
  info: GeodesicInfo[],
  r: number,
  epsilon: number = r * 0.1
): number[] {

  const indices: number[] = [];

  for (let f = 0; f < info.length; f++) {
    const d = info[f].dist;
    if (d >= r - epsilon && d <= r + epsilon) {
      indices.push(f);
    }
  }

  return indices;
}



/**
 * Find the face (only among the given subset) whose centroid
 * is most extreme in the given direction.
 */
export function faceMostExtremeInDirectionSubset(
  geometry: THREE.BufferGeometry,
  direction: THREE.Vector3,
  subset: number[]
): number {

  const pos = geometry.attributes.position.array as Float32Array;
  const dir = direction.clone().normalize();

  let bestFace = subset[0];
  let bestDot = -Infinity;

  for (const f of subset) {
    const i = f * 9;

    const cx = (pos[i + 0] + pos[i + 3] + pos[i + 6]) / 3;
    const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    const cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;

    const dot = cx * dir.x + cy * dir.y + cz * dir.z;

    if (dot > bestDot) {
      bestDot = dot;
      bestFace = f;
    }
  }

  return bestFace;
}

export function selectGeodesicDiskFaces(
  info: GeodesicInfo[],
  r: number
): number[] {
  const faces: number[] = [];
  for (let f = 0; f < info.length; f++) {
    if (info[f].dist <= r) {
      faces.push(f);
    }
  }
  return faces;
}



export function componentToHex(c: number) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

export function rgb2Hex(r: number, g: number, b: number) {
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

export let getImages = async (urls: string[]): Promise<[number, number, [number, number, number][][][]]> => {
    console.log(urls)
    let loader = new THREE.ImageBitmapLoader();
    loader.setOptions({ imageOrientation: 'flipY' })

    var canvas = document.createElement('canvas');
    let context2d = canvas.getContext('2d', { willReadFrequently: true })!;

    let frames = [];
    // can't use for loop here or order will be disrupted?
    let promises = urls.map(async url => {
        return await loader.loadAsync(url);
    })

    frames = await Promise.all(promises);
    let width = frames[0].width;
    let height = frames[0].height;

    canvas.width = width;
    canvas.height = height;
    let images: [number, number, number][][][] = [];
    for (let imageBitmap of frames) {
        context2d.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height);
        let rgba = context2d.getImageData(0, 0, imageBitmap.width, imageBitmap.height).data;
        console.log(rgba)
        let resultingImg: [number, number, number][][] = [];
        for (let i = 0; i < imageBitmap.height; i++) {
            let curRow: [number, number, number][] = [];
            for (let j = 0; j < imageBitmap.width; j++) {
                curRow.push([rgba[(i * imageBitmap.width + j) * 4], rgba[(i * imageBitmap.width + j) * 4 + 1], rgba[(i * imageBitmap.width + j) * 4 + 2]]);
            }
            resultingImg.push(curRow);
        }
        images.push(resultingImg);
        console.log(resultingImg.length)
        console.log(resultingImg[0].length)
        // nextFlips.push(this.generateFlipBitmap(resultingImg, [255, 255, 255]));
    }
    return [width, height, images];
}

export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): { x: number, y: number }[] {
    const points: { x: number, y: number }[] = [];
    
    // Calculate differences and absolute differences
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1; // Step direction in x
    const sy = (y0 < y1) ? 1 : -1; // Step direction in y
    
    let err = dx - dy; // Initial error decision parameter

    while (true) {
        points.push({ x: x0, y: y0 });

        if (x0 === x1 && y0 === y1) break;

        const e2 = 2 * err;
        if (e2 > -dy) { // Check if error is significant enough to step in Y
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) { // Check if error is significant enough to step in X
            err += dx;
            y0 += sy;
        }
    }
    return points;
}

export let frameDisplay = (frame: Colour[][]): string => {
    let str = "";
    for (let row of frame) {
        console.log()
        let strRow = "";
        for (let col of row) {
            // console.log(col)
            strRow += ` ${col == true ? "O" : "X"}`
            // strRow + col;
            // console.log(strRow);
        }
        str += strRow + "\n"
    }
    // console.log(str);
    return str;
}

export let inBounds = (coord: [number, number], bounds: [number, number]): boolean => {
    let [x, y] = coord;
    return (x >= 0 && x < bounds[0] && y >= 0 && y < bounds[1]);
}

export class Perlin {
  private perm: number[] = [];

  constructor(seed = 0) {
    const p = Array.from({ length: 256 }, (_, i) => i);

    let rand = seed || 1;
    const random = () => {
      rand = (rand * 16807) % 2147483647;
      return rand / 2147483647;
    };

    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }

    this.perm = [...p, ...p];
  }

  private fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number) {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number) {
    const h = hash & 3;
    return (h === 0 ? x : h === 1 ? -x : h === 2 ? y : -y);
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.perm[X + this.perm[Y]];
    const ab = this.perm[X + this.perm[Y + 1]];
    const ba = this.perm[X + 1 + this.perm[Y]];
    const bb = this.perm[X + 1 + this.perm[Y + 1]];

    const x1 = this.lerp(
      this.grad(aa, xf, yf),
      this.grad(ba, xf - 1, yf),
      u
    );

    const x2 = this.lerp(
      this.grad(ab, xf, yf - 1),
      this.grad(bb, xf - 1, yf - 1),
      u
    );

    return this.lerp(x1, x2, v); // range ≈ [-1,1]
  }
}