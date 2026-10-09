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
  /** utility bills: an amount above zero shows up under "needs attention" */
  bills?: Bill[];
  /** degrees the plan's "up" (−y) is turned from north, clockwise; used for the sun */
  north?: number;
}

export interface Bill {
  name: string;
  /** the entity holding the amount owed now */
  entity: string;
  /** read the amount from this attribute instead of the state ("208,24 lei" is fine) */
  attribute?: string;
  /** due date: an attribute of the same entity, or another entity */
  due?: string;
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
  furniture?: Furniture[];
}

export type Side = 'up' | 'down' | 'left' | 'right';

export type FurnitureType =
  | 'bed'
  | 'wardrobe'
  | 'dresser'
  | 'desk'
  | 'sofa'
  | 'bookshelf'
  | 'counter'
  | 'cabinet'
  | 'fridge'
  | 'table'
  | 'chair'
  | 'bathtub'
  | 'shower'
  | 'stove'
  | 'box';

/** a piece of furniture: an axis-aligned rectangle between two opposite corners */
export interface Furniture {
  type: FurnitureType;
  from: Vec2;
  to: Vec2;
  /** the side against the wall (a bed's head); found from the nearest wall when left out */
  back?: Side;
  height?: number;
  /** sofas: which short ends get an armrest (default both) */
  arms?: Side[];
  /** counters: wall cabinets above – false for none, a number for that many rows up to the ceiling */
  upper?: boolean | number;
  /** tables: round top on one pedestal */
  round?: boolean;
  /** desks: a monitor on top (default true) */
  monitor?: boolean;
  /** raise the piece off the floor (furniture on a terrace slab) */
  z?: number;
  name?: string;
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
  /** `desk` stands on a desk; `string` is fairy/Christmas lights along `path` */
  kind?: 'bulb' | 'strip' | 'flood' | 'lamp' | 'desk' | 'string';
  /** strips: length in metres */
  length?: number;
  /** string lights: the corners they run along (e.g. round the roof eaves) */
  path?: Vec2[];
  /** string lights: join the last corner back to the first (default true) */
  closed?: boolean;
  /** string lights: red, green, blue, yellow, pink bulbs instead of the light's colour */
  multicolor?: boolean;
  /** string lights: metres between bulbs (default 0.3) */
  spacing?: number;
  /** string lights: gentle twinkle while on (keeps the view animating) */
  twinkle?: boolean;
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

export interface SprinklerDevice extends DeviceBase {
  type: 'sprinkler';
  /** a valve (or switch) that waters this spot */
  entity: string;
  /** reach of the spray in metres */
  radius?: number;
  /** degrees of the circle it waters (default 360), centred on `rot` */
  arc?: number;
}

export interface MeterDevice extends DeviceBase {
  type: 'meter';
  kind: 'electricity' | 'gas' | 'water';
  /** what the label shows, e.g. this month's consumption */
  entity: string;
  /** a second figure, e.g. the meter index */
  index?: string;
  /** text after the main figure when its entity has no unit (e.g. "m³ in 2026") */
  unit?: string;
  /** drawn as a lid in the ground (a water meter pit) */
  underground?: boolean;
}

export type Device =
  | MeterDevice
  | SprinklerDevice
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
  /** a roof on posts over it (a covered terrace, a carport) */
  roof?: boolean;
  /** height of that roof, default 2.6 m */
  roof_height?: number;
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
  labels?: string[];
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  entities?: Record<string, HassEntityRegistryDisplayEntry>;
  devices?: Record<string, { id: string; area_id?: string | null; name?: string | null; name_by_user?: string | null }>;
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
  /** the "needs attention" chip: low/dead batteries, problems, unavailable devices (default on) */
  attention?: boolean;
  /** entities with this label are left out of battery warnings (default no_battery_alerts) */
  attention_exclude_label?: string;
  /** battery percentage counted as low (default 20) */
  battery_low?: number;
  /** buttons in the top bar that open other dashboards, e.g. { name: Utilities, path: /my-dashboard/utilities } */
  links?: { name: string; path: string }[];
  /** show the frame rate */
  stats?: boolean;
}

export type ThemeName = 'neon' | 'blueprint' | 'day';
