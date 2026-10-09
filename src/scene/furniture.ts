// Furniture: each piece is a rectangle on the plan plus a type. The side against the wall (a
// bed's head, a wardrobe's back) is found from the nearest wall unless the plan names it.
// Built from simple boxes with soft outlines so it reads as furniture without stealing the glow.

import * as THREE from 'three';
import type { Floor, Furniture, Side } from '../types';
import { projectOnSegment, type LaidWall } from '../plan/walls';
import { LineBuilder, lineMaterial } from './geo';
import type { Theme } from './theme';

interface Palette {
  body: number;
  wood: number;
  fabric: number;
  mattress: number;
  pillow: number;
  blanket: number;
  top: number;
  screen: number;
  /** sanitary ware and appliances */
  white: number;
  metal: number;
  water: number;
  edge: number;
  edgeOpacity: number;
  opacity: number;
}

const PALETTES: Record<Theme['name'], Palette> = {
  neon: {
    body: 0x14284c, wood: 0x1b3260, fabric: 0x1f3a6e, mattress: 0x2a4a85, pillow: 0x3d63a8, blanket: 0x24427c,
    top: 0x2a4a80, screen: 0x3d8bff, white: 0x2c4f86, metal: 0x24406e, water: 0x1f78c8,
    edge: 0x5cc4f0, edgeOpacity: 0.45, opacity: 1,
  },
  blueprint: {
    body: 0x1d4c93, wood: 0x1d4c93, fabric: 0x2a5aa3, mattress: 0x2f63b0, pillow: 0x3a70bf, blanket: 0x2a5aa3,
    top: 0x2f63b0, screen: 0xbfe0ff, white: 0x3a70bf, metal: 0x2f63b0, water: 0x8fc4ff,
    edge: 0xe8f2ff, edgeOpacity: 0.55, opacity: 0.55,
  },
  day: {
    body: 0xe9e4da, wood: 0xb8875a, fabric: 0x7f96b8, mattress: 0xf4f3ee, pillow: 0xffffff, blanket: 0x9fb4d3,
    top: 0xd9cbb4, screen: 0x223044, white: 0xfbfbf8, metal: 0xc9ced6, water: 0x9fd4ff,
    edge: 0x6f7f94, edgeOpacity: 0.35, opacity: 1,
  },
};

const DEFAULT_HEIGHT: Record<string, number> = {
  bed: 1.0, wardrobe: 2.2, dresser: 0.85, desk: 0.76, sofa: 0.82, bookshelf: 2.0,
  counter: 0.9, cabinet: 2.0, fridge: 1.85, table: 0.76, chair: 0.9, bathtub: 0.55, shower: 2.05, stove: 0.9, box: 0.8,
};

/** the side of a rectangle closest to a wall; beds pick from their short sides, others from their long sides */
export function backSide(f: Furniture, walls: LaidWall[]): Side {
  if (f.back) return f.back;
  const [x0, x1] = [Math.min(f.from[0], f.to[0]), Math.max(f.from[0], f.to[0])];
  const [y0, y1] = [Math.min(f.from[1], f.to[1]), Math.max(f.from[1], f.to[1])];
  const wide = x1 - x0 >= y1 - y0;
  const mids: Record<Side, [number, number]> = {
    up: [(x0 + x1) / 2, y0],
    down: [(x0 + x1) / 2, y1],
    left: [x0, (y0 + y1) / 2],
    right: [x1, (y0 + y1) / 2],
  };
  // the long sides of a wide piece are up/down; a bed's head is on a short side, anything else
  // prefers a long side unless a short one is clearly closer to a wall (a fridge in a corner)
  const longSides: Side[] = wide ? ['up', 'down'] : ['left', 'right'];
  const shortSides: Side[] = wide ? ['left', 'right'] : ['up', 'down'];
  const candidates: [Side, number][] =
    f.type === 'bed' ? shortSides.map((s) => [s, 0]) : [...longSides.map((s): [Side, number] => [s, 0]), ...shortSides.map((s): [Side, number] => [s, 0.15])];
  let best = candidates[0][0];
  let bestScore = Infinity;
  for (const [s, penalty] of candidates) {
    for (const w of walls) {
      const score = projectOnSegment(mids[s], w.a, w.b).dist + penalty;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
  }
  return best;
}

/** all furniture of a floor in one group (floor-local heights) */
export function buildFurniture(floor: Floor, walls: LaidWall[], theme: Theme, maxHeight: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'furniture';
  const items = floor.furniture ?? [];
  if (!items.length) return group;
  const pal = PALETTES[theme.name];
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: number, emissive = 0) => {
    const key = `${color}:${emissive}`;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.75,
        metalness: 0.05,
        transparent: pal.opacity < 1,
        opacity: pal.opacity,
        emissive: emissive || (theme.name === 'neon' ? 0x050c1c : 0x000000),
        emissiveIntensity: emissive ? 0.9 : 1,
      });
      mats.set(key, m);
    }
    return m;
  };
  const glass = new THREE.MeshStandardMaterial({
    color: theme.glass,
    transparent: true,
    opacity: theme.name === 'day' ? 0.3 : 0.2,
    roughness: 0.1,
    metalness: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const edges = new LineBuilder();
  const ceiling = floor.height;

  for (const f of items) {
    if (!Array.isArray(f.from) || !Array.isArray(f.to)) continue;
    const x0 = Math.min(f.from[0], f.to[0]);
    const x1 = Math.max(f.from[0], f.to[0]);
    const z0 = Math.min(f.from[1], f.to[1]);
    const z1 = Math.max(f.from[1], f.to[1]);
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
    const back = backSide(f, walls);
    const alongX = back === 'up' || back === 'down';
    const L = alongX ? x1 - x0 : z1 - z0; // along the back
    const D = alongX ? z1 - z0 : x1 - x0; // from the back to the front
    const H = Math.min(f.height ?? DEFAULT_HEIGHT[f.type] ?? 0.8, maxHeight);
    const zb = f.z ?? 0; // standing on something (a terrace slab)

    /** a box in the piece's own frame: u along the back, v away from it, h up */
    const box = (
      u0: number, u1: number, v0: number, v1: number, h0: number, h1: number,
      color: number | THREE.Material, emissive = 0, outline = true,
    ) => {
      h1 = Math.min(h1, maxHeight);
      if (h1 - h0 < 0.005) return;
      let ax0: number, ax1: number, az0: number, az1: number;
      if (back === 'up') [ax0, ax1, az0, az1] = [x0 + u0, x0 + u1, z0 + v0, z0 + v1];
      else if (back === 'down') [ax0, ax1, az0, az1] = [x0 + u0, x0 + u1, z1 - v1, z1 - v0];
      else if (back === 'left') [ax0, ax1, az0, az1] = [x0 + v0, x0 + v1, z0 + u0, z0 + u1];
      else [ax0, ax1, az0, az1] = [x1 - v1, x1 - v0, z0 + u0, z0 + u1];
      const material = typeof color === 'number' ? mat(color, emissive) : color;
      const m = new THREE.Mesh(new THREE.BoxGeometry(ax1 - ax0, h1 - h0, az1 - az0), material);
      m.position.set((ax0 + ax1) / 2, (h0 + h1) / 2 + zb, (az0 + az1) / 2);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      if (outline) boxEdges(edges, ax0, ax1, h0 + zb, h1 + zb, az0, az1);
    };
    /** a point in the piece's own frame */
    const P = (u: number, v: number, h: number) => {
      if (back === 'up') return new THREE.Vector3(x0 + u, h + zb, z0 + v);
      if (back === 'down') return new THREE.Vector3(x0 + u, h + zb, z1 - v);
      if (back === 'left') return new THREE.Vector3(x0 + v, h + zb, z0 + u);
      return new THREE.Vector3(x1 - v, h + zb, z0 + u);
    };
    /** a line on a front face (at depth v) between two (u, h) points */
    const frontLine = (u0: number, h0: number, u1: number, h1: number, v = D) => {
      if (Math.max(h0, h1) <= maxHeight) edges.seg(P(u0, v + 0.004, h0), P(u1, v + 0.004, h1));
    };
    /** which end of the back a plan side is (sofa arms) */
    const endOf = (s: Side): 'start' | 'end' | null => {
      if (alongX) return s === 'left' ? 'start' : s === 'right' ? 'end' : null;
      return s === 'up' ? 'start' : s === 'down' ? 'end' : null;
    };

    switch (f.type) {
      case 'bed': {
        box(0, L, 0, D, 0, 0.32, pal.wood);
        box(0.03, L - 0.03, 0.04, D - 0.03, 0.32, 0.52, pal.mattress, 0, false);
        box(0, L, 0, 0.07, 0, H, pal.wood);
        const n = L > 1.3 ? 2 : 1;
        const pw = (L - 0.2) / n - 0.08;
        for (let i = 0; i < n; i++) {
          const u = 0.1 + i * (pw + 0.08) + 0.04;
          box(u, u + pw, 0.1, 0.48, 0.52, 0.64, pal.pillow, 0, false);
        }
        box(0.01, L - 0.01, D * 0.38, D - 0.01, 0.52, 0.57, pal.blanket);
        break;
      }
      case 'wardrobe':
      case 'cabinet': {
        box(0, L, 0, D, 0, H, pal.body);
        const doors = Math.max(1, Math.round(L / (f.type === 'cabinet' ? 0.6 : 0.55)));
        for (let i = 1; i < doors; i++) frontLine((L * i) / doors, 0.06, (L * i) / doors, H - 0.06);
        for (let i = 0; i < doors; i++) {
          const u = (L * (i + 0.5)) / doors + (i % 2 ? -1 : 1) * (L / doors) * 0.35;
          frontLine(u, H * 0.45, u, H * 0.58);
        }
        break;
      }
      case 'fridge': {
        box(0, L, 0, D, 0, H, pal.white);
        if (L > 0.8) {
          // side-by-side: two tall doors with handles meeting in the middle
          frontLine(L / 2, 0.04, L / 2, H - 0.04);
          frontLine(L / 2 - 0.06, H * 0.4, L / 2 - 0.06, H * 0.75);
          frontLine(L / 2 + 0.06, H * 0.4, L / 2 + 0.06, H * 0.75);
        } else {
          // freezer below, fridge above
          frontLine(0.02, H * 0.36, L - 0.02, H * 0.36);
          frontLine(L - 0.08, H * 0.42, L - 0.08, H * 0.7);
          frontLine(L - 0.08, H * 0.12, L - 0.08, H * 0.3);
        }
        box(L * 0.6, L * 0.8, D, D + 0.005, H * 0.78, H * 0.84, 0x0a0f1a, pal.screen, false);
        break;
      }
      case 'bathtub': {
        box(0, L, 0, D, 0, H, pal.white);
        box(0.08, L - 0.08, 0.08, D - 0.08, H - 0.12, H - 0.02, pal.water, pal.water, false);
        box(L - 0.16, L - 0.1, 0.02, 0.1, H, H + 0.18, pal.metal, 0, false);
        break;
      }
      case 'shower': {
        // a walk-in shower: flat tray, one fixed glass pane on the open side, head on the wall
        box(0, L, 0, D, 0, 0.05, pal.white);
        box(L * 0.4, L, D - 0.03, D, 0.05, H, glass, 0, true);
        box(0.12, 0.16, 0.02, 0.06, 0.05, H, pal.metal, 0, false);
        box(0.04, 0.24, 0.04, 0.3, H - 0.04, H, pal.metal, pal.screen, false);
        break;
      }
      case 'stove': {
        // a free-standing cooker: glass hob with four rings, oven door with a handle
        box(0, L, 0, D, 0, H - 0.03, pal.white);
        box(0, L, 0, D, H - 0.03, H, 0x0a0f1a, 0, true);
        if (H <= maxHeight) {
          for (const [fu, fv, r] of [[0.28, 0.3, 0.09], [0.72, 0.3, 0.07], [0.28, 0.72, 0.07], [0.72, 0.72, 0.09]]) {
            const ring: THREE.Vector3[] = [];
            for (let i = 0; i < 24; i++) {
              const a = (i / 24) * Math.PI * 2;
              ring.push(P(L * fu + Math.cos(a) * r, D * fv + Math.sin(a) * r, H + 0.003));
            }
            edges.loop(ring);
          }
        }
        frontLine(0.04, H * 0.12, L - 0.04, H * 0.12);
        frontLine(0.04, H * 0.78, L - 0.04, H * 0.78);
        frontLine(L * 0.2, H * 0.72, L * 0.8, H * 0.72);
        break;
      }
      case 'dresser': {
        box(0, L, 0, D, 0.06, H - 0.03, pal.body);
        box(-0.01, L + 0.01, 0, D + 0.01, H - 0.03, H, pal.top);
        const rows = 3;
        for (let i = 1; i < rows; i++) frontLine(0.02, 0.06 + ((H - 0.09) * i) / rows, L - 0.02, 0.06 + ((H - 0.09) * i) / rows);
        for (let i = 0; i < rows; i++) {
          const h = 0.06 + ((H - 0.09) * (i + 0.5)) / rows;
          frontLine(L / 2 - 0.12, h, L / 2 + 0.12, h);
        }
        break;
      }
      case 'desk': {
        box(0, L, 0, D, H - 0.04, H, pal.top);
        box(0, 0.04, 0.02, D - 0.02, 0, H - 0.04, pal.wood);
        box(L - 0.04, L, 0.02, D - 0.02, 0, H - 0.04, pal.wood);
        box(0.04, L - 0.04, 0.02, 0.05, H * 0.45, H - 0.04, pal.wood, 0, false);
        if (f.monitor !== false && L >= 0.9) {
          const w = Math.min(0.7, L * 0.45);
          box(L / 2 - w / 2, L / 2 + w / 2, 0.1, 0.13, H + 0.12, H + 0.5, 0x0a0f1a, pal.screen);
          box(L / 2 - 0.03, L / 2 + 0.03, 0.12, 0.16, H, H + 0.13, pal.body, 0, false);
        }
        break;
      }
      case 'sofa': {
        const arms = (f.arms ?? (alongX ? ['left', 'right'] : ['up', 'down'])).map(endOf);
        const a0 = arms.includes('start') ? 0.16 : 0;
        const a1 = arms.includes('end') ? 0.16 : 0;
        box(0, L, 0, D, 0.08, 0.42, pal.fabric);
        box(0, L, 0, 0.2, 0.42, H, pal.fabric);
        if (a0) box(0, a0, 0, D, 0.08, 0.64, pal.fabric);
        if (a1) box(L - a1, L, 0, D, 0.08, 0.64, pal.fabric);
        // seat cushions
        const seat = L - a0 - a1;
        const n = Math.max(1, Math.round(seat / 0.75));
        for (let i = 1; i < n; i++) {
          const u = a0 + (seat * i) / n;
          if (maxHeight > 0.43) edges.seg(P(u, 0.2, 0.425), P(u, D, 0.425));
        }
        break;
      }
      case 'bookshelf': {
        box(0, L, 0, D, 0, H, pal.body);
        const shelves = Math.max(2, Math.round(H / 0.38));
        for (let i = 1; i < shelves; i++) frontLine(0.02, (H * i) / shelves, L - 0.02, (H * i) / shelves);
        const cols = Math.max(1, Math.round(L / 0.8));
        for (let i = 1; i < cols; i++) frontLine((L * i) / cols, 0.02, (L * i) / cols, H - 0.02);
        break;
      }
      case 'counter': {
        box(0, L, 0, D - 0.03, 0, H - 0.04, pal.body);
        box(0, L, 0, D, H - 0.04, H, pal.top);
        const doors = Math.max(1, Math.round(L / 0.6));
        for (let i = 1; i < doors; i++) frontLine((L * i) / doors, 0.1, (L * i) / doors, H - 0.08, D - 0.03);
        frontLine(0.02, 0.1, L - 0.02, 0.1, D - 0.03);
        // wall cabinets: one row by default, or `upper: 2` rows stacked up to the ceiling
        const rows = f.upper === false ? 0 : typeof f.upper === 'number' ? Math.max(1, Math.round(f.upper)) : 1;
        if (rows) {
          const bottom = 1.45;
          const top = rows === 1 ? 2.2 : ceiling - 0.02;
          const rh = (top - bottom) / rows;
          for (let r = 0; r < rows; r++) {
            const h0 = bottom + r * rh;
            const h1 = h0 + rh - 0.02;
            box(0, L, 0, 0.35, h0, h1, pal.body);
            for (let i = 1; i < doors; i++) frontLine((L * i) / doors, h0 + 0.02, (L * i) / doors, h1 - 0.02, 0.35);
          }
        }
        break;
      }
      case 'table': {
        if (f.round) {
          // a round table on one pedestal
          const r = Math.min(L, D) / 2;
          const c = P(L / 2, D / 2, 0);
          const cyl = (radius: number, h0: number, h1: number, color: number) => {
            h1 = Math.min(h1, maxHeight);
            if (h1 - h0 < 0.005) return;
            const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h1 - h0, 36), mat(color));
            m.position.set(c.x, (h0 + h1) / 2 + zb, c.z);
            m.castShadow = m.receiveShadow = true;
            group.add(m);
          };
          cyl(r, H - 0.04, H, pal.top);
          cyl(0.05, 0.03, H - 0.04, pal.wood);
          cyl(r * 0.4, 0, 0.03, pal.wood);
          if (H <= maxHeight) {
            const ring: THREE.Vector3[] = [];
            for (let i = 0; i < 36; i++) {
              const a = (i / 36) * Math.PI * 2;
              ring.push(new THREE.Vector3(c.x + Math.cos(a) * r, H + zb, c.z + Math.sin(a) * r));
            }
            edges.loop(ring);
          }
          break;
        }
        box(0, L, 0, D, H - 0.04, H, pal.top);
        for (const [u, v] of [[0.05, 0.05], [L - 0.11, 0.05], [0.05, D - 0.11], [L - 0.11, D - 0.11]])
          box(u, u + 0.06, v, v + 0.06, 0, H - 0.04, pal.wood, 0, false);
        break;
      }
      case 'chair': {
        box(0, L, 0, D, 0.42, 0.47, pal.fabric);
        box(0, L, 0, 0.05, 0.47, H, pal.fabric);
        for (const [u, v] of [[0.02, 0.02], [L - 0.06, 0.02], [0.02, D - 0.06], [L - 0.06, D - 0.06]])
          box(u, u + 0.04, v, v + 0.04, 0, 0.42, pal.wood, 0, false);
        break;
      }
      default:
        box(0, L, 0, D, 0, H, pal.body);
    }
  }

  if (!edges.empty) group.add(edges.build(lineMaterial(pal.edge, 1, pal.edgeOpacity)));
  return group;
}

function boxEdges(lb: LineBuilder, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const y of [y0, y1]) lb.loop([V(x0, y, z0), V(x1, y, z0), V(x1, y, z1), V(x0, y, z1)]);
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) lb.seg(V(x, y0, z), V(x, y1, z));
}
