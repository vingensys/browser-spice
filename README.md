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

- **Run DC / AC Sweep / Transient** from the toolbar; add voltage / current probes to plot signals.
- **Stop / Step / start from 0** set the transient run; **AC** sets the sweep range.
- **Engine**: *Built-in* is instant. *ngspice* runs the exported netlist through the real
  ngspice (WebAssembly, loads on first use) for a second opinion or vendor models.
- **Examples** menu: rectifier, LED, zener regulator, CE amplifier, op-amp, 555 oscillator, boost converter.

**Interchange**

- **Export Netlist** produces a standard `.cir` (device `.model` cards, op-amp and 555 macro-models).
- **Import SPICE** turns a `.cir` into an editable schematic (parts, wires, models, sources, analyses).
- **Save / Open CAD** use a JSON file.

## What is simulated

R, C, L, voltage sources (DC / sine / pulse), diode, LED, zener, NPN / PNP BJT, N / P MOSFET
(level 1 with body diode and gate capacitance), op-amp (single pole, rail clamp), logic gates
(with propagation delay), NE555. Part models are standard SPICE parameter sets (1N4148,
1N4007, 2N2222, 2N3904, 2N7000, IRF540, LM741, ...).

The engine (`js/sim`) is a SPICE-style solver: modified nodal analysis, Newton-Raphson with
junction limiting, gmin and source stepping, trapezoidal / backward-Euler transient with
breakpoints, charge-conserving junction capacitances, small-signal AC.

## Layout

- `js/sim/` engine: `linalg`, `devices`, `models`, `engine`, `spice-parser`, `ngspice-backend`
- `js/cad/` editor internals: `symbols` (pins and bodies), `router` (A* + rubber-band repair), `symbol-draw`
- `js/visualization/` schematic editor and waveform plotter
- `js/circuit/netlist.js` schematic -> nets -> element list -> simulation / `.cir`
- `js/ui/` properties panel, simulation runner, SPICE import; `js/examples.js`, `js/app.js`

## Tests

```bash
npm test             # engine, ngspice cross-check (needs ngspice on PATH), ngspice-WASM adapter
```

- `tests/sim.test.js` engine against closed-form results (42 checks).
- `tests/ngspice.test.js` runs `tests/decks/*.cir` through the engine **and** native ngspice and compares
  operating points, transients and AC sweeps node by node. Skips if ngspice is missing.
- `tests/ngspice-wasm.test.js` the WASM adapter.

Browser suites (load in the running app and call from the console):

```js
(0, eval)(await (await fetch('tests/interaction.js')).text()); interactionTests();   // editor behaviour
(0, eval)(await (await fetch('tests/stress.js')).text());      stress(12345, 100);  // random drags / rotations
(0, eval)(await (await fetch('tests/examples.js')).text());    await exampleTests(); // every example's physics
(0, eval)(await (await fetch('tests/roundtrip.js')).text());   await roundtripTests(); // SPICE -> schematic -> sim
```

Parts that are known to be approximations are listed in the roadmap. ngspice remains the reference.
