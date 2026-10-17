# The PIC16F84A in Browser SPICE

Pick Devices > Microcontrollers > PIC16F84A. Double-click the chip to give it a program (assembly source, or Intel HEX) and a
clock; **Debug > Microcontroller…** (or **Debug…** in its properties) opens the debugger. SPICE export is not available for it.

## The chip
1K x 14 program words, 68 bytes of RAM (0x0C-0x4F, both banks), 64 bytes of data EEPROM, an 8-level stack, Timer0 with prescaler,
the watchdog, SLEEP, and interrupts (RB0/INT, Timer0 overflow, RB4-RB7 change, EEPROM write done). All 35 instructions with their
cycle counts (1, or 2 for a taken branch, skip, call, return, or a write to PCL). Pins: MCLR, RA0-RA4, RB0-RB7. There are no power
or oscillator pins; the clock is the part's `clock` property (one instruction every 4 / clock seconds).

- **Outputs** drive through 50 ohm. **RA4 is open-drain**: a high latch leaves it floating, so it needs a pull-up. **PORTB** inputs
  have a weak pull-up (about 20 k) when the program clears RBPU (OPTION bit 7). MCLR is pulled up inside; low holds the chip in reset.
- **Reading a port gives the pin levels**, not the latch, as on the real chip, so `bsf PORTB,0` on a loaded pin shows the classic
  read-modify-write behaviour.
- **Timer0**: counts instruction cycles (or edges on RA4/T0CKI with T0CS = 1) through the prescaler; a write to TMR0 holds it for 2 cycles.
- **Watchdog**: only when the configuration word enables it. Programs assembled without `__CONFIG` have it **off** (the real default is
  on, which resets a program that never executes CLRWDT); a HEX file's own configuration word is used. After reset the prescaler is
  1:128 (2.3 s time-out), as on the chip.
- **Interrupt latency** is 2 cycles here (the real chip takes 3 or 4); everything else follows the datasheet.

## Time and the circuit
The chip plans ahead (up to 2048 instructions with the pin levels as they are now) and reports to the circuit simulator only the times
its pins change, so a delay loop of a million instructions costs no analogue steps and output edges land exactly. An input that
crosses its threshold is detected at that instant (the simulator bisects to it), handed to the core as an interrupt edge or Timer0
count, and the plan is redone from there.

## Assembler
MPASM-style, case-insensitive. Labels (colon optional; at the start of the line or before `equ` / an instruction), `;` comments.

- **Numbers**: `10` decimal (default; `radix hex` changes it), `0x1F`, `1Fh`, `h'1F'`, `b'0101'`, `d'10'`, `.10`, `'A'`, `$` (this address); operators
  `+ - * / % << >> & | ^ ~ ( )` and `high()`, `low()`, `upper()`.
- **Directives**: `org`, `equ`, `=`, `set`, `end`, `dw`, `db`, `dt` (a table of `retlw`), `de` (EEPROM), `__config`, `cblock … endc` (variables, `name:n` for n
  registers), `res`, `#define name text`, `if / ifdef / ifndef / else / endif`, `radix`; `processor`, `list`, `include`, `errorlevel`, `title` are accepted and ignored.
- **Names**: the special registers (`PORTA`, `TRISB`, `STATUS`, `INTCON`, `OPTION_REG`, `EEADR`, …), their bits (`C`, `Z`, `RP0`, `GIE`, `T0IF`, `INTF`, `PSA`, `WREN`, …), `W` (0) and `F` (1), and the
  `_WDT_ON`-style configuration constants.
- **Pseudo-instructions**: `clrc setc clrz setz clrdc setdc skpc skpnc skpz skpnz skpdc skpndc b bc bnc bz bnz movfw tstf negf`.
- A destination left out means `F` (with a warning). Errors name the line; a program with an error does not run.

## Debugger
Program listing (the assembled source, or a disassembly of a HEX file) with the next instruction highlighted; click an address to set a
**breakpoint** (kept with the part, never restarts the run). **Step** and **Step x10** run instructions, advancing the circuit with them.
Registers, STATUS / INTCON flags, the I/O pins (blue = output), the stack, RAM and EEPROM, with changed bytes highlighted.

## Not done
Other PIC models or other families, the in-circuit programming pins, brown-out and power-up timers, a C compiler, and SPICE export.
