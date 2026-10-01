# Browser SPICE

Schematic capture and circuit simulation in the browser: draw, simulate, probe, and exchange
netlists with standard SPICE tools. No build step. See [ROADMAP.md](ROADMAP.md) for where it is going.

```bash
npm install          # optional: also vendors the ngspice WebAssembly engine
npm run serve        # http://localhost:8137
```

## Using it

The shell follows Proteus ISIS: menu bar, command toolbars, an overview and a mode toolbar
(Devices / Terminals / Generators / Instruments / Graph) on the left with the device list under
it, the sheet in the middle, and a status bar with the play / step / pause / stop transport.
The classic cream-sheet theme is the default; **View > Theme** switches to dark.

**Editing**

| Action | How |
| --- | --- |
| Pick a part | **P** (or the **P** button) opens Pick Devices: search, preview, OK adds it to the device list. Select it in the list, click the sheet to drop it. **R** rotates the ghost, right-click / **Esc** stops. |
| Wire | Click or drag from any pin. Click empty grid to pin a corner, click a pin or wire to finish (a wire makes a junction). **Backspace** removes a corner, **Esc** cancels. |
| Reshape / tidy | Drag a segment. **T** re-routes the selection (nothing selected: all wires). |
| Move, select | Drag parts (wires follow). Click, **Shift**-click or box-select; **Ctrl+A** selects all. |
| Copy / paste, undo | **Ctrl+C / X / V**, **Ctrl+Z / Y**. |
| Edit a part | Double-click it or **Ctrl+E**: the Edit Component dialog (name, values, models, waveforms). **OK** keeps, **Cancel** reverts. |
| Zoom / pan | Wheel, **Space**-drag or middle-drag, **F** fits, **Ctrl+0** resets. The overview pane also pans. |

Parts get standard reference designators (R1, C1, D1, Q1, U1, RV1, ...).

**Simulating**

- **Live**: **Play** (F12) runs the circuit continuously. Voltage / current probes, DC voltmeters and ammeters,
  and oscilloscopes on the sheet update as it runs; the LIVE graph tab plots them. Switches and pots can be
  changed during a run; editing the circuit restarts it. **Pause**, **Step** (F10), **Stop** (Shift+F12).
- **Graph analyses** (Graph menu or the graph window tabs): analogue transient, frequency (AC), DC sweep, operating point.
  **Design > Simulation Settings** sets stop time, step, UIC, AC range, sweep, temperature, solver and live speed.
- **Design > Electrical Rule Check** reports unconnected pins, a missing ground and similar problems in the message log.
- **Engine**: *Built-in* is instant. *ngspice* runs the exported netlist through the real
  ngspice (WebAssembly, loads on first use) for a second opinion or vendor models.
- **Examples** menu: rectifier, LED, zener regulator, CE amplifier, op-amp, 555 oscillator, boost converter.

**Interchange**

- **Export Netlist** produces a standard `.cir` (device `.model` cards, op-amp and 555 macro-models).
- **Import SPICE** turns a `.cir` into an editable schematic (parts, wires, models, sources, analyses).
- **Save / Open CAD** use a JSON file.

## What is simulated

R, C, L, voltage and current sources (DC / sine / pulse / piecewise-linear, with an AC-sweep
magnitude), VCVS and VCCS, ideal switch, potentiometer, per-node initial-condition flags, diode, LED, zener, NPN / PNP BJT, N / P
MOSFET (level 1 with body diode, gate capacitance and series RD / RS), op-amp (single pole, rail clamp), logic
gates (with propagation delay), NE555. Part models are standard SPICE parameter sets (1N4148,
1N4007, 2N2222, 2N3904, 2N7000, IRF540, LM741, ...); `.model` cards from vendor files can be
imported (Import SPICE with a model-only file) and are remembered between sessions.

**Analyses**: operating point, DC sweep, transient (with UIC / `.ic`), AC small-signal, and a
temperature setting (`.temp`) that scales junction currents the way SPICE does.

The engine (`js/sim`) is a SPICE-style solver: modified nodal analysis, Newton-Raphson with
junction limiting, gmin and source stepping, trapezoidal / backward-Euler transient with
local-error step control, exact landing on source edges and comparator crossings,
charge-conserving junction capacitances, and a Markowitz sparse LU for larger circuits
with the pivot order reused between iterations (about 2 ms per step at 1,100 unknowns, 5 ms at 2,200).

## Layout

- `js/sim/` engine: `linalg` (dense + sparse LU), `devices`, `models`, `model-library`, `engine`, `spice-parser`, `ngspice-backend`
- `js/cad/` editor internals: `symbols` (pins and bodies), `router` (A* + rubber-band repair), `symbol-draw`
- `js/visualization/` schematic editor and waveform plotter
- `js/circuit/netlist.js` schematic -> nets -> element list -> simulation / `.cir`
- `js/ui/` the ISIS-style shell: `theme`, `commands` (one registry for menus, toolbars and keys), `menubar`, `toolbars`, `statusbar`, `overview`, `device-list` + `catalog` (device pane, Pick Devices), `dialogs`, `graph-window`, `live-sim`, `properties`, `sim-runner`, `spice-import`, `icons`
- `js/examples.js`, `js/app.js` (composes the shell and defines the commands)

## Tests

```bash
npm test             # engine, ngspice cross-check (needs ngspice on PATH), ngspice-WASM adapter
SPARSE=1 npm test    # the same with the sparse solver forced on for every circuit
```

- `tests/sim.test.js` engine against closed-form results, solver equivalence, vendor-model import (46 checks).
- `tests/ngspice.test.js` runs `tests/decks/*.cir` (diodes, BJT / MOS amplifiers, rectifiers, CMOS, controlled
  sources, PWL / `.param`, `.ic`, `.temp`, MOSFET RD/RS) through the engine **and** native ngspice and compares operating
  points, transients and AC sweeps node by node. Skips if ngspice is missing.
- `tests/ngspice-wasm.test.js` the WASM adapter.

Browser suites (load in the running app and call from the console):

```js
(0, eval)(await (await fetch('tests/interaction.js')).text()); interactionTests();     // editor behaviour
(0, eval)(await (await fetch('tests/stress.js')).text());      stress(12345, 100);    // random drags / rotations
(0, eval)(await (await fetch('tests/examples.js')).text());    await exampleTests();   // every example's physics
(0, eval)(await (await fetch('tests/roundtrip.js')).text());   await roundtripTests(); // SPICE -> schematic -> sim
(0, eval)(await (await fetch('tests/engines.js')).text());     await engineTests();    // built-in vs ngspice-WASM
(0, eval)(await (await fetch('tests/ui.js')).text());          await uiTests();       // menus, dialogs, device list, live simulation
```

ngspice remains the reference. Known approximations: the built-in 555 and its ngspice macro are each
within about 1 % of an ideal 555's period; gates switch with a fixed 10 ns delay (the export models the same lag); MOSFETs are level 1.
