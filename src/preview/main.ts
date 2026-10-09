import '../card';
import type { Plan } from '../types';
import { createMockHass, cameraPicture } from './mock-hass';

// your own plan (plans/casa.json, kept out of git) wins over the bundled example;
// ?plan=example forces the example
const plans = import.meta.glob<{ default: Plan }>('../../plans/*.json', { eager: true });
const wanted = new URLSearchParams(location.search).get('plan');
const pick = (name: string) => plans[`../../plans/${name}.json`]?.default;
const plan = (wanted && pick(wanted)) || pick('casa') || pick('example')!;

const mock = createMockHass(plan);
const card = document.createElement('neon-house-card') as any;
card.setAttribute('fill', '');
document.getElementById('app')!.appendChild(card);
card.setConfig({ type: 'custom:neon-house-card', plan, stats: true, coords: true });
card.hass = mock.hass;
mock.subscribe((h) => (card.hass = h));

// saving the plan reloads the page: keep the view where it was
const VIEW_KEY = 'neon-house-preview-view';
try {
  const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null');
  if (saved && card.engine) {
    card.engine.flight = undefined; // cancel the opening flight
    card.engine.camera.position.fromArray(saved.pos);
    card.engine.controls.target.fromArray(saved.target);
    card.engine.controls.update();
  }
} catch {
  /* first visit */
}
setInterval(() => {
  try {
    const e = card.engine;
    if (e) sessionStorage.setItem(VIEW_KEY, JSON.stringify({ pos: e.camera.position.toArray(), target: e.controls.target.toArray() }));
  } catch {
    /* storage blocked: the view just resets on reload */
  }
}, 1000);

// HA's more-info dialog doesn't exist here: show what would open
card.addEventListener('hass-more-info', (e: CustomEvent) => {
  document.getElementById('dev-log')!.textContent = `more-info → ${e.detail.entityId}`;
});

// ---- dev panel: drive the fake house ----
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
$('#dev-weather').addEventListener('change', (e) => {
  if (plan.weather_entity) mock.set(plan.weather_entity, (e.target as HTMLSelectElement).value);
});
$('#dev-sun').addEventListener('change', (e) => {
  const night = (e.target as HTMLSelectElement).value === 'night';
  mock.set('sun.sun', night ? 'below_horizon' : 'above_horizon', { elevation: night ? -20 : 28, azimuth: night ? 320 : 205 });
});
const buttons = $('#dev-buttons');
for (const cam of mock.cameras) {
  if (!cam.motion.length) continue;
  const b = document.createElement('button');
  b.textContent = `Motion at ${cam.name}`;
  b.onclick = () => {
    const id = cam.motion[0];
    mock.set(id, 'on');
    setTimeout(() => mock.set(id, 'off'), 8000);
  };
  buttons.appendChild(b);
}
if (mock.vacuum) {
  const id = mock.vacuum;
  const b = document.createElement('button');
  b.textContent = 'Vacuum start/stop';
  b.onclick = () => mock.set(id, mock.hass.states[id].state === 'cleaning' ? 'docked' : 'cleaning');
  buttons.appendChild(b);
}
// refresh the fake camera pictures now and then
setInterval(() => {
  for (const cam of mock.cameras) mock.set(cam.entity, 'idle', { entity_picture: cameraPicture(cam.name) });
}, 10000);
