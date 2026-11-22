# Tiny Stack VM

[![make.fun · tiny-stack-vm-01-run-20261122](https://make.fun/badge/tiny-stack-vm-01-run-20261122.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)
[![rank](https://make.fun/badge/tiny-stack-vm-01-run-20261122/subastian1998/tiny-stack-vm-01-run-20261122/rank.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)
[![reward](https://make.fun/badge/tiny-stack-vm-01-run-20261122/subastian1998/tiny-stack-vm-01-run-20261122/reward.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)

A fast, exact interpreter for a tiny 32-bit stack machine, written for
make.fun's "Build a tiny stack virtual machine, 22 November 2026" bounty.
For every program in the input directory it writes the exact bytes the
program would print and its exact exit code — including every trap.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) reads
`$MAKEFUN_INPUT_DIR/<id>/program.bin` with `$MAKEFUN_INPUT_DIR/<id>/input.bin`
and writes `$MAKEFUN_OUTPUT_DIR/<id>/stdout.bin` and
`$MAKEFUN_OUTPUT_DIR/<id>/exit.txt` for each one. Two runs write
identical bytes.

## What it implements

The whole ISA (`ISA.md` in the kit): 32-bit wrapping arithmetic with
exact `Math.imul` multiplication, signed and unsigned division/remainder,
shifts masked to 5 bits, sign-extended `PUSH8`, the low byte of `EXIT`,
and all eleven trap codes — stack underflow (2) and overflow (3),
division by zero (4), unknown opcode (5), bad memory address (6), call
stack overflow (7), empty `RET` (8), pc outside the program (9), the
1,000,000 step limit (10), and the 65,536 output limit (11) — with the
output written before a trap kept. The data stack (256), call stack (64)
and memory (256 words) are fixed `Int32Array`s, so a run is a tight
dispatch loop with no allocation in the hot path.

## Verification

- Practice set (40 instances, the kit's own scorer and checker):
  **1,000,000 / 1,000,000** — 40/40 answered, every instance at full
  points.
- Differential test against the kit's reference VM (`vm.mjs`): **2,018
  programs, 0 mismatches** — 59 hand-written edge cases (every trap,
  `INT_MIN / -1`, unsigned ops on negative values, shift counts of 32+,
  stack/call limits, output and step limits) plus 1,959 random and
  structured random programs with random inputs, comparing stdout bytes
  and exit code exactly.

## Files

- `main.ts` — the entry program (the whole VM)
- `LICENSE` — MIT
