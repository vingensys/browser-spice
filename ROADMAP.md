# Roadmap: a Proteus-class circuit workbench in the browser

**Goal.** The Proteus experience (draw a circuit, press play, probe it, build the PCB) with
no install, plus open interchange with the tools engineers already use: SPICE, KiCad, CSV
BOMs, Gerber. Everything runs client-side; a file is a link.

**Principles**
- Interactive first: the built-in engine answers instantly; ngspice is one click away for a
  second opinion or vendor models.
- One source of truth per concept: schematic -> neutral element list -> simulate / export.
- Prove it: every claim is backed by a test against a reference (ngspice) or a closed form.

## Where we are

| Area | State |
| --- | --- |
| Schematic editor | Proteus-style wiring, probes, instruments, text and title block, net highlight, 15 rule-check rules (all sheets), multi-sheet hierarchy with ports and sheet symbols (per-use parameters), subcircuits from SPICE files, design parameters, command palette |
| Simulation | Built-in engine: OP, DC sweep, transient (adaptive, event-exact), AC, noise (thermal, shot, flicker), `.tf`, Fourier; Gummel-Poon BJT, level-1 MOSFET with body and capacitances, JFET, behavioural B sources, 37 logic ICs; analyses on cancellable Web Workers |
| Accuracy | Reference decks, 2,500+ random circuits, noise / `.tf` / `.meas` all checked against ngspice in CI |
| Study tools | Parametric sweeps (grid and corners), Monte Carlo with yield, sensitivity ranking, named measurements (`.meas`) |
| Instruments | Oscilloscope (triggers, cursors, FFT, saved traces), logic analyser, spectrum tab, graph cursors, CSV / PNG export |
| Interop | SPICE import / export (models, subcircuits, `.meas`, `.param`), BOM CSV, schematic PNG, HTML report, share-by-link, ngspice-WASM backend in a worker, MCP server for AI assistants |
| Product | Installable offline app, GitHub Pages workflow, autosave, accessible dialogs |

## Next, in order

### 1. Simulation depth
- MOSFET levels 2 / 3 and BSIM, `IRB` / `XTF` BJT effects, `.sens` on the engine, `.nodeset`, `.options` parsing.
- Digital: memories, microcontroller model, mixed-signal timing, propagation-delay options; export of logic ICs / SCR to SPICE.
- Faster: compile the circuit to typed arrays, WebAssembly sparse LU for very large circuits.

### 2. Interchange
- KiCad (`.kicad_sch` / netlist) and other CAD import / export, SVG / PDF schematic export, `.include` from a folder, XLSX BOM with footprints and MPNs.

### 3. Capture
- Buses, off-sheet connectors with direction, probes and instruments inside sub-sheets, cross-probing across sheets, auto-annotation.
- Touch-friendly drawing; screen-reader description of the sheet.

### 4. PCB layout (the "other half" of Proteus)
- Footprints, board outline, layers, placement from the schematic, interactive router, Gerber / drill export.

### 5. Product
- Cloud save, version history, comments, collaboration; embeddable simulator widgets; plugin API for parts and analyses.

## Decisions worth revisiting
- **Engine split.** Keep the built-in engine for the interactive loop and ngspice-WASM for
  accuracy / vendor models. If the interactive engine ever diverges from ngspice on a
  supported circuit, that is a bug: `tests/ngspice.test.js` is the guard.
- **File format.** Today: JSON (`browser-spice/1`, now with sheets, parameters, measurements and embedded subcircuits). Needs a documented, versioned schema and
  migration before sharing becomes a feature.
- **Build tooling.** Plain scripts keep it hackable. A bundler becomes worth it once there
  are many modules / third-party libs (KiCad parsers, PDF export).
