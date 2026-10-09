// A fake `hass` for developing without Home Assistant. Its entities are made up from the plan
// itself (every entity a device, door or room names gets a plausible state), so any plan works.

import type { HassEntity, HomeAssistant, Plan, Vec2 } from '../types';

type Attrs = Record<string, any>;

export function cameraPicture(name: string): string {
  const t = new Date().toLocaleTimeString();
  const hue = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},35%,30%)"/><stop offset="1" stop-color="hsl(${hue},25%,12%)"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <path d="M0 260 L640 220 L640 360 L0 360Z" fill="hsl(${hue},20%,18%)"/>
    <rect x="380" y="120" width="160" height="120" fill="hsl(${hue},15%,22%)" stroke="#9ab" stroke-opacity=".3"/>
    <text x="20" y="34" fill="#fff" font-family="monospace" font-size="20">${name.toUpperCase()}  ${t}</text>
    <text x="20" y="340" fill="#fff" fill-opacity=".6" font-family="monospace" font-size="14">preview – no real camera</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function artwork(app: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">
    <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e50914"/><stop offset="1" stop-color="#14070a"/></linearGradient></defs>
    <rect width="480" height="270" fill="url(#a)"/><circle cx="360" cy="90" r="70" fill="#ffb35c" fill-opacity=".55"/>
    <text x="30" y="230" fill="#fff" font-family="sans-serif" font-weight="800" font-size="44">${app}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const now = () => new Date().toISOString();
const entity = (entity_id: string, state: string, attributes: Attrs = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: now(),
  last_updated: now(),
});
const titleOf = (id: string) => id.split('.')[1].replace(/_/g, ' ');

function inside(p: Vec2, poly: Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** a believable state for an entity, judged by its domain and name */
function guess(id: string, role: string, n: number): HassEntity {
  const [domain, obj] = id.split('.');
  const name = titleOf(id);
  const a: Attrs = { friendly_name: name };
  if (role.startsWith('meter-')) {
    const kind = role.slice(6);
    const unit = kind === 'electricity' ? 'kWh' : 'm³';
    return entity(id, String(kind === 'electricity' ? 184 + n : 3.2 + n / 10), { ...a, unit_of_measurement: unit });
  }
  switch (domain) {
    case 'light': {
      const colours = [[120, 60, 255], [255, 140, 60], [60, 200, 255]];
      const on = role !== 'flood' && n % 3 !== 2;
      return entity(id, on ? 'on' : 'off', { ...a, brightness: 210, ...(n % 2 ? { color_temp_kelvin: 3000 } : { rgb_color: colours[n % 3] }) });
    }
    case 'media_player':
      return entity(id, n % 2 ? 'off' : 'on', { ...a, app_name: 'Netflix', entity_picture: artwork('NETFLIX') });
    case 'camera':
      return entity(id, 'idle', { ...a, entity_picture: cameraPicture(name) });
    case 'climate':
      return entity(id, 'cool', { ...a, current_temperature: 25, temperature: 22, hvac_action: 'cooling' });
    case 'vacuum':
      return entity(id, 'docked', { ...a, battery_level: 100 });
    case 'person':
      return entity(id, 'home', a);
    case 'valve':
    case 'cover':
      return entity(id, 'closed', a);
    case 'binary_sensor':
      return entity(id, 'off', { ...a, device_class: /door|window|contact/.test(obj) ? 'door' : 'motion' });
    case 'sensor':
      if (/humid/.test(obj)) return entity(id, String(45 + (n * 7) % 20), { ...a, unit_of_measurement: '%', device_class: 'humidity' });
      if (/power|consumption|watt/.test(obj)) return entity(id, String(80 + n * 30), { ...a, unit_of_measurement: 'W', device_class: 'power' });
      return entity(id, (20.5 + ((n * 1.3) % 5)).toFixed(1), { ...a, unit_of_measurement: '°C', device_class: 'temperature' });
    default:
      return entity(id, n % 2 ? 'off' : 'on', a);
  }
}

export interface MockHass {
  hass: HomeAssistant;
  set(id: string, state: string, attrs?: Attrs): void;
  subscribe(fn: (h: HomeAssistant) => void): void;
  cameras: { entity: string; name: string; motion: string[] }[];
  vacuum?: string;
  valves: string[];
}

export function createMockHass(plan: Plan): MockHass {
  const states: Record<string, HassEntity> = {};
  const areaOf: Record<string, string | undefined> = {};
  const deviceOf: Record<string, string> = {};
  let n = 0;
  const add = (id: string | undefined, role = '', area?: string) => {
    if (!id || states[id]) return;
    states[id] = guess(id, role, n++);
    areaOf[id] = area;
  };

  states['sun.sun'] = entity('sun.sun', 'above_horizon', { friendly_name: 'Sun', elevation: 28, azimuth: 205 });
  // something for the "needs attention" chip to find
  states['sensor.preview_thermometer_battery'] = entity('sensor.preview_thermometer_battery', '12', {
    friendly_name: 'Preview thermometer Battery',
    device_class: 'battery',
    unit_of_measurement: '%',
  });
  if (plan.weather_entity)
    states[plan.weather_entity] = entity(plan.weather_entity, 'rainy', { friendly_name: 'Weather', temperature: 14, wind_speed: 22, wind_bearing: 250 });

  const cameras: MockHass['cameras'] = [];
  const valves: string[] = [];
  let vacuum: string | undefined;
  for (const f of plan.floors ?? []) {
    const roomArea = (p: Vec2) => f.rooms?.find((r) => r.area && Array.isArray(r.polygon) && inside(p, r.polygon))?.area;
    for (const d of f.devices ?? []) {
      const area = Array.isArray(d.pos) ? roomArea(d.pos) : undefined;
      if (d.type === 'meter') {
        add(d.entity, `meter-${d.kind}`, area);
        add(d.index, `meter-${d.kind}`, area);
        continue;
      }
      add(d.entity, (d as any).kind, area);
      for (const k of ['power', 'presence', 'stream']) add((d as any)[k], k, area);
      for (const m of (d as any).motion ?? []) add(m, 'motion', area);
      // a TV's smart plug measures what the TV draws, like a real one does
      if (d.type === 'tv' && d.power?.startsWith('switch.')) {
        const obj = d.power.split('.')[1];
        const sid = `sensor.${obj}_current_consumption`;
        states[sid] = entity(sid, '96.4', { friendly_name: `${titleOf(d.power)} Current consumption`, unit_of_measurement: 'W', device_class: 'power' });
        deviceOf[d.power] = deviceOf[sid] = `plug_${obj}`;
      }
      if (d.type === 'camera') cameras.push({ entity: d.entity, name: d.name ?? titleOf(d.entity), motion: d.motion ?? [] });
      if (d.type === 'vacuum') vacuum = d.entity;
      if (d.type === 'sprinkler' && !valves.includes(d.entity)) valves.push(d.entity);
    }
    for (const o of f.openings ?? []) add(o.entity, 'contact');
    for (const r of f.rooms ?? []) {
      add(r.temperature, 'temperature', r.area);
      add(r.humidity, 'humidity', r.area);
    }
  }

  // bills: everything paid except the first one, so "needs attention" has something to show
  (plan.bills ?? []).forEach((b, i) => {
    const owed = i === 0;
    states[b.entity] = entity(
      b.entity,
      b.attribute ? (owed ? 'Da' : 'Nu') : owed ? '123.45' : '0',
      b.attribute ? { friendly_name: b.name, [b.attribute]: owed ? '123,45 lei' : '0,00 lei' } : { friendly_name: b.name, unit_of_measurement: 'RON' },
    );
    if (b.due && /^[a-z_]+\.[a-z0-9_]+$/.test(b.due)) states[b.due] = entity(b.due, '2026-10-31', { friendly_name: `${b.name} due` });
    else if (b.due) states[b.entity].attributes[b.due] = '31.10.2026';
  });

  const entities: NonNullable<HomeAssistant['entities']> = {};
  for (const id of Object.keys(states)) entities[id] = { entity_id: id, area_id: areaOf[id], device_id: deviceOf[id] };

  const subs: ((h: HomeAssistant) => void)[] = [];
  let hass: HomeAssistant;
  const emit = () => {
    hass = { ...hass, states: { ...states } };
    api.hass = hass;
    for (const fn of subs) fn(hass);
  };

  const set = (id: string, state: string, attrs?: Attrs) => {
    const prev = states[id];
    states[id] = {
      ...entity(id, state, { ...(prev?.attributes ?? {}), ...(attrs ?? {}) }),
      last_changed: prev && prev.state === state ? prev.last_changed : now(),
    };
    emit();
  };

  const callService = async (domain: string, service: string, data: Attrs = {}) => {
    const ids: string[] = Array.isArray(data.entity_id) ? data.entity_id : data.entity_id ? [data.entity_id] : [];
    for (const id of ids) {
      const s = states[id];
      if (!s) continue;
      const d = id.split('.')[0];
      let next = s.state;
      const openable = d === 'valve' || d === 'cover';
      if (service === 'toggle') next = openable ? (s.state === 'open' ? 'closed' : 'open') : s.state === 'on' ? 'off' : 'on';
      else if (service === 'open_valve' || service === 'open_cover') next = 'open';
      else if (service === 'close_valve' || service === 'close_cover') next = 'closed';
      else if (service === 'turn_on') next = d === 'climate' ? 'cool' : 'on';
      else if (service === 'turn_off') next = 'off';
      else if (service === 'start') next = 'cleaning';
      else if (service === 'return_to_base') next = 'docked';
      if (d === 'light' && next === 'on' && !s.attributes.brightness) set(id, next, { brightness: 255 });
      else set(id, next);
    }
    console.info('[mock] service', domain, service, data);
  };

  const callWS = async <T,>(msg: Attrs): Promise<T> => {
    if (msg.type === 'history/history_during_period') {
      // a few detections spread over the requested period
      const out: Record<string, { s: string; lu: number }[]> = {};
      const start = Date.parse(msg.start_time) / 1000;
      const end = Date.now() / 1000;
      let seed = 7;
      const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
      for (const id of msg.entity_ids as string[]) {
        const rows = [{ s: 'off', lu: start }];
        const count = rnd() > 0.4 ? 1 + Math.floor(rnd() * 3) : 0;
        for (let i = 0; i < count; i++) {
          const t = start + rnd() * (end - start - 60);
          rows.push({ s: 'on', lu: t }, { s: 'off', lu: t + 25 });
        }
        rows.sort((a, b) => a.lu - b.lu);
        out[id] = rows;
      }
      return out as T;
    }
    throw new Error(`mock: unsupported ${msg.type}`);
  };

  hass = {
    states: { ...states },
    entities,
    devices: {},
    areas: {},
    language: 'en',
    callService,
    callWS,
    hassUrl: (p = '') => p,
  };
  const api: MockHass = { hass, set, subscribe: (fn) => subs.push(fn), cameras, vacuum, valves };
  return api;
}
