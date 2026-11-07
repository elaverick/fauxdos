import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFake6502MP } from '../src/fake6502-wasm.js';

const wasm = new Uint8Array(fs.readFileSync(new URL('../build/fake6502mp.wasm', import.meta.url)));
const rom = new Uint8Array(fs.readFileSync(new URL('../build/rom.bin', import.meta.url)));

test('WebAssembly exports 6502MP ABI 1.1 without host imports', async () => {
  const module = new WebAssembly.Module(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const exports = WebAssembly.Module.exports(module).map(x => x.name);
  for (const name of ['memory','mp_init','mp_push_key','mp_reset','mp_step','mp_run','mp_spawn','mp_get_thread_state','mp_get_thread_pc','mp_get_total_instructions','mp_get_video_byte','mp_clear_video_byte']) assert.ok(exports.includes(name), name);
  const cpu = await createFake6502MP({ wasm, initialMemory: new Uint8Array(65536) });
  assert.equal(cpu.abiVersion, '1.1');
  assert.equal(cpu.memory.length, 65536);
  cpu.memory.set(rom, 0xf000);
  cpu.reset(0xf000, 0xfd);
  let video = '';
  for (let i = 0; i < 15000; i++) {
    const cycles = cpu.step();
    assert.ok(cycles > 0);
    const c = cpu.wasmExports.mp_get_video_byte() & 255;
    if (c) {
      video += String.fromCharCode(c);
      cpu.wasmExports.mp_clear_video_byte();
    }
  }
  assert.equal(cpu.getThread(0).state, cpu.threadStates.RUNNING);
  assert.match(video, /FAUXDOS 6502/);
  assert.match(video, /C>/);
  assert.equal(cpu.pushKey(13), true);
});

test('guest TSPAWN creates a second independently scheduled context', async () => {
  const cpu = await createFake6502MP({ wasm, initialMemory: new Uint8Array(65536), quantum: 4 });
  const m = cpu.memory;
  // main: TSPAWN $0200; JMP $0103; worker: INX; JMP $0201
  m.set([0x02,0x00,0x02,0x4c,0x03,0x01],0x0100);
  m.set([0xe8,0x4c,0x01,0x02],0x0200);
  cpu.reset(0x0100,0xfd);
  cpu.run(200);
  const worker=cpu.getThread(1);
  assert.ok(worker);
  assert.notEqual(worker.state,cpu.threadStates.FREE);
  assert.ok(cpu.getThread(0).pc !== worker.pc || cpu.getThread(0).x !== worker.x);
  assert.ok(cpu.totalInstructions >= 200);
});

test('standard LDX immediate remains available alongside MP semaphore extensions', async () => {
  const cpu = await createFake6502MP({ wasm, initialMemory: new Uint8Array(65536) });
  const m = cpu.memory;
  // LDX #$2A; JMP $0102
  m.set([0xA2, 0x2A, 0x4C, 0x02, 0x01], 0x0100);
  cpu.reset(0x0100, 0xfd);
  cpu.run(20);
  assert.equal(cpu.getThread(0).x, 0x2A);
});
