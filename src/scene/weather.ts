// Weather outside: rain, snow, clouds, fog and lightning from a weather entity, sun and
// moon from sun.sun, stars at night. Everything lives in one group around the house.

import * as THREE from 'three';
import type { HassEntity } from '../types';
import type { Theme } from './theme';

export interface WeatherInput {
  weather?: HassEntity;
  sun?: HassEntity;
  /** plan rotation against north, degrees clockwise */
  north: number;
}

export interface Area {
  center: THREE.Vector3;
  radius: number;
}

const RAIN = new Set(['rainy', 'pouring', 'lightning-rainy', 'snowy-rainy', 'hail']);
const SNOW = new Set(['snowy', 'snowy-rainy']);
const CLOUDY: Record<string, number> = {
  cloudy: 0.9, partlycloudy: 0.45, rainy: 0.9, pouring: 1, 'lightning-rainy': 1, lightning: 0.9,
  snowy: 0.8, 'snowy-rainy': 0.9, fog: 0.6, hail: 0.95, windy: 0.3, 'windy-variant': 0.6, exceptional: 0.8,
};

export class WeatherFx {
  readonly group = new THREE.Group();
  /** the directional light that follows the sun (or moon) */
  readonly sunLight: THREE.DirectionalLight;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private snow: THREE.Points;
  private snowPos: Float32Array;
  private clouds: THREE.Sprite[] = [];
  private sunSprite: THREE.Sprite;
  private moonSprite: THREE.Sprite;
  private stars: THREE.Points;
  private flash: THREE.PointLight;
  private bolt: THREE.Line;

  private condition = 'sunny';
  private enabled = true;
  private rainAmount = 0;
  private snowAmount = 0;
  private cloudAmount = 0;
  private wind = new THREE.Vector3();
  private flashTimer = 3;
  private flashLevel = 0;
  private night = false;
  private time = 0;

  constructor(private area: Area, private theme: Theme, drops: number) {
    this.group.name = 'weather';
    const span = area.radius * 2 + 12;

    // rain: short streaks recycled from the top
    this.rainPos = new Float32Array(drops * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({ color: theme.name === 'day' ? 0x6f8fb3 : 0x6fb8e8, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.rain.frustumCulled = false;
    for (let i = 0; i < drops; i++) this.seedDrop(i, span, true);
    this.group.add(this.rain);

    // snow
    this.snowPos = new Float32Array(drops * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ size: 0.09, map: softDot(), color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.snow.frustumCulled = false;
    for (let i = 0; i < drops; i++) {
      this.snowPos[i * 3] = area.center.x + (Math.random() - 0.5) * span;
      this.snowPos[i * 3 + 1] = Math.random() * 14;
      this.snowPos[i * 3 + 2] = area.center.z + (Math.random() - 0.5) * span;
    }
    this.group.add(this.snow);

    // clouds: big soft puffs in a ring around the house, so they frame it instead of hiding it
    const cloudTex = cloudTexture();
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: cloudTex, color: theme.name === 'day' ? 0xffffff : 0x6f80a8, transparent: true, opacity: 0, depthWrite: false }),
      );
      const scale = 9 + Math.random() * 8;
      s.scale.set(scale, scale * 0.5, 1);
      s.userData.angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      s.userData.dist = area.radius * 1.6 + 6 + Math.random() * 10;
      s.userData.height = 16 + Math.random() * 6;
      s.userData.speed = 0.01 + Math.random() * 0.015;
      this.placeCloud(s);
      this.clouds.push(s);
      this.group.add(s);
    }

    // sun, moon, stars
    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDot(), color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.sunSprite.scale.setScalar(6);
    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDot(), color: 0xbcd4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.moonSprite.scale.setScalar(3.2);
    this.group.add(this.sunSprite, this.moonSprite);

    const starCount = 500;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const az = Math.random() * Math.PI * 2;
      const el = Math.asin(0.1 + Math.random() * 0.9);
      const r = 70;
      starPos[i * 3] = area.center.x + Math.cos(el) * Math.cos(az) * r;
      starPos[i * 3 + 1] = Math.sin(el) * r;
      starPos[i * 3 + 2] = area.center.z + Math.cos(el) * Math.sin(az) * r;
    }
    const stg = new THREE.BufferGeometry();
    stg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(stg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xcfe3ff, transparent: true, opacity: 0, depthWrite: false }));
    this.group.add(this.stars);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.target.position.copy(area.center);
    this.group.add(this.sunLight, this.sunLight.target);

    this.flash = new THREE.PointLight(0xcfe0ff, 0, 80, 0.5);
    this.flash.position.set(area.center.x, 18, area.center.z);
    this.group.add(this.flash);
    this.bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0 }));
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.applyVisibility();
  }

  update(input: WeatherInput) {
    const w = input.weather;
    this.condition = w?.state ?? 'sunny';
    this.rainAmount = this.enabled && RAIN.has(this.condition) ? (this.condition === 'pouring' ? 1 : 0.6) : 0;
    this.snowAmount = this.enabled && SNOW.has(this.condition) ? 1 : 0;
    this.cloudAmount = this.enabled ? (CLOUDY[this.condition] ?? 0.1) : 0;
    const speed = Number(w?.attributes.wind_speed ?? 0); // km/h usually
    const bearing = Number(w?.attributes.wind_bearing ?? 0);
    // wind blows *from* the bearing; turn it into plan space and then world x/z
    const theta = ((bearing + 180 - input.north) * Math.PI) / 180;
    const k = Math.min(1, speed / 50);
    this.wind.set(Math.sin(theta) * k * 4, 0, -Math.cos(theta) * k * 4);

    // sun and moon
    const s = input.sun;
    const elevation = Number(s?.attributes.elevation ?? 35);
    const azimuth = Number(s?.attributes.azimuth ?? 180);
    this.night = s ? s.state === 'below_horizon' : false;
    const dir = skyDirection(azimuth - input.north, Math.max(elevation, 4));
    const R = 55;
    this.sunSprite.position.copy(this.area.center).addScaledVector(dir, R);
    const moonDir = skyDirection(azimuth + 180 - input.north, 35);
    this.moonSprite.position.copy(this.area.center).addScaledVector(moonDir, R);
    const lightDir = this.night ? moonDir : dir;
    this.sunLight.position.copy(this.area.center).addScaledVector(lightDir, 30);
    const daylight = this.night ? 0 : Math.min(1, Math.max(0, elevation) / 25);
    const overcast = 1 - this.cloudAmount * 0.6;
    const base = this.theme.name === 'day' ? 2.4 : this.theme.name === 'blueprint' ? 1.0 : 0.7;
    this.sunLight.intensity = this.night ? base * 0.18 : base * (0.25 + 0.75 * daylight) * overcast;
    this.sunLight.color.set(this.night ? 0x9fb8ff : elevation < 8 ? 0xffb37a : 0xfff1dc);
    this.applyVisibility();
  }

  private applyVisibility() {
    const on = this.enabled;
    this.rain.visible = on && this.rainAmount > 0;
    this.snow.visible = on && this.snowAmount > 0;
    this.sunSprite.visible = on && !this.night && this.cloudAmount < 0.85;
    this.moonSprite.visible = on && this.night;
    (this.stars.material as THREE.PointsMaterial).opacity = on && this.night ? 0.8 * (1 - this.cloudAmount) : 0;
    this.stars.visible = on && this.night;
    for (const c of this.clouds) c.visible = on && this.cloudAmount > 0.15;
  }

  /** true while something moves */
  tick(dt: number): boolean {
    if (!this.enabled) return false;
    this.time += dt;
    const span = this.area.radius * 2 + 12;
    let moving = false;

    if (this.rain.visible) {
      moving = true;
      const fall = 14 * dt;
      const n = Math.floor((this.rainPos.length / 6) * this.rainAmount);
      for (let i = 0; i < this.rainPos.length / 6; i++) {
        const o = i * 6;
        if (i >= n) {
          this.rainPos[o + 1] = this.rainPos[o + 4] = -50;
          continue;
        }
        for (const j of [0, 3]) {
          this.rainPos[o + j] += this.wind.x * dt;
          this.rainPos[o + j + 1] -= fall;
          this.rainPos[o + j + 2] += this.wind.z * dt;
        }
        if (this.rainPos[o + 4] < 0) this.seedDrop(i, span, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    if (this.snow.visible) {
      moving = true;
      for (let i = 0; i < this.snowPos.length / 3; i++) {
        const o = i * 3;
        this.snowPos[o] += (Math.sin(this.time + i) * 0.3 + this.wind.x * 0.4) * dt;
        this.snowPos[o + 1] -= 1.1 * dt;
        this.snowPos[o + 2] += (Math.cos(this.time * 0.7 + i) * 0.3 + this.wind.z * 0.4) * dt;
        if (this.snowPos[o + 1] < 0) {
          this.snowPos[o] = this.area.center.x + (Math.random() - 0.5) * span;
          this.snowPos[o + 1] = 14;
          this.snowPos[o + 2] = this.area.center.z + (Math.random() - 0.5) * span;
        }
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }

    // clouds fade towards the wanted cover and circle slowly, faster in wind
    const windK = 1 + this.wind.length() * 0.5;
    for (const c of this.clouds) {
      const m = c.material as THREE.SpriteMaterial;
      const target = c.visible ? Math.min(0.5, this.cloudAmount * 0.55) : 0;
      if (Math.abs(m.opacity - target) > 0.005) {
        m.opacity += (target - m.opacity) * Math.min(1, dt * 2);
        moving = true;
      }
      if (c.visible) {
        c.userData.angle += c.userData.speed * windK * dt;
        this.placeCloud(c);
        moving = true;
      }
    }

    // lightning
    if (this.enabled && (this.condition === 'lightning' || this.condition === 'lightning-rainy')) {
      moving = true;
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashTimer = 2.5 + Math.random() * 6;
        this.flashLevel = 1;
        this.makeBolt();
      }
    }
    if (this.flashLevel > 0) {
      moving = true;
      this.flashLevel = Math.max(0, this.flashLevel - dt * 3.5);
      const flicker = this.flashLevel > 0.5 ? (Math.random() > 0.4 ? 1 : 0.3) : this.flashLevel;
      this.flash.intensity = flicker * 60;
      (this.bolt.material as THREE.LineBasicMaterial).opacity = flicker;
    }
    return moving;
  }

  private placeCloud(s: THREE.Sprite) {
    const { angle, dist, height } = s.userData;
    s.position.set(this.area.center.x + Math.cos(angle) * dist, height, this.area.center.z + Math.sin(angle) * dist);
  }

  private seedDrop(i: number, span: number, anyHeight: boolean) {
    const x = this.area.center.x + (Math.random() - 0.5) * span;
    const z = this.area.center.z + (Math.random() - 0.5) * span;
    const y = anyHeight ? Math.random() * 16 : 14 + Math.random() * 3;
    const o = i * 6;
    this.rainPos.set([x, y, z, x - this.wind.x * 0.03, y + 0.35, z - this.wind.z * 0.03], o);
  }

  private makeBolt() {
    const pts: THREE.Vector3[] = [];
    let x = this.area.center.x + (Math.random() - 0.5) * this.area.radius * 3;
    let z = this.area.center.z + (Math.random() - 0.5) * this.area.radius * 3;
    for (let y = 18; y > 0; y -= 1.5) {
      pts.push(new THREE.Vector3(x, y, z));
      x += (Math.random() - 0.5) * 1.6;
      z += (Math.random() - 0.5) * 1.6;
    }
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.flash.position.set(x, 12, z);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}

/** world direction for a compass angle (clockwise from plan up) and an elevation */
function skyDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const a = (azimuthDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

let _dot: THREE.Texture | null = null;
function softDot(): THREE.Texture {
  if (_dot) return _dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}

let _cloud: THREE.Texture | null = null;
function cloudTexture(): THREE.Texture {
  if (_cloud) return _cloud;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 26; i++) {
    const cx = 40 + Math.random() * 176;
    const cy = 50 + Math.random() * 40;
    const r = 18 + Math.random() * 30;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
  }
  _cloud = new THREE.CanvasTexture(c);
  return _cloud;
}
