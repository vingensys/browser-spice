# Design file format

A saved design (File > Save Design, autosave, share links, examples) is one JSON object. The format is
versioned in the `format` field; `js/ui/format.js` (`DesignFormat`) is the reference implementation:
it migrates older files and checks structure, and `tests/format.test.js` pins its behaviour.

**Current version: 2** (`"format": "browser-spice/2"`).

## Versions

| Version | Marker | What it is |
| --- | --- | --- |
| 0 | no `format` field | The first saved files: `panX` / `panY` at the top level instead of `view`. |
| 1 | `browser-spice/1` | Sheets, parameters, measurements, embedded subcircuits, PCB, run settings. Some lists may be absent. |
| 2 | `browser-spice/2` | The same content; `wires`, `probes`, `measures`, `params`, `subckts`, `titleBlock` and `view` are always present, so readers need no defaults. |

## Compatibility rules

- **Reading.** `DesignFormat.migrate` accepts every version up to the current one and upgrades it step by step
  (`MIGRATIONS[n]` turns version n into n + 1). It works on a copy and never changes the file it was given.
- **Newer files** are refused with a message that says to update the app; they are never half-loaded.
- **Not a design** (`components` missing, or a different `format` name) is refused.
- **Damaged content** is dropped part by part and reported (unknown part types, wires to missing parts); the rest loads.
- **Writing.** Always the current version. Saving an old file therefore upgrades it.
- **Adding a field** that old readers can ignore needs no new version. **Renaming, removing or re-typing** a field,
  or changing what a value means, needs a new version, a `MIGRATIONS` entry and a fixture in `tests/fixtures/`.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | string | `browser-spice/<n>` |
| `components` | list | Parts on the active sheet (below) |
| `wires` | list | Wires on the active sheet |
| `probes` | list | Voltage / current probes on the active sheet |
| `titleBlock` | object | Title, author, date, revision, ... |
| `measures` | list | Named measurements (`{ fn, sig, ... }`) |
| `params` | list | Design parameters, `{ name, value }` (value is text, so it can be an expression) |
| `sheets` | list | Sheet list. The active sheet is `{ id, name, active: true }` (its content is the top-level lists); others carry `state: { components, wires, probes, titleBlock, nextId }` |
| `pcb` | object, optional | Board: `outline`, `parts`, tracks, vias, pours, rules |
| `subckts` | list | Subcircuits the design uses, `{ name, ports, text, models }`; they travel with the file |
| `probeScope` | object, optional | Setup of the probe oscilloscope (Graph > Probe Oscilloscope): the scope settings (`tdiv`, `chan.A..H` / `M` with `vdiv`, `pos`, `coup`, `on` and `src: { probe: <probe id> }`, `trig`, `math`, `cur`, `fft`, `keep`) |
| `pauseConditions` | list, optional | Debug > Pause Conditions: `{ probe: <probe id>, op: "above" \| "below", value, on }` |
| `nextId` | number | Next free object id. Must be above every id in the file |
| `view` | object | `{ zoom, panX, panY }`; not part of the "has unsaved changes" test |
| `settings` | object | Run settings: `tStop`, `tStep`, `fStart`, `fStop`, sweep, `temp`, `uic`, `engine`, solver options, `method`, `liveSpeed` |

## Objects

- **Component**: `{ id, type, x, y, rotation, mirror?, name, value, ...props }`. `type` names a symbol
  (`resistor`, `vsource`, ...) or `SUB:<name>` for a subcircuit. Positions are in canvas units (20 = 0.1 in).
  Run-time fields (`live`, `scopeTrace`, `glow`, `on`, ...) are never saved.
- **Wire**: `{ id, start, end, route }`. An end is `{ type: "terminal", component, terminal }` or a free point / junction.
- **Probe**: `{ id, type: "V" | "I", x, y, label, ... }`.
- **Oscilloscope** (`SCOPE` part) settings live in the part's `scope` field (same shape as `probeScope` above). A channel's `src` assigns a probe to it; without one, channels A-D read the scope's pins.
- **Current clamp** (`CLAMP` part): `{ target: <component id>, sens: "0.1" (V per A), ... }`; its `O` pin carries volts = amps x sens, and a scope channel wired to it shows amps.

Ids are unique per kind within one sheet and come from one counter (`nextId`).

## Checking a file

`DesignFormat.validate(state)` returns a list of problems (duplicate ids, parts without a type or position, wires to
missing parts, `nextId` too low). The app reports duplicate ids on Open and repairs the rest silently.
