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
- MOSFET levels 2 / 3 and BSIM: **run by ngspice automatically** (a graph analysis switches to it for any model card above level 1; the live run keeps the level-1 stand-in and says so). Not written into the built-in engine: those equations only mean something if they match ngspice sample for sample, and without its source they cannot be proven. (`.sens` is done for resistors and source levels, checked against ngspice; sensitivity to device model parameters is not.) (`.include` / `.lib`, `.nodeset` and `.options` parsing are done.)
- Digital: more microcontrollers (a PIC16F84A with assembler and debugger is done; ROM / RAM chips too), mixed-signal timing (propagation delay on flip-flops and logic ICs is done; per-pin and rise / fall delays are not); export of the three chips with more than 8 inputs (74151, 7483, 7485) to SPICE. (Counters, shift registers, registers, latches and SCR / TRIAC already export.)
- Faster: compile the circuit to typed arrays, WebAssembly sparse LU for very large circuits.

### 2. Interchange
- KiCad (`.kicad_sch` / netlist) and other CAD import / export, SVG / PDF schematic export, `.include` from a folder, XLSX BOM with footprints and MPNs.

### 3. Capture
- Buses, off-sheet connectors with direction, probes and instruments inside sub-sheets, cross-probing across sheets, auto-annotation: all done.
- Touch-friendly drawing is done; View > Describe Sheet gives a text description for screen readers (the canvas itself is still not navigable by keyboard).

### 4. PCB layout (the "other half" of Proteus)
- **Done (MVP)**: View > PCB Layout: footprints from the netlist, board outline, auto-place, ratsnest, manual routing on two layers with vias, a grid autorouter, a design-rule check and Gerber / Excellon ZIP export.
- Also done: SMD footprints, back-side placement, silkscreen, mask and paste layers.
- Also done: push-and-shove routing (tracks and vias), user-defined footprints (editor and KiCad import) and copper pours.
- Done: whole footprint-library import (a .pretty folder, kept in the browser, searchable).
- Not done: planes, differential pairs, length tuning, 3D view, back-annotation to the schematic.

### 5. Product
- Cloud save, version history, comments, collaboration; embeddable simulator widgets; plugin API for parts and analyses.

## Decisions worth revisiting
- **Engine split.** Keep the built-in engine for the interactive loop and ngspice-WASM for
  accuracy / vendor models. If the interactive engine ever diverges from ngspice on a
  supported circuit, that is a bug: `tests/ngspice.test.js` is the guard.
- **File format.** Done: versioned JSON (`browser-spice/2`), documented in `docs/FILE-FORMAT.md`, with migrations from older files. Sharing and cloud save can build on it.
- **Build tooling.** Decided: stay with plain scripts; bundle only a heavy new dependency, lazily, when one arrives. Triggers and method in `docs/DECISIONS.md`.
