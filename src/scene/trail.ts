// Motion trail: the detections of the last minutes from recorder history, drawn as glowing
// markers in each camera's view with arcs joining them in the order they happened.

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { CameraDevice, HomeAssistant } from '../types';
import { detectionWord, type DeviceView } from './devices';
import { LineBuilder, disposeTree, lineMaterial } from './geo';
import type { Theme } from './theme';

interface Detection {
  time: number; // epoch ms
  entity: string;
  camera: DeviceView;
  /** person, vehicle, pet … */
  kind: string;
}

type CompressedHistory = Record<string, { s: string; lu: number; lc?: number }[]>;

export class MotionTrail {
  readonly group = new THREE.Group();
  minutes = 30;
  private markers: THREE.Object3D[] = [];
  count = 0;

  constructor(private theme: Theme) {
    this.group.name = 'trail';
  }

  async load(hass: HomeAssistant, cameras: DeviceView[]): Promise<void> {
    const byEntity = new Map<string, DeviceView>();
    for (const c of cameras) for (const m of (c.device as CameraDevice).motion ?? []) byEntity.set(m, c);
    if (!byEntity.size) return this.clear();
    const start = new Date(Date.now() - this.minutes * 60_000).toISOString();
    let history: CompressedHistory;
    try {
      history = await hass.callWS<CompressedHistory>({
        type: 'history/history_during_period',
        start_time: start,
        entity_ids: [...byEntity.keys()],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
    } catch (e) {
      console.warn('neon-house: motion history unavailable', e);
      return this.clear();
    }
    const events: Detection[] = [];
    const since = Date.now() - this.minutes * 60_000;
    for (const [entity, rows] of Object.entries(history)) {
      const camera = byEntity.get(entity);
      if (!camera) continue;
      let prev = '';
      for (const r of rows) {
        const t = (r.lc ?? r.lu) * 1000;
        if (r.s === 'on' && prev !== 'on' && t >= since) events.push({ time: t, entity, camera, kind: detectionWord(entity, hass) });
        prev = r.s;
      }
    }
    events.sort((a, b) => a.time - b.time);
    this.draw(events);
  }

  private draw(events: Detection[]) {
    this.clear();
    this.count = events.length;
    if (!events.length) return;
    const t = this.theme;
    const now = Date.now();
    const spots: THREE.Vector3[] = [];
    // several detections of one camera spread out a little so they don't stack
    const perCamera = new Map<DeviceView, number>();
    for (const ev of events) {
      const n = perCamera.get(ev.camera) ?? 0;
      perCamera.set(ev.camera, n + 1);
      const spot = viewSpot(ev.camera, n);
      spots.push(spot);
      const age = (now - ev.time) / (this.minutes * 60_000);
      const fade = 1 - Math.min(0.85, age);
      const marker = new THREE.Group();
      marker.position.copy(spot);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.26, 28),
        new THREE.MeshBasicMaterial({ color: t.alert, transparent: true, opacity: 0.9 * fade, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      marker.add(ring);
      const beam = new LineBuilder();
      beam.seg(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.2, 0));
      marker.add(beam.build(lineMaterial(t.alert, 1.5, 0.7 * fade)));
      const el = document.createElement('div');
      el.className = 'nh-trail';
      el.style.opacity = String(0.45 + 0.55 * fade);
      el.textContent = `${new Date(ev.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${ev.kind}`;
      const lbl = new CSS2DObject(el);
      lbl.position.set(0, 1.35, 0);
      marker.add(lbl);
      this.group.add(marker);
      this.markers.push(marker);
    }
    // arcs joining the detections in time order
    const arcs = new LineBuilder();
    for (let i = 0; i < spots.length - 1; i++) {
      const a = spots[i];
      const b = spots[i + 1];
      if (a.distanceTo(b) < 0.05) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += 0.8 + a.distanceTo(b) * 0.15;
      const pts = new THREE.QuadraticBezierCurve3(a.clone().setY(a.y + 0.05), mid, b.clone().setY(b.y + 0.05)).getPoints(20);
      for (let k = 0; k < pts.length - 1; k++) arcs.seg(pts[k], pts[k + 1]);
    }
    if (!arcs.empty) this.group.add(arcs.build(lineMaterial(0xff7a3d, 1.8, 0.85)));
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      disposeTree(c);
      c.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
      });
    }
    this.markers = [];
    this.count = 0;
  }
}

/** a point on the floor inside a camera's view, nudged per detection */
function viewSpot(camera: DeviceView, n: number): THREE.Vector3 {
  const d = camera.device as CameraDevice;
  const rot = ((d.rot ?? 0) * Math.PI) / 180;
  const range = (d.range ?? 7) * 0.45;
  const spread = ((n % 5) - 2) * 0.22;
  const a = rot + spread;
  const z = d.z ?? 2.5;
  const local = new THREE.Vector3(Math.sin(a) * range, -z + 0.05, -Math.cos(a) * range);
  camera.object.updateWorldMatrix(true, false);
  return camera.object.localToWorld(local);
}
