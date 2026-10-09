import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { disposeTree, lineMaterials, lineResolution } from './geo';

export interface FlowTarget {
  /** stays the same while the device keeps drawing power, so its wire is reused */
  key: string;
  to: THREE.Vector3;
  watts: number;
  measured: boolean;
  label: string;
}

interface Wire {
  line: Line2;
  material: LineMaterial;
  label: CSS2DObject;
  speed: number;
}

/**
 * Neon wires from the electricity meter to everything drawing power, current running along them:
 * up from the meter into the ceiling, along it, and down to the device. More watts make a wire
 * thicker, brighter and faster. Seen through the walls, like an X-ray of the wiring.
 */
export class PowerFlow {
  readonly group = new THREE.Group();
  private wires = new Map<string, Wire>();
  private from = new THREE.Vector3();
  private ceiling = 0;

  constructor(private color: number) {
    this.group.name = 'power-flow';
  }

  get active() {
    return this.wires.size > 0;
  }

  set(from: THREE.Vector3, ceiling: number, targets: FlowTarget[]) {
    if (!from.equals(this.from) || ceiling !== this.ceiling) {
      this.clear();
      this.from.copy(from);
      this.ceiling = ceiling;
    }
    const keep = new Set(targets.map((t) => t.key));
    for (const key of [...this.wires.keys()]) if (!keep.has(key)) this.remove(key);
    for (const t of targets) {
      const w = this.wires.get(t.key) ?? this.add(t);
      // about 2 kW is the brightest a wire gets
      const level = Math.min(1, Math.log10(1 + t.watts) / 3.3);
      w.material.linewidth = 1.6 + 2.6 * level;
      w.material.opacity = (t.measured ? 0.6 : 0.4) + 0.4 * level;
      w.speed = 0.5 + 2.5 * level;
      w.label.element.textContent = t.label;
      w.label.element.classList.toggle('est', !t.measured);
    }
  }

  clear() {
    for (const key of [...this.wires.keys()]) this.remove(key);
  }

  /** moves the current along; true while there are wires */
  tick(dt: number): boolean {
    for (const w of this.wires.values()) w.material.dashOffset -= w.speed * dt;
    return this.active;
  }

  private add(t: FlowTarget): Wire {
    const a = this.from;
    const b = t.to;
    const y = this.ceiling;
    const points = [a.x, a.y, a.z, a.x, y, a.z, b.x, y, a.z, b.x, y, b.z, b.x, b.y, b.z];
    const geometry = new LineGeometry();
    geometry.setPositions(points);
    const material = new LineMaterial({
      color: this.color,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
      dashed: true,
      dashSize: 0.16,
      gapSize: 0.28,
      depthTest: false,
      worldUnits: false,
    });
    material.toneMapped = false;
    material.resolution.copy(lineResolution);
    lineMaterials.add(material);
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 5;
    // the wires are a picture: taps go through to the devices and rooms
    line.raycast = () => {};
    this.group.add(line);

    const el = document.createElement('div');
    el.className = 'nh-badge nh-watt';
    const label = new CSS2DObject(el);
    label.position.copy(b).add(new THREE.Vector3(0, 0.32, 0));
    this.group.add(label);

    const wire: Wire = { line, material, label, speed: 1 };
    this.wires.set(t.key, wire);
    return wire;
  }

  private remove(key: string) {
    const w = this.wires.get(key);
    if (!w) return;
    this.group.remove(w.line, w.label);
    disposeTree(w.line);
    this.wires.delete(key);
  }
}
