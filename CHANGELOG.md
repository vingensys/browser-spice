# Changelog

## 1.0 (current)

Editor and instruments
- Probes list and placement, a real oscilloscope (triggers, cursors, FFT, saved traces, CSV / PNG), a logic analyser, spectrum tab.
- Multi-sheet hierarchical designs, subcircuits from SPICE files as parts, design parameters, command palette, accessible dialogs.

Engine (all cross-checked against ngspice)
- Behavioural B sources, Gummel-Poon BJT, level-1 MOSFET with body effect and capacitances, JFET depletion capacitances.
- Noise (thermal, shot, flicker), `.tf`, `.measure`, sensitivity.
- New example: closed-loop buck converter (12 V to 5 V, IRF9540, type III compensator, input feed-forward) with saved probes; it checks the regulation and matches ngspice. ERC no longer reports a behavioural voltage source's output as having no DC path to ground.
- Fix: importing a SPICE deck whose MOSFET / BJT names a built-in library part but has no `.model` card (e.g. `IRF9540`, `BC557`) now keeps the part's polarity; it used to place an N-channel / NPN and substitute the default model (found by importing a buck converter into the app).
- Fixes found by the random-circuit test: LC damping, singular DC loops, `log` / `^` semantics, Newton robustness.

Interop and layout
- `.options` / `.nodeset`, imported high-level model cards kept verbatim (exact in ngspice, flagged as approximated in the built-in solver).
- SPICE export of combinational logic ICs and the 7474 / 74112 flip-flops; KiCad schematic (`.kicad_sch`) and netlist (`.net`) import.
- Buses (wires, entries, vector ports and sheet pins, vector pins on logic ICs).
- Touch input (pinch, pan, long press, double tap, touch toolbar).
- PCB layout: footprints (through-hole, SMD, user-defined, KiCad `.kicad_mod` import), auto-place, ratsnest, manual / automatic / push-and-shove routing, copper pours, silkscreen, mask, paste, DRC, Gerber / Excellon ZIP.

Study tools
- Parametric sweeps over several parameters, corners, Monte Carlo with yield, sensitivity ranking.

Platform
- Analyses (and ngspice) on cancellable workers; offline PWA; share-by-link; BOM, PNG, SVG, KiCad netlist, HTML report; MCP server; CI with ngspice, headless Chrome and a Pages workflow.
