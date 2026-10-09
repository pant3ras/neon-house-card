// Plan format. All lengths are metres; plan x runs east, plan y runs south
// (y down, like a drawing), and becomes three.js z.

export type Vec2 = [number, number];

export interface Plan {
  version: 1;
  name?: string;
  floors: Floor[];
  outdoor?: OutdoorArea[];
  roof?: Roof;
  /** weather entity driving rain, snow, clouds and lightning outside */
  weather_entity?: string;
  /** degrees the plan's "up" (−y) is turned from north, clockwise; used for the sun */
  north?: number;
}

export interface Floor {
  id: string;
  name: string;
  /** height of the floor surface above ground */
  elevation: number;
  /** wall height */
  height: number;
  rooms: Room[];
  /** free-standing walls in addition to the ones generated from room outlines */
  walls?: WallSpec[];
  openings?: Opening[];
  devices?: Device[];
}

export interface Room {
  id: string;
  name: string;
  /** Home Assistant area id: the room panel lists this area's entities */
  area?: string;
  polygon: Vec2[];
  /** rooms with the same group form one open space: no walls between them (kitchen + living) */
  group?: string;
  /** no outside walls either (a covered porch, a carport) */
  open?: boolean;
  /** entities shown in the room label and used for the heatmap */
  temperature?: string;
  humidity?: string;
}

export interface WallSpec {
  a: Vec2;
  b: Vec2;
  thickness?: number;
  height?: number;
}

export type OpeningType = 'door' | 'window' | 'garage' | 'gap';

export interface Opening {
  type: OpeningType;
  /** a point on (or near) the wall; the opening is centred there */
  at: Vec2;
  width: number;
  height?: number;
  /** windows: height of the bottom edge */
  sill?: number;
  /** contact sensor or cover: open while on/open */
  entity?: string;
  /** doors: hinge side seen from the side the door swings to */
  hinge?: 'left' | 'right';
  /** doors: which side of the wall the leaf swings to (+1 / −1 along the wall normal) */
  swing?: 1 | -1;
}

interface DeviceBase {
  /** main entity; tap toggles or opens it */
  entity: string;
  pos: Vec2;
  /** mounting height above the floor */
  z?: number;
  /** facing, degrees clockwise from plan "up" (−y) */
  rot?: number;
  name?: string;
}

export interface LightDevice extends DeviceBase {
  type: 'light';
  kind?: 'bulb' | 'strip' | 'flood' | 'lamp';
  /** strips: length in metres */
  length?: number;
}

export interface CameraDevice extends DeviceBase {
  type: 'camera';
  /** horizontal field of view in degrees */
  fov?: number;
  /** how far the view wedge reaches on the floor */
  range?: number;
  /** binary sensors that make the wedge turn red (person, vehicle, motion …) */
  motion?: string[];
  /** stream used by the cockpit view (default: the camera entity) */
  stream?: string;
}

export interface TvDevice extends DeviceBase {
  type: 'tv';
  width?: number;
  /** a plug or switch that powers the TV, toggled when the media player is off */
  power?: string;
}

export interface ClimateDevice extends DeviceBase {
  type: 'climate';
}

export interface ApplianceDevice extends DeviceBase {
  type: 'appliance';
  kind?: 'purifier' | 'dehumidifier' | 'fan' | 'plug' | 'washer';
  /** a power sensor: the appliance glows while it draws more than `active_watts` */
  power?: string;
  active_watts?: number;
}

export interface VacuumDevice extends DeviceBase {
  type: 'vacuum';
}

export interface SensorDevice extends DeviceBase {
  type: 'sensor';
}

export interface CarDevice extends DeviceBase {
  type: 'car';
  /** the car is drawn while this entity is on/home/true */
  presence?: string;
  length?: number;
  width?: number;
}

export type Device =
  | LightDevice
  | CameraDevice
  | TvDevice
  | ClimateDevice
  | ApplianceDevice
  | VacuumDevice
  | SensorDevice
  | CarDevice;

export interface OutdoorArea {
  name?: string;
  kind: 'grass' | 'paving' | 'terrace' | 'parking' | 'water';
  polygon: Vec2[];
  /** HA area for the room panel */
  area?: string;
}

export interface Roof {
  type: 'gable' | 'hip' | 'flat';
  /** gable: direction of the ridge */
  ridge?: 'x' | 'y';
  pitch?: number;
  overhang?: number;
  /** solar panels on the roof face pointing this way (plan direction) */
  solar?: { side: 'n' | 's' | 'e' | 'w'; rows: number; cols: number; power?: string };
}

// ---- the parts of Home Assistant's frontend `hass` object this card uses ----

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export interface HassEntityRegistryDisplayEntry {
  entity_id: string;
  name?: string | null;
  device_id?: string;
  area_id?: string;
  hidden?: boolean;
  entity_category?: 'config' | 'diagnostic';
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  entities?: Record<string, HassEntityRegistryDisplayEntry>;
  devices?: Record<string, { id: string; area_id?: string | null; name?: string | null }>;
  areas?: Record<string, { area_id: string; name: string }>;
  language?: string;
  callService(domain: string, service: string, data?: Record<string, any>): Promise<unknown>;
  callWS<T>(msg: Record<string, any>): Promise<T>;
  hassUrl(path?: string): string;
}

export interface CardConfig {
  type: string;
  /** the plan itself, or */
  plan?: Plan;
  /** a JSON file, e.g. /local/neon-house/plan.json */
  plan_url?: string;
  height?: number;
  /** fill the screen below the dashboard header (panel views) instead of a fixed height */
  fill?: boolean;
  theme?: ThemeName;
  quality?: 'auto' | 'low' | 'high';
  floor?: string;
  weather?: boolean;
  trail?: boolean;
  heatmap?: 'none' | 'temperature' | 'humidity';
  /** editing aid: show plan coordinates under the pointer */
  coords?: boolean;
  /** show the frame rate */
  stats?: boolean;
}

export type ThemeName = 'neon' | 'blueprint' | 'day';
