# Audit: where Browser SPICE falls short of a Proteus-class workbench

Compiled after a hands-on pass through the running app, the test suites and the code. "Verified" means I
reproduced it; the rest comes from reading the code. Priority: **P1** blocks real use, **P2** a clear gap
against Proteus / ngspice, **P3** polish.

## 0b. Bugs found while building the graph tools (fixed)
- **Time axis was drawn by sample index** (verified): with the adaptive solver the steps are uneven, so waveforms were stretched or squeezed against the tick labels. The axis is now true time / log frequency, with min-max decimation for dense data.
- **Layout overflow**: the page grid took its width from the canvas's last size, so a narrower window pushed the right side (graph panels, scroll bars) off screen. Fixed with `minmax(0, 1fr)`.

## 0. Things that looked broken but were not the app's fault
- **Stale browser cache (P1, fixed).** `python3 -m http.server` lets browsers cache JavaScript, so after an update
  you can keep running the old shell: no context menus, no waveform glyphs, no example placement. Fixed with
  `scripts/serve.mjs` (`npm run serve`, sends `no-store`), a cache-busting loader (`js/boot.js`) and a build id in the
  status bar. If the id at the bottom right is not the latest commit, restart the server and reload.

## 1. Schematic capture
| Gap | Pri | Notes |
| --- | --- | --- |
| ~~No text annotation / title block~~ | P2 | **Done**: multi-line text notes (size, colour, bold / italic, alignment, rotation) and a title block. Still missing: lines / boxes / circles, images, hyperlinks. |
| ~~No multi-sheet or hierarchical designs~~ | P2 | **Done**: sheets, hierarchical ports and sheet symbols, flattened netlist (see README). Per-instance parameters, rule check across sheets and probes inside sub-sheets (cross-probing) are done. Buses (bus wires, entries, bus ports through sheet symbols) are done. Instruments and part animations on sub-sheets are done (first use of a sheet only). |
| ~~No autosave / unsaved-changes warning~~ | P1 | **Done**: autosave to browser storage with restore, dirty tracking, Save / Don't Save / Cancel prompts. Remaining: autosave is per browser profile (no cloud), and two tabs on the same address overwrite each other's copy. |
| ~~No net highlighting~~ | P2 | **Done** (H / right-click). Still missing: net names drawn on the wires and cross-probing with graphs. |
| Grid and snap size are fixed (20 px = 0.1 in) | P3 | |
| ~~ERC is basic~~ | P2 | **Done**: 15 rules (see README), results list with go-to, marks on the sheet, F4 next issue, and fatal ones stop the simulator with a clear message. Still missing: bus / net-class rules, voltage-level mismatches between logic families, polarised-capacitor checks. |
| Auto-router can still make long detours around ICs when pins are on the far side | P3 | Example layouts were tidied by hand. |
| No component search by keyboard on the sheet, no recent-designs list | P3 | |

## 2. Simulation
| Gap | Pri | Notes |
| --- | --- | --- |
| ~~No counters / shift registers / 74xx~~ | P2 | **Done**: 37 logic ICs as event-driven state machines. Propagation delay and memories are done (see below). Still missing: 74181 ALU, monostables, a general bidirectional bus buffer (74245; a RAM has its own bidirectional data bus) and a microcontroller. |
| Logic ICs cannot be exported to SPICE | P3 | They run in the built-in engine only. |
| ~~No parametric sweep, Monte Carlo, noise, Fourier~~ | P2 | **Done** (see README). `.measure`, `.tf`, flicker noise and a finite-difference sensitivity ranking are done too. |
| Power supply example (transformer + bridge) differed from ngspice by ~30 % rms on the secondary nodes | P3 | **Investigated, two causes, neither an engine error.** (1) *Trapezoidal ringing in ngspice*: while the bridge is off, the secondary nodes are held only by diode leakage and ngspice's trapezoidal rule rings there at a coarse step (±3 V, aliased); the ring vanishes at a 0.5 µs step and with `.options method=gear` the two engines agree to 0.5 % rms. The built-in engine never rings (it damps after every break). (2) *Floating common-mode level*: the secondary's level while no diode conducts is not determined: any value from 0.3 V to 1.2 V leaves every current below abstol (1 pA), so the engines settle at different levels (0.33 V against ngspice's 0.75 V at the operating point); that is why the operating point of floating nodes is not compared. Found on the way and fixed: a diode with no junction capacitance (CJO = 0, TT = 0) made Newton cycle on that flat node ("time step too small" at 46 µs); every such diode now carries a femtofarad. (3) *The 1 MΩ-bleed variant*: with the secondary tied to ground through 1 MΩ the operating points agree exactly (1e-7 %), and the transient differs by ~3 % rms over the whole run (13.9 % with ngspice's trapezoidal rule, which is cause 1) but by 0.03 % once past 8 ms: every bit of it is the first diode commutation at ~7 ms, where the bridge chatters on its 4.3 µs reverse recovery and the two engines hop between conduction pairs with a different phase (the edge crossings elsewhere coincide to 0.0 µs). `compare_with_ngspice` takes `after` to ignore such a start-up window. It also now tells an undetermined floating level from a real disagreement: when the operating points differ it pins ngspice's levels on the nodes in question, solves everything else, and reports the current that takes (1.4 pA for the supply, so both are valid; milliamps for a wrong level on a divider). Verified in `tests/engines.js` (Gear, 0.47 % rms, tolerance 2 %), `tests/capability/app-export-roundtrip.mjs` and `tests/sim.test.js`. |
| AC frequency grid differed from SPICE's (an even spread from fStart to fStop instead of points-per-decade steps), which made decks with non-integer decade counts look wrong against ngspice at the high end | P3 | **Fixed**: the grid is now exactly pointsPerDecade per decade from fStart, as ngspice reports it; at identical frequencies the two engines agree to 1e-4 dB. |
| ~~BJT has no Gummel-Poon~~ | P2 | **Done**: full Gummel-Poon (VAR, IKF, IKR, ISE/NE, ISC/NC, RB, RC, RE, base-charge-scaled transit time with transcapacitance), checked against ngspice in a reference deck and in the random-circuit test. MOSFET level 1 is now complete (body node, body effect, junction / overlap / Meyer capacitances). Still open: JFET gates now have depletion capacitances; `RBM`/`IRB` base-resistance crowding and `XTF`/`VTF`/`ITF` transit-time bias dependence (with the B-E transcapacitance) are in and match ngspice on two reference decks; excess phase (`PTF`, Weil's approximation as ngspice applies it: AC rotation of the transport transconductance and the recursive filter in transient) is in and matches ngspice on a deck (AC 0.000 %, transient 0.23 %); higher-level cards run in ngspice. |
| `.include` / `.lib` and `.subckt` libraries cannot be loaded as hierarchy; `.subckt` is flattened | P2 | **`.include` / `.lib` done**: select the deck and the files it includes together in File > Import SPICE (the file nobody includes is the deck); `.lib file SECTION` takes just that section; a missing file is named in the import notes; nested and circular includes are handled; the MCP tools take `files`. Still flat: **Partly done**: a `.subckt` in an imported file becomes a part (see README); a schematic is still one flat sheet, and `.include` files cannot be fetched from a path. |
| ~~SCR, TRIAC and flip-flops have no SPICE export~~ | P2 | **Done**: SCR / TRIAC export as latch macromodels (3 % from the built-in on the lamp example) and flip-flops as master-slave macromodels (identical waveforms on the ripple counter). Logic ICs (`DIGITAL`) export too: combinational chips (gate packages, 7447, 74138/39, 74153/57, …) as truth-table B-sources and the 7474 / 74112 flip-flops via the master-slave macromodel, all checked against ngspice. **Clocked chips export too** (`js/circuit/logic-export.js`): the counters (7493, 7490, 74160-74163, 74193, 74393, 4017, 4040), shift registers (74164, 74165, 74194, 74595), registers and latches (74175, 74273, 74373, 74374) and the three-state buffer 74244, each state bit a master-slave cell of behavioural sources with the chip's next-state logic, three-state pins as enabled current drives. `tests/logic.seq.ngspice.test.js` runs every one of them in ngspice against the built-in chip (random controls, async clear / load / set, two clocks) at two time scales and they agree sample for sample; the counter and shift-register examples now match ngspice edge for edge. Limits: the bit cells take about 0.3 us to settle, so clock pulses (high and low) should be wider than that; ngspice runs these decks with `reltol=1e-4`; propagation delay (`tpd`) is not exported. Functions of more than 8 inputs (74151, 7483, 7485) are still reported as not exported. |
| Regulators have no current limit; relay export is approximate | P3 | |
| Optocoupler / controlled sources are idealised (no frequency response) | P3 | |

Propagation delay (`tpd` property on flip-flops and logic ICs, seconds, 0 = ideal): the chip's state changes at the clock edge but its outputs follow `tpd` later; the transient lands exactly on the due time and starts the next step small, so the edge is sharp. The delay is inertial: a change undone before it appears (a glitch shorter than `tpd`, a reset arriving in time) never reaches the pins. Analogue gates already had one. Not exported to SPICE (the macromodels are ideal), and no separate rise / fall or per-pin delays yet.

Memories (`Memory` category in Pick Devices): EPROMs 27C16 / 27C64 / 27C256 (2K / 8K / 32K x 8), a 74188 PROM (32 x 8), static RAMs 6116 / 6264 / 62256 (2K / 8K / 32K x 8, one bidirectional data bus D0-D7) and the 7489 (16 x 4 RAM with complemented outputs). The contents of a ROM (or a RAM's initial contents) are a property of the part: hex bytes or Intel HEX typed in, or loaded from a .hex / .bin / .txt file, saved with the design. A RAM write completes when WE rises while the chip is selected (or when CS rises with WE low), with the address and data from just before the edge; outputs float unless the chip is selected with OE active (and WE high for a RAM). **Debug > Memory…** is a live hex view (changed bytes highlighted, Export .hex). The example "ROM waveform generator" runs a 74161 into an EPROM holding a sine table and an R-2R ladder. Not done: SPICE export of memories, EEPROM / flash write cycles, access-time timing beyond the chip's `tpd`.

## 3. Graphs and instruments
| Gap | Pri | Notes |
| --- | --- | --- |
| ~~No cursors / measurements~~ | P2 | **Done**: cursors A / B, per-trace readouts, frequency / duty / rise-fall, AC peak / −3 dB / unity gain / phase margin. Still missing: multi-axis graphs, user-defined `.measure` expressions. |
| ~~No export of graph data~~ | P2 | **Done**: CSV (all / visible / between cursors), measurements CSV, PNG. |
| ~~Oscilloscope is only a preview~~ | P2 | **Done**: a real scope window with timebase, triggers (auto / normal / single), channel scaling and coupling, XY, readouts. Also done: cursors, FFT mode, saved reference traces, CSV/PNG export. |
| ~~No logic analyser or spectrum view~~ | P3 | **Done** (logic analyser part and window; spectrum tab and scope FFT). Signal generator panel still missing. |

## 4. Interoperability
| Gap | Pri | Notes |
| --- | --- | --- |
| No KiCad, Eagle, Altium import / export; no PDF schematic export, KiCad schematic (`.kicad_sch`) and netlist (`.net`) import is done for simulatable parts (R C L D Q M V I, power symbols, labels); Eagle / Altium import is not (BOM CSV, PNG, SVG, KiCad netlist and an HTML report that prints to PDF are done) | P2 | Roadmap section 2. |
| ~~File format is undocumented JSON with no migration path~~ | P2 | **Done**: `browser-spice/2`, documented in `docs/FILE-FORMAT.md`; `DesignFormat` (js/ui/format.js) migrates v0 / v1 files, refuses newer ones and validates structure; fixtures and `tests/format.test.js`. |
| ~~No PCB layout~~ | P2 | **MVP done**: View > PCB Layout. Footprints (through-hole axial / radial / TO-92 / TO-220 / DIP / headers and SMD 0603 / 0805 / 1206 / SOD-123 / SOT-23 / SOIC, with package pin order, back-side placement) from the netlist, auto-place, ratsnest, manual and automatic routing on F.Cu / B.Cu with vias, DRC (clearance, shorts, edge, width, unrouted), Gerber RS-274X (copper, silkscreen, mask, paste, edge) + Excellon in a ZIP. User footprints (text editor, KiCad `.kicad_mod` import) and copper pours (0.1 mm grid fill, thermal relief, island removal, Gerber regions) are in. Push-and-shove routing (tracks and vias of other nets pushed aside, cascading, validated by the rule check, invariants fuzzed) is in. Dragging a track vertex shoves too. Walk-around routing (A*, 0/45/90°) is in as a route mode. The PCB is also available to assistants through seven MCP tools. Missing: shoving while moving a part, 45° shoved geometry, 3D, back-annotation. Gerbers were read back with two independent parsers (gerbonara in Python, tracespace in JavaScript) and match the board exactly, and a fab-rule check (typical prototype-service limits: track, drill, annular ring, hole spacing, mask webs, board size) runs on the design; not tried in a commercial CAM package or sent to a fab. |

## 5. UI
| Gap | Pri | Notes |
| --- | --- | --- |
| ~~Not usable on a phone-width screen~~ | P3 | **Improved**: View > Sidebar hides the left pane (it starts hidden below 760 px), the toolbar scrolls and dialogs fit. Touch drawing: pinch zoom, one-finger pan, long-press menu, double-tap, larger pin hit targets and a floating touch toolbar (View > Touch Toolbar, automatic on coarse pointers). |
| ~~Dialogs do not trap focus~~ | P3 | **Done**: dialogs have a role and label, trap Tab and return focus; icon buttons get names. The schematic canvas itself is not screen-reader accessible. |
| No customisable shortcuts, no localisation | P3 | |
| ~~No in-app help~~ | P3 | **Done**: Help > Getting Started, the command palette (Ctrl+K). |

## 6. Engineering
- ~~Tests are run by hand; there is no CI.~~ **Done**: GitHub Actions runs the node and the headless-Chrome suites on every push.
- ~~The ngspice WebAssembly engine cannot be interrupted.~~ **Done**: it runs in a module worker; Cancel (or Esc) terminates it and the next run starts a fresh one. (When the page is not served over http(s) it falls back to the main thread.)
- Large circuits: the sparse solver is fast (about 2 ms per step at 1,100 unknowns). The editor was profiled with `npm run perf` (RC ladders of 300 to 9,000 parts): opening a deck with 900 parts took 35 s and a redraw 64 ms because every part added re-routed every wire, every wire rebuilt the whole routing picture, and junction detection compared every wire with every other. Fixed (import 0.8 s, redraw 20 ms at 2,700 parts, linear). Left: netlist extraction grows faster than linearly (0.3 s at 2,700 parts, 2.6 s at 5,400), and the router's per-wire search still scans all parts. (P3)

## Suggested order
1. ~~Autosave and an unsaved-changes prompt (P1)~~ done.
2. ~~Graph cursors, readouts and CSV export~~ done.
3. ~~Counters, shift registers and a 74xx set~~ done.
4. ~~Text annotation, title block, net highlighting~~ done.
5. ~~ERC rules~~ done; CI for the test suites is next.

- **Done**: parametric sweep and Monte Carlo analysis (Design menu, STUDY tab). Analyses now run on a Web Worker with progress and cancel. Multi-parameter grids (up to three parameters) and corner analysis are done.
