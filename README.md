# Browser SPICE

Interactive schematic editor and circuit simulator that runs entirely in the browser.
No build step: serve the folder and open `index.html`.

```bash
python3 -m http.server 8137
```

## Editing (Proteus-style)

| Action | How |
| --- | --- |
| Place a part | Pick it in the library (or press its hotkey), click to drop. Placement is sticky; **R** rotates the ghost, right-click / **Esc** stops. |
| Wire | Click or drag from any pin. Move to preview the auto-route, click empty grid to pin a corner, click a pin or a wire to finish (clicking a wire makes a junction). **Backspace** removes the last corner, double-click ends in free space, **Esc** cancels. |
| Reshape a wire | Drag a segment. **T** re-routes the selected wire from scratch (nothing selected: all wires). |
| Move parts | Drag. Attached wires stretch like rubber bands and keep their shape. |
| Select | Click, **Shift**-click, or drag a box. **Ctrl+A** selects all. |
| Copy / paste | **Ctrl+C / X / V**. Wires between copied parts come along. |
| Rotate / delete | **R** / **Del**. Works on a multi-selection. |
| Zoom / pan | Scroll to zoom at the cursor, **Space**-drag or middle-drag to pan, **F** fits the view, **Ctrl+0** resets. |
| Undo / redo | **Ctrl+Z**, **Ctrl+Y** (or **Ctrl+Shift+Z**). |
| Edit a value | Double-click a part, or use the Properties panel. |

Hotkeys: **C** capacitor, **L** inductor, **V** source, **G** ground, **D** diode, **Q** NPN,
**M** NMOS, **U** op-amp, **W** wire tool, **R** resistor (when nothing is selected).

Rules the editor enforces: parts can't overlap, no pin (or its exit stub) may land on another
part, wires never pass through a body, and every wire leaves a pin straight out.

## Layout

- `js/cad/symbols.js` – pin and body tables for every symbol (all pins on the 20 px grid)
- `js/cad/router.js` – grid A* router, rubber-band wire repair, junction analysis
- `js/cad/symbol-draw.js` – symbol artwork
- `js/visualization/schematic.js` – editor: view, selection, placement, wiring, rendering
- `js/circuit/`, `js/solver/` – netlist extraction and the MNA / AC / transient solvers

Only R, C, L and V are simulated so far. Diodes, transistors, op-amps, gates and the 555 can be
placed and wired but are ignored by the solver.

## Tests

Two browser-driven suites live in `tests/`. With the app open, load one and run it from the console:

```js
(0, eval)(await (await fetch('tests/interaction.js')).text()); interactionTests();
(0, eval)(await (await fetch('tests/stress.js')).text());      stress(12345, 100);
```

`interactionTests()` drives real pointer, wheel and keyboard events and asserts behaviour.
`stress()` drags and rotates parts at random and checks wire invariants after every move.
