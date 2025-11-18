// this is just chatgpt
import * as THREE from "three";
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
