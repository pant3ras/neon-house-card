import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { lineMaterials, lineResolution } from './geo';
import type { Theme } from './theme';

export type Animator = (dt: number, time: number) => boolean;

export interface Pick {
  object: THREE.Object3D;
  data: any;
  point: THREE.Vector3;
}

/**
 * Renderer, camera, controls and the frame loop. Frames are drawn only while something
 * changes (the view moves, an animation runs, a state arrives) so a wall tablet stays cool.
 */
export class Engine {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly controls: OrbitControls;
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  private animators = new Set<Animator>();
  private dirty = true;
  private raf = 0;
  private last = 0;
  private running = false;
  private flight?: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number; dur: number };
  private width = 1;
  private height = 1;
  private raycaster = new THREE.Raycaster();
  fps = 0;
  private frames = 0;
  private fpsT = 0;
  onFrame?: () => void;

  constructor(
    readonly host: HTMLElement,
    private quality: 'low' | 'high',
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', alpha: false, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'nh-canvas';
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'nh-labels';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.camera.position.set(18, 16, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 120;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => (this.flight = undefined));

    this.raycaster.camera = this.camera;
    // point clouds (string lights) are picked only when tapped close to a bulb
    this.raycaster.params.Points = { threshold: 0.2 };
  }

  applyTheme(theme: Theme) {
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog = new THREE.Fog(theme.fog, 60, 180);
    this.renderer.toneMapping = theme.name === 'day' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = theme.name === 'day' ? 1.0 : 1.35;
    this.setupComposer(theme);
    this.requestRender();
  }

  private setupComposer(theme: Theme) {
    this.composer?.dispose();
    this.composer = undefined;
    this.bloom = undefined;
    if (this.quality === 'low' && theme.name !== 'neon') return;
    // a stencil buffer lets camera cones skip the room floors (they are drawn outside only)
    const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, stencilBuffer: true });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const res = new THREE.Vector2(this.width, this.height).multiplyScalar(this.quality === 'high' ? 1 : 0.5);
    this.bloom = new UnrealBloomPass(res, theme.bloom.strength, theme.bloom.radius, theme.bloom.threshold);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(this.width, this.height);
    this.composer = composer;
  }

  get size() {
    return { w: this.width, h: this.height };
  }

  setSize(w: number, h: number) {
    if (w < 2 || h < 2) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labels.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // line widths are in CSS pixels, whatever the pixel ratio
    lineResolution.set(w, h);
    for (const m of lineMaterials) m.resolution.set(w, h);
    this.requestRender();
  }

  requestRender() {
    this.dirty = true;
  }

  /** runs every frame until it returns false */
  animate(fn: Animator) {
    this.animators.add(fn);
    this.requestRender();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt, now / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(dt: number, time: number) {
    let busy = false;
    for (const fn of [...this.animators]) {
      if (fn(dt, time)) busy = true;
      else this.animators.delete(fn);
    }
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(f.from[0], f.to[0], k);
      this.controls.target.lerpVectors(f.from[1], f.to[1], k);
      if (f.t >= 1) this.flight = undefined;
      busy = true;
    }
    if (this.controls.update()) busy = true;
    if (!busy && !this.dirty) return;
    this.dirty = false;
    this.onFrame?.();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 1) {
      this.fps = Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
    }
  }

  /** glide the view to look at `target` from a direction and distance */
  flyTo(target: THREE.Vector3, distance: number, azimuthDeg?: number, polarDeg?: number, duration = 0.9) {
    const cur = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(cur);
    if (azimuthDeg !== undefined) sph.theta = (azimuthDeg * Math.PI) / 180;
    if (polarDeg !== undefined) sph.phi = (polarDeg * Math.PI) / 180;
    sph.radius = distance;
    const pos = new THREE.Vector3().setFromSpherical(sph).add(target);
    this.flight = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [pos, target.clone()],
      t: 0,
      dur: duration,
    };
    this.requestRender();
  }

  /** glide to an exact eye position looking at a point (camera cockpit) */
  flyToEye(eye: THREE.Vector3, look: THREE.Vector3, duration = 1) {
    this.flight = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [eye.clone(), look.clone()],
      t: 0,
      dur: duration,
    };
    this.requestRender();
  }

  /** where a screen point meets the horizontal plane at height y */
  groundPoint(clientX: number, clientY: number, y: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  }

  /** the first object under a screen point that carries pick data (and that `accept` takes) */
  pick(clientX: number, clientY: number, accept?: (data: any, point: THREE.Vector3) => boolean): Pick | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      if (!visibleChain(hit.object)) continue;
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o && (!accept || accept(o.userData.pick, hit.point))) return { object: o, data: o.userData.pick, point: hit.point };
    }
    return null;
  }

  dispose() {
    this.stop();
    this.controls.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}

function visibleChain(o: THREE.Object3D | null): boolean {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}
