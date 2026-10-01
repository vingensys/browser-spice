# Browser SPICE

Schematic capture and circuit simulation in the browser: draw, simulate, probe, and exchange
netlists with standard SPICE tools. No build step. See [ROADMAP.md](ROADMAP.md) for where it is going.

```bash
npm install          # optional: also vendors the ngspice WebAssembly engine
npm run serve        # http://localhost:8137
```

## Using it

**Editing (Proteus-style)**

| Action | How |
| --- | --- |
| Place a part | Pick it in the library (or press its hotkey), click to drop. Placement is sticky; **R** rotates the ghost, right-click / **Esc** stops. |
| Wire | Click or drag from any pin. Move to preview the auto-route, click empty grid to pin a corner, click a pin or wire to finish (clicking a wire makes a junction). **Backspace** removes the last corner, double-click ends in free space, **Esc** cancels. |
| Reshape a wire | Drag a segment. **T** re-routes the selected wire from scratch (nothing selected: all wires). |
| Move parts | Drag. Attached wires stretch like rubber bands and keep their shape. |
| Select | Click, **Shift**-click, or drag a box. **Ctrl+A** selects all. |
| Copy / paste | **Ctrl+C / X / V**. Wires between copied parts come along. |
| Rotate / delete | **R** / **Del**. Works on a multi-selection. |
| Zoom / pan | Scroll to zoom at the cursor, **Space**-drag or middle-drag to pan, **F** fits the view, **Ctrl+0** resets. |
| Undo / redo | **Ctrl+Z**, **Ctrl+Y** (or **Ctrl+Shift+Z**). |
| Edit a part | Double-click it, or use the Properties panel (values, models, source waveforms, supplies). |

Hotkeys: **C** capacitor, **L** inductor, **V** source, **G** ground, **D** diode, **Q** NPN,
**M** NMOS, **U** op-amp, **W** wire tool, **R** resistor (when nothing is selected).

**Simulating**

- **Run DC / AC Sweep / Transient / DC Sweep** from the toolbar (Temp sets the circuit temperature); add voltage / current probes to plot signals.
- **Stop / Step / start from 0** set the transient run; **AC** sets the sweep range.
- **Engine**: *Built-in* is instant. *ngspice* runs the exported netlist through the real
  ngspice (WebAssembly, loads on first use) for a second opinion or vendor models.
- **Examples** menu: rectifier, LED, zener regulator, CE amplifier, op-amp, 555 oscillator, boost converter.

**Interchange**

- **Export Netlist** produces a standard `.cir` (device `.model` cards, op-amp and 555 macro-models).
- **Import SPICE** turns a `.cir` into an editable schematic (parts, wires, models, sources, analyses).
- **Save / Open CAD** use a JSON file.

## What is simulated

R, C, L, voltage and current sources (DC / sine / pulse / piecewise-linear, with an AC-sweep
magnitude), VCVS and VCCS, ideal switch, potentiometer, diode, LED, zener, NPN / PNP BJT, N / P
MOSFET (level 1 with body diode and gate capacitance), op-amp (single pole, rail clamp), logic
gates (with propagation delay), NE555. Part models are standard SPICE parameter sets (1N4148,
1N4007, 2N2222, 2N3904, 2N7000, IRF540, LM741, ...); `.model` cards from vendor files can be
imported (Import SPICE with a model-only file) and are remembered between sessions.

**Analyses**: operating point, DC sweep, transient (with UIC / `.ic`), AC small-signal, and a
temperature setting (`.temp`) that scales junction currents the way SPICE does.

The engine (`js/sim`) is a SPICE-style solver: modified nodal analysis, Newton-Raphson with
junction limiting, gmin and source stepping, trapezoidal / backward-Euler transient with
local-error step control, exact landing on source edges and comparator crossings,
charge-conserving junction capacitances, and a Markowitz sparse LU for larger circuits
(about 7 ms per step at 1,100 unknowns).

## Layout

- `js/sim/` engine: `linalg` (dense + sparse LU), `devices`, `models`, `model-library`, `engine`, `spice-parser`, `ngspice-backend`
- `js/cad/` editor internals: `symbols` (pins and bodies), `router` (A* + rubber-band repair), `symbol-draw`
- `js/visualization/` schematic editor and waveform plotter
- `js/circuit/netlist.js` schematic -> nets -> element list -> simulation / `.cir`
- `js/ui/` properties panel, simulation runner, SPICE import; `js/examples.js`, `js/app.js`

## Tests

```bash
npm test             # engine, ngspice cross-check (needs ngspice on PATH), ngspice-WASM adapter
SPARSE=1 npm test    # the same with the sparse solver forced on for every circuit
```

- `tests/sim.test.js` engine against closed-form results, solver equivalence, vendor-model import (46 checks).
- `tests/ngspice.test.js` runs `tests/decks/*.cir` (diodes, BJT / MOS amplifiers, rectifiers, CMOS, controlled
  sources, PWL / `.param`, `.ic`, `.temp`) through the engine **and** native ngspice and compares operating
  points, transients and AC sweeps node by node. Skips if ngspice is missing.
- `tests/ngspice-wasm.test.js` the WASM adapter.

Browser suites (load in the running app and call from the console):

```js
(0, eval)(await (await fetch('tests/interaction.js')).text()); interactionTests();     // editor behaviour
(0, eval)(await (await fetch('tests/stress.js')).text());      stress(12345, 100);    // random drags / rotations
(0, eval)(await (await fetch('tests/examples.js')).text());    await exampleTests();   // every example's physics
(0, eval)(await (await fetch('tests/roundtrip.js')).text());   await roundtripTests(); // SPICE -> schematic -> sim
(0, eval)(await (await fetch('tests/engines.js')).text());     await engineTests();    // built-in vs ngspice-WASM
```

ngspice remains the reference. Known approximations: the built-in 555 and its ngspice macro are each
within about 1 % of an ideal 555's period; gates switch with a fixed 10 ns delay; MOSFETs are level 1.
