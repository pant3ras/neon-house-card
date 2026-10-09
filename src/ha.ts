import * as THREE from 'three';
import type { HassEntity, HomeAssistant } from './types';

const ON_STATES = new Set([
  'on', 'open', 'opening', 'home', 'playing', 'paused', 'idle', 'cleaning', 'returning',
  'heat', 'cool', 'auto', 'dry', 'fan_only', 'heat_cool', 'true', 'detected', 'unlocked',
]);

export const stateOf = (hass: HomeAssistant | undefined, id?: string): HassEntity | undefined =>
  id ? hass?.states[id] : undefined;

export const isOn = (s?: HassEntity) => !!s && ON_STATES.has(s.state);
export const isUnavailable = (s?: HassEntity) => !s || s.state === 'unavailable' || s.state === 'unknown';

export const num = (s?: HassEntity): number | undefined => {
  if (!s) return undefined;
  const v = parseFloat(s.state);
  return Number.isFinite(v) ? v : undefined;
};

export function nameOf(hass: HomeAssistant | undefined, id: string): string {
  return hass?.states[id]?.attributes.friendly_name ?? id;
}

/** colour of a light: rgb, colour temperature or a warm white */
export function lightColor(s?: HassEntity): THREE.Color {
  const a = s?.attributes ?? {};
  if (Array.isArray(a.rgb_color)) return new THREE.Color(a.rgb_color[0] / 255, a.rgb_color[1] / 255, a.rgb_color[2] / 255);
  if (Array.isArray(a.hs_color)) return new THREE.Color().setHSL(a.hs_color[0] / 360, a.hs_color[1] / 100, 0.55);
  const k = a.color_temp_kelvin ?? (a.color_temp ? 1e6 / a.color_temp : 2900);
  return kelvinToColor(k);
}

export function kelvinToColor(k: number): THREE.Color {
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}

/** 0..1 brightness of a light that is on */
export const brightness = (s?: HassEntity) => (isOn(s) ? (s!.attributes.brightness ?? 255) / 255 : 0);

/** go to another dashboard/view inside Home Assistant without reloading the page */
export function navigate(path: string) {
  if (/^https?:/.test(path)) {
    window.open(path, '_blank', 'noopener');
    return;
  }
  history.pushState(null, '', path);
  window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
}

/** opens Home Assistant's own dialog for an entity (live camera, history, settings) */
export function moreInfo(from: HTMLElement, entityId: string) {
  from.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
}

export async function toggle(hass: HomeAssistant, entityId: string) {
  const domain = entityId.split('.')[0];
  const s = hass.states[entityId];
  if (domain === 'media_player') {
    return hass.callService('media_player', s && isOn(s) && s.state !== 'idle' ? 'turn_off' : 'turn_on', { entity_id: entityId });
  }
  if (domain === 'vacuum') {
    return hass.callService('vacuum', s?.state === 'cleaning' ? 'return_to_base' : 'start', { entity_id: entityId });
  }
  if (domain === 'cover') return hass.callService('cover', 'toggle', { entity_id: entityId });
  if (domain === 'climate') {
    return hass.callService('climate', s?.state === 'off' ? 'turn_on' : 'turn_off', { entity_id: entityId });
  }
  if (domain === 'scene' || domain === 'script') return hass.callService(domain, 'turn_on', { entity_id: entityId });
  return hass.callService('homeassistant', 'toggle', { entity_id: entityId });
}

export const TOGGLEABLE = new Set(['light', 'switch', 'fan', 'humidifier', 'media_player', 'climate', 'vacuum', 'cover', 'input_boolean', 'scene', 'script', 'siren', 'valve']);

/** camera picture URL with its access token, for <img> */
export function cameraUrl(hass: HomeAssistant, entityId: string, stream: boolean): string | undefined {
  const s = hass.states[entityId];
  const pic: string | undefined = s?.attributes.entity_picture;
  if (!pic) return undefined;
  const url = stream ? pic.replace('/api/camera_proxy/', '/api/camera_proxy_stream/') : `${pic}&t=${Date.now()}`;
  return url.startsWith('http') || url.startsWith('data:') ? url : hass.hassUrl(url);
}
