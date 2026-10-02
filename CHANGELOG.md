# Changelog

## 1.0 (current)

Editor and instruments
- Probes list and placement, a real oscilloscope (triggers, cursors, FFT, saved traces, CSV / PNG), a logic analyser, spectrum tab.
- Multi-sheet hierarchical designs, subcircuits from SPICE files as parts, design parameters, command palette, accessible dialogs.

Engine (all cross-checked against ngspice)
- Behavioural B sources, Gummel-Poon BJT, level-1 MOSFET with body effect and capacitances, JFET depletion capacitances.
- Noise (thermal, shot, flicker), `.tf`, `.measure`, sensitivity.
- Fixes found by the random-circuit test: LC damping, singular DC loops, `log` / `^` semantics, Newton robustness.

Interop and layout
- `.options` / `.nodeset`, imported high-level model cards kept verbatim (exact in ngspice, flagged as approximated in the built-in solver).
- SPICE export of combinational logic ICs and the 7474 / 74112 flip-flops; KiCad schematic (`.kicad_sch`) and netlist (`.net`) import.
- Buses (wires, entries, vector ports and sheet pins, vector pins on logic ICs).
- Touch input (pinch, pan, long press, double tap, touch toolbar).
- PCB layout MVP: footprints, auto-place, ratsnest, manual and automatic routing, DRC, Gerber / Excellon ZIP.

Study tools
- Parametric sweeps over several parameters, corners, Monte Carlo with yield, sensitivity ranking.

Platform
- Analyses (and ngspice) on cancellable workers; offline PWA; share-by-link; BOM, PNG, SVG, KiCad netlist, HTML report; MCP server; CI with ngspice, headless Chrome and a Pages workflow.
