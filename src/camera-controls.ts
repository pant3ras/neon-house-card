// The controls a camera offers, found among the other entities of its Home Assistant device:
// floodlight, siren, privacy mode, pan/tilt, viewpoints, detection levels, night vision …
// Matched by entity id and name, so Tapo, Reolink and friends work without configuration.

import type { HomeAssistant } from './types';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface CameraControls {
  light?: string;
  siren?: string;
  privacy?: string;
  ptz: Partial<Record<Direction, string>>;
  presets?: string;
  /** person / vehicle / pet / motion detection: a select (off, low, normal, high) or a switch */
  detection: { label: string; entity: string }[];
  nightVision?: string;
  track?: string;
  record?: string;
  notifications?: string;
}

const DETECTION: [string, RegExp][] = [
  ['Person', /\b(person|people|human)[ _-]?detection\b/],
  ['Vehicle', /\b(vehicle|car)[ _-]?detection\b/],
  ['Pet', /\b(pet|animal)[ _-]?detection\b/],
  ['Motion', /\bmotion[ _-]?detection\b/],
];

export function findCameraControls(hass: HomeAssistant, camera: string): CameraControls {
  const out: CameraControls = { ptz: {}, detection: [] };
  const device = hass.entities?.[camera]?.device_id;
  if (!device) return out;
  const siblings = Object.values(hass.entities!)
    .filter((e) => e.device_id === device && !e.hidden && hass.states[e.entity_id])
    .map((e) => e.entity_id)
    .sort();
  // id and friendly name together: slugs get reshuffled by some integrations, names are steadier
  const text = (id: string) => `${id.split('.')[1].replace(/_/g, ' ')} ${String(hass.states[id]?.attributes.friendly_name ?? '').toLowerCase()}`;
  const detection = new Map<string, string>();

  for (const id of siblings) {
    const domain = id.split('.')[0];
    const t = text(id);
    if (domain === 'light') out.light ??= id;
    else if (domain === 'siren') out.siren ??= id;
    else if (domain === 'button') {
      const m = t.match(/\b(?:move|ptz|pan|tilt)[ _-]?(up|down|left|right)\b/);
      if (m) out.ptz[m[1] as Direction] ??= id;
    } else if (domain === 'select') {
      if (/preset/.test(t) && !/patrol/.test(t)) out.presets ??= id;
      else if (/night[ _-]?vision/.test(t) && !/switching/.test(t)) out.nightVision ??= id;
    } else if (domain === 'switch') {
      if (/privacy/.test(t) && !/zone/.test(t)) out.privacy ??= id;
      else if (/auto[ _-]?track/.test(t)) out.track ??= id;
      else if (/record(ing)?[ _-]?to[ _-]?sd|\brecord(ing)?$/.test(t) && !/audio/.test(t)) out.record ??= id;
      else if (/\bnotifications?\b/.test(t) && !/rich/.test(t)) out.notifications ??= id;
    }
    // detection levels: selects first (Tapo), switches otherwise; never the "trigger alarm on …" switches
    if ((domain === 'select' || domain === 'switch') && !/trigger|alarm|sensitivity|digital/.test(t)) {
      for (const [label, re] of DETECTION) {
        if (!re.test(t)) continue;
        if (!detection.has(label) || domain === 'select') detection.set(label, id);
        break;
      }
    }
  }
  out.detection = DETECTION.filter(([label]) => detection.has(label)).map(([label]) => ({ label, entity: detection.get(label)! }));
  return out;
}

/** every entity the controls show, to notice when one of them changes */
export function controlEntities(c: CameraControls): string[] {
  return [c.light, c.siren, c.privacy, c.presets, c.nightVision, c.track, c.record, c.notifications, ...c.detection.map((d) => d.entity)].filter(
    (x): x is string => !!x,
  );
}
