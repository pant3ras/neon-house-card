// Robot vacuums built by Dreame (Dreame, Xiaomi X20+, many Mijia models) publish their live map as a
// "map-data" property: base64url text of a zlib stream that starts with a 27-byte header holding the
// robot's position and the dock's. Home Assistant cuts a state at 255 characters, which still leaves
// the header, so inflating the start of the stream is enough – no cloud, no map download.

import { Unzlib } from 'three/examples/jsm/libs/fflate.module.js';
import type { Vec2 } from '../types';

export interface DreamePose {
  /** robot position on its own map, millimetres, y pointing up */
  x: number;
  y: number;
  /** robot heading, degrees counter-clockwise from the map's +x */
  angle: number;
  /** where the robot sits when docked, and the way it faces there (out of the dock) */
  dockX: number;
  dockY: number;
  dockAngle: number;
}

const HEADER = 27;
const cache = new Map<string, DreamePose | null>();

function base64urlBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** the robot's pose from a map-data state; null when the state isn't a Dreame map frame */
export function decodeDreamePose(raw: string | undefined): DreamePose | null {
  // a header alone compresses to ~36 characters
  if (!raw || raw.length < 24 || !/^[A-Za-z0-9_\-+/=]+$/.test(raw)) return null;
  if (cache.has(raw)) return cache.get(raw)!;
  let pose: DreamePose | null = null;
  try {
    const head = new Uint8Array(HEADER);
    let got = 0;
    // stream mode: a cut-off stream is fine, whatever inflates before the cut comes out
    const z = new Unzlib((chunk) => {
      if (got >= HEADER) return;
      const n = Math.min(chunk.length, HEADER - got);
      head.set(chunk.subarray(0, n), got);
      got += n;
    });
    z.push(base64urlBytes(raw), false);
    const type = head[4];
    // 'I' is a full map, 'P' an update; both carry the header
    if (got >= HEADER && (type === 73 || type === 80)) {
      const v = new DataView(head.buffer);
      pose = {
        x: v.getInt16(5, true),
        y: v.getInt16(7, true),
        angle: v.getInt16(9, true),
        dockX: v.getInt16(11, true),
        dockY: v.getInt16(13, true),
        dockAngle: v.getInt16(15, true),
      };
    }
  } catch {
    pose = null;
  }
  if (cache.size > 64) cache.clear();
  cache.set(raw, pose);
  return pose;
}

/**
 * Robot map → plan metres. The dock is `dock` on the plan; the map is turned so the way the robot
 * faces on its dock matches the dock's `rot` on the plan, plus `extraRot` degrees clockwise.
 */
export function dreameToPlan(p: DreamePose, dock: Vec2, dockRot = 0, extraRot = 0): Vec2 {
  // the map's y points up, the plan's down
  const dx = (p.x - p.dockX) / 1000;
  const dy = -(p.y - p.dockY) / 1000;
  // on the plan the robot leaves the dock at angle rot − 90°; on the flipped map at −dockAngle
  const th = ((dockRot - 90 + p.dockAngle + extraRot) * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [dock[0] + dx * c - dy * s, dock[1] + dx * s + dy * c];
}
