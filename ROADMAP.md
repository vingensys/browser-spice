# Roadmap: a Proteus-class circuit workbench in the browser

**Goal.** The Proteus experience (draw a circuit, press play, probe it, build the PCB) with
no install, plus open interchange with the tools engineers already use: SPICE, KiCad, CSV
BOMs, Gerber. Everything runs client-side; a file is a link.

**Principles**
- Interactive first: the built-in engine answers instantly; ngspice is one click away for a
  second opinion or vendor models.
- One source of truth per concept: schematic -> neutral element list -> simulate / export.
- Prove it: every claim is backed by a test against a reference (ngspice) or a closed form.

## Where we are

| Area | State |
| --- | --- |
| Schematic editor | Proteus-style wiring (A* router, rubber-banding, junctions), placement ghost, box/multi-select, copy/paste, zoom/pan, undo |
| Simulation | Built-in SPICE engine: OP, DC sweep, transient (adaptive, event-exact), AC, temperature, sparse LU. R C L V I, E/G sources, switch, pot, diode/LED/zener, BJT, MOSFET, op-amp, gates, 555 |
| Accuracy | 46 engine tests; 16 reference decks within ~1 % of ngspice (OP, transient, AC, temperature, `.ic`); built-in vs ngspice-WASM agree on every example |
| Interop | SPICE `.cir` export (models, op-amp and 555 macros, PWL, controlled sources) and import (into an editable schematic, `.param`, `.ic`); vendor `.model` libraries; ngspice-WASM backend |
| Shell | Proteus ISIS-style UI: menus, toolbars, overview, mode bar + device list, Pick Devices, Edit Component, graph window, status-bar transport, classic and dark themes |
| Live simulation | Play / pause / step / stop with probes, voltmeters, ammeters, on-sheet scope; interactive switches and pots |
| Parts | Transformer, relay, fuse, JFET, SCR / TRIAC, regulators, flip-flops, 7-segment, lamp / buzzer / motor / crystal, researched vendor library |
| Examples | 16 working circuits with probes |

## Next, in order

### 1. Make simulation feel like Proteus
- **Live simulation** (done: run, probes, meters, switches). Still to do: animate current (moving dots)
  and show node voltages on wires (colour / labels).
- **Virtual instruments**: oscilloscope, function generator, DC voltmeter / ammeter, logic
  analyser as placeable parts (the plot panel becomes the scope).
- **More parts** (done: relay, transformer, fuse, JFET, SCR / TRIAC, regulators, 7-segment, crystal, buzzer). Still to do: LED brightness,
  counters / shift registers / 74xx, microcontroller model, Darlingtons, optocouplers, more op-amps.
- **Digital + mixed-signal**: event-driven logic (flip-flops, counters, shift registers,
  74xx, simple microcontroller model) bridged to the analog solver.
- **Analyses**: DC sweep UI, parametric sweep, Monte Carlo, temperature, noise, Fourier, Bode
  with phase and margins.
- **Convergence**: `.nodeset`, higher-level MOSFET models (BSIM), JFET.

### 2. Industry-standard interchange
- **SPICE**: `.include` / `.lib` vendor models, `.subckt` as hierarchical sheets, `.param`,
  behavioural B-sources (expression parser), full ngspice/LTspice dialect coverage.
- **KiCad**: export schematic (`.kicad_sch`) and netlist (`.net`); import symbols / libraries.
- **Other CAD**: Eagle / Altium netlists, SVG / PDF schematic export, BOM (CSV / XLSX) with
  values, footprints and MPNs, IPC-D-356.
- **Libraries**: symbol + model + footprint bundles, search by part number, user libraries.

### 3. Schematic capture polish
- Buses, net labels, power ports, off-sheet connectors, hierarchical sheets.
- Text and graphic annotations, title block, design-rule / ERC checks
  (floating pins, shorted outputs, missing supply, duplicate names).
- Auto-annotation, cross-probing (click a net, see it everywhere), net highlighting.
- Move wire segments with neighbours, "drag" mode that keeps wires attached, snap-to-pin.

### 4. PCB layout (the "other half" of Proteus)
- Footprints, board outline, layers, placement from the schematic (cross-probe).
- Interactive router with push-and-shove, design rules, copper pours.
- 3D view, Gerber / drill export.

### 5. Product
- Cloud save and share-by-link, version history, comments, real-time collaboration.
- Offline / PWA, installable; embeddable simulator widgets for teaching.
- Plugin API for parts and analyses.

## Decisions worth revisiting
- **Engine split.** Keep the built-in engine for the interactive loop and ngspice-WASM for
  accuracy / vendor models. If the interactive engine ever diverges from ngspice on a
  supported circuit, that is a bug: `tests/ngspice.test.js` is the guard.
- **File format.** Today: JSON (`browser-spice/1`). Needs a documented, versioned schema and
  migration before sharing becomes a feature.
- **Build tooling.** Plain scripts keep it hackable. A bundler becomes worth it once there
  are many modules / third-party libs (KiCad parsers, PDF export).
