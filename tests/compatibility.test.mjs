import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFake6502 } from "../src/fake6502-wasm.js";
import { Fake6502Computer } from "../src/computer.js";
import { DiskImage } from "../src/disk.js";

const wasmBytes = new Uint8Array(await readFile(new URL("../build/fake6502.wasm", import.meta.url)));
const wasmModule = await WebAssembly.compile(wasmBytes);
const rom = new Uint8Array(await readFile(new URL("../build/rom.bin", import.meta.url)));
const diskBytes = new Uint8Array(await readFile(new URL("../build/disk.dsk", import.meta.url)));

function screenText(machine) {
  const rows = [];
  for (let y = 0; y < machine.display.rows; y += 1) {
    rows.push(String.fromCharCode(...machine.display.cells.slice(y * machine.display.columns, (y + 1) * machine.display.columns)));
  }
  return rows.join("\n");
}

async function bootMachine(onDiskChanged = () => {}) {
  return Fake6502Computer.create({ wasm: wasmBytes, rom, disk: new DiskImage(diskBytes), onDiskChanged });
}

function runCommand(machine, command) {
  machine.enqueueText(`${command}\r`);
  machine.runCycles(250_000);
  return screenText(machine);
}

test("WebAssembly module retains the original fake6502 import/export surface", () => {
  const imports = WebAssembly.Module.imports(wasmModule)
    .map(({ module, name, kind }) => `${module}.${name}:${kind}`).sort();
  assert.deepEqual(imports, ["env.read6502:function", "env.write6502:function"]);
  const exports = WebAssembly.Module.exports(wasmModule).map(x => x.name).sort();
  assert.deepEqual(exports, ["A", "PC", "SP", "X", "Y", "getP", "irq6502", "memory", "nmi6502", "reset6502", "setP", "step6502"].sort());
});

test("adapter keeps original register widths, flags, memory callbacks and CPU entry points", async () => {
  const ram = new Uint8Array(65536);
  const readAddresses = [];
  const writes = [];
  const cpu = await createFake6502({
    wasm: wasmBytes,
    read6502(address) { readAddresses.push(address); return ram[address]; },
    write6502(address, value) { writes.push([address, value]); ram[address] = value; },
  });
  ram[0xfffc] = 0x00; ram[0xfffd] = 0x80;
  ram.set([0xa9, 0x42, 0xa2, 0x11, 0x69, 0x01, 0x8d, 0x00, 0x02], 0x8000);
  assert.equal(cpu.reset6502(), 7);
  assert.equal(cpu.PC, 0x8000);
  assert.equal(cpu.SP, 0xfd);
  assert.equal(cpu.step6502(), 2); assert.equal(cpu.A, 0x42);
  assert.equal(cpu.step6502(), 2); assert.equal(cpu.X, 0x11);
  assert.equal(cpu.step6502(), 2); assert.equal(cpu.A, 0x43);
  assert.equal(cpu.step6502(), 4); assert.equal(ram[0x0200], 0x43);
  cpu.PC = 0x12345; cpu.A = 0x1ff; cpu.SP = -1;
  assert.equal(cpu.PC, 0x2345); assert.equal(cpu.A, 0xff); assert.equal(cpu.SP, 0xff);
  cpu.setP(0xcb); assert.equal(cpu.getP(), 0xeb);
  assert.ok(readAddresses.includes(0x8000));
  assert.ok(writes.some(([a, v]) => a === 0x0200 && v === 0x43));
});

test("boot ROM prints prompt and DIR/CAT execute from the disk image", async () => {
  const machine = await bootMachine();
  machine.runCycles(30_000);
  assert.match(screenText(machine), /FAUXDOS 6502 - READY/);
  assert.match(screenText(machine), /C> /);

  const dir = runCommand(machine, "DIR");
  for (const name of ["DIR", "CAT", "WRITE", "HELP", "HELLO", "README.TXT"]) assert.ok(dir.includes(name), `DIR should contain ${name}`);

  const cat = runCommand(machine, "CAT README.TXT");
  assert.ok(cat.includes("FAUXDOS 6502 COMPUTER"));
  assert.ok(cat.includes("assembled ROM"));
  const catUsage = runCommand(machine, "CAT");
  assert.ok(catUsage.includes("USAGE: CAT NAME"));

  const hello = runCommand(machine, "hello");
  assert.ok(hello.includes("HELLO FROM A REAL 6502 PROGRAM"));

  const help = runCommand(machine, "HELP");
  assert.ok(help.includes("DISPLAY A FILE"));
});

test("WRITE executes an assembled program, changes the disk image, and CAT reads it back", async () => {
  let saves = 0;
  const machine = await bootMachine(() => { saves += 1; });
  machine.runCycles(25_000);
  const result = runCommand(machine, "WRITE NOTE.TXT HELLO FROM THE 6502");
  assert.ok(result.includes("SAVED"));
  assert.equal(saves, 1);
  assert.equal(new TextDecoder().decode(machine.disk.readFile("NOTE.TXT")), "HELLO FROM THE 6502");
  const mixedCase = runCommand(machine, "write CASE.TXT Mixed Case Is Preserved");
  assert.ok(mixedCase.includes("SAVED"));
  assert.equal(new TextDecoder().decode(machine.disk.readFile("CASE.TXT")), "Mixed Case Is Preserved");
  const roundTrip = runCommand(machine, "CAT NOTE.TXT");
  assert.ok(roundTrip.includes("HELLO FROM THE 6502"));

  const restored = DiskImage.fromArrayBuffer(machine.exportDisk());
  assert.equal(new TextDecoder().decode(restored.readFile("NOTE.TXT")), "HELLO FROM THE 6502");
});

 test("disk image directory format and bounded write failures are deterministic", () => {
  const disk = DiskImage.format();
  disk.writeFile("A.TXT", new TextEncoder().encode("one"));
  disk.writeFile("B.TXT", new TextEncoder().encode("two"));
  disk.writeFile("A.TXT", new TextEncoder().encode("updated"));
  assert.deepEqual(disk.list().map(x => x.name), ["A.TXT", "B.TXT"]);
  assert.equal(new TextDecoder().decode(disk.readFile("A.TXT")), "updated");
  assert.throws(() => disk.writeFile("INVALID NAME", new Uint8Array()), /Filenames/);
});
