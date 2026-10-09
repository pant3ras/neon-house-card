import * as THREE from 'three';
import { Engine } from './scene/engine';
import { THEMES, type Theme } from './scene/theme';
import { buildFloor, buildGround, buildRoof, buildWalls, disposeFloor, escapeHtml, type FloorView, type OpeningView, type RoomView } from './scene/builder';
import { createDevice, type DeviceCtx, type DeviceView } from './scene/devices';
import { disposeTree, pointInPolygon } from './scene/geo';
import { WeatherFx } from './scene/weather';
import { MotionTrail } from './scene/trail';
import { STYLES } from './ui/styles';
import { missingEntities, validatePlan } from './plan/validate';
import { findIssues, type Issue } from './attention';
import { TOGGLEABLE, cameraUrl, isOn, isUnavailable, moreInfo, nameOf, navigate, num, stateOf, toggle } from './ha';
import type { CameraDevice, CardConfig, HassEntity, HomeAssistant, Plan, ThemeName, Vec2 } from './types';

const VERSION = '0.2.0';
/** the URL this module was loaded from (HACS adds ?hacstag=<version>) */
const LOADED_FROM = import.meta.url;
const APART_GAP = 3.2;
const PREFS_KEY = 'neon-house-prefs';

type Markers = 'none' | 'important' | 'all';
type Heat = 'none' | 'temperature' | 'humidity';

interface Prefs {
  theme: ThemeName;
  markers: Markers;
  cut: boolean;
  apart: boolean;
  names: boolean;
  cameras: boolean;
  weather: boolean;
  trail: boolean;
  heatmap: Heat;
}

const DEFAULT_PREFS: Prefs = {
  theme: 'neon',
  markers: 'important',
  cut: false,
  apart: false,
  names: true,
  cameras: true,
  weather: true,
  trail: false,
  heatmap: 'none',
};

interface RoomInfo {
  view: RoomView;
  lights: DeviceView[];
  temperature?: string;
  humidity?: string;
}

export class NeonHouseCard extends HTMLElement {
  private config?: CardConfig;
  private _hass?: HomeAssistant;
  private plan?: Plan;
  private planError?: string;
  private shadow: ShadowRoot;
  private engine?: Engine;
  private theme: Theme = THEMES.neon;
  private prefs: Prefs = { ...DEFAULT_PREFS };
  private floors: FloorView[] = [];
  private devices: DeviceView[] = [];
  private byEntity = new Map<string, DeviceView[]>();
  private openingsByEntity = new Map<string, OpeningView[]>();
  private rooms: RoomInfo[] = [];
  private ground?: THREE.Group;
  private roof?: THREE.Group;
  private hemi?: THREE.HemisphereLight;
  private weather?: WeatherFx;
  private trail?: MotionTrail;
  private houseCenter = new THREE.Vector3();
  private houseRadius = 10;
  private selectedFloor: string | null = null;
  private panelArea?: { title: string; area?: string; room?: RoomInfo; attention?: boolean };
  private issues: Issue[] = [];
  private attentionTimer = 0;
  private updateChecked = false;
  private cockpit?: DeviceView;
  private cockpitTimer = 0;
  private seen = new Map<string, HassEntity | undefined>();
  private anims = new WeakMap<DeviceView, (dt: number, t: number) => boolean>();
  private resizeObs?: ResizeObserver;
  private trailTimer = 0;
  private toastTimer = 0;
  private built = false;
  private els!: {
    root: HTMLElement;
    stage: HTMLElement;
    floors: HTMLElement;
    rooms: HTMLElement;
    modes: HTMLElement;
    bottom: HTMLElement;
    panel: HTMLElement;
    cockpit: HTMLElement;
    toast: HTMLElement;
    alert: HTMLElement;
    fps: HTMLElement;
    warn: HTMLElement;
    coords: HTMLElement;
  };
  private ctx: DeviceCtx = { theme: THEMES.neon, high: false, requestRender: () => this.engine?.requestRender() };

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.prefs = loadPrefs();
  }

  // ---------- Lovelace card API ----------

  static getStubConfig() {
    return { type: 'custom:neon-house-card', plan_url: '/local/neon-house/plan.json' };
  }

  setConfig(config: CardConfig) {
    if (!config.plan && !config.plan_url) throw new Error('neon-house-card: set `plan` or `plan_url`');
    const changed = JSON.stringify(config) !== JSON.stringify(this.config);
    this.config = config;
    if (config.theme && !localStorageHas()) this.prefs.theme = config.theme;
    if (config.heatmap && !localStorageHas()) this.prefs.heatmap = config.heatmap;
    if (config.weather === false) this.prefs.weather = false;
    if (config.trail) this.prefs.trail = true;
    this.ensureDom();
    if (changed) {
      this.plan = config.plan;
      this.planError = undefined;
      this.built = false;
      if (!this.plan) void this.loadPlan();
      else this.maybeBuild();
    }
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this.ctx.hass = hass;
    if (!this.updateChecked) {
      this.updateChecked = true;
      void this.checkForUpdate();
    }
    if (!this.built) this.maybeBuild();
    // the first states after a build get the full treatment (room sensors, weather …)
    else this.applyHass(this.seen.size === 0);
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  getCardSize() {
    return Math.ceil((this.config?.height ?? 560) / 50);
  }

  getGridOptions() {
    return { columns: 'full', rows: Math.ceil((this.config?.height ?? 560) / 56), min_rows: 6 };
  }

  connectedCallback() {
    this.ensureDom();
    this.resizeObs ??= new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.els.root);
    this.engine?.start();
    this.maybeBuild();
  }

  disconnectedCallback() {
    this.resizeObs?.disconnect();
    this.engine?.stop();
    this.closeCockpit(false);
  }

  // ---------- setup ----------

  private async loadPlan() {
    const url = this.config?.plan_url;
    if (!url) return;
    try {
      const full = url.startsWith('http') || !this._hass ? url : this._hass.hassUrl(url);
      const res = await fetch(`${full}${full.includes('?') ? '&' : '?'}v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      this.plan = (await res.json()) as Plan;
      this.maybeBuild();
    } catch (e) {
      this.planError = `Could not load ${url}: ${(e as Error).message}`;
      this.showError(this.planError);
    }
  }

  private ensureDom() {
    if (this.els) return;
    this.shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="nh-root">
        <div class="nh-stage"></div>
        <div class="nh-top">
          <div class="nh-row nh-floors"></div>
          <div class="nh-row nh-rooms"></div>
        </div>
        <div class="nh-bottom"><div class="nh-row nh-modes"></div></div>
        <div class="nh-panel"></div>
        <div class="nh-cockpit"></div>
        <div class="nh-alert"></div>
        <div class="nh-toast"></div>
        <details class="nh-warn"><summary></summary><ul></ul></details>
        <div class="nh-coords"></div>
        <div class="nh-fps"></div>
      </div>`;
    const q = <T extends HTMLElement>(s: string) => this.shadow.querySelector(s) as T;
    this.els = {
      root: q('.nh-root'),
      stage: q('.nh-stage'),
      floors: q('.nh-floors'),
      rooms: q('.nh-rooms'),
      modes: q('.nh-modes'),
      bottom: q('.nh-bottom'),
      panel: q('.nh-panel'),
      cockpit: q('.nh-cockpit'),
      toast: q('.nh-toast'),
      alert: q('.nh-alert'),
      fps: q('.nh-fps'),
      warn: q('.nh-warn'),
      coords: q('.nh-coords'),
    };
    this.applyHeight();
    this.bindPointer();
  }

  private applyHeight() {
    const h = this.config?.height;
    this.els.root.style.height = this.hasAttribute('fill')
      ? '100%'
      : this.config?.fill
        ? 'calc(100vh - var(--header-height, 56px) - env(safe-area-inset-top, 0px))'
        : `${h ?? 560}px`;
  }

  private showError(msg: string) {
    this.els.stage.innerHTML = `<div class="nh-error">${escapeHtml(msg)}</div>`;
  }

  private maybeBuild() {
    if (this.built || !this.plan || !this.config || !this.isConnected) return;
    try {
      this.build();
    } catch (e) {
      console.error(e);
      const hints = validatePlan(this.plan);
      this.showError(`neon-house: ${(e as Error).message}${hints.length ? `\n\nProblems in the plan:\n• ${hints.join('\n• ')}` : ''}`);
    }
  }

  private resize() {
    if (!this.engine) return;
    const r = this.els.root.getBoundingClientRect();
    this.engine.setSize(Math.round(r.width), Math.round(r.height));
  }

  private build() {
    const plan = this.plan!;
    this.applyHeight();
    const quality = this.config!.quality ?? 'auto';
    const high = quality === 'high' || (quality === 'auto' && (window.devicePixelRatio ?? 1) <= 2 && !/Silk|KF[A-Z]{2}|Android 7|Android 8/.test(navigator.userAgent));
    this.ctx.high = high;
    const first = !this.engine;
    if (!this.engine) {
      this.engine = new Engine(this.els.stage, high ? 'high' : 'low');
      this.engine.onFrame = () => {
        if (this.config?.stats) this.els.fps.textContent = `${this.engine!.fps} fps`;
      };
      this.resize();
      this.engine.start();
    }
    this.teardownScene();
    this.theme = THEMES[this.prefs.theme];
    this.ctx.theme = this.theme;
    this.applyCssTheme();
    const engine = this.engine;
    engine.applyTheme(this.theme);
    const scene = engine.scene;

    this.hemi = new THREE.HemisphereLight(this.theme.ambient, this.theme.background, this.theme.ambientIntensity);
    scene.add(this.hemi);

    this.ground = buildGround(plan, this.theme);
    scene.add(this.ground);

    const floors = [...plan.floors].sort((a, b) => a.elevation - b.elevation);
    this.floors = floors.map((f) => buildFloor(f, this.theme, this.prefs.cut));
    for (const fv of this.floors) {
      scene.add(fv.group);
      fv.labelEl.onclick = () => this.selectFloor(fv.floor.id);
    }

    // house extent for the default view and the weather box
    const pts = floors.flatMap((f) => f.rooms.flatMap((r) => r.polygon));
    if (pts.length) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const top = floors.at(-1)!;
      this.houseCenter.set((Math.min(...xs) + Math.max(...xs)) / 2, (top.elevation + top.height) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      this.houseRadius = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 2;
    }

    // devices
    this.devices = [];
    this.byEntity.clear();
    for (const fv of this.floors) {
      for (const d of fv.floor.devices ?? []) {
        const view = createDevice(d, fv.floor, this.ctx);
        if (!view) continue;
        fv.devices.add(view.object);
        this.devices.push(view);
        // a camera's name tag opens its live view
        if (d.type === 'camera' && view.badge) view.badge.el.onclick = () => this.openCockpit(view);
        for (const e of view.entities) {
          if (!this.byEntity.has(e)) this.byEntity.set(e, []);
          this.byEntity.get(e)!.push(view);
        }
      }
    }
    this.indexOpenings();

    // rooms with the lights inside them
    this.rooms = this.floors.flatMap((fv) =>
      fv.rooms.map((rv) => ({
        view: rv,
        lights: this.devices.filter((d) => d.floor === fv.floor && d.device.type === 'light' && insideRoom(d, rv.room.polygon)),
        temperature: rv.room.temperature,
        humidity: rv.room.humidity,
      })),
    );

    if (plan.roof && floors.length) {
      this.roof = buildRoof(floors.at(-1)!, plan.roof, this.theme);
      scene.add(this.roof);
    }

    this.weather = new WeatherFx({ center: this.houseCenter.clone().setY(0), radius: this.houseRadius }, this.theme, high ? 1400 : 600);
    this.weather.setEnabled(this.prefs.weather);
    if (high) {
      const sl = this.weather.sunLight;
      sl.castShadow = true;
      sl.shadow.mapSize.set(2048, 2048);
      const r = this.houseRadius + 4;
      Object.assign(sl.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 90 });
      sl.shadow.bias = -0.0005;
    }
    scene.add(this.weather.group);

    this.trail = new MotionTrail(this.theme);
    scene.add(this.trail.group);

    this.built = true;
    this.seen.clear();
    this.showWarnings();
    this.renderModes();
    this.applyHass(true);
    // a house with one level above ground (maybe a cellar too) opens inside; "House" brings the roof back
    const start = this.config?.floor ?? this.mainFloor()?.floor.id ?? null;
    this.selectFloor(first ? start : this.selectedFloor, false);
    if (first) this.frameView(0.01, 35);
    if (this.prefs.trail) this.reloadTrail();
  }

  private teardownScene() {
    const scene = this.engine?.scene;
    if (!scene) return;
    for (const fv of this.floors) {
      scene.remove(fv.group);
      disposeFloor(fv);
    }
    for (const o of [this.ground, this.roof, this.hemi]) {
      if (!o) continue;
      scene.remove(o);
      disposeTree(o);
    }
    if (this.weather) {
      scene.remove(this.weather.group);
      this.weather.dispose();
    }
    if (this.trail) {
      this.trail.clear();
      scene.remove(this.trail.group);
    }
    this.floors = [];
    this.roof = undefined;
    this.els.stage.querySelectorAll('.nh-labels > *').forEach((n) => n.remove());
  }

  private indexOpenings() {
    this.openingsByEntity.clear();
    for (const fv of this.floors)
      for (const ov of fv.openings) {
        const e = ov.opening.opening.entity;
        if (!e) continue;
        if (!this.openingsByEntity.has(e)) this.openingsByEntity.set(e, []);
        this.openingsByEntity.get(e)!.push(ov);
      }
  }

  /** plan mistakes (and entities HA doesn't know) in a small folding box */
  private showWarnings() {
    if (!this.plan) return;
    const list = validatePlan(this.plan);
    if (this._hass) list.push(...missingEntities(this.plan, this._hass));
    const el = this.els.warn;
    el.classList.toggle('show', list.length > 0);
    if (!list.length) return;
    el.querySelector('summary')!.textContent = `⚠ ${list.length} plan warning${list.length > 1 ? 's' : ''}`;
    el.querySelector('ul')!.innerHTML = list.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
    for (const w of list) console.warn(`neon-house: ${w}`);
  }

  private applyCssTheme() {
    const c = this.theme.css;
    const s = this.els.root.style;
    s.setProperty('--nh-bg', `#${this.theme.background.toString(16).padStart(6, '0')}`);
    s.setProperty('--nh-text', c.text);
    s.setProperty('--nh-muted', c.muted);
    s.setProperty('--nh-accent', c.accent);
    s.setProperty('--nh-on-accent', this.theme.name === 'neon' ? '#04121f' : this.theme.name === 'blueprint' ? '#0b2c63' : '#ffffff');
    s.setProperty('--nh-panel', c.panel);
    s.setProperty('--nh-pill', c.pill);
    s.setProperty('--nh-border', c.border);
  }

  // ---------- state ----------

  private watched(): string[] {
    const ids = new Set<string>([...this.byEntity.keys(), ...this.openingsByEntity.keys()]);
    for (const r of this.rooms) {
      if (r.temperature) ids.add(r.temperature);
      if (r.humidity) ids.add(r.humidity);
    }
    if (this.plan?.weather_entity) ids.add(this.plan.weather_entity);
    ids.add('sun.sun');
    return [...ids];
  }

  private applyHass(full: boolean) {
    const hass = this._hass;
    if (!hass || !this.built || !this.engine) return;
    if (full) {
      this.autoRoomSensors();
      this.showWarnings();
    }
    // batteries anywhere in the house count, not only the plan's entities
    this.scheduleAttention(full);
    const changed = new Set<string>();
    for (const id of this.watched()) {
      const s = hass.states[id];
      if (full || this.seen.get(id) !== s) changed.add(id);
      this.seen.set(id, s);
    }
    if (!changed.size) return;

    const touched = new Set<DeviceView>();
    for (const id of changed) for (const v of this.byEntity.get(id) ?? []) touched.add(v);
    for (const v of touched) {
      v.update(this.ctx);
      if (v.tick) {
        let fn = this.anims.get(v);
        if (!fn) {
          fn = (dt, t) => v.tick!(dt, t);
          this.anims.set(v, fn);
        }
        this.engine.animate(fn);
      }
    }

    for (const id of changed) {
      for (const ov of this.openingsByEntity.get(id) ?? []) {
        ov.target = isOn(hass.states[id]) ? 1 : 0;
        this.engine.animate((dt) => {
          const d = ov.target - ov.amount;
          if (Math.abs(d) < 0.01) {
            ov.apply(ov.target);
            return false;
          }
          ov.apply(ov.amount + Math.sign(d) * Math.min(Math.abs(d), dt * 1.6));
          return true;
        });
      }
    }

    this.updateRooms();
    this.updateFloorLabels();
    this.applyMarkers();
    this.updateAlerts();

    const wid = this.plan?.weather_entity;
    if (this.weather && (full || changed.has('sun.sun') || (wid && changed.has(wid)))) {
      this.weather.update({ weather: stateOf(hass, wid), sun: hass.states['sun.sun'], north: this.plan?.north ?? 0 });
      const w = this.weather;
      this.engine.animate((dt) => w.tick(dt));
    }

    if (this.prefs.trail && !full) {
      const motionChanged = [...changed].some((id) => this.devices.some((d) => d.device.type === 'camera' && (d.device as CameraDevice).motion?.includes(id)));
      if (motionChanged) this.reloadTrail();
    }
    if (this.panelArea) this.renderPanel();
    if (this.cockpit) this.els.cockpit.classList.toggle('alarm', !!this.cockpit.alarm?.());
    this.engine.requestRender();
  }

  /** rooms without configured sensors pick the temperature/humidity sensors of their HA area */
  private autoRoomSensors() {
    const hass = this._hass;
    if (!hass) return;
    for (const r of this.rooms) {
      if (!r.view.room.area || (r.temperature && r.humidity)) continue;
      for (const id of this.areaEntities(r.view.room.area)) {
        const dc = hass.states[id]?.attributes.device_class;
        if (!id.startsWith('sensor.')) continue;
        if (dc === 'temperature' && !r.temperature) r.temperature = id;
        if (dc === 'humidity' && !r.humidity) r.humidity = id;
      }
    }
  }

  private updateRooms() {
    const hass = this._hass;
    const t = this.theme;
    for (const r of this.rooms) {
      // light from the lamps inside
      const glow = new THREE.Color(0, 0, 0);
      let on = 0;
      for (const l of r.lights) {
        const g = l.glow?.();
        if (!g) continue;
        on++;
        glow.add(g.color.clone().multiplyScalar(g.amount));
      }
      const m = r.view.material;
      const base = new THREE.Color(t.floorFill);
      const heat = this.prefs.heatmap;
      const sensor = heat === 'temperature' ? r.temperature : heat === 'humidity' ? r.humidity : undefined;
      const value = num(stateOf(hass, sensor));
      if (heat !== 'none' && value !== undefined) {
        const c = heat === 'temperature' ? tempColor(value) : humidityColor(value);
        m.color.copy(base.lerp(c, 0.55));
        m.emissive.copy(c).multiplyScalar(t.name === 'day' ? 0.05 : 0.22);
      } else {
        m.color.set(t.floorFill);
        // several lamps mix their colours but never wash the floor out to white
        const peak = Math.max(glow.r, glow.g, glow.b, 1);
        const k = t.name === 'day' ? 0.04 : 0.075;
        m.emissive.copy(glow.multiplyScalar(k / peak));
      }
      // label
      const parts: string[] = [];
      const temp = stateOf(hass, r.temperature);
      const hum = stateOf(hass, r.humidity);
      if (temp && !isUnavailable(temp)) parts.push(`${round1(temp.state)}°`);
      if (hum && !isUnavailable(hum)) parts.push(`${Math.round(Number(hum.state))}%`);
      if (on) parts.push(`${on} light${on > 1 ? 's' : ''} on`);
      const sub = r.view.labelEl.querySelector('.nh-room-sub');
      if (sub) sub.textContent = parts.join(' · ');
    }
  }

  private updateFloorLabels() {
    for (const fv of this.floors) {
      const rooms = this.rooms.filter((r) => r.view.floor === fv.floor);
      const lightsOn = this.devices.filter((d) => d.floor === fv.floor && d.device.type === 'light' && d.glow?.()).length;
      const alarms = this.devices.filter((d) => d.floor === fv.floor && d.alarm?.()).length;
      const parts = [`${rooms.length} room${rooms.length === 1 ? '' : 's'}`];
      if (lightsOn) parts.push(`${lightsOn} light${lightsOn > 1 ? 's' : ''} on`);
      if (alarms) parts.push(`<span style="color:#ff6b81">${alarms} alert${alarms > 1 ? 's' : ''}</span>`);
      const sub = fv.labelEl.querySelector('.nh-floor-sub');
      if (sub) sub.innerHTML = parts.join(' · ');
    }
  }

  private applyMarkers() {
    const mode = this.prefs.markers;
    for (const d of this.devices) {
      if (!d.badge) continue;
      const important = d.badge.important || !!d.alarm?.();
      d.badge.obj.visible = mode === 'all' || (mode === 'important' && important);
    }
  }

  private updateAlerts() {
    const alarms = this.devices.filter((d) => d.alarm?.());
    const el = this.els.alert;
    if (!alarms.length) {
      el.classList.remove('show');
      return;
    }
    const cam = alarms[0];
    const name = cam.device.name ?? nameOf(this._hass, cam.device.entity).replace(/ (live view|hd stream|sd stream)$/i, '');
    el.textContent = `⚠ Motion · ${name}${alarms.length > 1 ? ` +${alarms.length - 1}` : ''}`;
    el.classList.add('show');
    el.onclick = () => this.openCockpit(cam);
  }

  private reloadTrail() {
    clearTimeout(this.trailTimer);
    this.trailTimer = window.setTimeout(async () => {
      if (!this._hass || !this.trail) return;
      await this.trail.load(this._hass, this.devices.filter((d) => d.device.type === 'camera'));
      this.trail.group.visible = this.prefs.trail;
      this.engine?.requestRender();
      if (this.prefs.trail) this.toast(this.trail.count ? `${this.trail.count} detections in the last ${this.trail.minutes} min` : `No detections in the last ${this.trail.minutes} min`);
    }, 400);
  }

  // ---------- floors & rooms ----------

  private selectFloor(id: string | null, fly = true) {
    if (id && !this.floors.some((f) => f.floor.id === id)) id = null;
    this.selectedFloor = id;
    const sel = id ? this.floors.findIndex((f) => f.floor.id === id) : -1;
    // pulled apart around the ground floor: it stays on the lawn, upper floors rise, cellars sink
    const apart = sel < 0 && this.canPullApart() && this.prefs.apart;
    const base = this.groundIndex();
    this.floors.forEach((fv, i) => {
      fv.group.position.y = fv.floor.elevation + (apart ? (i - base) * APART_GAP : 0);
      if (sel < 0) {
        fv.group.visible = true;
        this.dimFloor(fv, false);
      } else {
        fv.group.visible = i <= sel;
        this.dimFloor(fv, i < sel);
      }
      fv.label.visible = sel < 0 && this.prefs.names;
      for (const r of fv.rooms) r.label.visible = this.prefs.names && (sel === i || (sel < 0 && fv === this.mainFloor()));
    });
    // the lawn would hide a cellar: drop it while looking at a floor below ground
    if (this.ground) this.ground.visible = sel < 0 || this.floors[sel].floor.elevation > -0.5;
    const covers = this.ground?.getObjectByName('covers');
    if (covers) covers.visible = sel < 0 && !this.prefs.cut;
    if (this.roof) {
      this.roof.visible = sel < 0 && !this.prefs.cut;
      this.roof.position.y = apart ? (this.floors.length - 1 - base) * APART_GAP : 0;
    }
    this.renderFloorChips();
    this.renderRoomChips();
    if (fly) this.frameView(0.9);
    this.engine?.requestRender();
  }

  /** the only level above ground, when there is just one (a bungalow, with or without a cellar) */
  private mainFloor(): FloorView | undefined {
    const above = this.floors.filter((f) => f.floor.elevation > -0.5);
    return above.length === 1 ? above[0] : undefined;
  }

  /** the floor nearest to ground level (floors are sorted by elevation) */
  private groundIndex(): number {
    let best = 0;
    this.floors.forEach((f, i) => {
      if (Math.abs(f.floor.elevation) < Math.abs(this.floors[best].floor.elevation)) best = i;
    });
    return best;
  }

  /** pulling floors apart only helps with two or more levels above ground (cellars stay hidden underground) */
  private canPullApart(): boolean {
    return this.floors.filter((f) => f.floor.elevation > -0.5).length > 1;
  }

  /** fly to the whole house or the selected floor; `azimuth` only for the very first view */
  private frameView(duration: number, azimuth?: number) {
    if (!this.engine) return;
    const sel = this.selectedFloor ? this.floors.findIndex((f) => f.floor.id === this.selectedFloor) : -1;
    if (sel < 0) {
      const y = this.prefs.apart && this.canPullApart() ? this.houseCenter.y + 2 : this.houseCenter.y * 0.6;
      this.engine.flyTo(this.houseCenter.clone().setY(y), this.houseRadius * 2.6, azimuth, 56, duration);
    } else {
      const fv = this.floors[sel];
      this.engine.flyTo(fv.center.clone().setY(fv.floor.elevation + 0.5), fv.radius * 2.3, azimuth, 48, duration);
    }
  }

  private dimFloor(fv: FloorView, dim: boolean) {
    const t = this.theme;
    fv.wallMaterial.opacity = dim ? 0.06 : t.wallOpacity;
    fv.wallMaterial.transparent = dim || t.wallOpacity < 1;
    fv.wallMaterial.depthWrite = !dim && t.wallOpacity >= 0.85;
    fv.edgeMaterial.opacity = dim ? 0.15 : 1;
    fv.edgeMaterial.transparent = dim;
    fv.devices.visible = !dim;
    fv.furniture.visible = !dim;
  }

  private selectRoom(r: RoomInfo) {
    if (this.selectedFloor !== r.view.floor.id) this.selectFloor(r.view.floor.id, false);
    const fv = this.floors.find((f) => f.floor === r.view.floor)!;
    const c = new THREE.Vector3(r.view.centroid[0], fv.group.position.y + 0.4, r.view.centroid[1]);
    const xs = r.view.room.polygon.map((p) => p[0]);
    const ys = r.view.room.polygon.map((p) => p[1]);
    const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    this.engine?.flyTo(c, Math.max(6, size * 1.7), undefined, 45);
    this.openPanel({ title: r.view.room.name, area: r.view.room.area, room: r });
    this.renderRoomChips(r);
  }

  // ---------- UI ----------

  private renderFloorChips() {
    const el = this.els.floors;
    const chips = [`<span class="nh-title">Neon<i>House</i></span>`];
    chips.push(`<button class="nh-chip ${this.selectedFloor === null ? 'on' : ''}" data-floor="">${this.mainFloor() ? 'House' : 'All floors'}</button>`);
    for (const fv of [...this.floors].reverse())
      chips.push(`<button class="nh-chip ${this.selectedFloor === fv.floor.id ? 'on' : ''}" data-floor="${fv.floor.id}">${escapeHtml(fv.floor.name)}</button>`);
    chips.push(`<span class="nh-spacer"></span>`);
    for (const l of this.config?.links ?? [])
      chips.push(`<button class="nh-chip nh-link" data-link="${escapeHtml(l.path)}">${escapeHtml(l.name)} ↗</button>`);
    if (this.config?.attention !== false) chips.push(this.attentionChip());
    chips.push(
      `<span class="nh-seg">${(['neon', 'blueprint', 'day'] as const)
        .map((t) => `<button class="nh-chip ${this.prefs.theme === t ? 'on' : ''}" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)
        .join('')}</span>`,
    );
    chips.push(
      `<span class="nh-seg">${(['none', 'important', 'all'] as const)
        .map((m) => `<button class="nh-chip ${this.prefs.markers === m ? 'on' : ''}" data-markers="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`)
        .join('')}</span>`,
    );
    el.innerHTML = chips.join('');
    el.querySelectorAll<HTMLElement>('[data-floor]').forEach((b) => (b.onclick = () => this.selectFloor(b.dataset.floor || null)));
    el.querySelectorAll<HTMLElement>('[data-link]').forEach((b) => (b.onclick = () => navigate(b.dataset.link!)));
    el.querySelectorAll<HTMLElement>('[data-theme]').forEach(
      (b) =>
        (b.onclick = () => {
          this.prefs.theme = b.dataset.theme as ThemeName;
          savePrefs(this.prefs);
          this.built = false;
          this.build();
        }),
    );
    el.querySelectorAll<HTMLElement>('[data-markers]').forEach(
      (b) =>
        (b.onclick = () => {
          this.prefs.markers = b.dataset.markers as Markers;
          savePrefs(this.prefs);
          this.applyMarkers();
          this.renderFloorChips();
          this.engine?.requestRender();
        }),
    );
    this.bindAttentionChip();
  }

  /**
   * After a HACS update the browser can keep running the old copy until a full reload. The
   * registered resource URL carries the new version, so compare it with the URL we came from.
   */
  private async checkForUpdate() {
    try {
      const resources = await this._hass!.callWS<{ url: string }[]>({ type: 'lovelace/resources' });
      const mine = resources.find((r) => r.url.includes('neon-house-card.js'));
      if (!mine) return;
      const want = new URL(mine.url, location.origin);
      const have = new URL(LOADED_FROM);
      if (want.pathname !== have.pathname || want.search === have.search) return;
      const el = document.createElement('button');
      el.className = 'nh-update';
      el.textContent = '⟳ Neon House was updated – tap to reload';
      el.onclick = () => location.reload();
      this.els.root.appendChild(el);
    } catch {
      /* not an admin, or not in Home Assistant: no check */
    }
  }

  // ---------- needs attention ----------

  private attentionChip(): string {
    const n = this.issues.length;
    const urgent = this.issues.some((i) => i.severity >= 3);
    return `<button class="nh-chip nh-attn ${n ? (urgent ? 'urgent' : 'warn') : 'ok'}" data-attn title="Needs attention">${n ? `⚠ ${n}` : '✓'}</button>`;
  }

  private bindAttentionChip() {
    const b = this.els.floors.querySelector<HTMLElement>('[data-attn]');
    if (b) b.onclick = () => (this.panelArea?.attention ? this.closePanel() : this.openPanel({ title: 'Needs attention', attention: true }));
  }

  /** recount at most every 1.5 s – hass updates arrive many times a second */
  private scheduleAttention(now = false) {
    if (this.config?.attention === false || !this._hass) return;
    if (this.attentionTimer && !now) return;
    clearTimeout(this.attentionTimer);
    this.attentionTimer = window.setTimeout(() => {
      this.attentionTimer = 0;
      if (!this._hass) return;
      this.issues = findIssues(this._hass, this.plan, {
        excludeLabel: this.config?.attention_exclude_label ?? 'no_battery_alerts',
        batteryLow: this.config?.battery_low ?? 20,
      });
      const chip = this.els.floors.querySelector('[data-attn]');
      if (chip) {
        chip.outerHTML = this.attentionChip();
        this.bindAttentionChip();
      }
      if (this.panelArea?.attention) this.renderPanel();
    }, now ? 50 : 1500);
  }

  private renderAttention() {
    const groups: [string, Issue['kind']][] = [
      ['Problems', 'problem'],
      ['Bills', 'bill'],
      ['Batteries', 'battery'],
      ['Unavailable on the plan', 'offline'],
    ];
    const body = groups
      .map(([title, kind]) => {
        const rows = this.issues.filter((i) => i.kind === kind);
        if (!rows.length) return '';
        return `<div class="nh-section">${title}</div>${rows
          .map(
            (i) => `<div class="nh-item attn sev${i.severity}" data-id="${escapeHtml(i.entity)}">
              <span class="dot"></span><span class="name">${escapeHtml(i.name)}<small>${escapeHtml(i.detail)}</small></span>
            </div>`,
          )
          .join('')}`;
      })
      .join('');
    this.els.panel.innerHTML = `
      <header><div style="flex:1"><h3>Needs attention</h3><div class="sub">${this.issues.length ? `${this.issues.length} thing${this.issues.length > 1 ? 's' : ''} to look at` : 'All good'}</div></div><button class="nh-x" data-close>✕</button></header>
      <div class="nh-list">${body || '<div class="nh-section">Nothing needs attention ✓</div>'}</div>`;
    this.els.panel.querySelector<HTMLElement>('[data-close]')!.onclick = () => this.closePanel();
    this.els.panel.querySelectorAll<HTMLElement>('[data-id]').forEach((row) => (row.onclick = () => moreInfo(this, row.dataset.id!)));
  }

  private renderRoomChips(active?: RoomInfo) {
    const el = this.els.rooms;
    const parts: string[] = [];
    const floors = this.selectedFloor ? this.floors.filter((f) => f.floor.id === this.selectedFloor) : [...this.floors].reverse();
    for (const fv of floors) {
      if (!this.selectedFloor && this.floors.length > 1) parts.push(`<span class="nh-group-label">${escapeHtml(fv.floor.name)}</span>`);
      for (const r of this.rooms.filter((x) => x.view.floor === fv.floor)) {
        const id = `${fv.floor.id}/${r.view.room.id}`;
        parts.push(`<button class="nh-chip ${active === r ? 'on' : ''}" data-room="${id}">${escapeHtml(r.view.room.name)}</button>`);
      }
    }
    el.innerHTML = parts.join('');
    el.querySelectorAll<HTMLElement>('[data-room]').forEach((b) => {
      b.onclick = () => {
        const [f, r] = b.dataset.room!.split('/');
        const room = this.rooms.find((x) => x.view.floor.id === f && x.view.room.id === r);
        if (room) this.selectRoom(room);
      };
    });
  }

  private renderModes() {
    const p = this.prefs;
    const heatLabel = { none: 'Heatmap', temperature: 'Heat: temp', humidity: 'Heat: humidity' }[p.heatmap];
    this.els.modes.innerHTML = `
      <span class="nh-seg">
        <button class="nh-chip ${!p.cut ? 'on' : ''}" data-act="tall">Tall walls</button>
        <button class="nh-chip ${p.cut ? 'on' : ''}" data-act="cut">Cut</button>
      </span>
      ${this.canPullApart() ? `<button class="nh-chip ${p.apart ? 'on' : ''}" data-act="apart">Apart</button>` : ''}
      <button class="nh-chip ${p.names ? 'on' : ''}" data-act="names">Room names</button>
      <button class="nh-chip ${p.heatmap !== 'none' ? 'on' : ''}" data-act="heat">${heatLabel}</button>
      <button class="nh-chip ${p.cameras ? 'on' : ''}" data-act="cameras">Cameras</button>
      <button class="nh-chip ${p.trail ? 'on' : ''}" data-act="trail">Trail</button>
      <button class="nh-chip ${p.weather ? 'on' : ''}" data-act="weather">Weather</button>`;
    this.els.modes.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => (b.onclick = () => this.modeAction(b.dataset.act!)));
    for (const d of this.devices) d.setExtras?.(p.cameras);
  }

  private modeAction(act: string) {
    const p = this.prefs;
    switch (act) {
      case 'tall':
      case 'cut':
        p.cut = act === 'cut';
        for (const fv of this.floors) buildWalls(fv, this.theme, p.cut);
        this.indexOpenings();
        this.seen.clear();
        this.applyHass(true);
        break;
      case 'apart':
        p.apart = !p.apart;
        if (p.apart && this.selectedFloor) this.selectedFloor = null;
        break;
      case 'names':
        p.names = !p.names;
        break;
      case 'heat':
        p.heatmap = p.heatmap === 'none' ? 'temperature' : p.heatmap === 'temperature' ? 'humidity' : 'none';
        this.updateRooms();
        break;
      case 'cameras':
        p.cameras = !p.cameras;
        break;
      case 'trail':
        p.trail = !p.trail;
        if (p.trail) this.reloadTrail();
        else this.trail?.clear();
        break;
      case 'weather':
        p.weather = !p.weather;
        this.weather?.setEnabled(p.weather);
        if (this.weather && this._hass) {
          this.weather.update({ weather: stateOf(this._hass, this.plan?.weather_entity), sun: this._hass.states['sun.sun'], north: this.plan?.north ?? 0 });
          const w = this.weather;
          this.engine?.animate((dt) => w.tick(dt));
        }
        break;
    }
    savePrefs(p);
    this.renderModes();
    this.selectFloor(this.selectedFloor, act === 'apart' || act === 'cut' || act === 'tall');
  }

  private toast(msg: string) {
    const el = this.els.toast;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- room panel ----------

  private areaEntities(area: string): string[] {
    const hass = this._hass;
    if (!hass?.entities) return [];
    const out: string[] = [];
    for (const e of Object.values(hass.entities)) {
      if (e.hidden || e.entity_category) continue;
      const a = e.area_id ?? (e.device_id ? hass.devices?.[e.device_id]?.area_id : undefined);
      if (a === area && hass.states[e.entity_id]) out.push(e.entity_id);
    }
    return out;
  }

  private openPanel(p: { title: string; area?: string; room?: RoomInfo; attention?: boolean }) {
    this.panelArea = p;
    this.renderPanel();
    this.els.panel.classList.add('open');
  }

  private closePanel() {
    this.panelArea = undefined;
    this.els.panel.classList.remove('open');
    this.renderRoomChips();
  }

  private renderPanel() {
    const p = this.panelArea;
    const hass = this._hass;
    if (!p || !hass) return;
    if (p.attention) return this.renderAttention();
    const ids = new Set<string>(p.area ? this.areaEntities(p.area) : []);
    // devices drawn in this room count too, even if their HA area differs
    if (p.room) for (const d of this.devices) if (d.floor === p.room.view.floor && insideRoom(d, p.room.view.room.polygon)) ids.add(d.device.entity);
    const groups: Record<string, string[]> = { Controls: [], Cameras: [], Sensors: [], Other: [] };
    for (const id of ids) {
      const domain = id.split('.')[0];
      if (domain === 'camera') groups.Cameras.push(id);
      else if (TOGGLEABLE.has(domain)) groups.Controls.push(id);
      else if (domain === 'sensor' || domain === 'binary_sensor') groups.Sensors.push(id);
      else if (!['button', 'number', 'select', 'text', 'update', 'event', 'image'].includes(domain)) groups.Other.push(id);
    }
    const temp = stateOf(hass, p.room?.temperature);
    const hum = stateOf(hass, p.room?.humidity);
    const sub = [temp && !isUnavailable(temp) ? `${round1(temp.state)}°C` : '', hum && !isUnavailable(hum) ? `${Math.round(Number(hum.state))}%` : ''].filter(Boolean).join(' · ');
    const row = (id: string) => {
      const s = hass.states[id];
      const domain = id.split('.')[0];
      const on = isOn(s) && domain !== 'sensor';
      const canToggle = TOGGLEABLE.has(domain) && !isUnavailable(s);
      const unit = s?.attributes.unit_of_measurement ? ` ${s.attributes.unit_of_measurement}` : '';
      return `<div class="nh-item ${on ? 'on' : ''}" data-id="${id}">
        <span class="dot"></span><span class="name">${escapeHtml(nameOf(hass, id))}</span>
        ${canToggle ? `<span class="nh-toggle ${on ? 'on' : ''}" data-toggle="${id}"></span>` : `<span class="state">${escapeHtml(s ? s.state + unit : '–')}</span>`}
      </div>`;
    };
    const body = Object.entries(groups)
      .filter(([, list]) => list.length)
      .map(([title, list]) => `<div class="nh-section">${title}</div>${list.sort((a, b) => nameOf(hass, a).localeCompare(nameOf(hass, b))).map(row).join('')}`)
      .join('');
    this.els.panel.innerHTML = `
      <header><div style="flex:1"><h3>${escapeHtml(p.title)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div><button class="nh-x" data-close>✕</button></header>
      <div class="nh-list">${body || `<div class="nh-section">No entities${p.area ? '' : ' – set an HA area for this room'}</div>`}</div>`;
    this.els.panel.querySelector<HTMLElement>('[data-close]')!.onclick = () => this.closePanel();
    this.els.panel.querySelectorAll<HTMLElement>('[data-id]').forEach((row) => {
      row.onclick = (ev) => {
        const t = ev.target as HTMLElement;
        if (t.dataset.toggle) {
          void toggle(hass, t.dataset.toggle);
          t.classList.toggle('on');
          return;
        }
        const id = row.dataset.id!;
        const cam = this.devices.find((d) => d.device.type === 'camera' && d.device.entity === id);
        if (cam) this.openCockpit(cam);
        else moreInfo(this, id);
      };
    });
  }

  // ---------- camera cockpit ----------

  private openCockpit(view: DeviceView) {
    const hass = this._hass;
    if (!hass || !this.engine) return;
    const d = view.device as CameraDevice;
    this.closeCockpit(false);
    this.cockpit = view;
    if (this.selectedFloor && this.selectedFloor !== view.floor.id) this.selectFloor(view.floor.id, false);
    const stream = d.stream ?? d.entity;
    const name = d.name ?? nameOf(hass, d.entity).replace(/ (live view|hd stream|sd stream)$/i, '');
    const el = this.els.cockpit;
    el.innerHTML = `
      <header><b>◉ ${escapeHtml(name)}</b><button class="nh-x" data-close>✕</button></header>
      <div class="live"><img alt=""><span class="rec">LIVE</span></div>
      <div class="acts">
        <button class="nh-chip" data-act="ha">Open in Home Assistant</button>
        <button class="nh-chip" data-act="view">Look from camera</button>
        <button class="nh-chip" data-act="back">Back to house</button>
      </div>`;
    el.classList.add('open');
    el.classList.toggle('alarm', !!view.alarm?.());
    const img = el.querySelector('img')!;
    const live = cameraUrl(hass, stream, true);
    let fellBack = false;
    const snapshot = () => {
      const u = cameraUrl(hass, stream, false);
      if (u) img.src = u;
    };
    const fallback = () => {
      // no MJPEG proxy for this camera: refresh still pictures instead
      if (fellBack) return;
      fellBack = true;
      snapshot();
      this.cockpitTimer = window.setInterval(snapshot, 2000);
    };
    img.onerror = fallback;
    if (live) img.src = live;
    else fallback();
    el.querySelector<HTMLElement>('[data-close]')!.onclick = () => this.closeCockpit(true);
    el.querySelector<HTMLElement>('[data-act="ha"]')!.onclick = () => moreInfo(this, stream);
    el.querySelector<HTMLElement>('[data-act="back"]')!.onclick = () => this.closeCockpit(true);
    el.querySelector<HTMLElement>('[data-act="view"]')!.onclick = () => this.lookFromCamera(view);
    this.lookFromCamera(view);
  }

  private lookFromCamera(view: DeviceView) {
    const d = view.device as CameraDevice;
    const eye = view.focus();
    const rot = ((d.rot ?? 0) * Math.PI) / 180;
    const fwd = new THREE.Vector3(Math.sin(rot), 0, -Math.cos(rot));
    // sit a little behind and above the camera, looking at the middle of its view
    const pos = eye.clone().addScaledVector(fwd, -1.6).add(new THREE.Vector3(0, 1.2, 0));
    const look = eye.clone().addScaledVector(fwd, (d.range ?? 7) * 0.5).setY(eye.y - (d.z ?? 2.5) + 0.2);
    this.engine?.flyToEye(pos, look, 1.1);
  }

  private closeCockpit(returnView: boolean) {
    clearInterval(this.cockpitTimer);
    const img = this.els?.cockpit.querySelector('img');
    if (img) {
      img.onerror = null;
      img.src = ''; // ends the MJPEG connection
    }
    this.els?.cockpit.classList.remove('open', 'alarm');
    const was = this.cockpit;
    this.cockpit = undefined;
    if (returnView && was) this.selectFloor(this.selectedFloor);
  }

  // ---------- pointer ----------

  private bindPointer() {
    const stage = this.els.stage;
    let down: { x: number; y: number; t: number; id: number } | null = null;
    let pressTimer = 0;
    stage.addEventListener('pointerdown', (e) => {
      // clickable labels (a camera's name tag) handle their own clicks
      if ((e.target as HTMLElement).closest?.('.nh-cam, .nh-floor')) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        if (!down) return;
        down = null;
        this.longPress(e.clientX, e.clientY);
      }, 600);
    });
    stage.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
        down = null;
        clearTimeout(pressTimer);
      }
      if (this.config?.coords) this.showCoords(e.clientX, e.clientY);
    });
    stage.addEventListener('pointerleave', () => this.els.coords.classList.remove('show'));
    stage.addEventListener('pointerup', (e) => {
      clearTimeout(pressTimer);
      if (!down || down.id !== e.pointerId) return;
      const quick = performance.now() - down.t < 500;
      down = null;
      if (quick) this.tap(e.clientX, e.clientY);
    });
    stage.addEventListener('pointercancel', () => {
      down = null;
      clearTimeout(pressTimer);
    });
  }

  /** editing aid: the plan x/y (metres) under the pointer, on the floor being looked at */
  private showCoords(x: number, y: number) {
    const fv = this.floors.find((f) => f.floor.id === this.selectedFloor) ?? this.floors[0];
    const p = fv && this.engine?.groundPoint(x, y, fv.group.position.y);
    const el = this.els.coords;
    if (!p) return el.classList.remove('show');
    el.textContent = `x ${p.x.toFixed(2)}   y ${p.z.toFixed(2)}`;
    el.classList.add('show');
  }

  /** is a world point over a room (on any floor)? */
  private overRoom(p: THREE.Vector3): boolean {
    return this.floors.some((fv) => fv.group.visible && fv.floor.rooms.some((r) => pointInPolygon([p.x, p.z], r.polygon)));
  }

  private tap(x: number, y: number) {
    // a camera cone reaching over the house must not swallow taps meant for the rooms
    const hit = this.engine?.pick(x, y, (data, point) => !(data.wedge && this.overRoom(point)));
    const hass = this._hass;
    if (!hit || !hass) {
      if (this.panelArea) this.closePanel();
      return;
    }
    const data = hit.data;
    if (data.kind === 'device') {
      const v = data.view as DeviceView;
      const d = v.device;
      if (d.type === 'camera') return this.openCockpit(v);
      // water valves open from HA's dialog, never by an accidental tap on the lawn
      if (d.type === 'sensor' || d.type === 'sprinkler') return moreInfo(this, d.entity);
      if (d.type === 'car') return moreInfo(this, d.presence ?? d.entity);
      if (d.type === 'tv') {
        const s = hass.states[d.entity];
        // a TV that is fully off often can't be woken through the media player: use its plug
        const target = d.power && (!s || s.state === 'off' || isUnavailable(s)) ? d.power : d.entity;
        void toggle(hass, target);
        return this.toast(`${nameOf(hass, target)} → toggled`);
      }
      const domain = d.entity.split('.')[0];
      if (!TOGGLEABLE.has(domain)) return moreInfo(this, d.entity);
      void toggle(hass, d.entity);
      const s = hass.states[d.entity];
      this.toast(`${d.name ?? nameOf(hass, d.entity)} → ${isOn(s) ? 'off' : 'on'}`);
      return;
    }
    if (data.kind === 'room') {
      const r = this.rooms.find((x) => x.view.floor.id === data.floor && x.view.room.id === data.room);
      if (r) this.selectRoom(r);
      return;
    }
    if (data.kind === 'outdoor' && data.area) {
      this.openPanel({ title: data.name ?? data.area, area: data.area });
      return;
    }
    if (data.kind === 'solar' && data.entity) return moreInfo(this, data.entity);
    if (this.panelArea) this.closePanel();
  }

  private longPress(x: number, y: number) {
    const hit = this.engine?.pick(x, y);
    if (hit?.data.kind === 'device') moreInfo(this, (hit.data.view as DeviceView).device.entity);
  }
}

// ---------- helpers ----------

/** string lights have a path instead of a position and belong to no room */
const insideRoom = (d: DeviceView, poly: Vec2[]) => Array.isArray(d.device.pos) && pointInPolygon(d.device.pos, poly);

function tempColor(t: number): THREE.Color {
  // 16° blue → 21° green → 24° amber → 28° red
  const stops: [number, number][] = [
    [16, 0x2f6bff],
    [19, 0x26c6da],
    [21, 0x2ee68a],
    [24, 0xffc23d],
    [28, 0xff3d57],
  ];
  return gradient(stops, t);
}

function humidityColor(h: number): THREE.Color {
  const stops: [number, number][] = [
    [25, 0xffb13d],
    [40, 0x2ee68a],
    [55, 0x26c6da],
    [70, 0x2f6bff],
  ];
  return gradient(stops, h);
}

function gradient(stops: [number, number][], v: number): THREE.Color {
  if (v <= stops[0][0]) return new THREE.Color(stops[0][1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (v <= b) return new THREE.Color(ca).lerp(new THREE.Color(cb), (v - a) / (b - a));
  }
  return new THREE.Color(stops.at(-1)![1]);
}

const round1 = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : s;
};

function localStorageHas(): boolean {
  try {
    return !!localStorage.getItem(PREFS_KEY);
  } catch {
    return false;
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* private mode or blocked storage: defaults */
  }
  return { ...DEFAULT_PREFS };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* not persisted, fine */
  }
}

if (!customElements.get('neon-house-card')) {
  customElements.define('neon-house-card', NeonHouseCard);
  const w = window as any;
  w.customCards = w.customCards || [];
  w.customCards.push({
    type: 'neon-house-card',
    name: 'Neon House',
    description: 'Your home as a neon 3D plan: lights, cameras, climate, weather – all local.',
    preview: false,
  });
  console.info(`%c NEON-HOUSE %c ${VERSION} `, 'background:#38e8ff;color:#04121f;font-weight:700', 'background:#0c1c3d;color:#38e8ff');
}
