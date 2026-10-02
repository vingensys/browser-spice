Schematic capture and circuit simulation in the browser: draw, simulate, probe, and exchange
netlists with standard SPICE tools. No build step, no server needed. See [ROADMAP.md](ROADMAP.md) for where it is going and
[AUDIT.md](AUDIT.md) for the honest list of what is still missing.

**At a glance**
- A Proteus-style editor (A* router, probes, instruments, 260 library parts, 37 logic ICs, subcircuits from SPICE files, multi-sheet hierarchy, design parameters).
- A SPICE engine (MNA, Newton with limiting, adaptive trapezoidal transient, sparse LU) checked against **ngspice** on reference decks, on random circuits, and for noise, `.tf`, `.measure`: operating point, DC sweep, transient, AC, noise, transfer function, Fourier, temperature.
- Study tools ngspice does not have in one place: parametric sweeps (several parameters, corners), Monte Carlo with yield, sensitivity ranking, named measurements.
- Instruments: multi-channel oscilloscope (triggers, cursors, FFT, saved traces), logic analyser, spectrum, cursors and CSV / PNG export on every graph.
- Works anywhere: analyses run on Web Workers (cancellable), installable and offline, share a design as a link, export report / BOM / PNG / SPICE, and an **MCP server** so an AI assistant can use the same engine.

Live copy: https://vingensys.github.io/browser-spice/ (GitHub Pages; the ngspice option loads its engine from a CDN there).

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
- **File > Examples** (one list: on an empty sheet an example opens; on a sheet with a design it attaches to the cursor so you can place it beside what you have): rectifier, LED, zener regulator, CE and JFET amplifiers, op-amp, 555 oscillator, boost converter, power supply (transformer + bridge + 7805), relay driver, SCR lamp control, 3-bit ripple counter, a 74161 + 7447 counter driving a 7-segment display, and a 74164 shift register.

**Probes** have their own list (the **PROBES** pane, via the probe buttons or Tool > Voltage / Current Probe). They stay armed so you can drop several; clicks only need to be near a wire or pin, and a current probe goes on a part or on the wire right next to it. Double-click a probe to rename it, pick its trace colour, or set it to "live only" (shown on the sheet but not plotted).

**Oscilloscope**: double-click the scope instrument (or right-click > Open Oscilloscope) for a real scope window: 10 x 8 division screen, time/div, horizontal position, a **trigger** (source A-D, rising / falling, level or auto level, **Auto / Normal / Single** modes), four channels with volts/div, position and DC / AC / GND coupling, Run / Stop, **Auto set**, XY mode and Vpp / Vrms / Vavg / frequency readouts. The picture is triggered, so it stays put while the simulation runs; the engine's step shrinks automatically for fast timebases. Settings are saved with the design.

**Operating point on the sheet** (View > Show Operating Point): node voltages sit on the wires and branch currents beside the parts, re-solved after every edit and following the running values during Play.

**Oscilloscope extras**: *Cursors* (click or drag on the screen; time difference, 1/Δt and the voltage of the chosen channel at each cursor), *FFT* (spectrum of one channel over the displayed window, with fundamental and THD), *Save trace* (keeps up to four grey reference traces of the screen), and CSV / PNG export. **Logic analyser** (Pick Devices > Instruments, example "Logic analyser on a ripple counter"): eight digital inputs with a threshold, an edge trigger on any input, scroll-back through the history, two cursors with the bus value in hex, Auto set, and CSV / PNG export.

**Exports**: File > *Bill of Materials…* lists the parts grouped by value (references, quantity, value, part, tolerance) with Copy and Download CSV; File > *Export Schematic Image (PNG)…* saves the whole design (no grid or selection marks) at 2× resolution.

**Behavioural sources** (Pick Devices > BSOURCE-V / BSOURCE-I, SPICE `B` cards): a voltage or current that is any expression of node voltages `v(A)`, `v(A,B)`, source currents `i(V1)` and `time`, with + - * / ^, comparisons, `?:`, and the usual functions (`sin`, `exp`, `tanh`, `limit`, `min`, `max`, `if`, ...). Newton gets exact-enough slopes by differencing, AC uses the small-signal slope at the operating point, and the results match ngspice on the reference deck. In the schematic the part has sense pins A–D; SPICE import maps the nets onto them (up to four) and export writes B cards back.

**Background analyses**: Simulate (transient, AC, DC sweep, operating point) and the sweep / Monte Carlo studies run on a Web Worker, so the page stays responsive during a long run. A progress strip with a Cancel button (or Esc) appears in the status bar after a moment; cancelling stops the run immediately. If workers are unavailable (for example the page is opened from `file://`) the same analyses run on the main thread. Live (Play) simulation stays on the main thread, since it animates the schematic. The ngspice solver option runs in its own module worker, so a runaway ngspice run can be cancelled instead of freezing the page.

**Sensitivity** (Design > Sensitivity…): changes every part value by a small percentage in turn and ranks the parts by how much they move a probe's operating-point value, transient measurement or AC measurement (percent of result per percent of part, plus the absolute slope); copy the table as CSV. **Flicker (1/f) noise** (KF, AF on diodes and BJTs) and depletion-capacitance JFET gates are modelled, both matching ngspice.

**Solver options and `.nodeset`**: Simulation Settings has a *Solver options* section (reltol, vntol, abstol, gmin, Newton iteration limit, trapezoidal or backward-Euler integration); they are saved with the design, read from `.options` in imported decks, passed to the workers, and written back as `.options` (only those that differ from the defaults). An *Initial Condition* flag can be switched to *Starting guess* (`.nodeset`): it only chooses where the DC solver starts looking, so a bistable circuit settles in the state you want without being forced there.

**Higher-level model cards (level 2 / 3, BSIM, VBIC ...)**: an imported `.model` card is kept exactly as written (type, level, every parameter). The built-in solver simulates it with its level-1 / Gummel-Poon stand-in and says so (a warning on running, and per part in the netlist notes); the ngspice solver option, and the SPICE export, use the real card, so the exact model is one setting away. Tested against ngspice on a level-3 NMOS.

**Sharing, reports, offline**: File > *Share as Link…* puts the whole design into the URL (gzip + base64 in the `#share=` fragment; nothing is uploaded) and opening such a link loads it. File > *Export Report (HTML)…* writes one self-contained page with the schematic, parameters, parts list, the latest graphs, measurements and the SPICE netlist (print it to PDF). **Ctrl+K** opens a command palette for every command. The app is installable and works offline once visited (a service worker keeps a copy; updates are fetched first, so it is never stale). It is published as a static site from the `main` branch with GitHub Pages (branch deployment, no build step; the repository root is the site).

**MCP server (for AI assistants)**: `node mcp/server.mjs` (or `npm run mcp`) is a Model Context Protocol server over stdio, with no dependencies, that gives an assistant the same engine the page uses. Tools: `simulate` (operating point, transient, AC with bandwidth / phase margin, DC sweep, noise, transfer function, plus `.meas` measurements), `sweep` (a `.param` over a list or range), `monte_carlo` (seeded tolerance analysis with yield and histogram), `check_deck` (parse, warnings, convergence), `compare_with_ngspice` (cross-check when ngspice is installed) and `list_models`. Register it with Claude Code: `claude mcp add browser-spice -- node /path/to/browser-spice/mcp/server.mjs`, or in any MCP client's config as `{ "command": "node", "args": ["/path/to/browser-spice/mcp/server.mjs"] }`. Tested in `tests/mcp.test.js`.

**PCB layout (MVP)**: View > PCB Layout… opens a board for the design. Every part of the netlist gets a footprint (axial R / L, radial C, diode, TO-92 / TO-220, DIP for logic ICs, a pin header for anything else); **Auto-place** arranges them, grouping parts that share nets, and the yellow dashed **ratsnest** shows what is unrouted. Route by hand (T: click points, Enter or double-click to end, V for a via, F for the other layer, 45° moves unless Shift is held) or press **Auto-route** (A* on a 0.25 mm grid, two layers, vias; it routes what it can and says what it could not). **Check rules** lists clearance, short, edge, track-width and unrouted problems and marks them on the board; **Export Gerber…** downloads F.Cu, B.Cu, edge cuts and the drill file as a ZIP. The board is saved with the design. **Footprints**: select a part and pick its footprint in the toolbar: R / L / C in axial or radial through-hole, 0603, 0805 or 1206; diodes in axial or SOD-123; BJTs and JFETs in TO-92 or SOT-23; MOSFETs in TO-220 or SOT-23; logic ICs in DIP or SOIC (1.27 mm). Transistors take the package pin order (TO-92 E B C, SOT-23 B E C, TO-220 G D S), not the symbol's. Surface-mount pads are copper on one side only (**Flip side**, X, puts a part on the back, mirrored), so the router needs a via to reach them from the other layer. **Silkscreen** (part outlines, a pin-1 mark, reference designators in a built-in stroke font, mirrored on the back), **solder mask** (pads + 0.1 mm) and **paste** (top SMD pads) come out with the copper, edge and drill files in the Gerber ZIP (nine files). Basic by intent: a small fixed set of footprints (no user-defined ones or library import), no copper pours or 3D, silk is not checked against pads, and the Gerbers have been checked by structure and by `unzip`, not opened in a CAM viewer.

**KiCad import**: File > Import SPICE Netlist… also takes a KiCad schematic (`.kicad_sch`, KiCad 6+) or a KiCad netlist (`.net` in the `export` format). The schematic's connectivity is recomputed from symbol pin positions, rotation and mirroring, wires, junctions, labels and power symbols, then R, C, L, diodes / LEDs, BJTs, MOSFETs and V / I sources (value or `Sim.*` fields) come in as parts. Anything else is listed as a warning. Hierarchical sheets are not followed; only the opened sheet is imported. Tested on hand-built files, not on a wide corpus of real KiCad projects.

**Logic IC export**: combinational 74xx chips and the 7474 / 74112 flip-flops export to SPICE (truth-table sources thresholded at half the supply, driven through the output resistance) and match ngspice; counters, shift registers, latches, three-state and wide chips are flagged as built-in-only in the deck and in the ngspice engine choice.

**Touch**: on tablets and phones, two fingers pinch-zoom and pan, one finger on empty sheet pans, a tap on empty sheet deselects, a long press opens the right-click menu, a double tap edits a part, pins have larger hit targets, and a floating toolbar (View > Touch Toolbar; automatic on coarse pointers) carries Select/Wire/Bus/Rotate/Mirror/Delete/Undo/Redo/Fit/Play/Stop. Tested with synthetic touch pointer events, not on physical devices.

**Buses**: the Bus tool (Tool menu, **B**) draws a thick bus wire; double-click it (or right-click > Bus Name…) to name it with a range, `D[0..7]`. A bus wire joins nothing by itself. Place **Bus Entry** parts (Terminals in Pick Devices; the slanted end touches the bus, the pin takes the signal; entries placed in a row count up): entry 3 on bus D is the net D3, and every D3 on the sheet is one net. A hierarchical port or sheet pin named `D[0..7]` is a bus pin, so the whole bus crosses a sheet boundary and member k meets member k. The rule check reports entries that touch no bus, indexes outside the range, unnamed buses and bus wires on ordinary pins. Logic ICs with runs of numbered pins (74374 D1..D8 / Q1..Q8, 74151 D0..D7, 7483 A1..A4, 4040 Q1..Q12, …) have a **Vector pins as buses** option in their properties: each run folds into one thick bus pin, `D[1..8]`; attach a bus wire and the first pin of the run meets the first member of the bus, the second the second, and so on (so a 0-based bus drives a 1-based chip). Not done: bus rippers with automatic placement, differently named buses merging at a junction.

**Multi-sheet designs**: tabs under the schematic hold the sheets of a design (Design > Sheets… add, rename, duplicate, delete; Ctrl+PageDown next sheet). Put a **Hierarchical Port** on a sheet and a **Sheet Symbol** (Terminals in Pick Devices) on another: the symbol's pins are that sheet's ports, double-click it to open the sheet, Ctrl+Backspace returns. The design is simulated from the first sheet with every instance expanded (`S1.R1`, `S2.R1`, …); ground and POWER ports of the same name are shared by all sheets, a sheet may be used several times, a sheet that contains itself is cut off with a warning, the BOM and the SPICE export see all instances, and all sheets are saved in the design file. **Cross-probing**: probes placed on a sub-sheet are simulated and plotted once per use of the sheet (`Vmid@S1`, `I(R1)@S2`) in every graph, study, measurement and the live run; with a sub-sheet open, the operating-point overlay and Play show that sheet's own wires and probes (as its first use). **Instruments and animations on sub-sheets** work too: a scope, logic analyser, voltmeter or ammeter on a sub-sheet is fed from the first use of that sheet (a second use of the same sheet is not instrumented, with a note), its window opens from the open sub-sheet, and LED / lamp / relay animations of its parts follow the run. A sheet symbol's *Parameters for this use* (`rv=2k; cv=gain*1n`) gives that use of the sheet its own design-parameter values, so one sheet can serve as several different filters. The rule check (Design > Electrical Rules Check) covers all sheets and reports unused sheets and symbols that point nowhere.

**MOSFET level 1, complete**: NMOS / PMOS have a body pin (B, an open body is tied to the source), body effect (GAMMA, PHI), bulk junction diodes (IS), junction capacitances (CBD, CBS or CJ·area + CJSW·perimeter with their own grading), gate overlap capacitances (CGSO, CGDO, CGBO), Meyer gate capacitances when TOX is given, depletion-mode devices (negative VTO), and W, L, AD, AS, PD, PS from the `M` card. Matches ngspice to better than 1 % in transient and AC on three reference decks and in the random-circuit test (which now includes MOSFET circuits). The nonlinear DC solver also treats a momentarily singular Newton step as a failed attempt, so gmin / source stepping can rescue it.

**Design parameters** (Design > Parameters…): named values and expressions (`rbias = 47k`, `rf = gain*1k`) that any part value can use as `{rbias}` or `{rf/2}`. They are substituted while the netlist is extracted, so every analysis and the SPICE export see plain numbers, the schematic keeps showing the names, and they are saved with the design. Parametric sweeps can vary a parameter, which moves every part that uses it at once.

**Subcircuits as parts**: File > Import a SPICE file that contains `.subckt` blocks (vendor op-amp macromodels, regulators, drivers) and each one becomes a part under *Subcircuits* in Pick Devices, with one pin per port (first half of the ports on the left). The part simulates the subcircuit as written (nested subcircuits, behavioural sources and the `.model` cards it needs travel with it), the SPICE export writes it back as an `X` card plus the `.subckt`, the design file embeds the subcircuits it uses (so it opens anywhere), and the library is remembered in the browser (Library > Forget Imported Models clears it). Matches ngspice on a reference deck (`tests/decks/subckt_amp.cir`). Not supported: `.param` expressions inside subcircuits and `PARAMS:` overrides on the instance.

**Several parameters and corners**: Design > Parametric Sweep… takes up to three parameters. *Every combination* runs the grid (up to 400 runs; a measurement is plotted against the first parameter with one trace per value of the others, waveforms are overlaid up to 150 curves). *Corners* runs each chosen part at low / nominal / high (± a tolerance you set per part), plots the measurement for every corner as bars, and the Measure panel names the lowest and highest corners and the spread against nominal.

**Measurements and transfer function**: Graph > *Measurements…* keeps named measurements with the design: max / min / peak-to-peak / average / RMS / integral over a window, value at a time, time of a crossing (rising, falling, either, nth), delay between two signals, rise / fall time, period / frequency / duty; for AC peak gain, gain and phase at a frequency, the frequency where gain crosses a level, −3 dB bandwidth, unity-gain frequency and phase margin. They run on the latest results (or re-run the analyses), show why one cannot be made, and copy as SPICE `.meas` lines; `.meas` lines in an imported deck are parsed too. 21 measurements on two reference decks agree with ngspice (`tests/measure.ngspice.test.js`). Graph > *Transfer Function (.tf)…* gives the small-signal DC gain from a source to a probe plus the input and output resistance (matches ngspice's `.tf`).

**Noise analysis** (Graph > Noise Analysis, NOISE tab; frequency range from the AC settings): thermal noise of resistors (and diode / MOSFET series resistances), shot noise of diodes and BJT collector / base currents, and MOSFET channel noise, summed at every voltage probe through one adjoint solve per frequency. Shows output noise or noise referred to the AC source in dBV/√Hz; the Measure panel gives spot values at the cursors, the integrated rms noise over the cursor range and the largest contributors (as % of the power). Agrees with ngspice's `.noise` to better than 0.1 % on the reference amplifiers (`tests/noise.ngspice.test.js`). Not modelled: flicker (1/f) noise and the base resistance of BJTs.

**Parametric sweep and Monte Carlo** (Design menu): *Parametric Sweep…* steps one value (a resistor, capacitor or inductor, a source level, frequency or offset, a wiper position, a part property, or the temperature) over a linear, log or explicit list of values, runs a transient, AC or operating-point analysis for each, and shows either every run's waveforms overlaid (colour-graded) or one measurement against the parameter (final, max, min, peak-to-peak, mean, RMS, frequency, rise time; gain or phase at a frequency, peak gain, −3 dB bandwidth, unity-gain frequency). *Monte Carlo…* randomises the tolerances (Gaussian with tolerance = 3σ, or uniform; per-part **Tolerance** field or R/C/L defaults; seeded, so repeatable), measures one number per run, and plots a histogram with mean, σ, min/max and the yield against optional pass limits. Results open in the STUDY tab; values are always restored afterwards, and a run can be cancelled.

**Spectrum**: the SPECTRUM graph tab FFTs the last transient (or live) run: choose the window (Hann, Hamming, Blackman, flat top, rectangular), dBV or volts, linear or log frequency, and the range; place two cursors on the time plot first to analyse just that span. The Measure panel gives the fundamental, DC level, THD and the first harmonics in dBc.

**Net highlighting**: press **H** over a pin or wire (or right-click it > Highlight Net, or Design > Highlight Net) and every wire and pin of that net lights up while the rest fades; the status bar names the net and its pins. Nets joined by a port or label show under its name. **Esc** clears it, and it follows edits.

**Electrical rule check** (Design > Electrical Rule Check): lists problems with a click-to-go list, **Mark on Sheet** puts a **!** on each, and **F4** steps through them. Rules: missing ground; a voltage source shorted or in a loop with other voltage sources (an error: Play and the analyses refuse with that explanation instead of a singular-matrix message); inductors or windings directly across a source; nets with no DC path to ground; unconnected pins; wires ending in mid air; single-pin nets; duplicate designators; parts with all pins on one net; outputs tied to ground or a supply and two outputs on one net (three-state buses are fine); an LED across a supply with no resistor; probes on ground; power ports that disagree on voltage.

**Notes and title block**: press **A** (or Tool > Place Text, or right-click the sheet > Add Text Here), click, and type; notes can be multi-line, sized, coloured, bold / italic, aligned and rotated with **R**. They sit on top of everything (they never block parts or wires) and are ignored by the simulator. **Design > Title Block…** fills the ISIS-style block in the sheet's corner (title, company, document number, revision, author, date, sheet); the title also heads the exported `.cir`.

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
NPN / PNP BJTs (Gummel-Poon), N / P MOSFETs (level 1 with body pin and effect, junction / overlap / Meyer capacitances, series RD / RS), behavioural B sources, N / P JFETs, op-amps (single pole, rail clamp),
logic gates (AND OR NOT NAND NOR XOR XNOR BUF, with propagation delay), D / T / JK flip-flops (rising edge, async set / reset), NE555,
SCR and TRIAC (latching, gate trigger, holding current), relay (coil + contact with pull-in / drop-out), fuse (blows on I²t),
voltage regulators (78xx, 79xx, LM317 / LM337, LDOs with dropout), lamp, buzzer, motor, crystal, battery, 7-segment display,
37 logic ICs (7474, 74112, 74175, 74273, 74373, 74374 flip-flops and latches; 7490, 7493, 74160-74163, 74193, 74393, 4017, 4040 counters; 74164, 74165, 74194, 74595 shift registers; 74138, 74139, 74148, 74151, 74153, 74157 decoders and multiplexers; 7447, 4511 display drivers; 7483, 7485, 74244; 7400/02/04/08/32/86 gate packages) with no power pins to wire and sensible defaults for open inputs,
LDR, NTC / PTC thermistors, varistor, rheostat and photodiode (their light / temperature / setting can be changed while a simulation runs),
phototransistor optocouplers (4N25, 4N35, PC817 ...), and power ports / net labels (same name = same net, no wire needed).

**Sources** (Generators mode, Tool > Place Source, or Pick Devices; the symbol shows the waveform): DC, sine, pulse, square / clock (duty cycle), triangle, sawtooth, exponential (`EXP`), frequency-modulated (`SFFM`), piecewise-linear; current sources too.

**Library**: about 260 named parts, with parameters taken from public vendor SPICE models and datasheets (see the comments in
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

- `js/pcb/pcb.js` the PCB kernel (footprints, ratsnest, autorouter, DRC, Gerber) with its window in `js/ui/pcb-view.js`; `js/sim/` engine: `linalg` (dense + sparse LU), `devices` (R C L sources, diode, Gummel-Poon BJT, level-1 MOSFET), `devices-extra` (JFET, transformer, relay, fuse, SCR / TRIAC, regulator, flip-flops, logic ICs, behavioural B source), `expression` (B-source expressions), `logic-ics`, `models` / `models-extra` / `models-parts` (library), `model-library`, `engine` (OP, DC, transient, AC, noise, `.tf`), `spice-parser`, `worker` / `sim-worker` (analyses off the main thread), `ngspice-backend` / `ngspice-worker`
- `js/cad/` editor internals: `symbols`, `parts` (added parts), `subckt-library` (subcircuits as parts), `sheets` (multi-sheet, ports, sheet symbols), `router`, `symbol-draw`, `probes`, `netview`
- `js/visualization/` schematic editor, waveform plotter, `plot-math`, `fft`, `scope-core`, `logic-core`
- `js/circuit/` `netlist` (schematic -> nets -> elements -> simulation / `.cir`), `hierarchy` (sheets flattened), `params` (design parameters), `erc` (rule check)
- `js/analysis/` `study` (sweeps, corners, Monte Carlo, sensitivity), `measure` (`.measure`)
- `js/ui/` the ISIS-style shell and dialogs (commands, menus, graph window, scope, logic analyser, study / measure / parameter / transfer-function dialogs, export, report, share, palette, sheet bar ...)
- `mcp/` the MCP server (`server.mjs`, `tools.cjs`, `engine.cjs`); `sw.js` + `manifest.webmanifest` the offline app; `.github/workflows` CI and Pages
- `js/examples.js`, `js/app.js` (composes the shell and defines the commands)

## Tests

```bash
npm test             # engine, ngspice cross-check (needs ngspice on PATH), ngspice-WASM adapter, graph and logic maths
npm run test:browser # every browser suite in headless Chrome against the real app (CHROME_PATH if needed)
npm run test:all     # both
SPARSE=1 npm test    # the same with the sparse solver forced on for every circuit
```

- `tests/sim.test.js` engine against closed-form results, solver equivalence, vendor-model import, the added parts, B sources, noise, `.tf`, parameters, subcircuits.
- `tests/ngspice.test.js` runs `tests/decks/*.cir` (diodes, BJT incl. Gummel-Poon, MOSFET incl. body effect and capacitances, JFET, rectifiers, CMOS, controlled sources, behavioural sources, subcircuits, PWL / EXP / SFFM / `.param`, `.ic`, `.temp`, coupled inductors) through the engine **and** native ngspice and compares operating points, transients and AC sweeps node by node. Skips if ngspice is missing.
- `tests/fuzz.test.js` generates seeded random circuits (resistor networks with diodes, BJTs incl. Gummel-Poon, MOSFETs, capacitors, an inductor, sine / pulse and behavioural sources) and compares engine and ngspice on operating point, transient and AC. `FUZZ_N=500 FUZZ_SEED=7 node tests/fuzz.test.js` runs more; `FUZZ_PRINT=<seed>` prints one circuit's deck. It found several engine problems, now fixed (numerical damping of LC resonances, singular inductor / source loops, `log()` and `^` semantics, Newton failures treated as fatal).
- `tests/noise.ngspice.test.js`, `tests/tf.ngspice.test.js`, `tests/measure.ngspice.test.js` noise (incl. flicker), `.tf` and 21 `.measure`s against ngspice.
- `tests/mcp.test.js` the MCP server over its stdio protocol.
- `tests/pcb.test.js` the PCB kernel: footprints, ratsnest, autorouter, DRC, Gerber / Excellon / ZIP.
- `tests/kicad.test.js` KiCad schematic / netlist import.
- `tests/logic.ngspice.test.js` the logic-IC SPICE export against ngspice.
- `tests/logic.analyser.test.js`, `tests/scope.test.js`, `tests/logic.test.js`, `tests/fft.test.js`, `tests/plot.test.js` the instrument cores, logic ICs against truth tables, FFT / THD, and the graph maths.
- `tests/ngspice-wasm.test.js` the WASM adapter.
- `npm run test:browser` also checks that the app loads offline.

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
(0, eval)(await (await fetch('tests/erc.js')).text());         await ercTests();      // rule check rules, dialog, net highlighting
(0, eval)(await (await fetch('tests/scope.js')).text());       await scopeTests();    // probes list / placement, oscilloscope window
(0, eval)(await (await fetch('tests/analysis.js')).text());    await analysisTests(); // everything added since: studies, noise, measurements, sheets, subcircuits, exports ...
```

ngspice remains the reference. Known approximations: the built-in 555 and its ngspice macro are each
within about 1 % of an ideal 555's period; gates switch with a fixed 10 ns delay (the export models the same lag); MOSFETs are level 1 (no level 2 / 3 / BSIM).

See [AUDIT.md](AUDIT.md) for the list of known shortcomings.

## Continuous integration

`.github/workflows/ci.yml` runs `npm test` (with and without the sparse solver, ngspice installed for the cross-check) and `npm run test:browser` (headless Chrome) on every push and pull request.
