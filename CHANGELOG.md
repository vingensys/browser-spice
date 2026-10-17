# Changelog

## 1.0 (current)

Capture and export
- KiCad schematic export (.kicad_sch, KiCad 7), BOM with manufacturer part number / maker / footprint and an Excel (.xlsx) download. Importing a KiCad file now keeps library LEDs and zeners as LEDs and zeners.
- Off-sheet connectors (same name = same net across all sheets, with a direction and a rule check), Design > Auto-Annotate, and PDF export of the schematic (vector, selectable text, A4 / Letter).

Parts
- A MOSFET (or BJT / diode) card above level 1 (MOS level 2, 3, BSIM...) makes a graph analysis run in ngspice automatically, with a note; the live run says it only approximates the model.
- Voltage regulators now current-limit at their rated current (a short gives ilim, an overload follows the load line), also in the SPICE export.
- Controlled sources (E, G) and the optocoupler have an optional bandwidth (one-pole filter), in both engines and in the export; the relay export follows |coil current|.

Microcontroller
- PIC16F84A: the whole instruction set, Timer0, interrupts, SLEEP, watchdog, EEPROM and the ports, simulated together with the circuit; an MPASM-style assembler and Intel HEX loader in the app; a debugger (Debug > Microcontroller…) with step, breakpoints, registers, pins, RAM and EEPROM. Examples: LED chaser, Timer0 interrupt blinker. See docs/PIC.md.

Memories
- ROM / EPROM (27C16, 27C64, 27C256, 74188) and RAM (6116, 6264, 62256 with a bidirectional data bus, 7489) chips; contents from hex text, Intel HEX or a loaded file, saved with the design; live hex view with Export .hex (Debug > Memory…). New example: ROM waveform generator.

Scope usability
- The scope window can be resized by its corner grip (the screen follows; the size is saved with the design) and popped out into its own browser window.
- Shift + wheel zooms the selected channel's amplitude, shift-drag moves it; click a trace or a channel row to select. All volts/div and all amps/div controls, and a link switch, put channels of a kind on a common scale.

Logic export
- Counters (7493, 7490, 74160-74163, 74193, 74393, 4017, 4040), shift registers (74164, 74165, 74194, 74595), registers and latches (74175, 74273, 74373, 74374) and the 74244 buffer now export to SPICE, checked against the built-in chips in ngspice. The counter and shift-register examples are compared with ngspice in the test suite (they were skipped before).

Oscilloscope and probes
- The scope has eight input channels (A-D pins, E-H assigned probes) and a math trace (A-B, A+B, AxB, A/B, integral, derivative); channels carry volts or amps and the scope labels and scales them accordingly.
- Current Clamp instrument: clamps on a part, wire its output to a scope channel; also any probe can be assigned to a channel.
- Probe oscilloscope: Graph > Probe Oscilloscope (or Scope on the graph toolbar) pops the probes out as a scope.
- Pause the simulation from the scope, change time/div and volts/div while held, and scroll back through the history (drag, wheel, scroll bar); History setting.
- Debug > Pause Conditions (probe above / below a value) and the scope's Pause sim on trigger; live voltage / current tip under the pointer while a run exists.
- New example: current clamp on the oscilloscope.

Foundations
- Design files are versioned (`browser-spice/2`) and documented (`docs/FILE-FORMAT.md`); older files are upgraded on open and files from a newer app are refused with a message.
- Large designs: opening a 900-part deck went from 35 s to under 1 s, and a 2,700-part redraw from 310 ms to 20 ms (`npm run perf`). Causes: a re-route of every wire for every part added, a full routing-context rebuild per wire, and a pairwise junction search.

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
