// A DOM-free simulation of a flipdot board wrapped onto a 3D surface.
//
// It takes a UV DotField (see uvdots.ts) placed by a world matrix, renders one
// physically-flipping disc per unit, and is driven entirely by on/off states
// pushed in from outside (setStates). It knows nothing about the DOM, the
// controls, orders, or how the states are produced — so it can be driven by an
// order, a sampled image, or real hardware output, and dropped into any scene.
//
// Each disc is a two-sided flap: a metallic front face and a matte back face.
// "On" vs "off" is purely which face points outward, so the flip rotation alone
// tells them apart — no color swapping. (For metals to look right the scene
// should have an environment map so they have something to reflect.)

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DotField } from './uvdots';

export type FlipdotSimOptions = {
  fill?: number;        // drawn disc radius as a fraction of the cell half-pitch (default 0.9)
  baseLift?: number;    // resting standoff off the surface, in disc radii (default 0.25)
  flipSeconds?: number; // time for one 180° flip (default 0.4)
  segments?: number;    // circle tessellation (default 16)
  onColor?: THREE.ColorRepresentation;  // front face (default 0xc0c0c0, silver)
  offColor?: THREE.ColorRepresentation; // back face (default 0x707070)
  frontMetalness?: number; // front face metalness (default 0.9 => metal)
  frontRoughness?: number; // front face roughness (default 0.35 => shiny)
  backRoughness?: number;  // back (matte) face roughness (default 0.85)
};

export class FlipdotSim {
  readonly object3d = new THREE.Group();
  flipSeconds: number;

  private fill: number;
  private baseLift: number;
  private segments: number;
  private onColor: THREE.Color;
  private offColor: THREE.Color;
  private frontMetalness: number;
  private frontRoughness: number;
  private backRoughness: number;

  private mesh: THREE.InstancedMesh | null = null;
  private frontMat: THREE.MeshStandardMaterial | null = null;
  private backMat: THREE.MeshStandardMaterial | null = null;
  private count = 0;
  private radius = 1; // world-space drawn disc radius

  // Per-disc pose. A disc rotates about its in-plane hinge from angle 0
  // (front facing outward) to π (flipped so the back faces outward).
  private pos: THREE.Vector3[] = [];     // resting position, on the surface
  private normal: THREE.Vector3[] = [];  // surface normal (flip bulges along this)
  private baseQuat: THREE.Quaternion[] = []; // orientation with +Z along the normal
  private hinge: THREE.Vector3[] = [];   // in-plane axis the disc flips about
  private angle: Float32Array = new Float32Array(0);  // current flip angle
  private target: Float32Array = new Float32Array(0); // desired flip angle (0 or π)
  private frozen = false; // static/debug mode: skip flip animation

  // scratch
  private _q = new THREE.Quaternion();
  private _wq = new THREE.Quaternion();
  private _m = new THREE.Matrix4();
  private _pivot = new THREE.Vector3();
  private readonly _one = new THREE.Vector3(1, 1, 1);
  private readonly _white = new THREE.Color(1, 1, 1);

  constructor(opts: FlipdotSimOptions = {}) {
    this.fill = opts.fill ?? 0.9;
    this.baseLift = opts.baseLift ?? 0.25;
    this.flipSeconds = opts.flipSeconds ?? 0.4;
    this.segments = opts.segments ?? 16;
    this.onColor = new THREE.Color(opts.onColor ?? 0xc0c0c0);
    this.offColor = new THREE.Color(opts.offColor ?? 0x707070);
    this.frontMetalness = opts.frontMetalness ?? 0.9;
    this.frontRoughness = opts.frontRoughness ?? 0.35;
    this.backRoughness = opts.backRoughness ?? 0.85;
  }

  get unitCount(): number { return this.count; }
  get discRadius(): number { return this.radius; }
  get visible(): boolean { return this.object3d.visible; }
  set visible(v: boolean) { this.object3d.visible = v; }

  // Build discs from a dot field. `worldMatrix` places the mesh's local coords
  // in the scene; `cellRadiusWorld` is the cell half-pitch in world units (the
  // disc is drawn at cellRadiusWorld × fill). Replaces any previous build.
  build(field: DotField, worldMatrix: THREE.Matrix4, cellRadiusWorld: number): void {
    this.dispose();
    const dots = field.dots;
    this.count = dots.length;
    this.radius = cellRadiusWorld * this.fill;

    // Two coincident circles back-to-back: group 0 faces +Z (front), group 1
    // faces −Z (back). Tiny z offsets avoid z-fighting where they meet.
    const front = new THREE.CircleGeometry(this.radius, this.segments);
    front.translate(0, 0, this.radius * 0.01);
    const back = new THREE.CircleGeometry(this.radius, this.segments);
    back.rotateY(Math.PI);
    back.translate(0, 0, -this.radius * 0.01);
    const geom = mergeGeometries([front, back], true); // useGroups => materialIndex 0/1
    front.dispose();
    back.dispose();

    // Front = metal (reflects the scene's environment). Back = matte.
    this.frontMat = new THREE.MeshStandardMaterial({
      color: this.onColor.clone(), side: THREE.FrontSide,
      metalness: this.frontMetalness, roughness: this.frontRoughness,
    });
    this.backMat = new THREE.MeshStandardMaterial({
      color: this.offColor.clone(), side: THREE.FrontSide,
      metalness: 0, roughness: this.backRoughness,
    });

    const inst = new THREE.InstancedMesh(geom, [this.frontMat, this.backMat], this.count);
    this.mesh = inst;

    const normalMat = new THREE.Matrix3().getNormalMatrix(worldMatrix);
    const zAxis = new THREE.Vector3(0, 0, 1);
    const localX = new THREE.Vector3(1, 0, 0);
    const wp = new THREE.Vector3();
    const wn = new THREE.Vector3();
    const q = new THREE.Quaternion();

    this.pos = new Array(this.count);
    this.normal = new Array(this.count);
    this.baseQuat = new Array(this.count);
    this.hinge = new Array(this.count);
    this.angle = new Float32Array(this.count).fill(Math.PI);  // start off (back out)
    this.target = new Float32Array(this.count).fill(Math.PI);

    for (let i = 0; i < this.count; i++) {
      const d = dots[i];
      wp.copy(d.position).applyMatrix4(worldMatrix);
      wn.copy(d.normal).applyMatrix3(normalMat).normalize();
      q.setFromUnitVectors(zAxis, wn);
      wp.addScaledVector(wn, this.radius * this.baseLift); // small resting standoff
      this.pos[i] = wp.clone();
      this.normal[i] = wn.clone();
      this.baseQuat[i] = q.clone();
      this.hinge[i] = localX.clone().applyQuaternion(q).normalize();
      this.writeMatrix(i, this.angle[i]);
    }
    inst.instanceMatrix.needsUpdate = true;

    this.object3d.add(inst);
  }

  // Set target states. `on` may be a Set of unit ids that are on, or an
  // array-like of 0/1 (index == unit id). Units flip toward the new state.
  setStates(on: Set<number> | ArrayLike<number>): void {
    if (!this.count) return;
    this.frozen = false;
    if (on instanceof Set) {
      for (let i = 0; i < this.count; i++) this.target[i] = on.has(i) ? 0 : Math.PI;
    } else {
      for (let i = 0; i < this.count; i++) this.target[i] = on[i] ? 0 : Math.PI;
    }
  }

  // Advance flips toward their targets. `dt` is seconds since the last frame.
  update(dt: number): void {
    if (this.frozen || !this.mesh || !this.count) return;
    const step = (Math.PI / this.flipSeconds) * dt;
    let changed = false;
    for (let i = 0; i < this.count; i++) {
      const t = this.target[i];
      let a = this.angle[i];
      if (a === t) continue;
      const d = t - a;
      a = Math.abs(d) <= step ? t : a + Math.sign(d) * step;
      this.angle[i] = a;
      this.writeMatrix(i, a);
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Update the front (on) and/or back (off) face colors. Either arg may be
  // omitted to leave that face unchanged. Applies to the shared face materials.
  setColors(on?: THREE.ColorRepresentation, off?: THREE.ColorRepresentation): void {
    if (on !== undefined) { this.onColor.set(on); this.frontMat?.color.copy(this.onColor); }
    if (off !== undefined) { this.offColor.set(off); this.backMat?.color.copy(this.offColor); }
  }

  // Debug/static coloring: freeze all discs flat (front facing out) and tint
  // each by a per-unit color (via instanceColor). Pass null to resume flips and
  // clear the tint so the face materials show through again.
  setStaticColors(colors: ArrayLike<THREE.Color> | null): void {
    if (!this.mesh) return;
    if (!colors) {
      this.frozen = false;
      if (this.mesh.instanceColor) {
        for (let i = 0; i < this.count; i++) this.mesh.setColorAt(i, this._white);
        this.mesh.instanceColor.needsUpdate = true;
      }
      return;
    }
    this.frozen = true;
    for (let i = 0; i < this.count; i++) {
      this.angle[i] = 0;
      this.writeMatrix(i, 0);
      this.mesh.setColorAt(i, colors[i] ?? this.onColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh) {
      this.object3d.remove(this.mesh);
      this.mesh.geometry.dispose();
      const mats = this.mesh.material;
      if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
      else (mats as THREE.Material).dispose();
      this.mesh = null;
    }
    this.frontMat = null;
    this.backMat = null;
    this.count = 0;
  }

  // Compose one disc's matrix for flip angle `a`.
  private writeMatrix(i: number, a: number): void {
    this._q.setFromAxisAngle(this.hinge[i], a);
    this._wq.multiplyQuaternions(this._q, this.baseQuat[i]);
    // Push the pivot outward by r·sin(a): the disc's lower edge swings down by
    // exactly r·sin(a) as it rotates, so this keeps that edge at the resting
    // height instead of diving into the mesh. Zero at rest (a = 0 or π).
    this._pivot.copy(this.pos[i]).addScaledVector(this.normal[i], this.radius * Math.sin(a));
    this._m.compose(this._pivot, this._wq, this._one);
    this.mesh!.setMatrixAt(i, this._m);
  }
}
