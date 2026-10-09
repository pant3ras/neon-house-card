// "Needs attention": low or dead batteries, problem sensors that are on, and devices on the plan
// that went unavailable – one row per physical device, worst problem first.

import type { HassEntity, HomeAssistant, Plan } from './types';

export type IssueKind = 'problem' | 'battery' | 'offline';

export interface Issue {
  kind: IssueKind;
  /** the entity to open when the row is tapped */
  entity: string;
  /** device (or entity) name */
  name: string;
  detail: string;
  severity: number;
}

const PROBLEM_CLASSES = new Set(['problem', 'safety', 'smoke', 'gas', 'moisture', 'carbon_monoxide', 'tamper', 'battery', 'heat', 'cold']);
const DEAD = (s: HassEntity) => s.state === 'unavailable' || s.state === 'unknown';
const HOUR = 3600_000;

function age(s: HassEntity): string {
  const ms = Date.now() - Date.parse(s.last_changed);
  if (!Number.isFinite(ms)) return '';
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / (24 * HOUR))} days`;
}

/** every entity the plan shows, so a device going unavailable there is noticed */
export function planEntities(plan: Plan): Set<string> {
  const ids = new Set<string>();
  for (const f of plan.floors ?? []) {
    for (const d of f.devices ?? []) {
      ids.add(d.entity);
      for (const k of ['power', 'presence', 'stream']) if ((d as any)[k]) ids.add((d as any)[k]);
      for (const m of (d as any).motion ?? []) ids.add(m);
    }
    for (const o of f.openings ?? []) if (o.entity) ids.add(o.entity);
  }
  return ids;
}

export interface AttentionOptions {
  excludeLabel: string;
  batteryLow: number;
}

export function findIssues(hass: HomeAssistant, plan: Plan | undefined, opts: AttentionOptions): Issue[] {
  const found: (Issue & { device: string })[] = [];
  const reg = hass.entities ?? {};
  const deviceName = (id: string): string => {
    const dev = reg[id]?.device_id ? hass.devices?.[reg[id].device_id!] : undefined;
    return dev?.name_by_user || dev?.name || hass.states[id]?.attributes.friendly_name || id;
  };
  const add = (id: string, kind: IssueKind, detail: string, severity: number) =>
    found.push({ entity: id, kind, detail, severity, name: deviceName(id), device: reg[id]?.device_id ?? id });

  for (const s of Object.values(hass.states)) {
    const id = s.entity_id;
    const e = reg[id];
    if (e?.hidden) continue;
    const domain = id.split('.')[0];
    const dc = s.attributes.device_class;

    // batteries: percentages, Tuya-style low/middle/high enums, and batteries that went quiet
    const isBattery = domain === 'sensor' && (dc === 'battery' || id.endsWith('_battery_state') || id.endsWith('_battery_level'));
    if (isBattery && !(e?.labels ?? []).includes(opts.excludeLabel)) {
      if (DEAD(s)) {
        if (Date.now() - Date.parse(s.last_changed) > 12 * HOUR) add(id, 'battery', `offline for ${age(s)} – battery dead?`, 3);
      } else if (s.state === 'low') add(id, 'battery', 'battery low', 2);
      else if (dc === 'battery' && Number(s.state) < opts.batteryLow) add(id, 'battery', `battery ${Math.round(Number(s.state))}%`, 2);
      continue;
    }

    // problem sensors that are on (tank full, overheated, leak, smoke …)
    if (domain === 'binary_sensor' && PROBLEM_CLASSES.has(dc) && s.state === 'on') {
      add(id, 'problem', s.attributes.friendly_name ?? id, 4);
    }
  }

  // devices shown on the plan that dropped out
  if (plan) {
    for (const id of planEntities(plan)) {
      const s = hass.states[id];
      if (!s) add(id, 'offline', 'missing from Home Assistant (renamed?)', 1);
      else if (DEAD(s) && Date.now() - Date.parse(s.last_changed) > 10 * 60_000) add(id, 'offline', `unavailable for ${age(s)}`, 1);
    }
  }

  // one row per device: its worst issue, the others folded into the text
  const byDevice = new Map<string, (Issue & { device: string })[]>();
  for (const i of found) {
    if (!byDevice.has(i.device)) byDevice.set(i.device, []);
    byDevice.get(i.device)!.push(i);
  }
  const rows: Issue[] = [];
  for (const list of byDevice.values()) {
    list.sort((a, b) => b.severity - a.severity);
    const top = list[0];
    const extra = [...new Set(list.slice(1).map((i) => i.detail))].filter((d) => d !== top.detail);
    rows.push({ kind: top.kind, entity: top.entity, name: top.name, severity: top.severity, detail: [top.detail, ...extra.slice(0, 2)].join(' · ') });
  }
  return rows.sort((a, b) => b.severity - a.severity || a.name.localeCompare(b.name));
}
