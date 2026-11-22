// Tiny stack VM: exact interpreter of make.fun's tiny stack ISA v1 (Node 22,
// stdlib only). Reads MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR; per <id> runs
// program.bin on input.bin, writes stdout.bin + exit.txt (exit code 0-255).
// Wrapping 32-bit arithmetic (Math.imul), unsigned DIVU/MODU/LTU, shifts
// masked to 5 bits, PUSH8 sign extension, EXIT low byte, all trap codes 2-11.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SL = 1_000_000, OL = 65536, SM = 256, CM = 64, MM = 256;
// [pops, pushes] per opcode, for the stack checks (trap 2 underflow, trap 3 overflow).
const FX = {
  0x00: [0, 0], 0x01: [0, 1], 0x02: [0, 1], 0x03: [1, 0], 0x04: [1, 2], 0x05: [2, 2], 0x06: [2, 3], 0x07: [3, 3],
  0x10: [2, 1], 0x11: [2, 1], 0x12: [2, 1], 0x13: [2, 1], 0x14: [2, 1], 0x15: [2, 1], 0x16: [2, 1], 0x17: [1, 1],
  0x18: [2, 1], 0x19: [2, 1], 0x1a: [2, 1], 0x1b: [1, 1], 0x1c: [2, 1], 0x1d: [2, 1], 0x1e: [2, 1],
  0x20: [2, 1], 0x21: [2, 1], 0x22: [2, 1],
  0x30: [0, 0], 0x31: [1, 0], 0x32: [1, 0], 0x33: [0, 0], 0x34: [0, 0],
  0x40: [1, 1], 0x41: [2, 0], 0x50: [1, 0], 0x51: [1, 0], 0x52: [0, 1], 0x53: [1, 0],
};

function run(p: Uint8Array, inp: Uint8Array) {
  const st = new Int32Array(SM);
  let sp = 0;
  const cs = new Int32Array(CM);
  let csp = 0;
  const m = new Int32Array(MM);
  const o = new Uint8Array(OL);
  let ol = 0;
  const n = p.length;
  let pc = 0, ip = 0, steps = 0;
  const done = (code: number) => ({ out: o.subarray(0, ol), code });
  for (;;) {
    if (steps >= SL) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = p[pc];
    const fx = FX[op as keyof typeof FX];
    if (fx === undefined) return done(5);
    const il = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
    if (pc + 1 + il > n) return done(9);
    steps++;
    if (sp < fx[0]) return done(2);
    if (sp - fx[0] + fx[1] > SM) return done(3);
    const nx = pc + 1 + il;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: st[sp++] = (p[pc + 1] << 24) >> 24; pc = nx; break;
      case 0x02: st[sp++] = p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24); pc = nx; break;
      case 0x03: sp--; pc = nx; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; pc = nx; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; pc = nx; break; }
      case 0x06: { const a = st[sp - 2]; st[sp++] = a; pc = nx; break; }
      case 0x07: { const c = st[sp - 1], b = st[sp - 2], a = st[sp - 3]; st[sp - 3] = b; st[sp - 2] = c; st[sp - 1] = a; pc = nx; break; }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = st[--sp], a = st[--sp];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return done(4); r = a === -2147483648 && b === -1 ? -2147483648 : (Math.trunc(a / b) | 0); }
        else if (op === 0x14) { if (b === 0) return done(4); r = (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return done(4); r = Math.trunc((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return done(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        st[sp++] = r; pc = nx; break;
      }
      case 0x17: st[sp - 1] = (-st[sp - 1]) | 0; pc = nx; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; pc = nx; break;
      case 0x30: pc = nx + (((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16); break;
      case 0x31: { const v = st[--sp]; pc = v === 0 ? nx + (((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16) : nx; break; }
      case 0x32: { const v = st[--sp]; pc = v !== 0 ? nx + (((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16) : nx; break; }
      case 0x33: if (csp >= CM) return done(7); cs[csp++] = nx; pc = p[pc + 1] | (p[pc + 2] << 8); break;
      case 0x34: if (csp === 0) return done(8); pc = cs[--csp]; break;
      case 0x40: { const a = st[sp - 1]; if (a < 0 || a > 255) return done(6); st[sp - 1] = m[a]; pc = nx; break; }
      case 0x41: { const a = st[--sp], v = st[--sp]; if (a < 0 || a > 255) return done(6); m[a] = v; pc = nx; break; }
      case 0x50: { const s = String(st[--sp]); if (ol + s.length > OL) return done(11); for (let i = 0; i < s.length; i++) o[ol++] = s.charCodeAt(i); pc = nx; break; }
      case 0x51: { const v = st[--sp]; if (ol + 1 > OL) return done(11); o[ol++] = v & 255; pc = nx; break; }
      case 0x52: st[sp++] = ip < inp.length ? inp[ip++] : -1; pc = nx; break;
      case 0x53: return done(st[--sp] & 255);
      default: return done(5);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const d = join(I, id);
  let p: Uint8Array = new Uint8Array(0), inp: Uint8Array = new Uint8Array(0);
  try { p = readFileSync(join(d, 'program.bin')); } catch { /* empty program traps 9 */ }
  try { inp = readFileSync(join(d, 'input.bin')); } catch { /* empty input */ }
  const r = run(p, inp);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
