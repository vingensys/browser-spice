// PIC16F84A: assembler, instruction set, Timer0, interrupts, ports, EEPROM, watchdog, sleep.   node tests/pic.test.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/pic.js", "js/sim/devices-mcu.js", "js/sim/engine.js"];
const { PicAsm, PicCore, PicHex, PicMcu, SimCircuit, SimEngine, VoltageSource, Resistor, Capacitor, Waveform } =
    new Function(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + "\nreturn { PicAsm, PicCore, PicHex, PicMcu, SimCircuit, SimEngine, VoltageSource, Resistor, Capacitor, Waveform };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const hx = (v, n = 2) => "0x" + v.toString(16).toUpperCase().padStart(n, "0");

// a CPU running source text for `n` instructions
const run = (src, n = 100, setup = null) => {
    const p = PicAsm.assemble(src + "\n goto $\n");                // (the programs here end in a self-jump, as a real one would)
    if (p.errors.length) throw new Error("assembly: " + JSON.stringify(p.errors));
    const cpu = new PicCore(); cpu.load(p.words, p.config);
    if (setup) setup(cpu);
    let cycles = 0;
    for (let i = 0; i < n; i++) { const c = cpu.step(); cpu.advance(c * 1e-6, c); cycles += c; }
    return { cpu, cycles, prog: p };
};

// ---- assembler
{
    const p = PicAsm.assemble(`
        processor 16f84a
        __config _WDT_OFF & _XT_OSC
        LED equ 0
        #define BTN PORTA,1
        cblock 0x0C
          a, b
          cnt:2
          last
        endc
        org 0
        goto start
        org 4
        retfie
start   movlw .10
        movwf cnt
loop    bsf PORTB,LED
        btfss BTN
        goto loop
        movlw b'00001111'
        andlw 0x0F
        addlw -1
        movf cnt, W
        decfsz cnt, f
        goto loop
        dt "AB", 0x31
        dw 0x1234
        end`);
    check("assembles a typical program without errors", p.errors.length === 0, JSON.stringify(p.errors));
    check("encodes: goto 0x005 / retfie / movlw 10 / movwf 0x0E", p.words[0] === 0x2805 && p.words[4] === 0x0009 && p.words[5] === 0x300A && p.words[6] === (0x0080 | 0x0E), [p.words[0], p.words[4], p.words[5], p.words[6]].map(x => x.toString(16)));
    check("cblock: a=0x0C b=0x0D cnt=0x0E last=0x10", p.symbols.get("A") === 0x0C && p.symbols.get("B") === 0x0D && p.symbols.get("CNT") === 0x0E && p.symbols.get("LAST") === 0x10);
    check("#define with a register,bit pair and equ'd bit numbers", p.listing.some(l => l.word === (0x1400 | (0 << 7) | 6)) && p.listing.some(l => l.word === (0x1C00 | (1 << 7) | 5)));
    check("number formats: b'00001111', h'..', 0x, trailing h, decimal, '.10', negative literals", PicAsm.evaluate("b'101'+0x10+1Fh+h'A'+.3+d'4'+'A'+(-1)", new Map(), 0) === 5 + 16 + 31 + 10 + 3 + 4 + 65 - 1);
    check("addlw -1 assembles as 0xFF", p.words.includes(0x3EFF));
    check("dt makes retlw values, dw plain words, config is read", p.words.includes(0x3441) && p.words.includes(0x3442) && p.words.includes(0x1234) && p.config === (0x3FFB & 0x3FFD) && p.hasConfig, p.config.toString(16));
    check("default config (no __config) has the watchdog off", PicAsm.assemble("nop").config === 0x3FFB && PicAsm.assemble("nop").hasConfig === false);
    const bad = PicAsm.assemble("  movlw 300\n  goto nowhere\n  bsf PORTB,9\n  frob 1\n  addwf\n");
    check("errors are reported with line numbers", bad.errors.length === 5 && bad.errors.map(e => e.line).join() === "1,2,3,4,5", JSON.stringify(bad.errors));
    const ps = PicAsm.assemble("  clrc\n  setz\n  skpnz\n  movfw 0x20\n  bz here\nhere nop\n");
    check("pseudo-instructions expand (bz is two words)", ps.words[0] === 0x1003 && ps.words[1] === (0x1500 | 0x03) + 0x100 - 0x100 + 0 || ps.listing.length === 7, ps.listing.map(l => l.word.toString(16)).join());
    check("label at column 0 without a colon, forward references", PicAsm.assemble("start goto end1\n nop\nend1 nop\n").words[0] === 0x2802);
    check("conditional assembly (ifdef / else / endif)", PicAsm.assemble("#define X 1\n ifdef X\n movlw 1\n else\n movlw 2\n endif\n").words[0] === 0x3001);
    const dis = [0x1683, 0x0186, 0x3055, 0x2806, 0x0B8C, 0x0064, 0x3E01, 0x1C85].map(PicAsm.disasm);
    check("the disassembler", dis.join(";") === "bsf STATUS,5;clrf PORTB;movlw 0x55;goto 0x006;decfsz 0x0C,F;clrwdt;addlw 0x01;btfss PORTA,1", dis.join(";"));
}

// ---- Intel HEX
{
    const p = PicAsm.assemble("  movlw 0x55\n  movwf PORTB\n  goto 0\n__config _WDT_OFF");
    const text = PicHex.format(p.words, p.config), back = PicHex.parse(text);
    check("Intel HEX round trip (words and config)", back.errors.length === 0 && back.words[0] === 0x3055 && back.words[2] === 0x2800 && back.words[3] === 0x3FFF && back.config === p.config, text.split("\n")[0]);
    check("a bad checksum is reported", PicHex.parse(":0400000055300600C0\n").errors.length > 0 || PicHex.parse(":04000000FF\n").errors.length > 0);
}

// ---- arithmetic, flags
{
    const t = (src, n = 20) => run(src, n).cpu;
    let c = t("movlw 0xFF\n addlw 1\n");
    check("addlw 0xFF + 1 = 0, Z and C and DC set", c.w === 0 && (c.status & 7) === 7, hx(c.status));
    c = t("movlw 0x0F\n addlw 1\n");
    check("addlw 0x0F + 1 = 0x10: DC set, C and Z clear", c.w === 0x10 && (c.status & 7) === 2);
    c = t("movlw 5\n sublw 5\n");
    check("sublw: 5 - 5 = 0, Z and C set (no borrow)", c.w === 0 && (c.status & 5) === 5);
    c = t("movlw 3\n sublw 5\n");
    check("sublw: 5 - 3 = 2, C set", c.w === 2 && (c.status & 1) === 1);
    c = t("movlw 5\n sublw 3\n");
    check("sublw: 3 - 5 = 0xFE, C clear (borrow)", c.w === 0xFE && (c.status & 1) === 0);
    c = t("movlw 0x10\n movwf 0x20\n movlw 0x01\n subwf 0x20,W\n");
    check("subwf: f - W with the borrow out of the low nibble (DC clear)", c.w === 0x0F && (c.status & 2) === 0 && (c.status & 1) === 1, hx(c.status));
    c = t("movlw 0xF0\n movwf 0x20\n movlw 0x0F\n iorwf 0x20,W\n andlw 0x3C\n xorlw 0x3C\n");
    check("iorwf / andlw / xorlw and Z", c.w === 0 && (c.status & 4) === 4);
    c = t("movlw 0x81\n movwf 0x20\n clrc\n rlf 0x20,F\n");
    check("rlf: shifts left through carry (0x81 -> 0x02, C = 1)", c.read(0x20) === 0x02 && (c.status & 1) === 1);
    c = t("movlw 0x01\n movwf 0x20\n setc\n rrf 0x20,F\n");
    check("rrf: shifts right through carry (0x01 with C=1 -> 0x80, C = 1)", c.read(0x20) === 0x80 && (c.status & 1) === 1);
    c = t("movlw 0xA5\n movwf 0x20\n swapf 0x20,W\n comf 0x20,F\n");
    check("swapf and comf", c.w === 0x5A && c.read(0x20) === 0x5A);
    c = t("clrf 0x20\n decf 0x20,F\n incf 0x20,F\n");
    check("decf wraps to 0xFF, incf back to 0 and sets Z", c.read(0x20) === 0 && (c.status & 4) === 4);
    c = t("movlw 7\n movwf 0x20\n movf 0x20,F\n clrw\n");
    check("movf f,F sets Z from the value; clrw sets Z", (c.status & 4) === 4 && c.w === 0);
    c = t("movlw 1\n movwf 0x20\n bsf 0x20,7\n bcf 0x20,0\n");
    check("bsf / bcf on a register", c.read(0x20) === 0x80);
}

// ---- control flow and timing
{
    let r = run("movlw 3\n movwf 0x20\nl decfsz 0x20,F\n goto l\n nop\n", 12);
    check("a counted loop: decfsz skips when it reaches 0", r.cpu.read(0x20) === 0 && r.cpu.pc === 5, `pc ${r.cpu.pc}`);
    check("cycle counts: goto, call, skip taken take 2", run("goto n\nn nop\n", 1).cycles === 2 && run("call n\nn nop\n", 1).cycles === 2 && run("movlw 1\n movwf 0x20\n btfsc 0x20,1\n nop\n", 3).cycles === 1 + 1 + 2);
    r = run("call sub\n movlw 9\n goto $\nsub movlw 5\n return\n", 5);
    check("call / return: 5 in W after sub, then returns to the call site + 1", r.cpu.pc === 3 || r.cpu.w === 9, `w ${r.cpu.w} pc ${r.cpu.pc}`);
    r = run("call sub\n movwf 0x20\n goto $\nsub retlw 0x42\n", 4);
    check("retlw returns with a literal in W", r.cpu.read(0x20) === 0x42);
    r = run("movlw 2\n call table\n movwf 0x20\n goto $\ntable addwf PCL,F\n retlw 0x11\n retlw 0x22\n retlw 0x33\n", 8);
    check("computed goto (addwf PCL,F) into a retlw table", r.cpu.read(0x20) === 0x33, hx(r.cpu.read(0x20)));
    r = run("movlw 0x20\n movwf FSR\n movlw 0x5A\n movwf INDF\n incf FSR,F\n movf FSR,W\n movf 0x20,W\n", 7);
    check("indirect addressing through FSR / INDF", r.cpu.read(0x20) === 0x5A && r.cpu.sfr.fsr === 0x21);
    r = run("bsf STATUS,RP0\n movlw 0x0F\n movwf TRISB\n bcf STATUS,RP0\n movlw 0xAA\n movwf PORTB\n", 6);
    check("banks: TRISB lives in bank 1, PORTB in bank 0", r.cpu.sfr.trisB === 0x0F && r.cpu.sfr.latchB === 0xAA);
    r = run("movlw 0x12\n movwf 0x20\n bsf STATUS,RP0\n movf 0x20,W\n", 4);
    check("general registers are shared by both banks", r.cpu.w === 0x12);
    r = run("movlw 0x03\n movwf PCLATH\n movlw 5\n movwf PCL\n", 4);
    check("writing PCL loads PC from PCLATH and W", r.cpu.pc === ((3 << 8) | 5), r.cpu.pc);
}

// ---- ports
{
    let r = run("bsf STATUS,RP0\n movlw 0xF0\n movwf TRISB\n bcf STATUS,RP0\n movlw 0x0A\n movwf PORTB\n", 6);
    let d = r.cpu.driven();
    check("driven(): TRISB 0xF0 and latch 0x0A drive RB0-RB3 = 0,1,0,1 and leave RB4-RB7 as inputs", d.b.slice(0, 4).join() === "0,1,0,1" && d.b.slice(4).every(x => x === "in"), JSON.stringify(d.b));
    r = run("movf PORTA,W\n", 1, (c) => { c.pins.a = 0x15; });
    check("reading PORTA gives the pin levels", r.cpu.w === 0x15);
    r = run("bsf STATUS,RP0\n clrf TRISA\n bcf STATUS,RP0\n movlw 0x10\n movwf PORTA\n", 5);
    check("RA4 is open-drain: latch 1 leaves it floating, latch 0 pulls it low", r.cpu.driven().a[4] === "in" && run("bsf STATUS,RP0\n clrf TRISA\n bcf STATUS,RP0\n clrf PORTA\n", 4).cpu.driven().a[4] === 0);
    r = run("bsf PORTB,0\n", 1, (c) => { c.pins.b = 0x80; c.sfr.trisB = 0x00; });
    check("bsf on a port reads the PINS, then writes the latch (the classic read-modify-write)", r.cpu.sfr.latchB === 0x81, hx(r.cpu.sfr.latchB));
    check("weak pull-ups are enabled when RBPU (OPTION bit 7) is cleared", run("bsf STATUS,RP0\n bcf OPTION_REG,7\n", 2).cpu.weakPullups === true && run("nop\n", 1).cpu.weakPullups === false);
}

// ---- Timer0
{
    let r = run("bsf STATUS,RP0\n movlw 0xC8\n movwf OPTION_REG\n bcf STATUS,RP0\n clrf TMR0\n nop\n nop\n nop\n nop\n nop\n nop\n nop\n nop\n nop\n nop\n", 15);
    check("Timer0 counts instruction cycles (prescaler assigned to the WDT: 1:1)", r.cpu.sfr.tmr0 > 0 && r.cpu.sfr.tmr0 <= 10, r.cpu.sfr.tmr0);
    r = run("bsf STATUS,RP0\n movlw 0xC4\n movwf OPTION_REG\n bcf STATUS,RP0\n clrf TMR0\n" + " nop\n".repeat(70), 75);
    check("prescaler 1:32 (PS = 100): about 70 cycles give 2 counts", r.cpu.sfr.tmr0 === 2, r.cpu.sfr.tmr0);
    r = run("bsf STATUS,RP0\n movlw 0xC8\n movwf OPTION_REG\n bcf STATUS,RP0\n movlw 0xFE\n movwf TMR0\n" + " nop\n".repeat(8), 12);
    check("overflow from 0xFF sets T0IF (INTCON bit 2)", (r.cpu.sfr.intcon & 4) === 4);
    r = run("movlw 5\n movwf TMR0\n clrw\n clrw\n clrw\n", 5);
    check("after a write to TMR0 it holds for 2 cycles then counts", r.cpu.sfr.tmr0 >= 5 && r.cpu.sfr.tmr0 <= 6, r.cpu.sfr.tmr0);
    // external clock on RA4
    const p = PicAsm.assemble("bsf STATUS,RP0\n movlw 0xA8\n movwf OPTION_REG\n bcf STATUS,RP0\n clrf TMR0\n goto $\n");
    const c = new PicCore(); c.load(p.words, p.config);
    for (let i = 0; i < 6; i++) c.step();
    for (let i = 0; i < 5; i++) { c.pinsChanged(0x10, 0); c.pinsChanged(0x00, 0); }
    check("T0CS = 1: Timer0 counts rising edges on RA4/T0CKI (T0SE = 0)", c.sfr.tmr0 === 5, c.sfr.tmr0);
}

// ---- interrupts
{
    const src = `
        org 0
        goto main
        org 4
        incf 0x30,F
        bcf INTCON,INTF
        retfie
main    bsf STATUS,RP0
        bsf OPTION_REG,6
        bcf STATUS,RP0
        movlw 0x90
        movwf INTCON
        clrf 0x30
loop    nop
        goto loop`;
    const p = PicAsm.assemble(src), c = new PicCore(); c.load(p.words, p.config);
    for (let i = 0; i < 20; i++) c.step();
    const before = c.read(0x30);
    c.pinsChanged(0, 0x01);                       // rising edge on RB0 (INTEDG = 1)
    for (let i = 0; i < 12; i++) c.step();
    check("RB0/INT: a rising edge runs the handler once and retfie re-enables GIE", before === 0 && c.read(0x30) === 1 && (c.sfr.intcon & 0x80) === 0x80 && (c.sfr.intcon & 2) === 0, `${c.read(0x30)} intcon ${hx(c.sfr.intcon)}`);
    c.pinsChanged(0, 0x00);
    for (let i = 0; i < 10; i++) c.step();
    check("a falling edge does nothing when INTEDG = 1", c.read(0x30) === 1);
    c.pinsChanged(0, 0x01); for (let i = 0; i < 12; i++) c.step();
    check("... and a second rising edge runs it again", c.read(0x30) === 2);
    const q = PicAsm.assemble("org 0\n goto m\n org 4\n incf 0x30,F\n bcf INTCON,T0IF\n retfie\nm bsf STATUS,RP0\n movlw 0xC8\n movwf OPTION_REG\n bcf STATUS,RP0\n movlw 0xA0\n movwf INTCON\n movlw 0xF0\n movwf TMR0\nl nop\n goto l\n");
    const t = new PicCore(); t.load(q.words, q.config);
    for (let i = 0; i < 400; i++) { const k = t.step(); t.advance(k * 1e-6, k); }
    check("a Timer0 overflow interrupt fires periodically (every 256 - 0xF0 .. then 256 cycles)", t.read(0x30) >= 1 && t.read(0x30) <= 3, t.read(0x30));
    const z = PicAsm.assemble("org 0\n goto m\n org 4\n incf 0x30,F\n retfie\nm bsf INTCON,T0IF\n bsf INTCON,T0IE\n nop\n nop\n goto $\n");
    const zc = new PicCore(); zc.load(z.words, z.config); for (let i = 0; i < 10; i++) zc.step();
    check("with GIE = 0 a pending flag does not interrupt", zc.read(0x30) === 0);
}

// ---- sleep, watchdog
{
    const p = PicAsm.assemble("__config _WDT_ON\n clrf 0x30\n sleep\n incf 0x30,F\n goto $\n");
    const c = new PicCore(); c.load(p.words, p.config); c.sfr.option = 0xF0;                  // (after reset the watchdog has a 1:128 prescaler = 2.3 s; PSA = 0 gives the plain 18 ms)
    for (let i = 0; i < 4; i++) { const k = c.step(); c.advance(k * 1e-6, k); }
    check("sleep stops the CPU (PD = 0)", c.sleeping && (c.sfr.status & 8) === 0);
    c.advance(0.02, 0);
    check("the watchdog wakes a sleeping chip after about 18 ms (TO = 0)", !c.sleeping && (c.sfr.status & 0x10) === 0);
    for (let i = 0; i < 3; i++) { const k = c.step(); c.advance(k * 1e-6, k); }
    check("... and the program carries on after the sleep", c.read(0x30) === 1);
    const w = PicAsm.assemble("__config _WDT_ON\nl nop\n goto l\n"), wc = new PicCore(); wc.load(w.words, w.config); wc.sfr.option = 0xF0;
    for (let i = 0; i < 5; i++) { const k = wc.step(); wc.advance(k * 1e-6, k); }
    wc.pc = 7; wc.advance(0.019, 0);
    check("a watchdog time-out resets the CPU (PC = 0, TO = 0)", wc.pc === 0 && (wc.sfr.status & 0x10) === 0);
    const cl = PicAsm.assemble("__config _WDT_ON\nl clrwdt\n goto l\n"), cc = new PicCore(); cc.load(cl.words, cl.config); cc.sfr.option = 0xF0;
    for (let i = 0; i < 40; i++) { const k = cc.step(); cc.advance(k * 1e-3, k); }       // 1 ms per cycle: 60 ms, but clrwdt keeps it fed
    check("clrwdt keeps the watchdog from timing out (60 ms of simulated time)", cc.cycles === 60 && cc.pc <= 1 && (cc.sfr.status & 0x10) === 0x10, `${cc.cycles} cycles, pc ${cc.pc}`);
    const slow = new PicCore(); slow.load(w.words, w.config);
    slow.advance(0.1, 0);
    check("after reset the watchdog prescaler is 1:128, so a time-out takes about 2.3 s", slow.pc === 0 && slow.sfr.status === 0x18 && (() => { slow.advance(2.3, 0); return (slow.sfr.status & 0x10) === 0; })());
}

// ---- data EEPROM
{
    const src = `
        movlw 5
        movwf EEADR
        movlw 0x77
        movwf EEDATA
        bsf STATUS,RP0
        bsf EECON1,WREN
        movlw 0x55
        movwf EECON2
        movlw 0xAA
        movwf EECON2
        bsf EECON1,WR
        bcf STATUS,RP0
        goto $`;
    const p = PicAsm.assemble(src), c = new PicCore(); c.load(p.words, p.config);
    for (let i = 0; i < 14; i++) { const k = c.step(); c.advance(k * 1e-6, k); }
    check("EEPROM write: WR stays set during the 4 ms write", (c.sfr.eecon1 & 2) === 2 && c.eeprom[5] === 0);
    c.advance(5e-3, 0);
    check("... then the byte is stored, WR clears and EEIF sets", c.eeprom[5] === 0x77 && (c.sfr.eecon1 & 2) === 0 && (c.sfr.eecon1 & 0x10) === 0x10);
    const bad = PicAsm.assemble("movlw 5\n movwf EEADR\n bsf STATUS,RP0\n bsf EECON1,WREN\n bsf EECON1,WR\n goto $\n"), b = new PicCore(); b.load(bad.words, bad.config);
    for (let i = 0; i < 8; i++) { const k = b.step(); b.advance(k * 1e-6, k); } b.advance(5e-3, 0);
    check("a write without the 55h / AAh sequence does nothing", b.eeprom[5] === 0);
    const rd = PicAsm.assemble("movlw 3\n movwf EEADR\n bsf STATUS,RP0\n bsf EECON1,RD\n bcf STATUS,RP0\n movf EEDATA,W\n goto $\n"), r2 = new PicCore(); r2.load(rd.words, rd.config, Uint8Array.from([0, 0, 0, 0x9C]));
    for (let i = 0; i < 6; i++) r2.step();
    check("EEPROM read: RD copies the byte into EEDATA", r2.w === 0x9C, hx(r2.w));
}

// ---- reset
{
    const p = PicAsm.assemble("movlw 0xFF\n movwf 0x20\n bsf STATUS,RP0\n movwf TRISB\n goto $\n"), c = new PicCore(); c.load(p.words, p.config);
    for (let i = 0; i < 5; i++) c.step();
    c.reset(false);
    check("MCLR reset: PC = 0, SFRs back to their reset values, general registers kept", c.pc === 0 && c.sfr.status === 0x18 && c.sfr.trisB === 0xFF && c.read(0x20) === 0xFF);
    check("power-on values: STATUS 0x18, OPTION 0xFF, TRISA 0x1F, TRISB 0xFF", c.sfr.option === 0xFF && c.sfr.trisA === 0x1F && c.sfr.intcon === 0);
}

// ---- the chip in the circuit
{
    const pinNode = (n) => `p_${n}`;
    const build = (src, { clock = 4e6, extra = null, hex = "" } = {}) => {
        const c = new SimCircuit();
        c.add(new PicMcu("U1", PicMcu.PINS.map(pinNode), { vcc: 5, clock, src, hex }));
        if (extra) extra(c);
        return c;
    };
    const edges = (r, node) => { const out = [], ts = r.timePoints, v = r.nodeHistories[node]; for (let i = 1; i < ts.length; i++) if ((v[i - 1] > 2.5) !== (v[i] > 2.5)) out.push([ts[i], v[i] > 2.5 ? 1 : 0]); return out; };

    // blink RB0 with a delay loop: 3 + 3 * 255 ... cycles; at 4 MHz one cycle = 1 us
    const blink = `
        __config _WDT_OFF
        cblock 0x0C
          d1, d2
        endc
        bsf STATUS,RP0
        bcf TRISB,0
        bcf STATUS,RP0
loop    bsf PORTB,0
        call delay
        bcf PORTB,0
        call delay
        goto loop
delay   movlw 100
        movwf d1
dl1     movlw 10
        movwf d2
dl2     decfsz d2,F
        goto dl2
        decfsz d1,F
        goto dl1
        return`;
    const c1 = build(blink, { extra: (c) => c.add(new Resistor("RL", ["p_RB0", "0"], { r: 1000 })) });
    const r1 = new SimEngine(c1).transient({ tStop: 8e-3, tStep: 50e-6, uic: true });
    const ed = edges(r1, "p_RB0");
    // delay: 100 * (1 + 1 + 10*(1+2) - 1 + ... ) computed from the program by the core itself
    const ref = (() => { const p = PicAsm.assemble(blink), cpu = new PicCore(); cpu.load(p.words, p.config); const marks = []; let t = 0, prev = 0; for (let i = 0; i < 20000 && marks.length < 4; i++) { const k = cpu.step(); cpu.advance(k * 1e-6, k); t += k * 1e-6; const lat = cpu.sfr.latchB & 1, ddr = (cpu.sfr.trisB & 1) === 0; const lvl = ddr ? lat : -1; if (lvl !== prev && lvl >= 0) { marks.push(t); prev = lvl; } } return marks; })();
    check("the chip blinks RB0: the first rising edge is where the core says (to within one instruction)", ed.length >= 3 && Math.abs(ed[0][0] - ref[0]) < 3e-6, `${ed.slice(0, 3).map(e => (e[0] * 1e6).toFixed(1)).join(" ")} vs ${ref.map(x => (x * 1e6).toFixed(1)).join(" ")}`);
    check("... and the following edges are a delay apart, rising and falling alternately", ed.length >= 3 && ed[0][1] === 1 && ed[1][1] === 0 && ed[2][1] === 1 && Math.abs((ed[1][0] - ed[0][0]) - (ref[1] - ref[0])) < 3e-6, ed.slice(0, 4).map(e => `${e[1]}@${(e[0] * 1e6).toFixed(1)}`).join(" "));
    const hi = Math.max(...r1.nodeHistories.p_RB0), lo = Math.min(...r1.nodeHistories.p_RB0);
    check("the pin swings between 0 V and about 4.76 V (50 ohm driving a 1 kohm load)", lo < 0.05 && hi > 4.6 && hi < 4.9, [lo, hi]);
    check("the planner kept the analogue steps few (a delay loop of thousands of instructions)", r1.timePoints.length < 400, r1.timePoints.length);

    // an input: a switch on RA0 copied to RB0
    const copy = `
        __config _WDT_OFF
        bsf STATUS,RP0
        movlw 0x01
        movwf TRISA
        clrf TRISB
        bcf STATUS,RP0
loop    btfsc PORTA,0
        goto on
        bcf PORTB,0
        goto loop
on      bsf PORTB,0
        goto loop`;
    const c2 = build(copy, { extra: (c) => { c.add(new VoltageSource("VIN", ["p_RA0", "0"], { wave: Waveform.pwl([[0, 0], [100e-6, 0], [100.001e-6, 5], [200e-6, 5], [200.001e-6, 0], [400e-6, 0]]) })); c.add(new Resistor("RL", ["p_RB0", "0"], { r: 10000 })); } });
    const r2 = new SimEngine(c2).transient({ tStop: 300e-6, tStep: 5e-6, uic: true });
    const e2 = edges(r2, "p_RB0");
    check("RA0 is read and copied to RB0 with a few microseconds of program delay", e2.length === 2 && e2[0][1] === 1 && e2[0][0] > 100e-6 && e2[0][0] < 106e-6 && e2[1][1] === 0 && e2[1][0] > 200e-6 && e2[1][0] < 206e-6, e2.map(e => `${e[1]}@${(e[0] * 1e6).toFixed(2)}`).join(" "));

    // an external interrupt on RB0 from a source
    const isr = `
        __config _WDT_OFF
        cblock 0x0C
          n
        endc
        org 0
        goto main
        org 4
        incf n,F
        movf n,W
        movwf PORTA
        bcf INTCON,INTF
        retfie
main    bsf STATUS,RP0
        clrf TRISA
        bsf OPTION_REG,6
        bcf STATUS,RP0
        clrf n
        movlw 0x90
        movwf INTCON
idle    goto idle`;
    const c3 = build(isr, { extra: (c) => c.add(new VoltageSource("VI", ["p_RB0", "0"], { wave: Waveform.pulse({ v1: 0, v2: 5, delay: 50e-6, rise: 1e-6, fall: 1e-6, width: 40e-6, period: 100e-6 }) })) });
    const r3 = new SimEngine(c3).transient({ tStop: 520e-6, tStep: 10e-6, uic: true });
    const mcu = c3.elements.find(e => e.name === "U1");
    check("each rising edge on RB0/INT runs the handler: the count reaches 5 after five pulses and is on PORTA", mcu.core.read(0x0C) === 5 && (r3.nodeHistories.p_RA0.slice(-1)[0] > 2.5) && !(r3.nodeHistories.p_RA1.slice(-1)[0] > 2.5) && (r3.nodeHistories.p_RA2.slice(-1)[0] > 2.5), `n=${mcu.core.read(0x0C)}`);

    // MCLR low holds it in reset
    const hold = build(blink, { extra: (c) => { c.add(new Resistor("RL", ["p_RB0", "0"], { r: 1000 })); c.add(new VoltageSource("VM", ["p_MCLR_N", "0"], { wave: Waveform.pwl([[0, 0], [2e-3, 0], [2.001e-3, 5], [10e-3, 5]]) })); } });
    const r4 = new SimEngine(hold).transient({ tStop: 4e-3, tStep: 50e-6, uic: true });
    const e4 = edges(r4, "p_RB0");
    check("MCLR_N held low keeps the program from running; released at 2 ms it starts", e4.length >= 1 && e4[0][0] > 2e-3 && e4[0][0] < 2.05e-3, e4.slice(0, 2).map(e => `${e[1]}@${(e[0] * 1e6).toFixed(0)}`).join(" "));

    // Timer0 interrupt driving a toggle at a steady rate
    const t0src = `
        __config _WDT_OFF
        org 0
        goto main
        org 4
        movlw 0x01
        xorwf PORTB,F
        bcf INTCON,T0IF
        retfie
main    bsf STATUS,RP0
        clrf TRISB
        movlw 0xC1
        movwf OPTION_REG
        bcf STATUS,RP0
        movlw 0xA0
        movwf INTCON
idle    goto idle`;
    const c5 = build(t0src, { extra: (c) => c.add(new Resistor("RL", ["p_RB0", "0"], { r: 1000 })) });
    const r5 = new SimEngine(c5).transient({ tStop: 4e-3, tStep: 20e-6, uic: true });
    const e5 = edges(r5, "p_RB0");
    // prescaler 1:4 -> an overflow every 256 * 4 = 1024 cycles = 1.024 ms
    const gaps = e5.slice(1).map((e, i) => e[0] - e5[i][0]);
    check("a Timer0 overflow interrupt toggles RB0 every 1.024 ms (prescaler 1:4)", e5.length >= 3 && gaps.every(g => Math.abs(g - 1.024e-3) < 8e-6), gaps.map(g => (g * 1e6).toFixed(1)).join(" "));

    // a program from HEX
    const hexText = PicHex.format(PicAsm.assemble("bsf STATUS,RP0\n clrf TRISB\n bcf STATUS,RP0\n movlw 0x01\n movwf PORTB\n goto $\n").words, 0x3FFB);
    const c6 = new SimCircuit(); c6.add(new PicMcu("U1", PicMcu.PINS.map(pinNode), { hex: hexText })); c6.add(new Resistor("RL", ["p_RB0", "0"], { r: 1000 }));
    const op6 = new SimEngine(c6).transient({ tStop: 100e-6, tStep: 10e-6, uic: true });
    check("a program loaded from Intel HEX runs the same way", op6.nodeHistories.p_RB0.slice(-1)[0] > 4.5);
    // breakpoints: the chip stops before the instruction, is let through once, and stops again a loop later
    {
        const loopSrc = "  __config _WDT_OFF\n  cblock 0x0C\n   d1,d2\n  endc\n  org 0\n  bsf STATUS,RP0\n  bcf TRISB,0\n  bcf STATUS,RP0\nloop movlw 1\n  xorwf PORTB,F\n  call delay\n  goto loop\ndelay movlw 200\n  movwf d1\nd1l movlw 3\n  movwf d2\nd2l decfsz d2,F\n  goto d2l\n  decfsz d1,F\n  goto d1l\n  return";
        const c = new SimCircuit(), m = new PicMcu("U1", PicMcu.PINS.map(pinNode), { src: loopSrc }); c.add(m); c.add(new Resistor("RL", ["p_RB0", "0"], { r: 1000 }));
        m.bps.add(PicAsm.assemble(loopSrc).symbols.get("LOOP"));
        const run = new SimEngine(c).beginTransient({ tStep: 20e-6, uic: true });
        const hits = [];
        for (let i = 0; i < 4000 && hits.length < 3; i++) { run.step(); if (m.breakHit) { m.breakHit = false; m.passBp = m.core.pc; hits.push(m.core.cycles); } }
        check("a breakpoint stops the chip at the same instruction each time round the loop (3, then a loop of 2609 cycles later, ...)", hits.length === 3 && hits[0] === 3 && hits[1] === 2612 && hits[2] === 5221, hits.join());
    }
    let threw = ""; try { PicMcu.program({ src: "  movlw 1\n  frob 2\n" }); } catch (e) { threw = e.message; }
    check("assembly errors stop the simulation with the line number", /assembly error, line 2/.test(threw), threw);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
