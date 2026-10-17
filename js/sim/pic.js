// A PIC16F84A: the CPU core (all 35 instructions, Timer0, interrupts, SLEEP, watchdog, data EEPROM, I/O ports), an assembler
// for it (MPASM-style source), a disassembler and an Intel HEX reader. No DOM and no analogue side: PicMcu (devices-extra.js)
// connects the core to the simulator's pins. The core counts instruction cycles and wall-clock time; the device decides how
// long a cycle is (4 / fosc).
//
//   const prog = PicAsm.assemble(text);          // { words, errors, listing, symbols, config }
//   const cpu = new PicCore(); cpu.load(prog.words, prog.config);
//   cpu.pins.b = 0x01;                           // levels the outside world puts on the pins (read by PORTA / PORTB)
//   const cycles = cpu.step();                   // run one instruction (or take an interrupt); returns the cycles it took
//   cpu.driven()                                 // what the chip drives on its pins right now

// ---------------------------------------------------------------------------------------------------- opcode table
const PIC_OPS = {
    // byte-oriented: opcode | d << 7 | f
    ADDWF: 0x0700, ANDWF: 0x0500, COMF: 0x0900, DECF: 0x0300, DECFSZ: 0x0B00, INCF: 0x0A00, INCFSZ: 0x0F00, IORWF: 0x0400,
    MOVF: 0x0800, RLF: 0x0D00, RRF: 0x0C00, SUBWF: 0x0200, SWAPF: 0x0E00, XORWF: 0x0600
};
const PIC_SFR = { INDF: 0x00, TMR0: 0x01, PCL: 0x02, STATUS: 0x03, FSR: 0x04, PORTA: 0x05, PORTB: 0x06, EEDATA: 0x08, EEADR: 0x09, PCLATH: 0x0A, INTCON: 0x0B,
    OPTION_REG: 0x81, OPTION: 0x81, TRISA: 0x85, TRISB: 0x86, EECON1: 0x88, EECON2: 0x89 };
const PIC_BITS = { C: 0, DC: 1, Z: 2, PD: 3, TO: 4, RP0: 5, RP1: 6, IRP: 7,
    RBIF: 0, INTF: 1, T0IF: 2, RBIE: 3, INTE: 4, T0IE: 5, EEIE: 6, GIE: 7,
    PS0: 0, PS1: 1, PS2: 2, PSA: 3, T0SE: 4, T0CS: 5, INTEDG: 6, NOT_RBPU: 7, RBPU: 7,
    RD: 0, WR: 1, WREN: 2, WRERR: 3, EEIF: 4 };

// ---------------------------------------------------------------------------------------------------- Intel HEX
class PicHex {
    // Intel HEX text -> { words (14-bit, by word address), config, eeprom, errors }. Byte addresses are twice the word address.
    static parse(text, size = 1024) {
        const words = new Uint16Array(size).fill(0x3FFF), eeprom = new Uint8Array(64), errors = [];
        let config = 0x3FFF, base = 0, any = false, hasConfig = false;
        String(text || "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
            const l = raw.trim();
            if (!l) return;
            if (l[0] !== ":" || l.length < 11) { errors.push(`line ${i + 1}: not an Intel HEX record`); return; }
            const n = parseInt(l.slice(1, 3), 16), addr = parseInt(l.slice(3, 7), 16), type = parseInt(l.slice(7, 9), 16);
            let sum = 0; for (let k = 1; k + 1 < l.length; k += 2) sum += parseInt(l.slice(k, k + 2), 16);
            if ((sum & 255) !== 0) { errors.push(`line ${i + 1}: bad checksum`); return; }
            if (type === 0) {
                for (let k = 0; k < n; k++) {
                    const byteAddr = base + addr + k, v = parseInt(l.slice(9 + 2 * k, 11 + 2 * k), 16);
                    if (byteAddr >= 0x4200 && byteAddr < 0x4280) { eeprom[(byteAddr - 0x4200) >> 1] = v; continue; }       // data EEPROM lives at word 0x2100
                    const w = byteAddr >> 1;
                    if (w === 0x2007) { hasConfig = true; config = (byteAddr & 1) ? ((config & 0x00FF) | (v << 8)) : ((config & 0x3F00) | v); continue; }
                    if (w < size) words[w] = (byteAddr & 1) ? ((words[w] & 0x00FF) | (v << 8)) & 0x3FFF : (words[w] & 0x3F00) | v;
                    any = true;
                }
            } else if (type === 4) base = parseInt(l.slice(9, 13), 16) * 65536;
            else if (type === 2) base = parseInt(l.slice(9, 13), 16) * 16;
            else if (type === 1) return;
        });
        if (!any && !errors.length) errors.push("the file holds no program words");
        return { words, config: hasConfig ? config & 0x3FFF : 0x3FFB, hasConfig, eeprom, errors };
    }

    // program words (+ config) -> Intel HEX text
    static format(words, config = 0x3FFF) {
        const lines = [], hex2 = (v) => (v & 255).toString(16).toUpperCase().padStart(2, "0");
        const rec = (addr, type, data) => { const b = [data.length, (addr >> 8) & 255, addr & 255, type, ...data]; lines.push(":" + b.map(hex2).join("") + hex2((256 - (b.reduce((a, c) => a + c, 0) & 255)) & 255)); };
        let last = words.length - 1; while (last > 0 && words[last] === 0x3FFF) last--;
        for (let w = 0; w <= last; w += 8) {
            const data = []; for (let k = w; k < Math.min(w + 8, last + 1); k++) data.push(words[k] & 255, words[k] >> 8);
            rec(w * 2, 0, data);
        }
        rec(0, 4, [0, 0]); lines.splice(lines.length - 1, 1);              // (no extended address needed below 64 K bytes)
        rec(0x400E, 0, [config & 255, config >> 8]);
        rec(0, 1, []);
        return lines.join("\n") + "\n";
    }
}

// ---------------------------------------------------------------------------------------------------- the CPU core
class PicCore {
    static PROG_WORDS = 1024;

    constructor() {
        this.prog = new Uint16Array(PicCore.PROG_WORDS).fill(0x3FFF);
        this.config = 0x3FFF;                    // __CONFIG word: bit 2 = WDTE (watchdog enabled)
        this.eeprom = new Uint8Array(64);
        this.pins = { a: 0, b: 0 };              // levels on the pins, set by whoever drives them (bit n = pin Rxn high)
        this.reset(true);
    }

    load(words, config = 0x3FFF, eeprom = null) {
        this.prog.fill(0x3FFF);
        this.prog.set(words.subarray ? words.subarray(0, this.prog.length) : words.slice(0, this.prog.length));
        this.config = config;
        if (eeprom) this.eeprom.set(eeprom.subarray ? eeprom.subarray(0, 64) : eeprom.slice(0, 64));
        this.reset(true);
    }

    // the whole run-time state as a plain object (the program image and config are not part of it), and back
    snapshot() {
        const c = this;
        return {
            pc: c.pc, w: c.w, sp: c.sp, stack: c.stack.slice(), ram: c.ram.slice(), sfr: Object.assign({}, c.sfr), pins: { a: c.pins.a, b: c.pins.b },
            cycles: c.cycles, time: c.time, sleeping: c.sleeping, prescale: c.prescale, t0Inhibit: c.t0Inhibit, wdt: c.wdt,
            eeState: c.eeState, eeWriteLeft: c.eeWriteLeft, eeAddr: c.eeAddr, eeData: c.eeData, eeprom: c.eeprom.slice()
        };
    }

    restore(s) {
        const c = this;
        c.pc = s.pc; c.w = s.w; c.sp = s.sp; c.stack.set(s.stack); c.ram.set(s.ram); Object.assign(c.sfr, s.sfr);
        c.pins.a = s.pins.a; c.pins.b = s.pins.b; c.cycles = s.cycles; c.time = s.time; c.sleeping = s.sleeping; c.prescale = s.prescale;
        c.t0Inhibit = s.t0Inhibit; c.wdt = s.wdt; c.eeState = s.eeState; c.eeWriteLeft = s.eeWriteLeft; c.eeAddr = s.eeAddr; c.eeData = s.eeData;
        c.eeprom.set(s.eeprom);
    }

    get wdtEnabled() { return !!(this.config & 0x04); }

    // power-on reset (por) or MCLR / watchdog reset: the registers take their datasheet values
    reset(por = false, kind = "mclr") {
        this.pc = 0;
        this.w = por ? 0 : this.w;
        this.ram = por || !this.ram ? new Uint8Array(0x80) : this.ram;              // general purpose registers 0x0C..0x4F (shared by both banks)
        this.stack = new Uint16Array(8); this.sp = 0;
        const s = this.sfr || {};
        this.sfr = {
            tmr0: por ? 0 : s.tmr0 | 0, status: 0x18, fsr: por ? 0 : s.fsr | 0, pclath: 0, intcon: por ? 0 : (s.intcon & 0x01), option: 0xFF,
            trisA: 0x1F, trisB: 0xFF, latchA: por ? 0 : s.latchA | 0, latchB: por ? 0 : s.latchB | 0,
            eedata: por ? 0 : s.eedata | 0, eeadr: por ? 0 : s.eeadr | 0, eecon1: por ? 0 : (s.eecon1 & 0x10)
        };
        if (kind === "wdt") this.sfr.status &= ~0x10;                               // TO = 0 after a watchdog time-out
        this.cycles = por ? 0 : this.cycles;
        this.time = por ? 0 : this.time;
        this.sleeping = false;
        this.prescale = 0;                       // Timer0 / WDT prescaler counter
        this.t0Inhibit = 0;                      // cycles during which Timer0 does not count (after a write to TMR0)
        this.wdt = 0;                            // watchdog time accumulated (seconds)
        this.eeState = 0; this.eeWriteLeft = 0;  // EECON2 55h / AAh sequence; time left of a running write
        this.lastPortB = this.pins.b;
        this.halted = false;
    }

    // ---- data memory ------------------------------------------------------------------------------------------

    // full address (bank in bit 7) of file register f under the current bank bits
    addr(f) { return ((this.sfr.status & 0x20) ? 0x80 : 0) | (f & 0x7F); }

    read(f, direct = false) {
        let a = f & 0x7F;
        if (a === 0 && !direct) return this.read(this.sfr.fsr & 0xFF, true) & 0xFF;      // INDF: through FSR
        const bank1 = !direct ? !!(this.sfr.status & 0x20) : !!(f & 0x80);
        a = a & 0x7F;
        const s = this.sfr;
        switch (a) {
            case 0x00: return 0;
            case 0x01: return bank1 ? s.option : s.tmr0;
            case 0x02: return this.pc & 0xFF;
            case 0x03: return s.status;
            case 0x04: return s.fsr;
            case 0x05: return bank1 ? s.trisA : (this.pins.a & 0x1F);                    // reading PORTA gives the pins, not the latch
            case 0x06: return bank1 ? s.trisB : this.pins.b & 0xFF;
            case 0x07: return 0;
            case 0x08: return bank1 ? s.eecon1 : s.eedata;
            case 0x09: return bank1 ? 0 : s.eeadr;
            case 0x0A: return s.pclath;
            case 0x0B: return s.intcon;
            default: return a >= 0x0C && a <= 0x4F ? this.ram[a] : 0;
        }
    }

    write(f, v, direct = false) {
        v &= 0xFF;
        let a = f & 0x7F;
        if (a === 0 && !direct) { this.write(this.sfr.fsr & 0xFF, v, true); return; }
        const bank1 = !direct ? !!(this.sfr.status & 0x20) : !!(f & 0x80);
        a = a & 0x7F;
        const s = this.sfr;
        switch (a) {
            case 0x01: if (bank1) s.option = v; else { s.tmr0 = v; this.t0Inhibit = 2; this.prescale = 0; } break;
            case 0x02: this.pc = ((s.pclath & 0x1F) << 8 | v) & 0x3FF; this.pcWritten = true; break;
            case 0x03: s.status = (s.status & 0x18) | (v & 0xE7); break;                    // TO and PD are read-only
            case 0x04: s.fsr = v; break;
            case 0x05: if (bank1) s.trisA = v & 0x1F; else s.latchA = v & 0x1F; break;
            case 0x06: if (bank1) s.trisB = v; else s.latchB = v; break;
            case 0x08: if (bank1) this.writeEecon1(v); else s.eedata = v; break;
            case 0x09: if (bank1) { if (v === 0x55 && this.eeState === 0) this.eeState = 1; else if (v === 0xAA && this.eeState === 1) this.eeState = 2; else this.eeState = 0; } else s.eeadr = v; break;
            case 0x0A: s.pclath = v & 0x1F; break;
            case 0x0B: s.intcon = v; break;
            default: if (a >= 0x0C && a <= 0x4F) this.ram[a] = v;
        }
    }

    writeEecon1(v) {
        const s = this.sfr;
        s.eecon1 = (s.eecon1 & 0x13) | (v & 0x04);                                         // WREN is writable
        s.eecon1 = (s.eecon1 & ~0x10) | (v & 0x10);                                        // EEIF: software can clear (or set) it
        if (v & 0x08) s.eecon1 |= 0x08; else s.eecon1 &= ~0x08;                            // WRERR
        if ((v & 0x01) && !this.eeWriteLeft) { s.eedata = this.eeprom[s.eeadr & 63]; }     // RD: the data is there at once; RD clears itself
        if ((v & 0x02) && (s.eecon1 & 0x04) && this.eeState === 2 && !this.eeWriteLeft) {   // WR needs WREN and the 55h / AAh sequence
            s.eecon1 |= 0x02; this.eeWriteLeft = 4e-3; this.eeAddr = s.eeadr & 63; this.eeData = s.eedata;
        }
        this.eeState = 0;
    }

    get status() { return this.sfr.status; }
    flag(mask, on) { this.sfr.status = on ? (this.sfr.status | mask) : (this.sfr.status & ~mask); }

    // ---- pins -------------------------------------------------------------------------------------------------

    // what the chip puts on its pins: for each of RA0-RA4 / RB0-RB7, "in" (input), 0 or 1 (driven), or "od0" / "in" for RA4's open drain
    driven() {
        const s = this.sfr, out = { a: [], b: [] };
        for (let i = 0; i < 5; i++) out.a.push((s.trisA >> i) & 1 ? "in" : (i === 4 ? ((s.latchA >> 4) & 1 ? "in" : 0) : (s.latchA >> i) & 1));      // RA4 is open-drain: it can only pull low
        for (let i = 0; i < 8; i++) out.b.push((s.trisB >> i) & 1 ? "in" : (s.latchB >> i) & 1);
        return out;
    }
    get weakPullups() { return !(this.sfr.option & 0x80); }       // RBPU = 0: PORTB inputs have pull-ups

    // an external signal changed: edge on RB0/INT, RB4-RB7 level change, RA4/T0CKI edge (called by the device with the new pin levels)
    pinsChanged(a, b) {
        const s = this.sfr, oa = this.pins.a, ob = this.pins.b;
        // RB0/INT edge (only if RB0 is an input)
        if ((s.trisB & 1) && ((ob ^ b) & 1)) {
            const rising = !!(b & 1);
            if (!!(s.option & 0x40) === rising) s.intcon |= 0x02;                           // INTEDG = 1: rising edge
        }
        // RB4-RB7 change on an input pin sets RBIF
        if (((ob ^ b) & 0xF0 & s.trisB)) s.intcon |= 0x01;
        // RA4/T0CKI counts Timer0 when T0CS = 1
        if ((s.option & 0x20) && ((oa ^ a) & 0x10)) {
            const rising = !!(a & 0x10);
            if (!!(s.option & 0x10) !== rising) this.timerTick(1);                           // T0SE = 0: count on rising edges
        }
        this.pins.a = a; this.pins.b = b;
        if (this.sleeping) this.wakeCheck();
    }

    // ---- Timer0, watchdog, EEPROM write, sleep -----------------------------------------------------------------

    // one count into the prescaler / Timer0 (from the instruction clock or the T0CKI pin)
    timerTick(n) {
        const s = this.sfr;
        const ratio = (s.option & 0x08) ? 1 : 2 << (s.option & 7);                          // prescaler on the WDT: Timer0 counts 1:1
        for (let i = 0; i < n; i++) {
            if (++this.prescale >= ratio) {
                this.prescale = 0;
                if (s.tmr0 === 0xFF) { s.tmr0 = 0; s.intcon |= 0x04; } else s.tmr0++;
            }
        }
    }

    // time passes (seconds, cycles): Timer0 on the instruction clock, the watchdog, a running EEPROM write
    advance(dt, cycles) {
        const s = this.sfr;
        if (!(s.option & 0x20) && cycles > 0) {                                              // Timer0 from the instruction clock (not in sleep)
            if (this.t0Inhibit > 0) { const k = Math.min(this.t0Inhibit, cycles); this.t0Inhibit -= k; cycles -= k; }
            if (cycles > 0 && !this.sleeping) this.timerTick(cycles);
        }
        if (this.eeWriteLeft > 0) {
            this.eeWriteLeft -= dt;
            if (this.eeWriteLeft <= 0) { this.eeWriteLeft = 0; this.eeprom[this.eeAddr] = this.eeData; s.eecon1 &= ~0x02; s.eecon1 |= 0x10; }
        }
        if (this.wdtEnabled) {
            this.wdt += dt;
            const limit = 18e-3 * ((s.option & 0x08) ? (1 << (s.option & 7)) : 1);
            if (this.wdt >= limit) {
                this.wdt = 0;
                if (this.sleeping) { this.sleeping = false; this.flag(0x10, false); }      // wake: TO = 0, the program carries on
                else this.reset(false, "wdt");
            }
        }
    }

    wakeCheck() {
        const s = this.sfr;
        // the enabled sources wake a sleeping chip (GIE decides only whether the interrupt is then taken)
        const wake = ((s.intcon & 0x10) && (s.intcon & 0x02)) || ((s.intcon & 0x08) && (s.intcon & 0x01)) || ((s.intcon & 0x40) && (s.eecon1 & 0x10));
        if (wake) this.sleeping = false;
    }

    interruptPending() {
        const i = this.sfr.intcon;
        return (i & 0x80) && (((i & 0x20) && (i & 0x04)) || ((i & 0x10) && (i & 0x02)) || ((i & 0x08) && (i & 0x01)) || ((i & 0x40) && (this.sfr.eecon1 & 0x10)));
    }

    // ---- execution --------------------------------------------------------------------------------------------

    push(pc) { this.stack[this.sp & 7] = pc; this.sp = (this.sp + 1) & 7; }
    pop() { this.sp = (this.sp - 1) & 7; return this.stack[this.sp]; }

    // run one instruction (or enter an interrupt); returns the instruction cycles it took (0 while asleep)
    step() {
        if (this.sleeping) { this.wakeCheck(); if (this.sleeping) return 0; }
        const s = this.sfr;
        if (this.interruptPending()) {
            this.push(this.pc); s.intcon &= 0x7F; this.pc = 4; this.sleeping = false;
            this.cycles += 2; return 2;
        }
        const op = this.prog[this.pc & 0x3FF];
        this.pc = (this.pc + 1) & 0x3FF;
        this.pcWritten = false;
        let cycles = 1;
        const f = op & 0x7F, d = (op >> 7) & 1, k8 = op & 0xFF;
        const dest = (v) => { if (d) this.write(f, v); else this.w = v & 0xFF; };
        const zflag = (v) => this.flag(0x04, (v & 0xFF) === 0);
        const top = op >> 8;
        switch (op >> 12 & 3) {
            case 0: {
                switch (top) {
                    case 0x00:
                        if (op & 0x80) this.write(f, this.w);                                            // MOVWF
                        else if (op === 0x0064) { this.wdt = 0; this.prescale = 0; this.flag(0x18, true); }    // CLRWDT
                        else if (op === 0x0009) { this.pc = this.pop(); s.intcon |= 0x80; cycles = 2; }      // RETFIE
                        else if (op === 0x0008) { this.pc = this.pop(); cycles = 2; }                        // RETURN
                        else if (op === 0x0063) { this.sleeping = true; this.flag(0x10, true); this.flag(0x08, false); this.wdt = 0; }   // SLEEP: TO = 1, PD = 0
                        break;                                                                              // (NOP and the rest do nothing)
                    case 0x01: if (op & 0x80) { this.write(f, 0); this.flag(0x04, true); } else { this.w = 0; this.flag(0x04, true); } break;   // CLRF / CLRW
                    case 0x02: { const a = this.read(f), b = this.w, r = a - b; this.flag(0x01, a >= b); this.flag(0x02, (a & 15) >= (b & 15)); zflag(r); dest(r); break; }   // SUBWF
                    case 0x03: { const r = (this.read(f) - 1) & 0xFF; zflag(r); dest(r); break; }                                                          // DECF
                    case 0x04: { const r = this.read(f) | this.w; zflag(r); dest(r); break; }                                                              // IORWF
                    case 0x05: { const r = this.read(f) & this.w; zflag(r); dest(r); break; }                                                              // ANDWF
                    case 0x06: { const r = this.read(f) ^ this.w; zflag(r); dest(r); break; }                                                              // XORWF
                    case 0x07: { const a = this.read(f), b = this.w, r = a + b; this.flag(0x01, r > 255); this.flag(0x02, ((a & 15) + (b & 15)) > 15); zflag(r); dest(r); break; }   // ADDWF
                    case 0x08: { const r = this.read(f); zflag(r); dest(r); break; }                                                                       // MOVF
                    case 0x09: { const r = (~this.read(f)) & 0xFF; zflag(r); dest(r); break; }                                                             // COMF
                    case 0x0A: { const r = (this.read(f) + 1) & 0xFF; zflag(r); dest(r); break; }                                                          // INCF
                    case 0x0B: { const r = (this.read(f) - 1) & 0xFF; dest(r); if (r === 0) { this.pc = (this.pc + 1) & 0x3FF; cycles = 2; } break; }    // DECFSZ
                    case 0x0C: { const a = this.read(f), r = ((a >> 1) | ((s.status & 1) << 7)) & 0xFF; this.flag(0x01, !!(a & 1)); dest(r); break; }      // RRF
                    case 0x0D: { const a = this.read(f), r = ((a << 1) | (s.status & 1)) & 0xFF; this.flag(0x01, !!(a & 0x80)); dest(r); break; }         // RLF
                    case 0x0E: { const a = this.read(f); dest(((a << 4) | (a >> 4)) & 0xFF); break; }                                                    // SWAPF
                    case 0x0F: { const r = (this.read(f) + 1) & 0xFF; dest(r); if (r === 0) { this.pc = (this.pc + 1) & 0x3FF; cycles = 2; } break; }    // INCFSZ
                }
                break;
            }
            case 1: {                                                                                  // bit-oriented
                const b = (op >> 7) & 7, mask = 1 << b, kind = (op >> 10) & 3;
                if (kind === 0) this.write(f, this.read(f) & ~mask);                                    // BCF
                else if (kind === 1) this.write(f, this.read(f) | mask);                                // BSF
                else { const set = !!(this.read(f) & mask); if (set === (kind === 3)) { this.pc = (this.pc + 1) & 0x3FF; cycles = 2; } }   // BTFSC / BTFSS
                break;
            }
            case 2: {                                                                                  // CALL / GOTO
                const target = (((s.pclath & 0x18) << 8) | (op & 0x7FF)) & 0x3FF;
                if (!(op & 0x800)) this.push(this.pc);
                this.pc = target; cycles = 2;
                break;
            }
            case 3: {                                                                                  // literal
                switch (top) {
                    case 0x30: case 0x31: case 0x32: case 0x33: this.w = k8; break;                                          // MOVLW
                    case 0x34: case 0x35: case 0x36: case 0x37: this.w = k8; this.pc = this.pop(); cycles = 2; break;        // RETLW
                    case 0x38: this.w = this.w | k8; zflag(this.w); break;                                                     // IORLW
                    case 0x39: this.w = this.w & k8; zflag(this.w); break;                                                     // ANDLW
                    case 0x3A: this.w = this.w ^ k8; zflag(this.w); break;                                                     // XORLW
                    case 0x3C: case 0x3D: { const r = k8 - this.w; this.flag(0x01, k8 >= this.w); this.flag(0x02, (k8 & 15) >= (this.w & 15)); this.w = r & 0xFF; zflag(this.w); break; }   // SUBLW
                    case 0x3E: case 0x3F: { const r = k8 + this.w; this.flag(0x01, r > 255); this.flag(0x02, ((k8 & 15) + (this.w & 15)) > 15); this.w = r & 0xFF; zflag(this.w); break; }       // ADDLW
                }
                break;
            }
        }
        if (this.pcWritten && cycles === 1) cycles = 2;                                                  // a write to PCL costs the extra cycle
        this.cycles += cycles;
        return cycles;
    }
}

// ---------------------------------------------------------------------------------------------------- assembler
class PicAsm {
    static BYTE_D = ["ADDWF", "ANDWF", "COMF", "DECF", "DECFSZ", "INCF", "INCFSZ", "IORWF", "MOVF", "RLF", "RRF", "SUBWF", "SWAPF", "XORWF"];
    static LIT = { ADDLW: 0x3E00, ANDLW: 0x3900, IORLW: 0x3800, MOVLW: 0x3000, RETLW: 0x3400, SUBLW: 0x3C00, XORLW: 0x3A00 };
    static BIT = { BCF: 0x1000, BSF: 0x1400, BTFSC: 0x1800, BTFSS: 0x1C00 };
    static NOARG = { NOP: 0x0000, CLRW: 0x0100, CLRWDT: 0x0064, RETFIE: 0x0009, RETURN: 0x0008, SLEEP: 0x0063 };
    // MPASM pseudo-instructions: [expansion template, size in words]
    static PSEUDO = {
        CLRC: ["BCF STATUS,C"], SETC: ["BSF STATUS,C"], CLRZ: ["BCF STATUS,Z"], SETZ: ["BSF STATUS,Z"], CLRDC: ["BCF STATUS,DC"], SETDC: ["BSF STATUS,DC"],
        SKPC: ["BTFSS STATUS,C"], SKPNC: ["BTFSC STATUS,C"], SKPZ: ["BTFSS STATUS,Z"], SKPNZ: ["BTFSC STATUS,Z"], SKPDC: ["BTFSS STATUS,DC"], SKPNDC: ["BTFSC STATUS,DC"],
        B: ["GOTO $0"], BC: ["BTFSC STATUS,C", "GOTO $0"], BNC: ["BTFSS STATUS,C", "GOTO $0"], BZ: ["BTFSC STATUS,Z", "GOTO $0"], BNZ: ["BTFSS STATUS,Z", "GOTO $0"],
        MOVFW: ["MOVF $0,W"], TSTF: ["MOVF $0,F"], NEGF: ["COMF $0,F", "INCF $0,F"]
    };
    static CONFIG_SYMBOLS = { _WDT_ON: 0x3FFF, _WDT_OFF: 0x3FFB, _PWRTE_ON: 0x3FF7, _PWRTE_OFF: 0x3FFF, _CP_ON: 0x000F, _CP_OFF: 0x3FFF, _XT_OSC: 0x3FFD, _HS_OSC: 0x3FFE, _LP_OSC: 0x3FFC, _RC_OSC: 0x3FFF };
    static DIRECTIVES = new Set(["ORG", "EQU", "SET", "END", "DW", "DB", "DT", "DE", "__CONFIG", "PROCESSOR", "LIST", "INCLUDE", "RADIX", "ERRORLEVEL", "CBLOCK", "ENDC", "IFDEF", "IFNDEF", "IF", "ELSE", "ENDIF", "CONSTANT", "VARIABLE", "TITLE", "SUBTITLE", "PAGE", "EXPAND", "NOEXPAND", "RES"]);

    // ---- numbers and expressions
    static number(tok, radix) {
        let m;
        if ((m = /^0x([0-9a-f]+)$/i.exec(tok))) return parseInt(m[1], 16);
        if ((m = /^\$([0-9a-f]+)$/i.exec(tok))) return parseInt(m[1], 16);
        if ((m = /^0b([01]+)$/i.exec(tok))) return parseInt(m[1], 2);
        if ((m = /^([0-9][0-9a-f]*)h$/i.exec(tok))) return parseInt(m[1], 16);
        if ((m = /^h'([0-9a-f]+)'$/i.exec(tok))) return parseInt(m[1], 16);
        if ((m = /^b'([01]+)'$/i.exec(tok))) return parseInt(m[1], 2);
        if ((m = /^d'(\d+)'$/i.exec(tok))) return parseInt(m[1], 10);
        if ((m = /^o'([0-7]+)'$/i.exec(tok))) return parseInt(m[1], 8);
        if ((m = /^a'(.)'$/i.exec(tok)) || (m = /^'(.)'$/.exec(tok))) return m[1].charCodeAt(0);
        if ((m = /^\.(\d+)$/.exec(tok))) return parseInt(m[1], 10);
        if (/^\d+$/.test(tok)) return parseInt(tok, radix === 16 ? 16 : 10);
        return null;
    }

    static tokenize(text) {
        const out = [], re = /\s*(0x[0-9a-fA-F]+|\$[0-9a-fA-F]+|[hbdoaHBDOA]'[^']*'|'[^']'|\.\d+|\d[0-9a-fA-F]*[hH]\b|0b[01]+|\d+|[A-Za-z_][A-Za-z_0-9.]*|<<|>>|[-+*\/%&|^~()$])/gy;
        let m, pos = 0;
        while (pos < text.length && (re.lastIndex = pos, m = re.exec(text))) { out.push(m[1]); pos = re.lastIndex; }
        if (text.slice(pos).trim()) throw new Error(`cannot read "${text.slice(pos).trim().slice(0, 12)}"`);
        return out;
    }

    // evaluate an expression with the symbol table; `here` is the address of the current word (the value of $)
    static evaluate(text, symbols, here, radix = 10) {
        const toks = PicAsm.tokenize(text);
        if (!toks.length) throw new Error("an expression is missing");
        let i = 0;
        const peek = () => toks[i], next = () => toks[i++];
        const prim = () => {
            const t = next();
            if (t === undefined) throw new Error("the expression ends too soon");
            if (t === "(") { const v = expr(0); if (next() !== ")") throw new Error("missing )"); return v; }
            if (t === "-") return -prim();
            if (t === "+") return prim();
            if (t === "~") return ~prim();
            if (t === "$" ) return here;
            const n = PicAsm.number(t, radix);
            if (n !== null) return n;
            const up = t.toUpperCase();
            if ((up === "HIGH" || up === "LOW" || up === "UPPER") && peek() === "(") { next(); const v = expr(0); if (next() !== ")") throw new Error("missing )"); return up === "HIGH" ? (v >> 8) & 255 : up === "LOW" ? v & 255 : (v >> 16) & 255; }
            if (/^[A-Za-z_]/.test(t)) { if (!symbols.has(up)) throw new Error(`undefined symbol ${t}`); return symbols.get(up); }
            throw new Error(`unexpected "${t}"`);
        };
        const LEVELS = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
        const expr = (lv) => {
            if (lv >= LEVELS.length) return prim();
            let v = expr(lv + 1);
            while (LEVELS[lv].includes(peek())) {
                const op = next(), r = expr(lv + 1);
                v = op === "|" ? v | r : op === "^" ? v ^ r : op === "&" ? v & r : op === "<<" ? v << r : op === ">>" ? v >> r : op === "+" ? v + r : op === "-" ? v - r : op === "*" ? v * r : op === "/" ? Math.trunc(v / r) : v % r;
            }
            return v;
        };
        const v = expr(0);
        if (i < toks.length) throw new Error(`unexpected "${toks[i]}"`);
        return v;
    }

    // split "a, b(c,d), e" on top-level commas
    static splitOperands(s) {
        const out = []; let depth = 0, cur = "", inq = false;
        for (const ch of s) {
            if (ch === "\"" || ch === "'" && !inq) inq = !inq;
            if (!inq && ch === "(") depth++;
            if (!inq && ch === ")") depth--;
            if (!inq && depth === 0 && ch === ",") { out.push(cur.trim()); cur = ""; } else cur += ch;
        }
        if (cur.trim() || out.length) out.push(cur.trim());
        return out;
    }

    // ---- the assembler
    // -> { words: Uint16Array(1024), config, eeprom, errors: [{line, message}], warnings, listing: [{line, addr, word, text}], symbols: Map, used }
    static assemble(source, { size = PicCore.PROG_WORDS } = {}) {
        const errors = [], warnings = [], listing = [], words = new Uint16Array(size).fill(0x3FFF), eeprom = new Uint8Array(64);
        const symbols = new Map(), defines = new Map();
        for (const [k, v] of Object.entries(PIC_SFR)) symbols.set(k, v);
        for (const [k, v] of Object.entries(PIC_BITS)) symbols.set(k, v);
        for (const [k, v] of Object.entries(PicAsm.CONFIG_SYMBOLS)) symbols.set(k, v);
        symbols.set("W", 0); symbols.set("F", 1);
        let config = null, radix = 10, loc = 0, cblock = null, used = 0, ended = false;
        const err = (line, message) => errors.push({ line, message });
        const items = [];                                        // pass 1: what to emit
        const cond = [];                                         // conditional assembly stack: true = assembling

        const lines = String(source || "").replace(/\r/g, "").split("\n");
        lines.forEach((raw, idx) => {
            const ln = idx + 1;
            if (ended) return;
            let text = raw.replace(/;.*$/, "");
            if (!text.trim()) return;
            // #define NAME replacement text
            let m = /^\s*#\s*define\s+([A-Za-z_]\w*)\s*(.*?)\s*$/i.exec(text);
            if (m) { if (!cond.length || cond.every(Boolean)) defines.set(m[1].toUpperCase(), m[2]); return; }
            if (/^\s*#\s*(include|undefine)\b/i.test(text)) return;
            if (!/^\s*(ifdef|ifndef)\b/i.test(text)) for (const [k, v] of defines) text = text.replace(new RegExp(`\\b${k}\\b`, "gi"), v);
            // inside CBLOCK each line names variables ("name", "name:n", several separated by commas), until ENDC
            if (cblock !== null) {
                const body = text.trim();
                if (/^endc\b/i.test(body)) { cblock = null; return; }
                for (const part of PicAsm.splitOperands(body)) {
                    const m2 = /^([A-Za-z_]\w*)\s*(?::\s*(.+))?$/.exec(part);
                    if (!m2) { err(ln, `"${part}" is not a variable name`); continue; }
                    symbols.set(m2[1].toUpperCase(), cblock);
                    try { cblock += m2[2] ? PicAsm.evaluate(m2[2], symbols, loc, radix) : 1; } catch (e) { err(ln, e.message); cblock++; }
                }
                return;
            }
            // label, mnemonic, operands
            let label = null, rest = text.trim();
            const startsAtCol0 = !/^\s/.test(text);
            const first = /^([A-Za-z_][A-Za-z_0-9.]*)(:?)/.exec(rest);
            if (first) {
                const up = first[1].toUpperCase();
                const known = PicAsm.DIRECTIVES.has(up) || PIC_OPS[up] !== undefined || PicAsm.LIT[up] !== undefined || PicAsm.BIT[up] !== undefined || PicAsm.NOARG[up] !== undefined || ["CLRF", "MOVWF", "CALL", "GOTO"].includes(up) || PicAsm.PSEUDO[up] !== undefined;
                const second = /^[A-Za-z_][A-Za-z_0-9.]*\s+([A-Za-z_][A-Za-z_0-9]*)/.exec(rest), secondUp = second ? second[1].toUpperCase() : "";
                const secondKnown = !known && second && (PicAsm.DIRECTIVES.has(secondUp) || PIC_OPS[secondUp] !== undefined || PicAsm.LIT[secondUp] !== undefined || PicAsm.BIT[secondUp] !== undefined || PicAsm.NOARG[secondUp] !== undefined || ["CLRF", "MOVWF", "CALL", "GOTO"].includes(secondUp) || PicAsm.PSEUDO[secondUp] !== undefined);
                if (first[2] === ":" || secondKnown || (startsAtCol0 && !known) || (startsAtCol0 && /^\s*[A-Za-z_]\w*\s+(equ|set)\b/i.test(rest)) || /^\s*[A-Za-z_]\w*\s*=/.test(rest)) { label = first[1]; rest = rest.slice(first[0].length).trim(); }
            }
            let mn = "", ops = "";
            if (rest) {
                const mm = /^(=|[A-Za-z_][A-Za-z_0-9]*)\s*(.*)$/.exec(rest);
                if (mm) { mn = mm[1].toUpperCase(); ops = mm[2].trim(); }
                else { err(ln, `cannot read "${rest.slice(0, 16)}"`); return; }
            }
            // conditional assembly
            if (mn === "IFDEF" || mn === "IFNDEF" || mn === "IF") {
                const active = cond.every(Boolean);
                let v = false;
                if (active) { try { v = mn === "IF" ? PicAsm.evaluate(ops, symbols, loc, radix) !== 0 : (symbols.has(ops.toUpperCase()) || defines.has(ops.toUpperCase())) === (mn === "IFDEF"); } catch (e) { err(ln, e.message); } }
                cond.push(v); return;
            }
            if (mn === "ELSE") { if (!cond.length) err(ln, "else without if"); else cond[cond.length - 1] = !cond[cond.length - 1]; return; }
            if (mn === "ENDIF") { if (!cond.length) err(ln, "endif without if"); else cond.pop(); return; }
            if (!cond.every(Boolean)) return;

            if (mn === "EQU" || mn === "=" || mn === "SET") {
                if (!label) { err(ln, `${mn.toLowerCase()} needs a name`); return; }
                try { symbols.set(label.toUpperCase(), PicAsm.evaluate(ops, symbols, loc, radix)); } catch (e) { err(ln, e.message); }
                return;
            }
            if (label && cblock === null) {
                if (symbols.has(label.toUpperCase()) && PIC_SFR[label.toUpperCase()] === undefined && PIC_BITS[label.toUpperCase()] === undefined) err(ln, `${label} is defined twice`);
                symbols.set(label.toUpperCase(), loc);
            }
            if (!mn) return;
            switch (mn) {
                case "ORG": try { loc = PicAsm.evaluate(ops, symbols, loc, radix); } catch (e) { err(ln, e.message); } return;
                case "END": ended = true; return;
                case "PROCESSOR": case "LIST": case "INCLUDE": case "ERRORLEVEL": case "TITLE": case "SUBTITLE": case "PAGE": case "EXPAND": case "NOEXPAND": return;
                case "RADIX": radix = /^h/i.test(ops) ? 16 : 10; return;
                case "CONSTANT": case "VARIABLE": return;
                case "CBLOCK": try { cblock = ops ? PicAsm.evaluate(ops, symbols, loc, radix) : 0x0C; } catch (e) { err(ln, e.message); cblock = 0x0C; } return;
                case "RES": try { loc += PicAsm.evaluate(ops, symbols, loc, radix); } catch (e) { err(ln, e.message); } return;
                case "__CONFIG": items.push({ ln, kind: "config", ops }); return;
                case "DW": { const a = PicAsm.splitOperands(ops); items.push({ ln, loc, kind: "dw", ops: a, text: raw }); loc += a.length; return; }
                case "DT": { const a = PicAsm.splitOperands(ops); let n = 0; for (const o of a) n += /^".*"$/.test(o) ? o.length - 2 : 1; items.push({ ln, loc, kind: "dt", ops: a, text: raw }); loc += n; return; }
                case "DB": { const a = PicAsm.splitOperands(ops); let n = 0; for (const o of a) n += /^".*"$/.test(o) ? o.length - 2 : 1; items.push({ ln, loc, kind: "db", ops: a, text: raw }); loc += Math.ceil(n / 2); return; }
                case "DE": items.push({ ln, kind: "de", ops: PicAsm.splitOperands(ops) }); return;
                case "ENDC": err(ln, "endc without cblock"); return;
            }
            if (PicAsm.PSEUDO[mn]) {
                const a = PicAsm.splitOperands(ops), tpl = PicAsm.PSEUDO[mn];
                tpl.forEach(t => {
                    const filled = t.replace(/\$0/g, a[0] === undefined ? "" : a[0]);
                    const sp = filled.indexOf(" "), m2 = (sp < 0 ? filled : filled.slice(0, sp)).toUpperCase(), o2 = sp < 0 ? "" : filled.slice(sp + 1);
                    items.push({ ln, loc, kind: "ins", mn: m2, ops: PicAsm.splitOperands(o2), text: raw });
                    loc++;
                });
                return;
            }
            items.push({ ln, loc, kind: "ins", mn, ops: PicAsm.splitOperands(ops), text: raw });
            loc++;
        });
        if (cond.length) err(lines.length, "if without endif");

        // pass 2: evaluate operands and emit
        const put = (ln, addr, w, text) => {
            if (addr < 0 || addr >= size) { err(ln, `address 0x${addr.toString(16)} is outside the ${size}-word program memory`); return; }
            if (words[addr] !== 0x3FFF) warnings.push({ line: ln, message: `address 0x${addr.toString(16)} is written twice` });
            words[addr] = w & 0x3FFF; used++;
            listing.push({ line: ln, addr, word: w & 0x3FFF, text });
        };
        for (const it of items) {
            try {
                const ev = (s, here = it.loc) => PicAsm.evaluate(s, symbols, here, radix);
                if (it.kind === "config") { config = ev(it.ops) & 0x3FFF; continue; }
                if (it.kind === "de") { it.ops.forEach((o, i) => { eeprom[i & 63] = ev(o) & 255; }); continue; }
                if (it.kind === "dw") { it.ops.forEach((o, i) => put(it.ln, it.loc + i, ev(o), it.text)); continue; }
                if (it.kind === "dt") {
                    let a = it.loc;
                    for (const o of it.ops) {
                        if (/^".*"$/.test(o)) for (const ch of o.slice(1, -1)) put(it.ln, a++, 0x3400 | ch.charCodeAt(0), it.text);
                        else put(it.ln, a++, 0x3400 | (ev(o) & 255), it.text);
                    }
                    continue;
                }
                if (it.kind === "db") {
                    const bytes = [];
                    for (const o of it.ops) { if (/^".*"$/.test(o)) for (const ch of o.slice(1, -1)) bytes.push(ch.charCodeAt(0)); else bytes.push(ev(o) & 255); }
                    for (let i = 0; i < bytes.length; i += 2) put(it.ln, it.loc + (i >> 1), bytes[i] | ((bytes[i + 1] || 0) << 8), it.text);
                    continue;
                }
                const mn = it.mn, a = it.ops;
                const need = (n) => { if (a.length !== n) throw new Error(`${mn.toLowerCase()} takes ${n} operand${n === 1 ? "" : "s"}`); };
                const reg = (s) => { const v = ev(s); if (v < 0 || v > 0xFF) throw new Error(`register ${s} (${v}) is out of range`); return v & 0x7F; };
                const dsel = (s) => { if (s === undefined) { warnings.push({ line: it.ln, message: `${mn.toLowerCase()}: destination not given, using f` }); return 1; } const v = ev(s); if (v !== 0 && v !== 1) throw new Error("the destination must be W (0) or F (1)"); return v; };
                let w;
                if (PicAsm.BYTE_D.includes(mn)) { if (a.length < 1 || a.length > 2) throw new Error(`${mn.toLowerCase()} takes f and an optional destination`); w = PIC_OPS[mn] | (dsel(a[1]) << 7) | reg(a[0]); }
                else if (mn === "CLRF") { need(1); w = 0x0180 | reg(a[0]); }
                else if (mn === "MOVWF") { need(1); w = 0x0080 | reg(a[0]); }
                else if (PicAsm.NOARG[mn] !== undefined) { if (a.length) throw new Error(`${mn.toLowerCase()} takes no operand`); w = PicAsm.NOARG[mn]; }
                else if (PicAsm.BIT[mn] !== undefined) { need(2); const b = ev(a[1]); if (b < 0 || b > 7) throw new Error("the bit number must be 0 to 7"); w = PicAsm.BIT[mn] | (b << 7) | reg(a[0]); }
                else if (PicAsm.LIT[mn] !== undefined) { need(1); const k = ev(a[0]); if (k < -128 || k > 255) throw new Error(`literal ${k} does not fit in 8 bits`); w = PicAsm.LIT[mn] | (k & 255); }
                else if (mn === "GOTO" || mn === "CALL") { need(1); const k = ev(a[0]); if (k < 0 || k >= size) throw new Error(`address ${k} is outside the program memory`); w = (mn === "GOTO" ? 0x2800 : 0x2000) | (k & 0x7FF); }
                else throw new Error(`unknown instruction ${mn.toLowerCase()}`);
                put(it.ln, it.loc, w, it.text);
            } catch (e) { err(it.ln, e.message); }
        }
        const hasConfig = config !== null;
        return { words, config: hasConfig ? config : 0x3FFB, hasConfig, eeprom, errors, warnings, listing, symbols, used };
    }

    // ---- disassembler: one 14-bit word -> text (file register names for the special registers)
    static disasm(op) {
        const f = op & 0x7F, d = (op >> 7) & 1, k = op & 0xFF, top = op >> 8;
        const fname = (v) => { for (const [n, a] of Object.entries(PIC_SFR)) if (a === v && n !== "OPTION") return n; return "0x" + v.toString(16).toUpperCase().padStart(2, "0"); };
        const dd = d ? "F" : "W";
        switch (op >> 12 & 3) {
            case 0:
                switch (top) {
                    case 0x00:
                        if (op & 0x80) return `movwf ${fname(f)}`;
                        return ({ 0x0064: "clrwdt", 0x0009: "retfie", 0x0008: "return", 0x0063: "sleep" })[op] || "nop";
                    case 0x01: return op & 0x80 ? `clrf ${fname(f)}` : "clrw";
                    default: { const n = Object.keys(PIC_OPS).find(m => PIC_OPS[m] >> 8 === top); return n ? `${n.toLowerCase()} ${fname(f)},${dd}` : "???"; }
                }
            case 1: return `${["bcf", "bsf", "btfsc", "btfss"][(op >> 10) & 3]} ${fname(f)},${(op >> 7) & 7}`;
            case 2: return `${op & 0x800 ? "goto" : "call"} 0x${(op & 0x7FF).toString(16).toUpperCase().padStart(3, "0")}`;
            default: {
                const n = { 0x30: "movlw", 0x31: "movlw", 0x32: "movlw", 0x33: "movlw", 0x34: "retlw", 0x35: "retlw", 0x36: "retlw", 0x37: "retlw", 0x38: "iorlw", 0x39: "andlw", 0x3A: "xorlw", 0x3C: "sublw", 0x3D: "sublw", 0x3E: "addlw", 0x3F: "addlw" }[top];
                return n ? `${n} 0x${k.toString(16).toUpperCase().padStart(2, "0")}` : "???";
            }
        }
    }
}
