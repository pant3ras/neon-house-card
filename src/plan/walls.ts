// Wall layout: turns room outlines into a clean set of wall segments (shared edges once,
// collinear pieces merged), works out mitred corners and cuts openings into them.
// Pure geometry – no three.js – so it can be reasoned about and tested on its own.

import type { Floor, Opening, Room, Vec2 } from '../types';

export const EXTERIOR_T = 0.3;
export const INTERIOR_T = 0.12;
const EPS = 0.02;

export interface WallSeg {
  a: Vec2;
  b: Vec2;
  t: number;
  height?: number;
  exterior: boolean;
}

export interface WallOpening {
  opening: Opening;
  s: number; // start along the wall
  e: number; // end along the wall
  bottom: number;
  top: number;
}

export interface LaidWall extends WallSeg {
  len: number;
  dir: Vec2; // unit a→b
  nrm: Vec2; // unit left normal
  /** where each face starts/ends along the wall (may reach past 0 / len at mitred corners) */
  faceStart: { l: number; r: number };
  faceEnd: { l: number; r: number };
  freeStart: boolean;
  freeEnd: boolean;
  openings: WallOpening[];
}

export interface WallPiece {
  s: number;
  e: number;
  y0: number;
  y1: number;
}

const key = (p: Vec2) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

/** distance from p to segment ab and the position along it (0..|ab|) */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { dist: number; u: number } {
  const ab = sub(b, a);
  const L = len(ab);
  const d = norm(ab);
  const u = Math.max(0, Math.min(L, dot(sub(p, a), d)));
  const q: Vec2 = [a[0] + d[0] * u, a[1] + d[1] * u];
  return { dist: len(sub(p, q)), u };
}

/**
 * wall segments of a floor: room edges split at every vertex lying on them, shared ones once.
 * No wall between two rooms of the same `group`, and none on the outside of an `open` room.
 */
export function wallSegments(floor: Floor): WallSeg[] {
  const rooms = floor.rooms.filter((r) => r.polygon.length >= 3);
  const vertices: Vec2[] = rooms.flatMap((r) => r.polygon);
  const counts = new Map<string, { a: Vec2; b: Vec2; rooms: Room[] }>();

  for (const room of rooms) {
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const L = len(sub(b, a));
      if (L < EPS) continue;
      // split at other rooms' corners lying on this edge
      const cuts = [0, L];
      for (const v of vertices) {
        const { dist, u } = projectOnSegment(v, a, b);
        if (dist < EPS && u > EPS && u < L - EPS) cuts.push(u);
      }
      cuts.sort((x, y) => x - y);
      const d = norm(sub(b, a));
      for (let k = 0; k < cuts.length - 1; k++) {
        if (cuts[k + 1] - cuts[k] < EPS) continue;
        const p: Vec2 = [a[0] + d[0] * cuts[k], a[1] + d[1] * cuts[k]];
        const q: Vec2 = [a[0] + d[0] * cuts[k + 1], a[1] + d[1] * cuts[k + 1]];
        const [ka, kb] = [key(p), key(q)];
        const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const hit = counts.get(id);
        if (hit) hit.rooms.push(room);
        else counts.set(id, { a: p, b: q, rooms: [room] });
      }
    }
  }

  let segs: WallSeg[] = [];
  for (const { a, b, rooms: owners } of counts.values()) {
    if (owners.length === 1) {
      if (!owners[0].open) segs.push({ a, b, exterior: true, t: EXTERIOR_T });
      continue;
    }
    const groups = owners.map((r) => r.group);
    if (groups[0] && groups.every((g) => g === groups[0])) continue; // one open space
    segs.push({ a, b, exterior: false, t: INTERIOR_T });
  }
  segs = mergeCollinear(segs);
  for (const w of floor.walls ?? []) {
    segs.push({ a: w.a, b: w.b, t: w.thickness ?? INTERIOR_T, height: w.height, exterior: false });
  }
  return segs;
}

/** joins straight runs that were split at a vertex nothing else meets */
function mergeCollinear(segs: WallSeg[]): WallSeg[] {
  let changed = true;
  while (changed) {
    changed = false;
    const at = new Map<string, number[]>();
    segs.forEach((s, i) => {
      for (const p of [s.a, s.b]) {
        const k = key(p);
        if (!at.has(k)) at.set(k, []);
        at.get(k)!.push(i);
      }
    });
    for (const [k, idx] of at) {
      if (idx.length !== 2) continue;
      const [s1, s2] = [segs[idx[0]], segs[idx[1]]];
      if (s1.exterior !== s2.exterior) continue;
      const far1 = key(s1.a) === k ? s1.b : s1.a;
      const far2 = key(s2.a) === k ? s2.b : s2.a;
      const d1 = norm(sub(far1, s1.a === far1 ? s1.b : s1.a));
      const d2 = norm(sub(far2, s2.a === far2 ? s2.b : s2.a));
      if (Math.abs(cross(d1, d2)) > 1e-3 || dot(d1, d2) > 0) continue;
      const merged: WallSeg = { ...s1, a: far1, b: far2 };
      segs = segs.filter((_, i) => i !== idx[0] && i !== idx[1]);
      segs.push(merged);
      changed = true;
      break;
    }
  }
  return segs;
}

interface EndRef {
  wall: number;
  atStart: boolean;
  d: Vec2; // direction pointing away from the node
  t: number;
}

/** intersection parameter λ along line p + λd with line q + μe */
function intersectLambda(p: Vec2, d: Vec2, q: Vec2, e: Vec2): number | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-6) return null;
  return cross(sub(q, p), e) / den;
}

/** mitred corners, free ends and openings for every wall of a floor */
export function layoutWalls(floor: Floor, cutHeight?: number): LaidWall[] {
  const segs = wallSegments(floor);
  const walls: LaidWall[] = segs.map((s) => {
    const dir = norm(sub(s.b, s.a));
    return {
      ...s,
      len: len(sub(s.b, s.a)),
      dir,
      nrm: [-dir[1], dir[0]] as Vec2,
      faceStart: { l: 0, r: 0 },
      faceEnd: { l: 0, r: 0 },
      freeStart: false,
      freeEnd: false,
      openings: [],
    };
  });

  // group wall ends by node
  const nodes = new Map<string, { p: Vec2; ends: EndRef[] }>();
  walls.forEach((w, i) => {
    for (const atStart of [true, false]) {
      const p = atStart ? w.a : w.b;
      const k = key(p);
      if (!nodes.has(k)) nodes.set(k, { p, ends: [] });
      nodes.get(k)!.ends.push({ wall: i, atStart, d: atStart ? w.dir : [-w.dir[0], -w.dir[1]], t: w.t });
    }
  });

  const setFace = (end: EndRef, side: 1 | -1, lambda: number) => {
    const w = walls[end.wall];
    // λ is measured from the node along d; convert to the wall's u and to its own l/r faces
    // (seen from the far end the left face is the wall's right face)
    const wallSide = end.atStart ? side : (-side as 1 | -1);
    const slot = wallSide === 1 ? 'l' : 'r';
    if (end.atStart) w.faceStart[slot] = lambda;
    else w.faceEnd[slot] = w.len - lambda;
  };

  for (const { p, ends } of nodes.values()) {
    for (const end of ends) {
      const w = walls[end.wall];
      if (end.atStart) w.faceStart = { l: 0, r: 0 };
      else w.faceEnd = { l: w.len, r: w.len };
    }
    if (ends.length === 1) {
      const w = walls[ends[0].wall];
      if (ends[0].atStart) w.freeStart = true;
      else w.freeEnd = true;
      continue;
    }
    const faceLine = (end: EndRef, side: 1 | -1): [Vec2, Vec2] => {
      const n: Vec2 = [-end.d[1], end.d[0]];
      return [[p[0] + n[0] * side * end.t / 2, p[1] + n[1] * side * end.t / 2], end.d];
    };
    if (ends.length === 2) {
      const [A, B] = ends;
      if (Math.abs(cross(A.d, B.d)) < 1e-3) continue; // straight continuation
      for (const s of [1, -1] as const) {
        const [pa, da] = faceLine(A, s);
        const [pb, db] = faceLine(B, -s as 1 | -1);
        const la = intersectLambda(pa, da, pb, db);
        const lb = intersectLambda(pb, db, pa, da);
        if (la !== null && Math.abs(la) < 2) setFace(A, s, la);
        if (lb !== null && Math.abs(lb) < 2) setFace(B, -s as 1 | -1, lb);
      }
      continue;
    }
    // three or more: the most opposite pair runs through, every other wall stops at its faces
    let best: [number, number] = [0, 1];
    let bestDot = Infinity;
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const dd = dot(ends[i].d, ends[j].d);
        if (dd < bestDot) {
          bestDot = dd;
          best = [i, j];
        }
      }
    const through = best.map((i) => ends[i]);
    for (let i = 0; i < ends.length; i++) {
      if (best.includes(i)) continue;
      const stem = ends[i];
      for (const s of [1, -1] as const) {
        const [ps, ds] = faceLine(stem, s);
        let lambda = 0;
        for (const T of through)
          for (const ts of [1, -1] as const) {
            const [pt, dt] = faceLine(T, ts);
            const l = intersectLambda(ps, ds, pt, dt);
            if (l !== null && l > lambda && l < 2) lambda = l;
          }
        setFace(stem, s, lambda);
      }
    }
  }

  // openings onto their nearest wall
  for (const o of floor.openings ?? []) {
    let bestWall = -1;
    let bestDist = 0.6;
    let bestU = 0;
    walls.forEach((w, i) => {
      const { dist, u } = projectOnSegment(o.at, w.a, w.b);
      if (dist < bestDist) {
        bestDist = dist;
        bestWall = i;
        bestU = u;
      }
    });
    if (bestWall < 0) continue;
    const w = walls[bestWall];
    const H = Math.min(w.height ?? floor.height, cutHeight ?? Infinity);
    const half = o.width / 2;
    const s = Math.max(0.02, bestU - half);
    const e = Math.min(w.len - 0.02, bestU + half);
    const defaults = OPENING_DEFAULTS[o.type];
    const bottom = o.type === 'window' ? (o.sill ?? defaults.sill) : 0;
    const top = Math.min(H, bottom + (o.height ?? defaults.height));
    w.openings.push({ opening: o, s, e, bottom: Math.min(bottom, H), top });
  }
  for (const w of walls) w.openings.sort((x, y) => x.s - y.s);
  return walls;
}

export const OPENING_DEFAULTS = {
  door: { height: 2.05, sill: 0 },
  window: { height: 1.3, sill: 0.9 },
  garage: { height: 2.2, sill: 0 },
  gap: { height: 2.3, sill: 0 },
} as const;

/** solid boxes of a wall around its openings, in wall coordinates (u along, y up) */
export function wallPieces(w: LaidWall, H: number): WallPiece[] {
  const pieces: WallPiece[] = [];
  let u = 0;
  for (const o of w.openings) {
    if (o.s > u) pieces.push({ s: u, e: o.s, y0: 0, y1: H });
    if (o.bottom > 0.001) pieces.push({ s: o.s, e: o.e, y0: 0, y1: o.bottom });
    if (o.top < H - 0.001) pieces.push({ s: o.s, e: o.e, y0: o.top, y1: H });
    u = Math.max(u, o.e);
  }
  if (u < w.len) pieces.push({ s: u, e: w.len, y0: 0, y1: H });
  return pieces;
}

/** world-plan position of (u along the wall, v across it, + = left face) */
export function wallPoint(w: LaidWall, u: number, v: number): Vec2 {
  return [w.a[0] + w.dir[0] * u + w.nrm[0] * v, w.a[1] + w.dir[1] * u + w.nrm[1] * v];
}

/** where a face line actually starts/ends for a piece spanning [s, e] */
export function faceRange(w: LaidWall, side: 'l' | 'r', s: number, e: number): [number, number] {
  return [s <= 0.0001 ? w.faceStart[side] : s, e >= w.len - 0.0001 ? w.faceEnd[side] : e];
}
