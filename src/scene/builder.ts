import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Floor, OutdoorArea, Plan, Room, Roof, Vec2 } from '../types';
import { layoutWalls, wallPieces, wallPoint, faceRange, type LaidWall, type WallOpening } from '../plan/walls';
import {
  LineBuilder,
  MeshBuilder,
  bounds,
  disposeTree,
  lineMaterial,
  polygonCentroid,
  slabGeometry,
  w3,
} from './geo';
import type { Theme } from './theme';

export const CUT_HEIGHT = 1.05;
const SLAB = 0.18;

export interface RoomView {
  room: Room;
  floor: Floor;
  slab: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  centroid: Vec2;
  label: CSS2DObject;
  labelEl: HTMLElement;
}

export interface OpeningView {
  opening: WallOpening;
  pivot: THREE.Object3D;
  /** 0 closed … 1 open */
  amount: number;
  target: number;
  apply(amount: number): void;
}

export interface FloorView {
  floor: Floor;
  group: THREE.Group;
  walls: THREE.Group;
  rooms: RoomView[];
  openings: OpeningView[];
  wallMaterial: THREE.MeshStandardMaterial;
  edgeMaterial: LineMaterial;
  floorEdgeMaterial: LineMaterial;
  outline: Vec2[];
  center: THREE.Vector3;
  radius: number;
  label: CSS2DObject;
  labelEl: HTMLElement;
  /** the lights, cameras … of this floor are added here by the device layer */
  devices: THREE.Group;
}

function label(className: string, html: string): [CSS2DObject, HTMLElement] {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  const obj = new CSS2DObject(el);
  return [obj, el];
}

export function buildFloor(floor: Floor, theme: Theme, cut: boolean): FloorView {
  const group = new THREE.Group();
  group.name = `floor:${floor.id}`;
  group.position.y = floor.elevation;

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: theme.wallFill,
    transparent: theme.wallOpacity < 1,
    opacity: theme.wallOpacity,
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: theme.wallOpacity >= 0.85,
    emissive: theme.name === 'neon' ? 0x08142e : 0x000000,
  });
  const edgeMaterial = lineMaterial(theme.wallEdge, theme.wallEdgeWidth);
  const floorEdgeMaterial = lineMaterial(theme.floorEdge, 1, 0.7);

  // rooms: slab + outline + label
  const rooms: RoomView[] = [];
  const floorLines = new LineBuilder();
  for (const room of floor.rooms) {
    const material = new THREE.MeshStandardMaterial({
      color: theme.floorFill,
      roughness: 0.85,
      metalness: 0.05,
      emissive: 0x000000,
    });
    const slab = new THREE.Mesh(slabGeometry(room.polygon, 0, SLAB), material);
    slab.receiveShadow = true;
    slab.userData.pick = { kind: 'room', floor: floor.id, room: room.id };
    group.add(slab);
    floorLines.loop(room.polygon.map((p) => w3(p, 0.012)));
    const centroid = polygonCentroid(room.polygon);
    const [lbl, el] = label('nh-room', `<b>${escapeHtml(room.name)}</b><span class="nh-room-sub"></span>`);
    lbl.position.copy(w3(centroid, 0.25));
    group.add(lbl);
    rooms.push({ room, floor, slab, material, centroid, label: lbl, labelEl: el });
  }
  if (!floorLines.empty) group.add(floorLines.build(floorEdgeMaterial));

  const walls = new THREE.Group();
  walls.name = 'walls';
  group.add(walls);
  const devices = new THREE.Group();
  devices.name = 'devices';
  group.add(devices);

  const outline = floor.rooms.flatMap((r) => r.polygon);
  const b = bounds(outline.length ? outline : [[0, 0]]);
  const center = new THREE.Vector3((b.minX + b.maxX) / 2, floor.elevation + floor.height / 2, (b.minY + b.maxY) / 2);
  const radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + 1;

  const [flabel, flabelEl] = label('nh-floor', `<b>${escapeHtml(floor.name)}</b><span class="nh-floor-sub"></span>`);
  flabel.position.set(b.minX - 0.6, floor.height * 0.6, (b.minY + b.maxY) / 2);
  group.add(flabel);

  const view: FloorView = {
    floor,
    group,
    walls,
    rooms,
    openings: [],
    wallMaterial,
    edgeMaterial,
    floorEdgeMaterial,
    outline,
    center,
    radius,
    label: flabel,
    labelEl: flabelEl,
    devices,
  };
  buildWalls(view, theme, cut);
  return view;
}

/** (re)builds the walls of a floor, tall or cut down to look inside */
export function buildWalls(view: FloorView, theme: Theme, cut: boolean) {
  const { floor, walls } = view;
  disposeChildren(walls, view);
  view.openings = [];

  const H = cut ? Math.min(CUT_HEIGHT, floor.height) : floor.height;
  const laid = layoutWalls(floor, cut ? CUT_HEIGHT : undefined);
  const fill = new MeshBuilder();
  const lines = new LineBuilder();
  const glass = new MeshBuilder();

  for (const w of laid) {
    const wh = Math.min(w.height ?? floor.height, H);
    for (const p of wallPieces(w, wh)) {
      const [ls, le] = faceRange(w, 'l', p.s, p.e);
      const [rs, re] = faceRange(w, 'r', p.s, p.e);
      const half = w.t / 2;
      fill.prism([wallPoint(w, ls, half), wallPoint(w, le, half), wallPoint(w, re, -half), wallPoint(w, rs, -half)], p.y0, p.y1);
    }
    wallEdges(w, wh, lines);
    for (const o of w.openings) {
      if (o.opening.type === 'window' && o.top > o.bottom + 0.05) {
        const a = wallPoint(w, o.s, 0);
        const c = wallPoint(w, o.e, 0);
        glass.quad(w3(a, o.bottom), w3(c, o.bottom), w3(c, o.top), w3(a, o.top));
      }
      const ov = openingLeaf(w, o, theme);
      if (ov) {
        walls.add(ov.pivot);
        view.openings.push(ov);
      }
    }
  }

  if (!fill.empty) {
    const mesh = new THREE.Mesh(fill.geometry(), view.wallMaterial);
    mesh.castShadow = true;
    mesh.renderOrder = 2;
    walls.add(mesh);
  }
  if (!lines.empty) walls.add(lines.build(view.edgeMaterial));
  if (!glass.empty) {
    const gm = new THREE.MeshStandardMaterial({
      color: theme.glass,
      transparent: true,
      opacity: theme.name === 'day' ? 0.35 : 0.22,
      emissive: theme.glass,
      emissiveIntensity: theme.name === 'neon' ? 0.35 : 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.1,
      metalness: 0.3,
    });
    const gmesh = new THREE.Mesh(glass.geometry(), gm);
    gmesh.renderOrder = 3;
    walls.add(gmesh);
  }
}

function disposeChildren(group: THREE.Group, view: FloorView) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      // the shared wall/edge materials live as long as the floor
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) if (mat !== view.wallMaterial && mat !== view.edgeMaterial) mat.dispose();
    });
  }
}

/** glowing outline of one wall: top and bottom face lines, opening frames, free ends */
function wallEdges(w: LaidWall, H: number, out: LineBuilder) {
  const half = w.t / 2;
  const P = (u: number, v: number, y: number) => w3(wallPoint(w, u, v), y);

  for (const side of ['l', 'r'] as const) {
    const v = side === 'l' ? half : -half;
    // top: continuous unless an opening reaches the top
    let u = 0;
    const tops: [number, number][] = [];
    const bottoms: [number, number][] = [];
    for (const o of w.openings) {
      if (o.top >= H - 0.001) {
        if (o.s > u) tops.push([u, o.s]);
        u = o.e;
      }
    }
    if (u < w.len) tops.push([u, w.len]);
    u = 0;
    for (const o of w.openings) {
      if (o.bottom <= 0.001) {
        if (o.s > u) bottoms.push([u, o.s]);
        u = o.e;
      }
    }
    if (u < w.len) bottoms.push([u, w.len]);
    for (const [s, e] of tops) {
      const [a, b] = faceRange(w, side, s, e);
      out.seg(P(a, v, H), P(b, v, H));
    }
    for (const [s, e] of bottoms) {
      const [a, b] = faceRange(w, side, s, e);
      out.seg(P(a, v, 0.02), P(b, v, 0.02));
    }
    // opening frames
    for (const o of w.openings) {
      out.seg(P(o.s, v, o.bottom), P(o.s, v, o.top));
      out.seg(P(o.e, v, o.bottom), P(o.e, v, o.top));
      if (o.top < H - 0.001) out.seg(P(o.s, v, o.top), P(o.e, v, o.top));
      if (o.bottom > 0.001) out.seg(P(o.s, v, o.bottom), P(o.e, v, o.bottom));
    }
  }
  // across the thickness at opening corners
  for (const o of w.openings) {
    for (const uu of [o.s, o.e]) {
      if (o.top < H - 0.001) out.seg(P(uu, half, o.top), P(uu, -half, o.top));
      if (o.bottom > 0.001) out.seg(P(uu, half, o.bottom), P(uu, -half, o.bottom));
    }
  }
  // free ends
  if (w.freeStart) endCap(0);
  if (w.freeEnd) endCap(w.len);

  function endCap(uu: number) {
    out.seg(P(uu, half, 0), P(uu, half, H));
    out.seg(P(uu, -half, 0), P(uu, -half, H));
    out.seg(P(uu, half, H), P(uu, -half, H));
  }
}

/** door leaf or garage door that moves with its entity */
function openingLeaf(w: LaidWall, o: WallOpening, theme: Theme): OpeningView | null {
  const type = o.opening.type;
  if (type !== 'door' && type !== 'garage') return null;
  if (!o.opening.entity) return null; // a door without a sensor is shown as an open gap
  const width = o.e - o.s;
  const height = o.top - o.bottom;
  const mat = new THREE.MeshStandardMaterial({
    color: theme.door,
    transparent: true,
    opacity: theme.name === 'day' ? 0.95 : 0.35,
    emissive: theme.door,
    emissiveIntensity: theme.name === 'neon' ? 0.25 : 0,
    side: THREE.DoubleSide,
  });
  const pivot = new THREE.Group();
  const angle = Math.atan2(w.dir[1], w.dir[0]);

  if (type === 'door') {
    const hingeAtStart = (o.opening.hinge ?? 'left') === 'left';
    const hingeU = hingeAtStart ? o.s : o.e;
    const hp = wallPoint(w, hingeU, 0);
    pivot.position.set(hp[0], o.bottom, hp[1]);
    // pivot's local +x runs along the wall from the hinge into the opening
    pivot.rotation.y = -angle + (hingeAtStart ? 0 : Math.PI);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.04), mat);
    leaf.position.set(width / 2, height / 2, 0);
    pivot.add(leaf);
    const swing = (o.opening.swing ?? 1) * (hingeAtStart ? 1 : -1);
    const base = pivot.rotation.y;
    const view: OpeningView = {
      opening: o,
      pivot,
      amount: 0,
      target: 0,
      apply(amount) {
        this.amount = amount;
        pivot.rotation.y = base + swing * amount * (Math.PI / 2) * 0.9;
      },
    };
    return view;
  }

  // garage door: a panel that slides up under the ceiling
  const mid = wallPoint(w, (o.s + o.e) / 2, 0);
  pivot.position.set(mid[0], o.bottom, mid[1]);
  pivot.rotation.y = -angle;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.05), mat);
  panel.position.y = height / 2;
  pivot.add(panel);
  return {
    opening: o,
    pivot,
    amount: 0,
    target: 0,
    apply(amount) {
      this.amount = amount;
      panel.position.y = height / 2 + amount * height * 0.92;
      panel.scale.y = 1 - amount * 0.85;
    },
  };
}

// ---------- outside ----------

export function buildGround(plan: Plan, theme: Theme): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ground';
  const pts = plan.floors.flatMap((f) => f.rooms.flatMap((r) => r.polygon)).concat((plan.outdoor ?? []).flatMap((o) => o.polygon));
  const b = bounds(pts.length ? pts : [[0, 0]]);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 3 + 30;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.02, cz);
  ground.receiveShadow = true;
  g.add(ground);

  // grid lines on whole metres, so plan coordinates can be read off the ground
  const gridSize = 2 * Math.ceil(size / 2);
  const grid = new THREE.GridHelper(gridSize, gridSize, theme.grid, theme.grid);
  grid.position.set(Math.round(cx), -0.01, Math.round(cz));
  const gm = grid.material as THREE.Material;
  gm.transparent = true;
  gm.opacity = theme.name === 'day' ? 0.35 : 0.55;
  g.add(grid);

  for (const area of plan.outdoor ?? []) g.add(outdoorArea(area, theme));
  return g;
}

function outdoorArea(area: OutdoorArea, theme: Theme): THREE.Object3D {
  const g = new THREE.Group();
  // different heights per kind so overlapping areas (a path across a lawn) don't flicker
  const height = { grass: 0.012, water: 0.008, paving: 0.026, parking: 0.026, terrace: 0.08 }[area.kind];
  const mesh = new THREE.Mesh(
    slabGeometry(area.polygon, height, height + 0.01),
    new THREE.MeshStandardMaterial({ color: theme.outdoor[area.kind], roughness: 0.95 }),
  );
  mesh.receiveShadow = true;
  mesh.userData.pick = { kind: 'outdoor', area: area.area, name: area.name };
  g.add(mesh);
  const lines = new LineBuilder();
  lines.loop(area.polygon.map((p) => w3(p, height + 0.01)));
  const color = area.kind === 'grass' ? (theme.name === 'neon' ? 0x1f9d63 : theme.floorEdge) : theme.floorEdge;
  g.add(lines.build(lineMaterial(color, 1.2, 0.8)));
  if (area.kind === 'parking') {
    // a dashed bay marking along the long side
    const b = bounds(area.polygon);
    const ml = new LineBuilder();
    const y = height + 0.012;
    ml.seg(new THREE.Vector3(b.minX + 0.15, y, b.minY + 0.15), new THREE.Vector3(b.minX + 0.15, y, b.maxY - 0.15));
    ml.seg(new THREE.Vector3(b.maxX - 0.15, y, b.minY + 0.15), new THREE.Vector3(b.maxX - 0.15, y, b.maxY - 0.15));
    g.add(ml.build(lineMaterial(theme.name === 'day' ? 0xffffff : 0x8fb3d9, 1.4, 0.8)));
  }
  return g;
}

/** a gable, hip or flat roof over the top floor's outline */
export function buildRoof(top: Floor, roof: Roof, theme: Theme): THREE.Group {
  const g = new THREE.Group();
  g.name = 'roof';
  const pts = top.rooms.flatMap((r) => r.polygon);
  if (!pts.length) return g;
  const o = roof.overhang ?? 0.4;
  const b = bounds(pts);
  const x0 = b.minX - o, x1 = b.maxX + o, z0 = b.minY - o, z1 = b.maxY + o;
  const base = top.elevation + top.height + 0.02;
  const pitch = ((roof.pitch ?? 32) * Math.PI) / 180;
  const ridgeX = (roof.ridge ?? (b.maxX - b.minX >= b.maxY - b.minY ? 'x' : 'y')) === 'x';
  const span = ridgeX ? z1 - z0 : x1 - x0;
  const rise = roof.type === 'flat' ? 0.25 : (span / 2) * Math.tan(pitch);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  const m = new MeshBuilder();
  const lines = new LineBuilder();
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  if (roof.type === 'flat') {
    m.prism([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], base, base + rise);
    lines.loop([V(x0, base + rise, z0), V(x1, base + rise, z0), V(x1, base + rise, z1), V(x0, base + rise, z1)]);
    lines.loop([V(x0, base, z0), V(x1, base, z0), V(x1, base, z1), V(x0, base, z1)]);
  } else {
    const hipIn = roof.type === 'hip' ? span / 2 : 0;
    const top = base + rise;
    let r0: THREE.Vector3, r1: THREE.Vector3;
    if (ridgeX) {
      r0 = V(x0 + hipIn, top, cz);
      r1 = V(x1 - hipIn, top, cz);
      const a = V(x0, base, z0), bb = V(x1, base, z0), c = V(x1, base, z1), d = V(x0, base, z1);
      m.quad(a, bb, r1, r0); m.quad(c, d, r0, r1);
      m.tri(d, a, r0); m.tri(bb, c, r1);
      lines.loop([a, bb, c, d]);
      lines.seg(r0, r1);
      for (const [p, r] of [[a, r0], [d, r0], [bb, r1], [c, r1]] as const) lines.seg(p, r);
    } else {
      r0 = V(cx, top, z0 + hipIn);
      r1 = V(cx, top, z1 - hipIn);
      const a = V(x0, base, z0), bb = V(x1, base, z0), c = V(x1, base, z1), d = V(x0, base, z1);
      m.quad(d, a, r0, r1); m.quad(bb, c, r1, r0);
      m.tri(a, bb, r0); m.tri(c, d, r1);
      lines.loop([a, bb, c, d]);
      lines.seg(r0, r1);
      for (const [p, r] of [[a, r0], [bb, r0], [c, r1], [d, r1]] as const) lines.seg(p, r);
    }
    if (roof.solar) addSolar(g, roof, theme, { x0, x1, z0, z1, base, rise, ridgeX });
  }

  const mat = new THREE.MeshStandardMaterial({
    color: theme.roof,
    emissive: theme.name === 'neon' ? 0x0a1a3c : 0x000000,
    transparent: theme.name !== 'day',
    opacity: theme.name === 'day' ? 1 : 0.85,
    side: THREE.DoubleSide,
    roughness: 0.7,
    depthWrite: theme.name === 'day',
  });
  const mesh = new THREE.Mesh(m.geometry(), mat);
  mesh.castShadow = true;
  mesh.userData.pick = { kind: 'roof' };
  g.add(mesh);
  g.add(lines.build(lineMaterial(theme.roofEdge, 1.4)));
  return g;
}

function addSolar(
  g: THREE.Group,
  roof: Roof,
  theme: Theme,
  r: { x0: number; x1: number; z0: number; z1: number; base: number; rise: number; ridgeX: boolean },
) {
  const solar = roof.solar!;
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x0a1a3a,
    emissive: theme.name === 'neon' ? 0x0a2a5a : 0x000000,
    metalness: 0.6,
    roughness: 0.25,
  });
  const lines = new LineBuilder();
  const slopeGroup = new THREE.Group();
  // build the panel grid flat, then tilt it onto the chosen roof face
  const along = r.ridgeX ? r.x1 - r.x0 : r.z1 - r.z0;
  const down = (r.ridgeX ? r.z1 - r.z0 : r.x1 - r.x0) / 2;
  const slopeLen = Math.hypot(down, r.rise);
  const pw = (along * 0.8) / solar.cols;
  const ph = (slopeLen * 0.75) / solar.rows;
  for (let i = 0; i < solar.cols; i++)
    for (let j = 0; j < solar.rows; j++) {
      const x = -along * 0.4 + pw * (i + 0.5);
      const y = slopeLen * 0.12 + ph * (j + 0.5);
      const p = new THREE.Mesh(new THREE.BoxGeometry(pw * 0.94, 0.04, ph * 0.94), panelMat);
      p.position.set(x, 0.05, y);
      slopeGroup.add(p);
      const hw = (pw * 0.94) / 2, hh = (ph * 0.94) / 2;
      lines.loop([
        new THREE.Vector3(x - hw, 0.075, y - hh),
        new THREE.Vector3(x + hw, 0.075, y - hh),
        new THREE.Vector3(x + hw, 0.075, y + hh),
        new THREE.Vector3(x - hw, 0.075, y + hh),
      ]);
    }
  slopeGroup.add(lines.build(lineMaterial(0x4fc3ff, 1)));
  const tilt = Math.atan2(r.rise, down);
  // local z runs down the slope from the eave; place the group at the eave of the chosen side
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const holder = new THREE.Group();
  holder.add(slopeGroup);
  slopeGroup.rotation.x = -tilt;
  const side = solar.side;
  // plan y grows to the south, so the south face is the one at z1
  const eave: Record<string, [number, number, number]> = {
    s: [cx, cz + down, 0],
    n: [cx, cz - down, Math.PI],
    e: [cx + down, cz, Math.PI / 2],
    w: [cx - down, cz, -Math.PI / 2],
  };
  const [ex, ez, rot] = eave[side];
  holder.position.set(ex, r.base, ez);
  holder.rotation.y = rot + Math.PI;
  holder.userData.pick = { kind: 'solar', entity: solar.power };
  g.add(holder);
}

export function disposeFloor(view: FloorView) {
  disposeTree(view.group);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
export { escapeHtml };
