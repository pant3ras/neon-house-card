# Neon House Card

Your home as a glowing 3D floor plan on a Home Assistant dashboard. Lights shine in their real colour,
cameras show what they see, the TV shows what's playing, the AC blows, the vacuum drives around – and
it rains on the roof when it rains outside. Everything runs in the browser against your own Home
Assistant: no cloud, no account, no licence key.

![Neon House](docs/screenshot.jpg)

## Features

- **Walls from rooms** – draw rooms as polygons; shared edges become one interior wall, outer edges
  outside walls, corners are mitred. Open-plan rooms (`group`), doors, windows, archways, garage doors.
- **Furniture** – beds, wardrobes, desks, sofas (L-shapes too), bookshelves, kitchen counters … each
  just two corners; it turns its back to the nearest wall by itself.
- **Lights** – bulbs, LED strips, floor lamps and floodlights glow in their colour and brightness and
  tint their room. Tap to toggle, long-press for Home Assistant's dialog.
- **Cameras** – the view cone on the ground turns red and pulses on person/vehicle/motion detection,
  with an alert banner. Tap for the **camera cockpit**: live picture plus a flight to the camera's
  point of view.
- **Motion trail** – detections of the last 30 minutes from the recorder, as markers joined in time order.
- **Weather outside** – rain, downpours, snow, clouds, fog, lightning, sun and moon in the right place,
  stars at night, wind-driven rain.
- **Screens** – TVs show the artwork or app colour of their media player.
- **Climate, appliances, vacuum, car** – airflow, glowing appliances above a power threshold, a robot
  that cleans in circles, a car on its bay while it's home.
- **Heatmap** – rooms coloured by temperature or humidity; room labels with values and lights on.
- **Room panel** – tap a room for every entity of its Home Assistant area.
- **Needs attention** – a chip counting low or dead batteries, problem sensors that are on (tank full,
  leak, overheated …) and plan devices that went unavailable; tap it for the list. Entities labelled
  `no_battery_alerts` are left out of the battery check.
- **Irrigation** – sprinklers spray over their lawn while their valve is open.
- **Electricity now** – the electricity meter shows what the house draws right now: every power
  sensor in Home Assistant (smart plugs, a whole-house meter) plus a typical-wattage estimate for
  devices that are on but measured by nothing. Tap it for the breakdown and neon wires running from
  the meter to everything drawing power.
- **Looks** – Neon, Blueprint and Day. House / floor views, cut-away walls, floors pulled apart.
- **Plan checks** – mistakes in the plan show as plain-language warnings on the card.

## Install

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/pant3ras/neon-house-card`, type
   **Dashboard**.
2. Install **Neon House Card**. HACS adds the resource; reload the browser.
3. Add a card:

```yaml
type: custom:neon-house-card
plan_url: /local/neon-house/plan.json   # a file in /config/www/neon-house/
# or put the whole plan inline:
# plan: { version: 1, floors: [ ... ] }
```

For a full-screen 3D view, put it alone in a **Panel** view with `fill: true`.

### Card options

| Option | Default | |
|---|---|---|
| `plan` / `plan_url` | – | The plan inline, or a JSON file under `/local/…`. One is required. |
| `fill` | `false` | Fill the screen below the header (panel views). |
| `height` | `560` | Height in pixels when not filling. |
| `floor` | – | Floor id to open on (default: the whole house; a one-level house opens inside). |
| `theme` | `neon` | `neon`, `blueprint`, `day` (viewers can switch; their choice is remembered). |
| `quality` | `auto` | `auto`, `low` (old wall tablets), `high` (shadows, full bloom). |
| `heatmap` | `none` | `temperature` or `humidity`. |
| `weather` | `true` | `false` hides the weather outside. |
| `trail` | `false` | Start with the motion trail on. |
| `coords` | `false` | Show plan coordinates under the pointer – handy while editing. |
| `attention` | `true` | The "needs attention" chip. |
| `attention_exclude_label` | `no_battery_alerts` | Label that keeps an entity out of battery warnings. |
| `battery_low` | `20` | Battery percentage counted as low. |
| `links` | – | Buttons to other dashboards: `[{ name: Utilities, path: /my-dashboard/utilities }]`. |
| `stats` | `false` | Frame rate. |

## The plan

A plan is JSON. Lengths are metres; `x` grows to the right, `y` grows **down** (like a drawing on
paper). Use the wall **centre lines** – the axes of an architect's drawing.

```json
{
  "version": 1,
  "weather_entity": "weather.home",
  "north": 0,
  "roof": { "type": "gable", "ridge": "x", "pitch": 30, "overhang": 0.45 },
  "floors": [{
    "id": "ground", "name": "Ground floor", "elevation": 0, "height": 2.7,
    "rooms": [
      { "id": "kitchen", "name": "Kitchen", "area": "kitchen", "group": "day", "polygon": [[5.5, 0], [12, 0], [12, 3.2], [5.5, 3.2]] },
      { "id": "living", "name": "Living Room", "area": "living_room", "group": "day", "polygon": [[5.5, 3.2], [12, 3.2], [12, 8], [5.5, 8]] }
    ],
    "openings": [
      { "type": "window", "at": [12, 5.6], "width": 1.8 },
      { "type": "door", "at": [4.75, 8], "width": 1.0, "entity": "binary_sensor.front_door" }
    ],
    "devices": [
      { "type": "light", "entity": "light.living_room", "pos": [8.75, 5.6] },
      { "type": "camera", "entity": "camera.garden", "pos": [12.15, -0.15], "z": 2.6, "rot": 45, "fov": 110, "range": 7,
        "motion": ["binary_sensor.garden_motion"] }
    ]
  }],
  "outdoor": [
    { "kind": "terrace", "area": "garden", "polygon": [[5.5, -3], [12, -3], [12, -0.2], [5.5, -0.2]] }
  ]
}
```

A complete example is in [`plans/example.json`](plans/example.json).

### Rooms and walls

You never list walls – **every room edge is a wall**. An edge two rooms share becomes one 12 cm
interior wall; an edge only one room has becomes a 30 cm outside wall. Shared corners must use the
same numbers in both rooms; a corner in the middle of another room's edge (a T-junction) is fine.

| Room field | |
|---|---|
| `id`, `name` | Unique id; the label. |
| `polygon` | Corners in order around the room, any shape. |
| `area` | Home Assistant area id: the room panel lists its entities and the room picks up its temperature and humidity sensors. |
| `group` | Rooms with the same group are one open space – no wall between them. |
| `open` | No outside walls either (a covered porch). |
| `temperature`, `humidity` | Pick the sensors yourself. |

- **Remove a wall:** give both rooms the same `group`, or merge them into one polygon.
- **Add a wall:** split a room into two rooms, or add a free-standing one under the floor's
  `"walls": [{ "a": [x, y], "b": [x, y], "thickness": 0.1, "height": 1.1 }]`.
- **Move a wall:** change the coordinate in every room that touches it.

### Openings

`{ "type": "door" | "window" | "garage" | "gap", "at": [x, y], "width": 0.9 }` – `at` is the centre
of the opening on the wall's centre line (up to 60 cm off is forgiven). Optional: `height`, `sill`
(windows), `entity` (a contact sensor or cover: the leaf opens while it's on), `hinge` (`left`/`right`),
`swing` (`1`/`-1`).

### Devices

All devices have `type`, `entity`, `pos: [x, y]`, and optionally `rot` (facing: degrees clockwise,
`0` = up the plan, `90` = right), `z` (height above the floor), `name` and `watts` (what it draws while
on, for the electricity estimate when nothing measures it; `0` leaves it out).

| type | Extra fields |
|---|---|
| `light` | `kind`: `bulb` (default, ceiling), `strip` (+ `length`), `lamp` (floor lamp), `desk` (on a desk), `flood`, `string` (fairy/Christmas lights along `path` instead of `pos`; `closed`, `multicolor`, `spacing`, `twinkle`). A switch entity works too – it lights warm white |
| `camera` | `fov`, `range`, `motion: [binary sensors]`, `stream` (another camera entity for the live view) |
| `tv` | `width`, `power` (plug/switch used when the TV is fully off) |
| `climate` | – |
| `appliance` | `kind`: `purifier`, `dehumidifier`, `fan`, `plug`, `washer`; `power` + `active_watts` |
| `sensor` | – (shows its value) |
| `vacuum` | `pos` is the dock |
| `car` | `presence` (drawn while on/home), `length`, `width` |
| `sprinkler` | `entity` is a valve (or switch); `radius`, `arc` (degrees, centred on `rot`). Sprays while open; a tap opens HA's dialog rather than the water |
| `meter` | `kind`: `electricity`, `gas`, `water`; `entity` = the figure on its label (e.g. this month), `index` = a second figure, `unit` to label a unitless sensor, `underground` (default for water: a lid in the ground). Electricity: `power` (a whole-house power sensor, if you have one), `base` (watts always drawn by things Home Assistant can't see – fridge, router, standby) |

**Electricity now.** With an electricity meter on the plan, its label shows the house's power draw. A
power sensor counts for the plan device it belongs to (same Home Assistant device, the `power` sensor of
an appliance, or the smart plug in a TV's `power`); a TV's own reading behind its plug isn't counted
twice. Power sensors on no plan device are added as they are. Devices that are on but measured by nothing
get a typical figure (bulb 10 W, LED strip 5 W/m, TV 90 W, AC 900 W while heating or cooling,
dehumidifier 200 W, camera 5 W …) shown with `~`; set `watts` on a device to correct it. With a
whole-house `power` sensor the total is that reading and the rest shows as "Everything else".

Camera cones are drawn outside the house only, and a tap on a room under a cone selects the room –
open a camera by tapping the camera or its name tag.

### Furniture

A piece is a rectangle between two opposite corners, under the floor's `"furniture"`:

```json
{ "type": "bed", "from": [0.3, 0.15], "to": [1.9, 2.2] },
{ "type": "sofa", "from": [6.2, 5.2], "to": [9.4, 6.05], "arms": ["left", "right"] }
```

Types: `bed`, `wardrobe`, `dresser`, `desk`, `sofa`, `bookshelf`, `counter`, `cabinet`, `fridge`,
`stove`, `table`, `chair`, `bathtub`, `shower`, `box`. The side against the wall (a bed's head) is found from
the nearest wall; set `back` (`up`/`down`/`left`/`right`) to override. Optional: `height`, `arms`
(sofas: which short ends get an armrest), `upper` (counters: `false` for no wall cabinets, `2` for two
rows up to the ceiling), `round: true` (tables), `monitor: false` (desks), `z` (stand on something, e.g.
`0.08` on a terrace slab), `name`. Outdoor furniture has no wall nearby – give it a `back`.

### Bills

Utility bills join "needs attention" when something is owed:

```json
"bills": [
  { "name": "Electricity", "entity": "sensor.electricity_balance" },
  { "name": "Gas", "entity": "sensor.gas_account", "attribute": "Balance", "due": "Due date" },
  { "name": "Internet", "entity": "sensor.isp_unpaid_total", "due": "sensor.isp_due_date" }
]
```

The amount comes from the state or an `attribute` (`"208,24 lei"` and `"1.234,56"` are understood); a
state of `Nu`/`No`/`off` means nothing is owed. `due` is an attribute or an entity; past due turns the
row red.

### Outside, roof, sun

`outdoor`: areas with `kind` `grass`, `paving`, `terrace`, `parking` or `water`, a `polygon` and an
optional HA `area`; `roof: true` puts a roof on posts over it (a covered terrace, a carport), at
`roof_height` (default 2.6 m). A cellar is just another floor with a negative `elevation`. `roof`: `type` `gable`, `hip` or `flat`, `ridge` `x`/`y`, `pitch`, `overhang`.
`north`: the compass direction the top of the plan faces (degrees) – it puts the sun in the right
place. `weather_entity`: the weather entity that drives rain, snow and clouds.

## Development

```bash
npm install
npm run dev      # preview with a fake Home Assistant at http://localhost:4170
npm run build    # dist/neon-house-card.js
```

The preview loads `plans/casa.json` if you have one (it is git-ignored, so your own house stays
private), otherwise `plans/example.json`; `?plan=example` forces the example. Saving the plan reloads
the preview and keeps the view. The "Preview controls" box fakes weather, night, detections and the vacuum.

## Licence

MIT
