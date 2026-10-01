# Browser SPICE

Schematic capture and circuit simulation in the browser: draw, simulate, probe, and exchange
netlists with standard SPICE tools. No build step. See [ROADMAP.md](ROADMAP.md) for where it is going.

```bash
npm install          # optional: also vendors the ngspice WebAssembly engine
npm run serve        # http://localhost:8137 (no-cache dev server; the build id shows at the bottom right)
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
| Copy / paste, undo | **Ctrl+C / X / V**, **Ctrl+Z / Y**. Paste attaches the block to the cursor: click to drop it, **Esc** or right-click cancels. |
| Drag Object | Right-click > Drag Object (or Edit menu): the selection follows the pointer until you click; **Esc** puts it back. |
| Probes | Click to select, drag onto another pin or wire, double-click to rename, **Del** removes. They follow the pin or wire they measure. |
| Menus | Mouse, or **Alt+letter** / **F10**, arrows, **Enter**, **Esc**. Right-click menus depend on what is under the pointer. |
| Edit a part | Double-click it or **Ctrl+E**: the Edit Component dialog (name, values, models, waveforms). **OK** keeps, **Cancel** reverts. |
| Zoom / pan | Wheel, **Space**-drag or middle-drag, **F** / **F8** fits, **F6 / F7** zoom, **Shift**+wheel pans sideways, **Ctrl+0** resets. The overview pane also pans. |

Parts get standard reference designators (R1, C1, D1, Q1, U1, RV1, ...). **R** rotates and **X** / **Y** mirror left-right / top-bottom (Edit menu, rotate toolbar, also on the placement ghost); wires follow.

**Simulating**

- **Live**: **Play** (F12) runs the circuit continuously. Voltage / current probes, DC voltmeters and ammeters,
  and oscilloscopes on the sheet update as it runs; the LIVE graph tab plots them. Switches and pots can be
  changed during a run; editing the circuit restarts it. **Pause**, **Step** (F10), **Stop** (Shift+F12).
- **Cursors and measurements**: click a graph to place cursor **A**, **Shift**+click for **B**, drag a cursor line to move it. The **Measure** panel shows each trace at the cursors and Δ, plus min / max / peak-to-peak / mean / RMS, frequency, duty and rise / fall time (between the cursors, or over the visible range). On a frequency plot it gives gain and phase at the cursors, the peak, the −3 dB band, the unity-gain frequency and the phase margin.
- **Export**: **Export ▾** (or right-click the graph) saves the plotted data as CSV (all, visible range, or between the cursors), the measurements as CSV, or the picture as PNG. Works on the LIVE tab too.
- **Graph analyses** (Graph menu or the graph window tabs): analogue transient, frequency (AC), DC sweep, operating point.
  **Design > Simulation Settings** sets stop time, step, UIC, AC range, sweep, temperature, solver and live speed.
- **Design > Electrical Rule Check** reports unconnected pins, a missing ground and similar problems in the message log.
- **Engine**: *Built-in* is instant. *ngspice* runs the exported netlist through the real
  ngspice (WebAssembly, loads on first use) for a second opinion or vendor models.
- **File > Examples** (one list: on an empty sheet an example opens; on a sheet with a design it attaches to the cursor so you can place it beside what you have): rectifier, LED, zener regulator, CE and JFET amplifiers, op-amp, 555 oscillator, boost converter, power supply (transformer + bridge + 7805), relay driver, SCR lamp control, 3-bit ripple counter.

**Your work is kept**

- The design is autosaved in this browser every couple of seconds and restored when you reopen the page (also after a crash). The status bar shows `Saved` / `Unsaved · autosaved hh:mm:ss`, and the window title gets a bullet while there are changes not saved to a file.
- **File > New / Open / Import** ask Save / Don't Save / Cancel when there are unsaved changes. Closing the tab only warns if the browser copy could not be written (storage blocked or full).
- Autosave is per browser profile and shared by tabs on the same address (the last tab to write wins); **Save Design** downloads a `.json` file you can keep.

**Interchange**

- **Export Netlist** produces a standard `.cir` (device `.model` cards, op-amp and 555 macro-models).
- **Import SPICE** turns a `.cir` into an editable schematic (parts, wires, models, sources, analyses).
- **Save / Open CAD** use a JSON file.

## What is simulated

R, C (and polarised electrolytics with ESR), L, transformers (coupled inductors, SPICE `K`), voltage and current sources, VCVS / VCCS,
ideal switch, potentiometer, per-node initial-condition flags, diodes (rectifier, Schottky, fast, LED, zener, bridge rectifier),
NPN / PNP BJTs, N / P MOSFETs (level 1 with body diode, gate capacitance, series RD / RS), N / P JFETs, op-amps (single pole, rail clamp),
logic gates (AND OR NOT NAND NOR XOR XNOR BUF, with propagation delay), D / T / JK flip-flops (rising edge, async set / reset), NE555,
SCR and TRIAC (latching, gate trigger, holding current), relay (coil + contact with pull-in / drop-out), fuse (blows on I²t),
voltage regulators (78xx, 79xx, LM317 / LM337, LDOs with dropout), lamp, buzzer, motor, crystal, battery, 7-segment display,
LDR, NTC / PTC thermistors, varistor, rheostat and photodiode (their light / temperature / setting can be changed while a simulation runs),
phototransistor optocouplers (4N25, 4N35, PC817 ...), and power ports / net labels (same name = same net, no wire needed).

**Sources** (Generators mode, Tool > Place Source, or Pick Devices; the symbol shows the waveform): DC, sine, pulse, square / clock (duty cycle), triangle, sawtooth, exponential (`EXP`), frequency-modulated (`SFFM`), piecewise-linear; current sources too.

**Library**: about 220 named parts, with parameters taken from public vendor SPICE models and datasheets (see the comments in
`js/sim/models-extra.js` for sources and what was fitted). Pick them with **P**. `.model` cards from vendor files can be imported
(Import SPICE with a model-only file, NJF / PJF included) and are remembered between sessions.

**Analyses**: operating point, DC sweep, transient (with UIC / `.ic`), AC small-signal (shown as gain in dB over unwrapped phase, or linear magnitude), and a
temperature setting (`.temp`) that scales junction currents the way SPICE does.

The engine (`js/sim`) is a SPICE-style solver: modified nodal analysis, Newton-Raphson with
junction limiting, gmin and source stepping, trapezoidal / backward-Euler transient with
local-error step control, exact landing on source edges and comparator crossings,
charge-conserving junction capacitances, and a Markowitz sparse LU for larger circuits
with the pivot order reused between iterations (about 2 ms per step at 1,100 unknowns, 5 ms at 2,200).

## Layout

- `js/sim/` engine: `linalg` (dense + sparse LU), `devices`, `devices-extra` (JFET, transformer, relay, fuse, SCR / TRIAC, regulator, flip-flops), `models`, `models-extra` / `models-parts` (library), `model-library`, `engine`, `spice-parser`, `ngspice-backend`
- `js/cad/` editor internals: `symbols` (pins and bodies), `parts` (the added parts: symbol, properties, netlist, library entries), `router` (A* + rubber-band repair), `symbol-draw`
- `js/visualization/` schematic editor, waveform plotter and the graph maths (`plot-math`)
- `js/circuit/netlist.js` schematic -> nets -> element list -> simulation / `.cir`
- `js/ui/` the ISIS-style shell: `theme`, `commands` (one registry for menus, toolbars and keys), `menubar`, `toolbars`, `statusbar`, `overview`, `device-list` + `catalog` (device pane, Pick Devices), `dialogs`, `graph-window`, `live-sim`, `properties`, `sim-runner`, `spice-import`, `icons`
- `js/examples.js`, `js/app.js` (composes the shell and defines the commands)

## Tests

```bash
npm test             # engine, ngspice cross-check (needs ngspice on PATH), ngspice-WASM adapter
SPARSE=1 npm test    # the same with the sparse solver forced on for every circuit
```

- `tests/sim.test.js` engine against closed-form results, solver equivalence, vendor-model import, the added parts (58 checks).
- `tests/ngspice.test.js` runs `tests/decks/*.cir` (diodes, BJT / MOS amplifiers, rectifiers, CMOS, controlled
  sources, PWL / EXP / SFFM / `.param`, `.ic`, `.temp`, MOSFET RD/RS, JFETs, coupled inductors) through the engine **and** native ngspice and compares operating
  points, transients and AC sweeps node by node. Skips if ngspice is missing.
- `tests/ngspice-wasm.test.js` the WASM adapter.
- `tests/plot.test.js` the graph maths (interpolation, statistics, frequency, edges, AC figures, CSV).

Browser suites (load in the running app and call from the console):

```js
(0, eval)(await (await fetch('tests/interaction.js')).text()); interactionTests();     // editor behaviour
(0, eval)(await (await fetch('tests/stress.js')).text());      stress(12345, 100);    // random drags / rotations
(0, eval)(await (await fetch('tests/examples.js')).text());    await exampleTests();   // every example's physics
(0, eval)(await (await fetch('tests/roundtrip.js')).text());   await roundtripTests(); // SPICE -> schematic -> sim
(0, eval)(await (await fetch('tests/engines.js')).text());     await engineTests();    // built-in vs ngspice-WASM
(0, eval)(await (await fetch('tests/ui.js')).text());          await uiTests();       // menus, dialogs, device list, live simulation
(0, eval)(await (await fetch('tests/parts.js')).text());       await partsTests();    // part library, mirror / flip, sources, exports, live displays
(0, eval)(await (await fetch('tests/graph.js')).text());       await graphTests();    // cursors, measurements, CSV / PNG export, true time axis
```

ngspice remains the reference. Known approximations: the built-in 555 and its ngspice macro are each
within about 1 % of an ideal 555's period; gates switch with a fixed 10 ns delay (the export models the same lag); MOSFETs are level 1.

See [AUDIT.md](AUDIT.md) for the list of known shortcomings.
