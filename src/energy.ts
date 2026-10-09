// Where the house's electricity goes right now: every power sensor Home Assistant has, plus a
// typical-wattage estimate for the plan's devices that are on but measured by nothing.

import type { Device, HassEntity, HomeAssistant, LightDevice, MeterDevice, Plan } from './types';
import { brightness, isOn, isUnavailable, nameOf, stateOf } from './ha';

export interface LoadRow {
  name: string;
  /** opened on tap: the power sensor, or the device itself for an estimate */
  entity: string;
  watts: number;
  measured: boolean;
  /** the plan device drawing it (for the flow lines); none for sensors that aren't on the plan */
  device?: Device;
}

export interface HouseLoad {
  /** a whole-house meter's reading, or the rows added up */
  total: number;
  measured: number;
  estimated: number;
  /** the total comes from a whole-house power sensor */
  metered: boolean;
  rows: LoadRow[];
}

/** power while on, for devices nobody measures – rough, but the right order of magnitude */
const TYPICAL: Record<string, number> = {
  bulb: 10,
  lamp: 10,
  desk: 6,
  flood: 15,
  tv: 90,
  climate: 900,
  dehumidifier: 200,
  purifier: 35,
  fan: 35,
  washer: 500,
  plug: 10,
  vacuum: 5,
  camera: 5,
};

export const electricityMeter = (plan?: Plan): MeterDevice | undefined =>
  plan?.floors
    ?.flatMap((f) => f.devices ?? [])
    .find((d): d is MeterDevice => d.type === 'meter' && d.kind === 'electricity');

/** watts of a power sensor (W, kW or mW), undefined while it has no number */
function watts(s?: HassEntity): number | undefined {
  if (!s || isUnavailable(s)) return undefined;
  const v = parseFloat(s.state);
  if (!Number.isFinite(v)) return undefined;
  const u = s.attributes.unit_of_measurement;
  return u === 'kW' ? v * 1000 : u === 'mW' ? v / 1000 : u === 'W' ? v : undefined;
}

const isPowerSensor = (s: HassEntity) =>
  s.entity_id.startsWith('sensor.') && s.attributes.device_class === 'power' && ['W', 'kW', 'mW'].includes(s.attributes.unit_of_measurement);

function pathLength(d: LightDevice): number {
  const p = d.path ?? [];
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  if (d.closed !== false && p.length > 2) len += Math.hypot(p[0][0] - p.at(-1)![0], p[0][1] - p.at(-1)![1]);
  return len;
}

function typical(d: Device): number {
  switch (d.type) {
    case 'light': {
      const kind = d.kind ?? 'bulb';
      if (kind === 'string') return 0.35 * pathLength(d);
      if (kind === 'strip') return 5 * (d.length ?? 1);
      return TYPICAL[kind] ?? TYPICAL.bulb;
    }
    case 'appliance':
      return TYPICAL[d.kind ?? 'plug'] ?? TYPICAL.plug;
    case 'tv':
    case 'climate':
    case 'vacuum':
    case 'camera':
      return TYPICAL[d.type];
    default:
      return 0;
  }
}

/** what a device that nothing measures probably draws now, from its state */
function estimate(d: Device, s: HassEntity | undefined, on: number): number {
  if (!s || isUnavailable(s)) return 0;
  switch (d.type) {
    case 'light':
      // dimmed lights draw less; a switch has no brightness and counts in full
      return isOn(s) ? on * (s.attributes.brightness != null ? Math.max(0.15, brightness(s)) : 1) : 0;
    case 'climate': {
      const a = s.attributes.hvac_action;
      if (a) return ['heating', 'cooling', 'preheating', 'defrosting'].includes(a) ? on : a === 'drying' ? on / 2 : a === 'fan' ? 40 : a === 'idle' ? 15 : 0;
      return ['heat', 'cool', 'heat_cool', 'auto'].includes(s.state) ? on : s.state === 'dry' ? on / 2 : s.state === 'fan_only' ? 40 : 0;
    }
    case 'appliance':
      // a dehumidifier that reached its target rests, when the integration says so
      if (!isOn(s)) return 0;
      return s.attributes.action === 'idle' ? 5 : s.attributes.action === 'off' ? 0 : on;
    case 'tv':
      return isOn(s) ? on : 0;
    case 'vacuum':
      // on its battery while cleaning; the dock charges and waits
      return s.state === 'docked' ? on : 0;
    case 'camera':
      return s.state === 'off' ? 0 : on;
    default:
      return 0;
  }
}

const sensorName = (hass: HomeAssistant, id: string) =>
  nameOf(hass, id).replace(/\s+(current consumption|current power|power)$/i, '') || id;

export function houseLoad(hass: HomeAssistant, plan: Plan): HouseLoad {
  // every power reading in Home Assistant, by the device it belongs to
  const power = new Map<string, number>();
  const byDevice = new Map<string, string[]>();
  for (const s of Object.values(hass.states)) {
    if (!isPowerSensor(s)) continue;
    const w = watts(s);
    if (w !== undefined && w >= 0) power.set(s.entity_id, w);
    const dev = hass.entities?.[s.entity_id]?.device_id;
    if (dev) byDevice.set(dev, [...(byDevice.get(dev) ?? []), s.entity_id]);
  }
  const sensorsOf = (entity?: string): string[] => {
    const dev = entity ? hass.entities?.[entity]?.device_id : undefined;
    return dev ? byDevice.get(dev) ?? [] : [];
  };

  const meter = electricityMeter(plan);
  const used = new Set<string>(meter?.power ? [meter.power] : []);
  const rows: LoadRow[] = [];
  const seen = new Set<string>();

  for (const f of plan.floors ?? []) {
    for (const d of f.devices ?? []) {
      if (!d?.entity || seen.has(d.entity) || ['meter', 'sensor', 'sprinkler', 'car'].includes(d.type)) continue;
      seen.add(d.entity);
      const name = d.name ?? nameOf(hass, d.entity);
      // what feeds it: a power sensor named in the plan, the smart plug in front of it, or its own reading
      const own = sensorsOf(d.entity);
      const explicit = d.type === 'appliance' && d.power ? [d.power] : [];
      const plug = d.type === 'tv' && d.power ? sensorsOf(d.power) : [];
      const feeds = (explicit.length ? explicit : plug.length ? plug : own).filter((id) => !used.has(id));
      const readable = feeds.filter((id) => power.has(id));
      // a device's own reading sits behind its plug: counting both would count it twice
      for (const id of [...feeds, ...own]) used.add(id);
      if (readable.length) {
        rows.push({ name, entity: readable[0], watts: readable.reduce((s, id) => s + power.get(id)!, 0), measured: true, device: d });
        continue;
      }
      const w = estimate(d, stateOf(hass, d.entity), d.watts ?? typical(d));
      if (w > 0) rows.push({ name, entity: d.entity, watts: w, measured: false, device: d });
    }
  }

  // smart plugs and meters that aren't on the plan
  for (const [id, w] of power) if (!used.has(id)) rows.push({ name: sensorName(hass, id), entity: id, watts: w, measured: true });
  if (meter?.base) rows.push({ name: 'Always on', entity: meter.entity, watts: meter.base, measured: false });

  rows.sort((a, b) => b.watts - a.watts);
  const measured = rows.filter((r) => r.measured).reduce((s, r) => s + r.watts, 0);
  const estimated = rows.filter((r) => !r.measured).reduce((s, r) => s + r.watts, 0);
  const house = meter?.power ? watts(stateOf(hass, meter.power)) : undefined;
  if (house !== undefined && house > measured + estimated + 1)
    rows.push({ name: 'Everything else', entity: meter!.power!, watts: house - measured - estimated, measured: true });
  return {
    total: house ?? measured + estimated,
    measured,
    estimated,
    metered: house !== undefined,
    rows,
  };
}

/** 412 W, 1.35 kW */
export function formatWatts(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(w >= 10000 ? 1 : 2)} kW`;
  return `${Math.round(w)} W`;
}
