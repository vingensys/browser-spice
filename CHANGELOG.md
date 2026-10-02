# Changelog

## 1.0 (current)

Editor and instruments
- Probes list and placement, a real oscilloscope (triggers, cursors, FFT, saved traces, CSV / PNG), a logic analyser, spectrum tab.
- Multi-sheet hierarchical designs, subcircuits from SPICE files as parts, design parameters, command palette, accessible dialogs.

Engine (all cross-checked against ngspice)
- Behavioural B sources, Gummel-Poon BJT, level-1 MOSFET with body effect and capacitances, JFET depletion capacitances.
- Noise (thermal, shot, flicker), `.tf`, `.measure`, sensitivity.
- Fixes found by the random-circuit test: LC damping, singular DC loops, `log` / `^` semantics, Newton robustness.

Study tools
- Parametric sweeps over several parameters, corners, Monte Carlo with yield, sensitivity ranking.

Platform
- Analyses (and ngspice) on cancellable workers; offline PWA; share-by-link; BOM, PNG, SVG, KiCad netlist, HTML report; MCP server; CI with ngspice, headless Chrome and a Pages workflow.
