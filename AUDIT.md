# Audit: where Browser SPICE falls short of a Proteus-class workbench

Compiled after a hands-on pass through the running app, the test suites and the code. "Verified" means I
reproduced it; the rest comes from reading the code. Priority: **P1** blocks real use, **P2** a clear gap
against Proteus / ngspice, **P3** polish.

## 0. Things that looked broken but were not the app's fault
- **Stale browser cache (P1, fixed).** `python3 -m http.server` lets browsers cache JavaScript, so after an update
  you can keep running the old shell: no context menus, no waveform glyphs, no example placement. Fixed with
  `scripts/serve.mjs` (`npm run serve`, sends `no-store`), a cache-busting loader (`js/boot.js`) and a build id in the
  status bar. If the id at the bottom right is not the latest commit, restart the server and reload.

## 1. Schematic capture
| Gap | Pri | Notes |
| --- | --- | --- |
| No text / graphic annotation, title block, notes | P2 | Cannot document a design on the sheet. |
| No multi-sheet or hierarchical designs, no buses | P2 | Everything is one flat sheet. Net labels and power ports exist (same name = same net). |
| No autosave and no unsaved-changes warning (verified) | P1 | Closing the tab loses the design. Only manual Save to a JSON file. New Design is undoable but there is no prompt. |
| No wire / net labels shown on wires, no net highlighting or cross-probing | P2 | |
| Grid and snap size are fixed (20 px = 0.1 in) | P3 | |
| ERC is basic (unconnected pins, no ground) | P2 | No shorted outputs, floating nets, duplicate names, missing supplies. |
| Auto-router can still make long detours around ICs when pins are on the far side | P3 | Example layouts were tidied by hand. |
| No component search by keyboard on the sheet, no recent-designs list | P3 | |

## 2. Simulation
| Gap | Pri | Notes |
| --- | --- | --- |
| No event-driven digital: only gates and edge-triggered flip-flops. No counters, shift registers, 74xx library, memories, microcontroller | P2 | Proteus's main draw. |
| No parametric sweep, Monte Carlo, noise, Fourier, `.measure` | P2 | |
| BJT has no Gummel-Poon high-injection / resistances (ikf, rb, rc, re); MOSFET is level 1; JFET has constant capacitances | P2 | Vendor models using those parameters are approximated. |
| `.include` / `.lib` and `.subckt` libraries cannot be loaded as hierarchy; `.subckt` is flattened; no B-source expression parser | P2 | |
| SCR, TRIAC and flip-flops have no SPICE export, so ngspice cannot run designs that use them | P2 | |
| Regulators have no current limit; relay export is approximate | P3 | |
| Optocoupler / controlled sources are idealised (no frequency response) | P3 | |

## 3. Graphs and instruments
| Gap | Pri | Notes |
| --- | --- | --- |
| No measurement cursors, peak / rise-time readouts, or multi-axis graphs (verified: no cursor code) | P2 | Hover shows values only. |
| No export of graph data (CSV) or image | P2 | |
| Oscilloscope is a trace preview on the sheet, not an interactive instrument (no time/div, trigger, channels volts/div) | P2 | |
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
- Tests are run by hand; there is no CI. (P2)
- The ngspice WebAssembly engine cannot be interrupted, so a malformed deck freezes the page. Invalid values are now
  refused before sending, but a pathological circuit can still hang it. (P2)
- Large circuits: the sparse solver is fast (about 2 ms per step at 1,100 unknowns), but the editor's router and
  redraw have not been profiled beyond a few hundred parts. (P3)

## Suggested order
1. Autosave and an unsaved-changes prompt (P1).
2. Graph cursors, `.measure`-style readouts and CSV export (P2, small, high value).
3. Counters, shift registers and a 74xx set built on the flip-flop (P2).
4. Text annotation, title block and net highlighting (P2).
5. ERC rules, then CI for the test suites.
