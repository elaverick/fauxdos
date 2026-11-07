import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Fake6502Computer, TextDisplay } from '../src/computer.js';
import { DiskImage } from '../src/disk.js';

const wasm = new Uint8Array(fs.readFileSync(new URL('../build/fake6502mp.wasm', import.meta.url)));
const rom = new Uint8Array(fs.readFileSync(new URL('../build/rom.bin', import.meta.url)));
const diskBytes = new Uint8Array(fs.readFileSync(new URL('../build/disk.dsk', import.meta.url)));

test('THREADS executable spawns a worker, joins it, and returns to the shell', async () => {
  const machine = await Fake6502Computer.create({ wasm, rom, disk: new DiskImage(diskBytes), display: new TextDisplay(80, 25) });
  machine.runCycles(200000);
  machine.enqueueText('THREADS\r');
  let output = '';
  for (let i = 0; i < 30; i++) {
    machine.runCycles(200000);
    output = Array.from(machine.display.cells, c => c ? String.fromCharCode(c) : ' ').join('');
    if (output.includes('JOIN COMPLETE')) break;
  }
  assert.match(output, /THREAD CREATED - PARENT WAITING/);
  assert.match(output, /WORKER RUNNING IN CONTEXT 1/);
  assert.match(output, /WORKER EXITED - JOIN COMPLETE/);
  assert.equal(machine.cpu.getThread(1).state, machine.cpu.threadStates.DEAD);
  assert.equal(machine.cpu.getThread(0).state, machine.cpu.threadStates.RUNNING);
});

test('CAT HELLO.TXT parses its argument, displays the file, and returns to the prompt', async () => {
  const display = new TextDisplay(80, 25);
  const machine = await Fake6502Computer.create({ wasm, rom, disk: new DiskImage(diskBytes), display });
  machine.runCycles(200000);
  machine.enqueueText('cat hello.txt\r');
  machine.runCycles(500000);
  const rows = Array.from({ length: display.rows }, (_, y) =>
    Array.from(display.cells.slice(y * display.columns, (y + 1) * display.columns), c => String.fromCharCode(c)).join(''));
  const output = rows.join('\n');
  assert.match(output, /This text lives in the disk image/);
  assert.equal(rows[display.cursorY].trimEnd(), 'C>');
  assert.equal(machine.lastDiskError, null);
  assert.ok(display.cursorY < display.rows - 1, 'shell prompt should not be stuck at the bottom row');
});
