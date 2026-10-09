// Friendly checks for a hand-edited plan: every message says what is wrong and where,
// so a typo in plan.json shows up as a warning instead of a silently missing door.

import type { HomeAssistant, Plan, Vec2 } from '../types';
import { layoutWalls, projectOnSegment } from './walls';

const OPENING_TYPES = ['door', 'window', 'garage', 'gap'];
const DEVICE_TYPES = ['light', 'camera', 'tv', 'climate', 'appliance', 'vacuum', 'sensor', 'car', 'sprinkler'];
const OUTDOOR_KINDS = ['grass', 'paving', 'terrace', 'parking', 'water'];
const FURNITURE_TYPES = [
  'bed', 'wardrobe', 'dresser', 'desk', 'sofa', 'bookshelf', 'counter', 'cabinet', 'fridge', 'table', 'chair', 'bathtub', 'shower', 'box',
];
const SIDES = ['up', 'down', 'left', 'right'];

const isPoint = (p: unknown): p is Vec2 =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
const fmt = (p: Vec2) => `[${p[0]}, ${p[1]}]`;

function area(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}

export function validatePlan(plan: Plan): string[] {
  const out: string[] = [];
  if (!plan || !Array.isArray(plan.floors) || !plan.floors.length) return ['The plan has no "floors".'];
  const floorIds = new Set<string>();

  plan.floors.forEach((f, fi) => {
    const fname = `Floor "${f.id ?? `#${fi + 1}`}"`;
    if (!f.id) out.push(`${fname}: needs an "id".`);
    else if (floorIds.has(f.id)) out.push(`${fname}: the id is used twice.`);
    floorIds.add(f.id);
    if (typeof f.height !== 'number') out.push(`${fname}: "height" (wall height in metres) is missing.`);
    if (typeof f.elevation !== 'number') out.push(`${fname}: "elevation" is missing (0 for the ground floor).`);

    const roomIds = new Set<string>();
    let roomsOk = true;
    (f.rooms ?? []).forEach((r, ri) => {
      const rname = `${fname}, room "${r.id ?? r.name ?? `#${ri + 1}`}"`;
      if (!r.id) out.push(`${rname}: needs an "id".`);
      else if (roomIds.has(r.id)) out.push(`${rname}: the id is used twice.`);
      roomIds.add(r.id);
      if (!Array.isArray(r.polygon) || r.polygon.length < 3) {
        out.push(`${rname}: "polygon" needs at least 3 corner points.`);
        roomsOk = false;
        return;
      }
      const bad = r.polygon.findIndex((p) => !isPoint(p));
      if (bad >= 0) {
        out.push(`${rname}: corner #${bad + 1} is not a [x, y] pair of numbers.`);
        roomsOk = false;
        return;
      }
      if (area(r.polygon) < 0.3) out.push(`${rname}: the polygon has (almost) no area – are two corners swapped?`);
    });
    if (!f.rooms?.length) out.push(`${fname}: has no rooms.`);

    if (roomsOk) {
      const walls = layoutWalls(f);
      (f.openings ?? []).forEach((o, oi) => {
        const oname = `${fname}, opening #${oi + 1} (${o.type ?? '?'}${isPoint(o.at) ? ` at ${fmt(o.at)}` : ''})`;
        if (!OPENING_TYPES.includes(o.type)) out.push(`${oname}: "type" must be one of ${OPENING_TYPES.join(', ')}.`);
        if (!isPoint(o.at)) return out.push(`${oname}: "at" must be a [x, y] point on a wall.`);
        if (typeof o.width !== 'number' || o.width <= 0) out.push(`${oname}: "width" in metres is missing.`);
        let best = Infinity;
        let len = 0;
        for (const w of walls) {
          const { dist } = projectOnSegment(o.at, w.a, w.b);
          if (dist < best) {
            best = dist;
            len = w.len;
          }
        }
        if (best > 0.6) out.push(`${oname}: not on a wall (nearest wall is ${best.toFixed(2)} m away) – it is left out.`);
        else if (o.width > len) out.push(`${oname}: ${o.width} m wide but the wall is only ${len.toFixed(2)} m long.`);
      });
      (f.walls ?? []).forEach((w, wi) => {
        if (!isPoint(w.a) || !isPoint(w.b)) out.push(`${fname}, wall #${wi + 1}: "a" and "b" must be [x, y] points.`);
      });
    }

    (f.furniture ?? []).forEach((p, pi) => {
      const pname = `${fname}, furniture #${pi + 1} (${p.type ?? '?'})`;
      if (!FURNITURE_TYPES.includes(p.type)) out.push(`${pname}: "type" must be one of ${FURNITURE_TYPES.join(', ')}.`);
      if (!isPoint(p.from) || !isPoint(p.to)) return out.push(`${pname}: "from" and "to" must be [x, y] corners.`);
      if (Math.abs(p.from[0] - p.to[0]) < 0.05 || Math.abs(p.from[1] - p.to[1]) < 0.05)
        out.push(`${pname}: "from" ${fmt(p.from)} and "to" ${fmt(p.to)} must be opposite corners (different x and y).`);
      if (p.back && !SIDES.includes(p.back)) out.push(`${pname}: "back" must be one of ${SIDES.join(', ')}.`);
    });

    (f.devices ?? []).forEach((d, di) => {
      const dname = `${fname}, device #${di + 1} (${d.type ?? '?'} ${d.entity ?? ''})`;
      if (!DEVICE_TYPES.includes(d.type)) out.push(`${dname}: "type" must be one of ${DEVICE_TYPES.join(', ')}.`);
      if (!d.entity) out.push(`${dname}: needs an "entity".`);
      const path = (d as any).path;
      if (path !== undefined && (!Array.isArray(path) || path.length < 2 || !path.every(isPoint)))
        out.push(`${dname}: "path" needs at least 2 [x, y] corners.`);
      else if (path === undefined && !isPoint(d.pos)) out.push(`${dname}: "pos" must be a [x, y] point.`);
    });
  });

  (plan.outdoor ?? []).forEach((o, oi) => {
    const oname = `Outdoor area "${o.name ?? `#${oi + 1}`}"`;
    if (!OUTDOOR_KINDS.includes(o.kind)) out.push(`${oname}: "kind" must be one of ${OUTDOOR_KINDS.join(', ')}.`);
    if (!Array.isArray(o.polygon) || o.polygon.length < 3 || !o.polygon.every(isPoint)) out.push(`${oname}: "polygon" needs at least 3 [x, y] points.`);
  });
  return out;
}

/** entities named in the plan that Home Assistant doesn't know */
export function missingEntities(plan: Plan, hass: HomeAssistant): string[] {
  const ids = new Set<string>();
  for (const f of plan.floors ?? []) {
    for (const d of f.devices ?? []) {
      ids.add(d.entity);
      for (const k of ['power', 'presence', 'stream'] as const) if ((d as any)[k]) ids.add((d as any)[k]);
      for (const m of (d as any).motion ?? []) ids.add(m);
    }
    for (const o of f.openings ?? []) if (o.entity) ids.add(o.entity);
    for (const r of f.rooms ?? []) for (const k of ['temperature', 'humidity'] as const) if (r[k]) ids.add(r[k]!);
  }
  if (plan.weather_entity) ids.add(plan.weather_entity);
  return [...ids].filter((id) => id && !hass.states[id]).map((id) => `Entity "${id}" is not in Home Assistant (renamed or removed?).`);
}
