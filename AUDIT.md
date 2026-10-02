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
| No multi-sheet or hierarchical designs, no buses | P2 | Everything is one flat sheet. Net labels and power ports exist (same name = same net). |
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
| No parametric sweep, Monte Carlo, noise, Fourier, `.measure` | P2 | |
| BJT has no Gummel-Poon high-injection / resistances (ikf, rb, rc, re); MOSFET is level 1; JFET has constant capacitances | P2 | Vendor models using those parameters are approximated. |
| `.include` / `.lib` and `.subckt` libraries cannot be loaded as hierarchy; `.subckt` is flattened; no B-source expression parser | P2 | |
| SCR, TRIAC and flip-flops have no SPICE export, so ngspice cannot run designs that use them | P2 | |
| Regulators have no current limit; relay export is approximate | P3 | |
| Optocoupler / controlled sources are idealised (no frequency response) | P3 | |

## 3. Graphs and instruments
| Gap | Pri | Notes |
| --- | --- | --- |
| ~~No cursors / measurements~~ | P2 | **Done**: cursors A / B, per-trace readouts, frequency / duty / rise-fall, AC peak / −3 dB / unity gain / phase margin. Still missing: multi-axis graphs, user-defined `.measure` expressions. |
| ~~No export of graph data~~ | P2 | **Done**: CSV (all / visible / between cursors), measurements CSV, PNG. |
| ~~Oscilloscope is only a preview~~ | P2 | **Done**: a real scope window with timebase, triggers (auto / normal / single), channel scaling and coupling, XY, readouts. Still missing: scope cursors, FFT mode, saved captures. |
| No logic analyser, signal generator panel, or spectrum view | P3 | |

## 4. Interoperability
| Gap | Pri | Notes |
| --- | --- | --- |
| No KiCad, Eagle, Altium import / export; no SVG / PDF schematic export; no BOM (CSV) | P2 | Roadmap section 2. |
| File format is undocumented JSON with no migration path | P2 | `browser-spice/1`. |
| No PCB layout | P2 | The other half of Proteus (roadmap section 4). |

## 5. UI
| Gap | Pri | Notes |
| --- | --- | --- |
| Not usable on a phone-width screen; panes do not collapse | P3 | |
| Dialogs do not trap focus; limited keyboard / screen-reader support | P3 | Menus have keyboard navigation; dialogs only Esc / Enter. |
| No customisable shortcuts, no localisation | P3 | |
| No in-app help beyond the shortcuts list and About | P3 | |

## 6. Engineering
- ~~Tests are run by hand; there is no CI.~~ **Done**: GitHub Actions runs the node and the headless-Chrome suites on every push.
- The ngspice WebAssembly engine cannot be interrupted, so a malformed deck freezes the page. Invalid values are now
  refused before sending, but a pathological circuit can still hang it. (P2)
- Large circuits: the sparse solver is fast (about 2 ms per step at 1,100 unknowns), but the editor's router and
  redraw have not been profiled beyond a few hundred parts. (P3)

## Suggested order
1. ~~Autosave and an unsaved-changes prompt (P1)~~ done.
2. ~~Graph cursors, readouts and CSV export~~ done.
3. ~~Counters, shift registers and a 74xx set~~ done.
4. ~~Text annotation, title block, net highlighting~~ done.
5. ~~ERC rules~~ done; CI for the test suites is next.

- **Done**: parametric sweep and Monte Carlo analysis (Design menu, STUDY tab). Still open: sweeps run on the main thread (large runs block the page between yields), no corner analysis, no multi-parameter sweeps.
