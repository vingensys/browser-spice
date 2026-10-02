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
| ~~No multi-sheet or hierarchical designs~~ | P2 | **Done**: sheets, hierarchical ports and sheet symbols, flattened netlist (see README). Per-instance parameters, rule check across sheets and probes inside sub-sheets (cross-probing) are done. Still missing: buses, instruments inside sub-sheets, part animations on sub-sheets. |
| ~~No autosave / unsaved-changes warning~~ | P1 | **Done**: autosave to browser storage with restore, dirty tracking, Save / Don't Save / Cancel prompts. Remaining: autosave is per browser profile (no cloud), and two tabs on the same address overwrite each other's copy. |
| ~~No net highlighting~~ | P2 | **Done** (H / right-click). Still missing: net names drawn on the wires and cross-probing with graphs. |
| Grid and snap size are fixed (20 px = 0.1 in) | P3 | |
| ~~ERC is basic~~ | P2 | **Done**: 15 rules (see README), results list with go-to, marks on the sheet, F4 next issue, and fatal ones stop the simulator with a clear message. Still missing: bus / net-class rules, voltage-level mismatches between logic families, polarised-capacitor checks. |
| Auto-router can still make long detours around ICs when pins are on the far side | P3 | Example layouts were tidied by hand. |
| No component search by keyboard on the sheet, no recent-designs list | P3 | |

## 2. Simulation
| Gap | Pri | Notes |
| --- | --- | --- |
| ~~No counters / shift registers / 74xx~~ | P2 | **Done**: 37 logic ICs as event-driven state machines. Still missing: memories (RAM/ROM), 74181 ALU, monostables, bidirectional buses (74245), propagation delays, and a microcontroller. |
| Logic ICs cannot be exported to SPICE | P3 | They run in the built-in engine only. |
| ~~No parametric sweep, Monte Carlo, noise, Fourier~~ | P2 | **Done** (see README). `.measure`, `.tf`, flicker noise and a finite-difference sensitivity ranking are done too. |
| ~~BJT has no Gummel-Poon~~ | P2 | **Done**: full Gummel-Poon (VAR, IKF, IKR, ISE/NE, ISC/NC, RB, RC, RE, base-charge-scaled transit time with transcapacitance), checked against ngspice in a reference deck and in the random-circuit test. MOSFET level 1 is now complete (body node, body effect, junction / overlap / Meyer capacitances). Still open: JFET gates now have depletion capacitances; no `IRB`/`XTF` effects, no level 2/3/BSIM. |
| `.include` / `.lib` and `.subckt` libraries cannot be loaded as hierarchy; `.subckt` is flattened | P2 | **Partly done**: a `.subckt` in an imported file becomes a part (see README); a schematic is still one flat sheet, and `.include` files cannot be fetched from a path. |
| ~~SCR, TRIAC and flip-flops have no SPICE export~~ | P2 | **Done**: SCR / TRIAC export as latch macromodels (3 % from the built-in on the lamp example) and flip-flops as master-slave macromodels (identical waveforms on the ripple counter). The 37 logic ICs (`DIGITAL`) still have no export. |
| Regulators have no current limit; relay export is approximate | P3 | |
| Optocoupler / controlled sources are idealised (no frequency response) | P3 | |

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
| No KiCad, Eagle, Altium import / export; no PDF schematic export, no KiCad / Eagle / Altium schematic import (BOM CSV, PNG, SVG, KiCad netlist and an HTML report that prints to PDF are done) | P2 | Roadmap section 2. |
| File format is undocumented JSON with no migration path | P2 | `browser-spice/1`. |
| No PCB layout | P2 | The other half of Proteus (roadmap section 4). |

## 5. UI
| Gap | Pri | Notes |
| --- | --- | --- |
| ~~Not usable on a phone-width screen~~ | P3 | **Improved**: View > Sidebar hides the left pane (it starts hidden below 760 px), the toolbar scrolls and dialogs fit. Touch drawing is still mouse-oriented. |
| ~~Dialogs do not trap focus~~ | P3 | **Done**: dialogs have a role and label, trap Tab and return focus; icon buttons get names. The schematic canvas itself is not screen-reader accessible. |
| No customisable shortcuts, no localisation | P3 | |
| ~~No in-app help~~ | P3 | **Done**: Help > Getting Started, the command palette (Ctrl+K). |

## 6. Engineering
- ~~Tests are run by hand; there is no CI.~~ **Done**: GitHub Actions runs the node and the headless-Chrome suites on every push.
- ~~The ngspice WebAssembly engine cannot be interrupted.~~ **Done**: it runs in a module worker; Cancel (or Esc) terminates it and the next run starts a fresh one. (When the page is not served over http(s) it falls back to the main thread.)
- Large circuits: the sparse solver is fast (about 2 ms per step at 1,100 unknowns), but the editor's router and
  redraw have not been profiled beyond a few hundred parts. (P3)

## Suggested order
1. ~~Autosave and an unsaved-changes prompt (P1)~~ done.
2. ~~Graph cursors, readouts and CSV export~~ done.
3. ~~Counters, shift registers and a 74xx set~~ done.
4. ~~Text annotation, title block, net highlighting~~ done.
5. ~~ERC rules~~ done; CI for the test suites is next.

- **Done**: parametric sweep and Monte Carlo analysis (Design menu, STUDY tab). Analyses now run on a Web Worker with progress and cancel. Multi-parameter grids (up to three parameters) and corner analysis are done.
