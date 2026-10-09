import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type {
  ApplianceDevice,
  CameraDevice,
  CarDevice,
  ClimateDevice,
  Device,
  Floor,
  HomeAssistant,
  LightDevice,
  SensorDevice,
  SprinklerDevice,
  TvDevice,
  VacuumDevice,
} from '../types';
import { brightness, isOn, isUnavailable, lightColor, num, stateOf } from '../ha';
import { LineBuilder, lineMaterial, w3 } from './geo';
import type { Theme } from './theme';

export interface DeviceCtx {
  theme: Theme;
  hass?: HomeAssistant;
  /** quality: shadows and light counts */
  high: boolean;
  /** something changed outside an update (a picture finished loading) */
  requestRender(): void;
}

export interface DeviceView {
  device: Device;
  floor: Floor;
  object: THREE.Object3D;
  /** entities whose changes affect this device */
  entities: string[];
  /** label above the device ("important" markers) */
  badge?: { obj: CSS2DObject; el: HTMLElement; important: boolean };
  update(ctx: DeviceCtx): void;
  /** per-frame animation; return true while something still moves */
  tick?(dt: number, time: number): boolean;
  /** lights: colour and strength they add to their room (0 when off) */
  glow?(): { color: THREE.Color; amount: number } | null;
  /** cameras: is motion seen right now */
  alarm?(): boolean;
  /** cameras: show or hide the view wedge on the floor */
  setExtras?(visible: boolean): void;
  /** world position (for flying the view there) */
  focus(): THREE.Vector3;
}

const DEG = Math.PI / 180;
/** plan rotation (clockwise from −y) to a three.js y-rotation */
const yaw = (rot = 0) => -rot * DEG;
/** unit vector of a plan rotation in plan coordinates */
const facing = (rot = 0): [number, number] => [Math.sin(rot * DEG), -Math.cos(rot * DEG)];

function pickable(obj: THREE.Object3D, view: DeviceView) {
  obj.traverse((o) => (o.userData.pick = { kind: 'device', view }));
}

function makeBadge(cls: string, important: boolean): { obj: CSS2DObject; el: HTMLElement; important: boolean } {
  const el = document.createElement('div');
  el.className = `nh-badge ${cls}`;
  const obj = new CSS2DObject(el);
  return { obj, el, important };
}

function edgeBox(w: number, h: number, d: number, color: number, width = 1.2) {
  const lb = new LineBuilder();
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i += 2)
    lb.seg(new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1));
  g.dispose();
  return lb.build(lineMaterial(color, width));
}

/** null for an unknown type (a typo in the plan; the plan warnings name it) */
export function createDevice(device: Device, floor: Floor, ctx: DeviceCtx): DeviceView | null {
  if (!device?.entity || !Array.isArray(device.pos)) return null;
  switch (device.type) {
    case 'light':
      return lightView(device, floor, ctx);
    case 'camera':
      return cameraView(device, floor, ctx);
    case 'tv':
      return tvView(device, floor, ctx);
    case 'climate':
      return climateView(device, floor, ctx);
    case 'appliance':
      return applianceView(device, floor, ctx);
    case 'vacuum':
      return vacuumView(device, floor, ctx);
    case 'sensor':
      return sensorView(device, floor, ctx);
    case 'car':
      return carView(device, floor, ctx);
    case 'sprinkler':
      return sprinklerView(device, floor, ctx);
    default:
      return null;
  }
}

// ---------- sprinklers ----------

function sprinklerView(d: SprinklerDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const radius = d.radius ?? 4;
  const arc = Math.min(360, Math.max(10, d.arc ?? 360)) * DEG;
  const g = new THREE.Group();
  g.position.copy(w3(d.pos, d.z ?? 0.02));

  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.1, 14),
    new THREE.MeshStandardMaterial({ color: t.name === 'day' ? 0x3d4a5c : 0x1a2c4c, emissive: 0x000000 }),
  );
  head.position.y = 0.05;
  g.add(head);

  // the patch it waters: a faint disc or sector, brighter while running
  const areaGeo = new THREE.CircleGeometry(radius, 48, 0, arc);
  areaGeo.rotateX(-Math.PI / 2);
  const areaMat = new THREE.MeshBasicMaterial({ color: 0x3fa9ff, transparent: true, opacity: 0.04, depthWrite: false, side: THREE.DoubleSide });
  const area = new THREE.Mesh(areaGeo, areaMat);
  // the flat sector spans plan angles 90° … 90° − arc; turn its middle onto `rot`
  area.rotation.y = Math.PI / 2 - arc / 2 - (d.rot ?? 0) * DEG;
  area.position.y = 0.01;
  g.add(area);

  // spray: droplets flying out on little arcs
  const count = ctx.high ? 220 : 120;
  const pos = new Float32Array(count * 3);
  const seeds = Array.from({ length: count }, () => [Math.random(), Math.random(), 0.6 + Math.random() * 0.4]);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sprayMat = new THREE.PointsMaterial({
    size: 0.06,
    color: t.name === 'day' ? 0x3a8fd8 : 0x8fd8ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: t.name === 'day' ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const spray = new THREE.Points(sprayGeo, sprayMat);
  spray.frustumCulled = false;
  g.add(spray);

  const badge = makeBadge('nh-water', false);
  badge.obj.position.set(0, 0.6, 0);
  g.add(badge.obj);

  let open = false;
  let level = 0;
  let time = 0;
  const centre = (d.rot ?? 0) * DEG; // plan angle of the arc's middle

  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity],
    badge,
    update(c) {
      const s = stateOf(c.hass, d.entity);
      open = isOn(s);
      badge.important = open;
      badge.el.classList.toggle('active', open);
      badge.el.classList.toggle('off', isUnavailable(s));
      badge.el.innerHTML = `<span class="ico">💧</span>${escape(d.name ?? s?.attributes.friendly_name ?? d.entity)}${open ? ' · watering' : ''}`;
    },
    tick(dt) {
      const target = open ? 1 : 0;
      level += (target - level) * Math.min(1, dt * 3);
      if (Math.abs(level - target) < 0.01) level = target;
      time += dt;
      areaMat.opacity = 0.04 + 0.12 * level;
      sprayMat.opacity = 0.85 * level;
      if (level > 0) {
        for (let i = 0; i < count; i++) {
          const [a, ph, reach] = seeds[i];
          const k = (ph + time * 0.7) % 1;
          // plan angle within the arc, then plan → world (x = sin, z = −cos)
          const ang = centre + (a - 0.5) * arc;
          const r = k * radius * reach;
          pos[i * 3] = Math.sin(ang) * r;
          pos[i * 3 + 1] = 0.1 + 4 * radius * 0.18 * k * (1 - k);
          pos[i * 3 + 2] = -Math.cos(ang) * r;
        }
        sprayGeo.attributes.position.needsUpdate = true;
      }
      return open || level > 0;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(head, view);
  return view;
}

// ---------- lights ----------

function lightView(d: LightDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const kind = d.kind ?? 'bulb';
  const g = new THREE.Group();
  const z = d.z ?? (kind === 'strip' ? 0.9 : kind === 'flood' ? 2.6 : kind === 'lamp' ? 1.3 : floor.height - 0.15);
  g.position.copy(w3(d.pos, z));
  g.rotation.y = yaw(d.rot);

  const mat = new THREE.MeshStandardMaterial({ color: 0x222833, emissive: 0x000000, roughness: 0.4 });
  let shape: THREE.Mesh;
  if (kind === 'strip') shape = new THREE.Mesh(new THREE.BoxGeometry(d.length ?? 1.2, 0.03, 0.03), mat);
  else if (kind === 'flood') shape = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), mat);
  else shape = new THREE.Mesh(new THREE.SphereGeometry(kind === 'lamp' ? 0.12 : 0.09, 18, 12), mat);
  g.add(shape);
  if (kind === 'lamp') {
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, z, 8),
      new THREE.MeshStandardMaterial({ color: ctx.theme.device }),
    );
    stand.position.y = -z / 2;
    g.add(stand);
  }

  const light = new THREE.PointLight(0xffffff, 0, kind === 'flood' ? 9 : kind === 'strip' ? 4.5 : 6.5, 1.6);
  light.position.y = kind === 'strip' ? 0.15 : -0.05;
  if (kind === 'flood') light.position.set(0, -0.3, -0.6);
  g.add(light);

  // a soft halo sprite so the lamp reads as "on" from far away
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  // long strips (a string of fairy lights) would get a halo the size of a room: cap it
  halo.scale.setScalar(kind === 'strip' ? Math.min(1.4, (d.length ?? 1.2) * 0.9) : 0.7);
  g.add(halo);

  let color = new THREE.Color(0xffd9a0);
  let level = 0;
  let shown = 0;

  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity],
    update(c) {
      const s = stateOf(c.hass, d.entity);
      color = lightColor(s);
      level = brightness(s);
      mat.color.set(isUnavailable(s) ? 0x3a3f4a : 0x2a3140);
      halo.material.color.copy(color);
    },
    tick(dt) {
      // fade in/out instead of switching instantly
      const diff = level - shown;
      if (Math.abs(diff) < 0.003) shown = level;
      else shown += diff * Math.min(1, dt * 8);
      light.color.copy(color);
      light.intensity = shown * (kind === 'flood' ? 10 : kind === 'strip' ? 3 : 3.5) * (ctx.theme.name === 'day' ? 0.6 : 1);
      mat.emissive.copy(color).multiplyScalar(shown * 1.6);
      halo.material.opacity = shown * (ctx.theme.name === 'day' ? 0.3 : 0.85);
      return shown !== level;
    },
    glow() {
      return level > 0 ? { color, amount: level } : null;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(g, view);
  return view;
}

let _halo: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (_halo) return _halo;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  _halo = new THREE.CanvasTexture(c);
  return _halo;
}

// ---------- cameras ----------

function cameraView(d: CameraDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const g = new THREE.Group();
  const z = d.z ?? 2.5;
  g.position.copy(w3(d.pos, z));
  const head = new THREE.Group();
  head.rotation.y = yaw(d.rot);
  g.add(head);

  const bodyMat = new THREE.MeshStandardMaterial({ color: t.name === 'day' ? 0xf2f4f7 : 0x1a2a4a, emissive: 0x000000 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.2), bodyMat);
  head.add(body);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16),
    new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x1a6cff, emissiveIntensity: 0.6 }),
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.11;
  head.add(lens);
  head.add(edgeBox(0.14, 0.12, 0.2, t.deviceEdge, 1));

  // field of view on the floor below: a fan that fades out towards its far edge
  const fov = (d.fov ?? 100) * DEG;
  const range = d.range ?? 7;
  const steps = 24;
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -fov / 2 + (fov * i) / steps;
    rim.push(new THREE.Vector3(Math.sin(a) * range, 0, -Math.cos(a) * range)); // −z is "forward"
  }
  const fan: number[] = [];
  const alpha: number[] = [];
  for (let i = 0; i < steps; i++) {
    fan.push(0, 0, 0, rim[i + 1].x, 0, rim[i + 1].z, rim[i].x, 0, rim[i].z);
    alpha.push(1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0);
  }
  const wedgeGeo = new THREE.BufferGeometry();
  wedgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(fan, 3));
  wedgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(alpha, 4));
  const wedgeMat = new THREE.MeshBasicMaterial({
    color: t.wallEdge,
    vertexColors: true,
    transparent: true,
    opacity: 0.09,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedge.position.y = -z + 0.035;
  wedge.rotation.y = yaw(d.rot);
  wedge.renderOrder = 4;
  g.add(wedge);
  // outline: the two sides fading out, the far arc faint
  const wl = new LineBuilder();
  wl.seg(new THREE.Vector3(), rim[0]);
  wl.seg(new THREE.Vector3(), rim[steps]);
  for (let i = 0; i < steps; i++) wl.seg(rim[i], rim[i + 1]);
  const wedgeLineMat = lineMaterial(t.wallEdge, 1, 0.3);
  const wedgeLines = wl.build(wedgeLineMat);
  wedgeLines.position.y = -z + 0.04;
  wedgeLines.rotation.y = yaw(d.rot);
  g.add(wedgeLines);

  // a beam from the camera down to the floor makes the mount readable from far
  const beam = new LineBuilder();
  beam.seg(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -z + 0.04, 0));
  const beamLine = beam.build(lineMaterial(t.wallEdge, 1, 0.35));
  g.add(beamLine);

  const motion = d.motion ?? [];
  let alarm = false;
  let pulse = 0;
  const badge = makeBadge('nh-cam', true);
  badge.obj.position.set(0, 0.32, 0);
  g.add(badge.obj);

  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity, ...motion],
    badge,
    update(c) {
      const hits = motion.filter((m) => isOn(stateOf(c.hass, m)));
      alarm = hits.length > 0;
      const s = stateOf(c.hass, d.entity);
      const name = d.name ?? s?.attributes.friendly_name?.replace(/ (live view|hd stream|sd stream)$/i, '') ?? d.entity;
      badge.el.classList.toggle('alarm', alarm);
      badge.el.classList.toggle('off', isUnavailable(s));
      const what = hits.map((h) => detectionWord(h, c.hass));
      badge.el.innerHTML = `<span class="ico">◉</span>${escape(name)}${alarm ? ` · <b>${escape([...new Set(what)].join(', ') || 'motion')}</b>` : ''}`;
      const col = alarm ? t.alert : t.wallEdge;
      wedgeMat.color.set(col);
      wedgeLineMat.color.set(col);
      bodyMat.emissive.set(alarm ? t.alert : 0x000000);
      if (!alarm) {
        wedgeMat.opacity = 0.09;
        bodyMat.emissiveIntensity = 0;
      }
    },
    tick(dt) {
      if (!alarm) return false;
      pulse += dt * 4;
      const k = 0.5 + 0.5 * Math.sin(pulse);
      wedgeMat.opacity = 0.25 + 0.3 * k;
      bodyMat.emissiveIntensity = 0.4 + 0.6 * k;
      return true;
    },
    alarm: () => alarm,
    setExtras(visible) {
      wedge.visible = wedgeLines.visible = beamLine.visible = visible;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(head, view);
  pickable(wedge, view);
  return view;
}

/**
 * what a detection sensor reports: judged by its friendly name first (entity ids can lag
 * behind a rename or be reshuffled by an integration), then by its entity id
 */
export function detectionWord(entityId: string, hass?: HomeAssistant): string {
  for (const text of [hass?.states[entityId]?.attributes.friendly_name, entityId]) {
    const t = String(text ?? '').toLowerCase();
    if (/person|people|human/.test(t)) return 'person';
    if (/vehicle|car\b/.test(t)) return 'vehicle';
    if (/\bpet|animal|dog|cat\b/.test(t)) return 'pet';
    if (/package|parcel/.test(t)) return 'package';
  }
  return 'motion';
}

// ---------- TV ----------

function tvView(d: TvDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const W = d.width ?? 1.23;
  const H = W * (9 / 16);
  const g = new THREE.Group();
  g.position.copy(w3(d.pos, d.z ?? 1.25));
  g.rotation.y = yaw(d.rot);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.3, metalness: 0.4 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, H + 0.04, 0.05), frameMat);
  g.add(frame);
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x050608, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
  screen.position.z = -0.027; // the screen faces the device's "forward" (−z)
  screen.rotation.y = Math.PI;
  g.add(screen);
  g.add(edgeBox(W + 0.04, H + 0.04, 0.05, t.deviceEdge, 1));
  const glowLight = new THREE.PointLight(0x4f8bff, 0, 4, 1.8);
  glowLight.position.z = -0.6;
  g.add(glowLight);

  let current: string | undefined;
  let on = false;
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';

  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity, ...(d.power ? [d.power] : [])],
    update(c) {
      const s = stateOf(c.hass, d.entity);
      on = !!s && ['on', 'playing', 'paused', 'idle'].includes(s.state);
      const pic: string | undefined = s?.attributes.entity_picture;
      if (on && pic && pic !== current && c.hass) {
        current = pic;
        const url = pic.startsWith('http') || pic.startsWith('data:') ? pic : c.hass.hassUrl(pic);
        loader.load(url, (tex) => {
          if (current !== pic) return tex.dispose();
          tex.colorSpace = THREE.SRGBColorSpace;
          screenMat.map?.dispose();
          screenMat.map = tex;
          screenMat.color.set(0xffffff);
          screenMat.needsUpdate = true;
          c.requestRender();
        });
      }
      if (!on || !pic) {
        current = undefined;
        if (screenMat.map) {
          screenMat.map.dispose();
          screenMat.map = null;
          screenMat.needsUpdate = true;
        }
      }
      // without artwork a lit screen shows the source as a calm colour
      if (!screenMat.map) screenMat.color.set(on ? appColor(s?.attributes.app_name ?? s?.attributes.source) : 0x050608);
      glowLight.intensity = on ? 2.2 : 0;
      glowLight.color.set(on ? appColor(s?.attributes.app_name ?? s?.attributes.source) : 0x000000);
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(g, view);
  return view;
}

/** recognisable colours for common TV apps */
function appColor(app?: string): number {
  const a = (app ?? '').toLowerCase();
  if (a.includes('netflix')) return 0xe50914;
  if (a.includes('youtube')) return 0xff2a2a;
  if (a.includes('disney')) return 0x1f4fd8;
  if (a.includes('prime')) return 0x00a8e1;
  if (a.includes('hbo') || a.includes('max')) return 0x6b2cff;
  if (a.includes('spotify')) return 0x1db954;
  if (a.includes('tv') || a.includes('hdmi')) return 0x2f7dff;
  return 0x3a6dff;
}

// ---------- climate ----------

function climateView(d: ClimateDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const g = new THREE.Group();
  g.position.copy(w3(d.pos, d.z ?? floor.height - 0.4));
  g.rotation.y = yaw(d.rot);
  const mat = new THREE.MeshStandardMaterial({ color: t.name === 'day' ? 0xffffff : 0x1c2c4c, emissive: 0x000000 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.22), mat));
  g.add(edgeBox(0.9, 0.28, 0.22, t.deviceEdge, 1));

  // airflow: little dashes drifting out of the unit
  const flowCount = 36;
  const flowGeo = new THREE.BufferGeometry();
  const flowPos = new Float32Array(flowCount * 3);
  const seeds = Array.from({ length: flowCount }, () => Math.random());
  flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
  const flowMat = new THREE.PointsMaterial({ size: 0.05, color: 0x6fd0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const flow = new THREE.Points(flowGeo, flowMat);
  g.add(flow);

  const badge = makeBadge('nh-climate', true);
  badge.obj.position.set(0, 0.35, 0);
  g.add(badge.obj);
  let active = false;
  let phase = 0;

  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity],
    badge,
    update(c) {
      const s = stateOf(c.hass, d.entity);
      const mode = s?.state ?? 'off';
      active = !!s && mode !== 'off' && !isUnavailable(s);
      const heat = mode === 'heat' || s?.attributes.hvac_action === 'heating';
      const col = heat ? 0xff8a3d : 0x5fd0ff;
      flowMat.color.set(col);
      mat.emissive.set(active ? col : 0x000000);
      mat.emissiveIntensity = active ? 0.35 : 0;
      const cur = s?.attributes.current_temperature;
      const target = s?.attributes.temperature;
      badge.el.classList.toggle('active', active);
      badge.el.innerHTML = `<span class="ico">❄</span>${cur != null ? `${cur}°` : '–'}${active && target != null ? ` → ${target}°` : ''}`;
      if (!active) flowMat.opacity = 0;
    },
    tick(dt) {
      if (!active) return false;
      phase += dt;
      for (let i = 0; i < flowCount; i++) {
        const k = (seeds[i] + phase * 0.35) % 1;
        const x = (seeds[(i * 7) % flowCount] - 0.5) * 0.8;
        flowPos[i * 3] = x * (1 + k * 0.6);
        flowPos[i * 3 + 1] = -0.15 - k * 0.9;
        flowPos[i * 3 + 2] = -0.15 - k * 1.4;
      }
      flowGeo.attributes.position.needsUpdate = true;
      flowMat.opacity = 0.75;
      return true;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(g, view);
  return view;
}

// ---------- appliances ----------

function applianceView(d: ApplianceDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const kind = d.kind ?? 'plug';
  const size: Record<string, [number, number, number]> = {
    purifier: [0.32, 0.6, 0.32],
    dehumidifier: [0.36, 0.55, 0.26],
    fan: [0.35, 1.0, 0.35],
    plug: [0.08, 0.08, 0.05],
    washer: [0.6, 0.85, 0.6],
  };
  const [w, h, dep] = size[kind];
  const g = new THREE.Group();
  g.position.copy(w3(d.pos, d.z ?? (kind === 'plug' ? 0.3 : h / 2)));
  g.rotation.y = yaw(d.rot);
  const mat = new THREE.MeshStandardMaterial({ color: t.name === 'day' ? 0xf4f6f8 : t.device, emissive: 0x000000, roughness: 0.5 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), mat));
  g.add(edgeBox(w, h, dep, t.deviceEdge, 1));
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(Math.min(w, dep) * 0.38, 0.012, 6, 28),
    new THREE.MeshBasicMaterial({ color: t.ok, transparent: true, opacity: 0 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = h / 2 + 0.01;
  g.add(ring);
  let active = false;

  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity, ...(d.power ? [d.power] : [])],
    update(c) {
      const s = stateOf(c.hass, d.entity);
      const watts = num(stateOf(c.hass, d.power));
      active = d.power && watts !== undefined ? watts > (d.active_watts ?? 5) : isOn(s);
      mat.emissive.set(active ? t.ok : 0x000000);
      mat.emissiveIntensity = active ? 0.3 : 0;
      (ring.material as THREE.MeshBasicMaterial).opacity = active ? 0.9 : 0;
    },
    tick(dt) {
      if (!active) return false;
      ring.rotation.z += dt * 3;
      return true;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(g, view);
  return view;
}

// ---------- vacuum ----------

function vacuumView(d: VacuumDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const g = new THREE.Group();
  const home = w3(d.pos, 0.06);
  g.position.copy(home);
  const mat = new THREE.MeshStandardMaterial({ color: t.name === 'day' ? 0xffffff : 0x1d2b48, emissive: 0x000000 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 28), mat);
  g.add(body);
  const ringMat = new THREE.MeshBasicMaterial({ color: t.wallEdge, transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.008, 6, 36), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.046;
  g.add(ring);
  const dock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: t.device }));
  // the dock stands behind the parked robot, against the wall it faces away from
  const [fx, fy] = facing(d.rot);
  dock.position.copy(w3([d.pos[0] - fx * 0.24, d.pos[1] - fy * 0.24], 0.06));
  dock.rotation.y = yaw(d.rot);
  const root = new THREE.Group();
  root.add(g, dock);

  const badge = makeBadge('nh-vac', false);
  badge.obj.position.set(0, 0.3, 0);
  g.add(badge.obj);
  let cleaning = false;
  let phase = 0;

  const view: DeviceView = {
    device: d,
    floor,
    object: root,
    entities: [d.entity],
    badge,
    update(c) {
      const s = stateOf(c.hass, d.entity);
      const st = s?.state ?? 'unknown';
      cleaning = st === 'cleaning' || st === 'returning';
      const err = st === 'error';
      ringMat.color.set(err ? t.alert : cleaning ? t.ok : t.wallEdge);
      mat.emissive.set(cleaning ? t.ok : 0x000000);
      mat.emissiveIntensity = cleaning ? 0.25 : 0;
      const bat = s?.attributes.battery_level;
      badge.el.innerHTML = `<span class="ico">⬤</span>${escape(st)}${bat != null ? ` · ${bat}%` : ''}`;
      badge.important = cleaning || err;
      if (!cleaning) g.position.copy(home);
    },
    tick(dt) {
      if (!cleaning) return false;
      phase += dt * 0.35;
      // a lazy figure-eight around the dock while cleaning
      g.position.set(home.x + Math.sin(phase) * 1.4, home.y, home.z + Math.sin(phase * 2) * 0.8 + 0.9);
      return true;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(root, view);
  return view;
}

// ---------- sensors ----------

function sensorView(d: SensorDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const g = new THREE.Group();
  g.position.copy(w3(d.pos, d.z ?? 1.5));
  const puck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16),
    new THREE.MeshStandardMaterial({ color: t.name === 'day' ? 0xffffff : t.device, emissive: t.wallEdge, emissiveIntensity: 0.15 }),
  );
  puck.rotation.x = Math.PI / 2;
  g.add(puck);
  const badge = makeBadge('nh-sensor', false);
  badge.obj.position.set(0, 0.18, 0);
  g.add(badge.obj);
  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity],
    badge,
    update(c) {
      const s = stateOf(c.hass, d.entity);
      const unit = s?.attributes.unit_of_measurement ?? '';
      badge.el.classList.toggle('off', isUnavailable(s));
      badge.el.textContent = isUnavailable(s) ? '–' : `${s!.state}${unit}`;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(g, view);
  return view;
}

// ---------- car ----------

function carView(d: CarDevice, floor: Floor, ctx: DeviceCtx): DeviceView {
  const t = ctx.theme;
  const L = d.length ?? 4.6;
  const W = d.width ?? 1.85;
  const g = new THREE.Group();
  g.position.copy(w3(d.pos, 0));
  g.rotation.y = yaw(d.rot);
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: t.name === 'day' ? 0x3d4a5c : 0x1b2c54, metalness: 0.6, roughness: 0.35, emissive: t.name === 'neon' ? 0x0a1a3a : 0 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1626, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, 0.55, L), paint);
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.45, L * 0.5), glass);
  cabin.position.set(0, 1.03, L * 0.04);
  car.add(body, cabin);
  const outline = edgeBox(W, 0.55, L, t.deviceEdge, 1.2);
  outline.position.y = 0.55;
  car.add(outline);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x07090d });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 18), tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * (W / 2 - 0.08), 0.33, sz * L * 0.33);
      car.add(wheel);
    }
  const lights = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.02), lights);
    hl.position.set(sx * (W / 2 - 0.3), 0.66, -L / 2 - 0.005);
    car.add(hl);
  }
  g.add(car);
  // an outline of the bay stays when the car is away
  const bay = new LineBuilder();
  const hw = W / 2 + 0.25, hl2 = L / 2 + 0.3;
  bay.loop([new THREE.Vector3(-hw, 0.03, -hl2), new THREE.Vector3(hw, 0.03, -hl2), new THREE.Vector3(hw, 0.03, hl2), new THREE.Vector3(-hw, 0.03, hl2)]);
  const bayMat = lineMaterial(t.wallEdge, 1.2, 0.5);
  g.add(bay.build(bayMat));

  let present = true;
  const view: DeviceView = {
    device: d,
    floor,
    object: g,
    entities: [d.entity, ...(d.presence ? [d.presence] : [])],
    update(c) {
      const s = stateOf(c.hass, d.presence ?? d.entity);
      present = d.presence ? isOn(s) || s?.state === 'home' : true;
      car.visible = present;
    },
    focus: () => g.getWorldPosition(new THREE.Vector3()),
  };
  pickable(g, view);
  return view;
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
