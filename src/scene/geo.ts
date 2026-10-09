import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Vec2 } from '../types';

/** plan point at a height → world vector (plan y becomes z) */
export const w3 = (p: Vec2, y: number) => new THREE.Vector3(p[0], y, p[1]);

/** collects flat-shaded triangles */
export class MeshBuilder {
  private pos: number[] = [];

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  /** quad a-b-c-d, counter-clockwise seen from its front */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** prism over a 4-point footprint (ordered around) from y0 to y1 */
  prism(f: Vec2[], y0: number, y1: number) {
    const lo = f.map((p) => w3(p, y0));
    const hi = f.map((p) => w3(p, y1));
    // plan (x, y) maps to world (x, z), which seen from above is mirrored: a positive
    // plan area is clockwise from above, so reverse it to get outward-facing triangles
    const area = f.reduce((s, p, i) => {
      const q = f[(i + 1) % f.length];
      return s + (p[0] * q[1] - q[0] * p[1]);
    }, 0);
    const order = area > 0 ? [3, 2, 1, 0] : [0, 1, 2, 3];
    const L = order.map((i) => lo[i]);
    const Hh = order.map((i) => hi[i]);
    this.quad(Hh[0], Hh[1], Hh[2], Hh[3]);
    this.quad(L[3], L[2], L[1], L[0]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(L[i], L[j], Hh[j], Hh[i]);
    }
  }

  get empty() {
    return this.pos.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** collects line segments for one fat-line object */
export class LineBuilder {
  pos: number[] = [];

  seg(a: THREE.Vector3, b: THREE.Vector3) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  loop(points: THREE.Vector3[]) {
    for (let i = 0; i < points.length; i++) this.seg(points[i], points[(i + 1) % points.length]);
  }

  get empty() {
    return this.pos.length === 0;
  }

  build(material: LineMaterial): LineSegments2 {
    const g = new LineSegmentsGeometry();
    g.setPositions(this.pos);
    const l = new LineSegments2(g, material);
    l.computeLineDistances();
    // outlines are decoration; taps go to the meshes they outline
    l.raycast = () => {};
    return l;
  }
}

/** every LineMaterial needs the canvas size; the engine keeps them in sync */
export const lineMaterials = new Set<LineMaterial>();
export const lineResolution = new THREE.Vector2(window.innerWidth, window.innerHeight);

export function lineMaterial(color: number, width: number, opacity = 1): LineMaterial {
  const m = new LineMaterial({
    color,
    linewidth: width,
    transparent: opacity < 1,
    opacity,
    worldUnits: false,
  });
  m.resolution.copy(lineResolution);
  lineMaterials.add(m);
  return m;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bounds(points: Vec2[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** a flat slab from a polygon: top face at y = top, `depth` thick */
export function slabGeometry(poly: Vec2[], top: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // extrusion runs along +z; turn it so the shape lies in x/z with its cap facing up at y = 0
  g.rotateX(Math.PI / 2);
  g.translate(0, top, 0);
  return g;
}

export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (mat instanceof LineMaterial) lineMaterials.delete(mat);
      (mat as THREE.Material).dispose?.();
    }
  });
}
