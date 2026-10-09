import type { ThemeName } from '../types';

export interface Theme {
  name: ThemeName;
  background: number;
  fog: number;
  ground: number;
  grid: number;
  wallFill: number;
  wallOpacity: number;
  wallEdge: number;
  wallEdgeWidth: number;
  floorFill: number;
  floorEdge: number;
  roomGlow: number;
  glass: number;
  door: number;
  roof: number;
  roofEdge: number;
  device: number;
  deviceEdge: number;
  alert: number;
  ok: number;
  bloom: { strength: number; radius: number; threshold: number };
  ambient: number;
  ambientIntensity: number;
  /** CSS colours for the overlay */
  css: { text: string; muted: string; accent: string; panel: string; pill: string; border: string };
  outdoor: Record<'grass' | 'paving' | 'terrace' | 'parking' | 'water', number>;
}

export const THEMES: Record<ThemeName, Theme> = {
  neon: {
    name: 'neon',
    background: 0x050916,
    fog: 0x050916,
    ground: 0x070d1f,
    grid: 0x10264a,
    wallFill: 0x0c1c3d,
    wallOpacity: 0.42,
    wallEdge: 0x38e8ff,
    wallEdgeWidth: 1.6,
    floorFill: 0x0a1530,
    floorEdge: 0x2275b8,
    roomGlow: 0x1b4f9a,
    glass: 0x5fd7ff,
    door: 0x2ad0ff,
    roof: 0x13284f,
    roofEdge: 0x38d6ff,
    device: 0x14284f,
    deviceEdge: 0x7af3ff,
    alert: 0xff3355,
    ok: 0x35f0a0,
    bloom: { strength: 0.55, radius: 0.3, threshold: 0.5 },
    ambient: 0x6a8cff,
    ambientIntensity: 0.55,
    css: {
      text: '#e8f6ff',
      muted: '#7e9cc0',
      accent: '#38e8ff',
      panel: 'rgba(8,16,36,.86)',
      pill: 'rgba(10,22,48,.78)',
      border: 'rgba(56,232,255,.35)',
    },
    outdoor: { grass: 0x0b2a1d, paving: 0x141c30, terrace: 0x1a2038, parking: 0x121a2c, water: 0x0b2a4a },
  },
  blueprint: {
    name: 'blueprint',
    background: 0x0b2c63,
    fog: 0x0b2c63,
    ground: 0x0d3270,
    grid: 0x2f5c9e,
    wallFill: 0x1a4a8f,
    wallOpacity: 0.25,
    wallEdge: 0xe8f2ff,
    wallEdgeWidth: 1.3,
    floorFill: 0x10397a,
    floorEdge: 0x9cc4ff,
    roomGlow: 0x3a72c4,
    glass: 0xbfe0ff,
    door: 0xe8f2ff,
    roof: 0x123d80,
    roofEdge: 0xdbe9ff,
    device: 0x1d4c93,
    deviceEdge: 0xffffff,
    alert: 0xff6b6b,
    ok: 0x9cffd0,
    bloom: { strength: 0.3, radius: 0.3, threshold: 0.7 },
    ambient: 0xffffff,
    ambientIntensity: 0.9,
    css: {
      text: '#f2f7ff',
      muted: '#a9c4ec',
      accent: '#ffffff',
      panel: 'rgba(10,40,90,.88)',
      pill: 'rgba(14,52,110,.8)',
      border: 'rgba(255,255,255,.4)',
    },
    outdoor: { grass: 0x124080, paving: 0x0f3878, terrace: 0x154488, parking: 0x0f3878, water: 0x1b56a8 },
  },
  day: {
    name: 'day',
    background: 0xdfe8f2,
    fog: 0xdfe8f2,
    ground: 0xc9d6c2,
    grid: 0xb7c6b4,
    wallFill: 0xf4f1ea,
    wallOpacity: 0.9,
    wallEdge: 0x8a9bb0,
    wallEdgeWidth: 1,
    floorFill: 0xd7c3a3,
    floorEdge: 0xa9927a,
    roomGlow: 0xffe2a8,
    glass: 0x9fd4ff,
    door: 0x9c7b5a,
    roof: 0x8e5a48,
    roofEdge: 0x6b4033,
    device: 0xe9edf2,
    deviceEdge: 0x5f6f84,
    alert: 0xe5243f,
    ok: 0x1aa56b,
    bloom: { strength: 0.12, radius: 0.2, threshold: 0.92 },
    ambient: 0xffffff,
    ambientIntensity: 1.6,
    css: {
      text: '#1d2a3a',
      muted: '#5d6f86',
      accent: '#1d7fd8',
      panel: 'rgba(255,255,255,.92)',
      pill: 'rgba(255,255,255,.85)',
      border: 'rgba(30,60,100,.18)',
    },
    outdoor: { grass: 0x9cc58a, paving: 0xc4c2bd, terrace: 0xb89a78, parking: 0xa9adb3, water: 0x7fb7e0 },
  },
};
