// Tiny stack VM — a fast, exact interpreter of make.fun's tiny stack ISA v1.
// Node 22, standard library only. Reads MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR
// (defaults /input and /output). For every <id> in the input dir it runs
// <id>/program.bin with <id>/input.bin and writes <id>/stdout.bin (the exact
// bytes the program wrote) and <id>/exit.txt (its exit code, 0-255, decimal).
//
// Every rule of ISA.md is implemented exactly, including the ones most
// implementations get wrong: 32-bit wrapping MUL (Math.imul, exact low 32
// bits), -2147483648 / -1 and % -1, unsigned DIVU/MODU/LTU, shift counts
// masked to 5 bits, PUSH8 sign extension, EXIT's low byte, all eleven trap
// codes (2-11) with the output written before the trap kept, the 1,000,000
// step limit, the 65,536 output limit, falling off the end, and IN after
// the end of the input.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_STEPS = 1_000_000;
const MAX_OUTPUT = 65536;
const STACK_MAX = 256;
const CALL_MAX = 64;
const MEM_SIZE = 256;

// Immediate length in bytes after the opcode (0 where the opcode has none).
const IMM_LEN: Record<number, number> = { 0x01: 1, 0x02: 4, 0x30: 2, 0x31: 2, 0x32: 2, 0x33: 2 };

// Pops / pushes per opcode, for the stack checks (trap 2 underflow, trap 3 overflow).
// [pops, pushes]
const STACK_FX: Record<number, [number, number]> = {
  0x00: [0, 0], 0x01: [0, 1], 0x02: [0, 1], 0x03: [1, 0], 0x04: [1, 2],
  0x05: [2, 2], 0x06: [2, 3], 0x07: [3, 3],
  0x10: [2, 1], 0x11: [2, 1], 0x12: [2, 1], 0x13: [2, 1], 0x14: [2, 1],
  0x15: [2, 1], 0x16: [2, 1], 0x17: [1, 1], 0x18: [2, 1], 0x19: [2, 1],
  0x1a: [2, 1], 0x1b: [1, 1], 0x1c: [2, 1], 0x1d: [2, 1], 0x1e: [2, 1],
  0x20: [2, 1], 0x21: [2, 1], 0x22: [2, 1],
  0x30: [0, 0], 0x31: [1, 0], 0x32: [1, 0], 0x33: [0, 0], 0x34: [0, 0],
  0x40: [1, 1], 0x41: [2, 0], 0x50: [1, 0], 0x51: [1, 0], 0x52: [0, 1], 0x53: [1, 0],
};

function run(program: Uint8Array, input: Uint8Array): { out: Uint8Array; code: number } {
  const stack = new Int32Array(STACK_MAX);
  let sp = 0;
  const call = new Int32Array(CALL_MAX);
  let csp = 0;
  const mem = new Int32Array(MEM_SIZE);
  const out = new Uint8Array(MAX_OUTPUT);
  let outLen = 0;
  const len = program.length;
  let pc = 0;
  let ip = 0;
  let steps = 0;

  const finish = (code: number): { out: Uint8Array; code: number } => ({
    out: out.subarray(0, outLen),
    code,
  });

  for (;;) {
    // 1. Step limit, checked before the instruction.
    if (steps >= MAX_STEPS) return finish(10);
    // 2. pc outside the program.
    if (pc < 0 || pc >= len) return finish(9);
    const op = program[pc];
    // 3. Unknown opcode.
    const fx = STACK_FX[op];
    if (fx === undefined) return finish(5);
    // 4. Immediate cut off by the end of the program.
    const immLen = IMM_LEN[op] ?? 0;
    if (pc + 1 + immLen > len) return finish(9);
    // 5. The instruction executes (counts as one step). Stack needs first.
    steps++;
    const pops = fx[0];
    const pushes = fx[1];
    if (sp < pops) return finish(2);
    if (sp - pops + pushes > STACK_MAX) return finish(3);
    const next = pc + 1 + immLen;

    switch (op) {
      case 0x00: // HALT
        return finish(0);
      case 0x01: // PUSH8, sign-extended
        stack[sp++] = (program[pc + 1] << 24) >> 24;
        pc = next;
        break;
      case 0x02: // PUSH32, little-endian signed
        stack[sp++] =
          program[pc + 1] | (program[pc + 2] << 8) | (program[pc + 3] << 16) | (program[pc + 4] << 24);
        pc = next;
        break;
      case 0x03: // POP
        sp--;
        pc = next;
        break;
      case 0x04: // DUP ( a -- a a )
        stack[sp] = stack[sp - 1];
        sp++;
        pc = next;
        break;
      case 0x05: { // SWAP
        const b = stack[sp - 1];
        const a = stack[sp - 2];
        stack[sp - 2] = b;
        stack[sp - 1] = a;
        pc = next;
        break;
      }
      case 0x06: { // OVER ( a b -- a b a ): copy the second value, not the top
        const a = stack[sp - 2];
        stack[sp++] = a;
        pc = next;
        break;
      }
      case 0x07: { // ROT ( a b c -- b c a )
        const c = stack[sp - 1];
        const b = stack[sp - 2];
        const a = stack[sp - 3];
        stack[sp - 3] = b;
        stack[sp - 2] = c;
        stack[sp - 1] = a;
        pc = next;
        break;
      }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = stack[--sp];
        const a = stack[--sp];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return finish(4);
          r = a === -2147483648 && b === -1 ? -2147483648 : (Math.trunc(a / b) | 0);
        } else if (op === 0x14) {
          if (b === 0) return finish(4);
          r = (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return finish(4);
          r = Math.trunc((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return finish(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // 0x22 LTU
        stack[sp++] = r;
        pc = next;
        break;
      }
      case 0x17: // NEG (wraps: -(-2147483648) is -2147483648)
        stack[sp - 1] = (-stack[sp - 1]) | 0;
        pc = next;
        break;
      case 0x1b: // NOT
        stack[sp - 1] = ~stack[sp - 1];
        pc = next;
        break;
      case 0x30: { // JMP, signed 16-bit LE offset from the next instruction
        const off = ((program[pc + 1] | (program[pc + 2] << 8)) << 16) >> 16;
        pc = next + off;
        break;
      }
      case 0x31: { // JZ
        const v = stack[--sp];
        const off = ((program[pc + 1] | (program[pc + 2] << 8)) << 16) >> 16;
        pc = v === 0 ? next + off : next;
        break;
      }
      case 0x32: { // JNZ
        const v = stack[--sp];
        const off = ((program[pc + 1] | (program[pc + 2] << 8)) << 16) >> 16;
        pc = v !== 0 ? next + off : next;
        break;
      }
      case 0x33: { // CALL, unsigned 16-bit LE target
        if (csp >= CALL_MAX) return finish(7);
        call[csp++] = next;
        pc = program[pc + 1] | (program[pc + 2] << 8);
        break;
      }
      case 0x34: // RET
        if (csp === 0) return finish(8);
        pc = call[--csp];
        break;
      case 0x40: { // LOAD
        const addr = stack[sp - 1];
        if (addr < 0 || addr > 255) return finish(6);
        stack[sp - 1] = mem[addr];
        pc = next;
        break;
      }
      case 0x41: { // STORE ( v addr -- )
        const addr = stack[--sp];
        const v = stack[--sp];
        if (addr < 0 || addr > 255) return finish(6);
        mem[addr] = v;
        pc = next;
        break;
      }
      case 0x50: { // PRINT, decimal ASCII, no newline
        const v = stack[--sp];
        const s = String(v);
        if (outLen + s.length > MAX_OUTPUT) return finish(11);
        for (let i = 0; i < s.length; i++) out[outLen++] = s.charCodeAt(i);
        pc = next;
        break;
      }
      case 0x51: { // PUTC, one byte
        const v = stack[--sp];
        if (outLen + 1 > MAX_OUTPUT) return finish(11);
        out[outLen++] = v & 255;
        pc = next;
        break;
      }
      case 0x52: // IN, -1 once the input is used up
        stack[sp++] = ip < input.length ? input[ip++] : -1;
        pc = next;
        break;
      case 0x53: // EXIT, low byte of v
        return finish(stack[--sp] & 255);
      default:
        return finish(5);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const dir = join(I, id);
  let program: Uint8Array = new Uint8Array(0);
  let input: Uint8Array = new Uint8Array(0);
  try {
    program = readFileSync(join(dir, 'program.bin'));
  } catch {
    program = new Uint8Array(0);
  }
  try {
    input = readFileSync(join(dir, 'input.bin'));
  } catch {
    input = new Uint8Array(0);
  }
  const r = run(program, input);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
