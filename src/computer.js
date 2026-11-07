import { createFake6502MP } from "./fake6502-wasm.js";
import { DiskImage } from "./disk.js";
import { GraphicsDisplay, GRAPHICS } from "./graphics.js";

const IO = Object.freeze({
  VIDEO_DATA: 0xd000, VIDEO_CONTROL: 0xd001, KEYBOARD_DATA: 0xd010,
  DISK_COMMAND: 0xd100, DISK_STATUS: 0xd101, DISK_NAME_LO: 0xd102, DISK_NAME_HI: 0xd103,
  DISK_PTR_LO: 0xd104, DISK_PTR_HI: 0xd105, DISK_SIZE_LO: 0xd106, DISK_SIZE_HI: 0xd107,
  DISK_DIR_COUNT: 0xd108,
});

export class TextDisplay {
  constructor(columns = 80, rows = 25) {
    this.columns = columns; this.rows = rows;
    this.cells = new Uint8Array(columns * rows); this.cells.fill(32);
    this.cursorX = 0; this.cursorY = 0; this.revision = 0;
  }
  clear() { this.cells.fill(32); this.cursorX = this.cursorY = 0; this.revision++; }
  newline() {
    this.cursorX = 0; this.cursorY++;
    if (this.cursorY >= this.rows) { this.cells.copyWithin(0, this.columns); this.cells.fill(32, this.cells.length - this.columns); this.cursorY = this.rows - 1; }
    this.revision++;
  }
  write(value) {
    const c = value & 255;
    if (!c) return;
    if (c === 10 || c === 13) { this.newline(); return; }
    if (c === 8 || c === 127) {
      if (this.cursorX) this.cursorX--; else if (this.cursorY) { this.cursorY--; this.cursorX = this.columns - 1; }
      this.cells[this.cursorY * this.columns + this.cursorX] = 32; this.revision++; return;
    }
    if (c < 32) return;
    this.cells[this.cursorY * this.columns + this.cursorX] = c; this.cursorX++;
    if (this.cursorX >= this.columns) this.newline(); else this.revision++;
  }
}

export class Fake6502Computer {
  constructor({ cpu, rom, disk, display = new TextDisplay(), onDiskChanged = () => {} }) {
    this.cpu = cpu; this.memory = cpu.memory; this.ram = this.memory;
    this.rom = rom instanceof Uint8Array ? rom : new Uint8Array(rom);
    if (this.rom.length !== 4096) throw new Error("ROM must be exactly 4096 bytes mapped at $F000");
    this.disk = disk instanceof DiskImage ? disk : new DiskImage(disk);
    this.display = display; this.graphics = new GraphicsDisplay(this.memory); this.onDiskChanged = onDiskChanged;
    this.lastDiskError = null; this.instructionsExecuted = 0;
  }
  static async create({ wasm, rom, disk, display, onDiskChanged, quantum = 32 } = {}) {
    const cpu = await createFake6502MP({ wasm, quantum });
    const machine = new Fake6502Computer({ cpu, rom, disk, display, onDiskChanged });
    machine.reset(); return machine;
  }
  pollDevices() {
    const byte = this.cpu.wasmExports.mp_get_video_byte() & 255;
    if (byte) { this.display.write(byte); this.cpu.wasmExports.mp_clear_video_byte(); }
    if (this.memory[IO.VIDEO_CONTROL] & 1) { this.display.clear(); this.memory[IO.VIDEO_CONTROL] = 0; }
    this.graphics.execute();
    const cmd = this.memory[IO.DISK_COMMAND];
    if (cmd) { this.executeDiskCommand(cmd); this.memory[IO.DISK_COMMAND] = 0; }
  }
  executeDiskCommand(command) {
    const m = this.memory;
    const namePointer = m[IO.DISK_NAME_LO] | (m[IO.DISK_NAME_HI] << 8);
    const dataPointer = m[IO.DISK_PTR_LO] | (m[IO.DISK_PTR_HI] << 8);
    const size = m[IO.DISK_SIZE_LO] | (m[IO.DISK_SIZE_HI] << 8);
    let result;
    try { result = this.disk.executeCommand(command, m, { namePointer, dataPointer, size }); this.lastDiskError = result.status ? `Disk status ${result.status}` : null; }
    catch (error) { result = { status: 0xff, count: 0, size: 0 }; this.lastDiskError = error instanceof Error ? error.message : String(error); }
    m[IO.DISK_STATUS] = result.status & 255; m[IO.DISK_DIR_COUNT] = result.count & 255;
    m[IO.DISK_SIZE_LO] = result.size & 255; m[IO.DISK_SIZE_HI] = (result.size >>> 8) & 255;
    if (command >= 3 && command <= 6 && result.status === 0) this.onDiskChanged(this.disk);
  }
  reset() {
    // Keep ROM and video device semantics. Reset CPU contexts without clearing the loaded ROM.
    this.memory.fill(0, 0, 65536); this.memory.set(this.rom, 0xf000);
    this.display.clear(); this.graphics.reset(); this.cpu.reset(0xf000, 0xfd);
  }
  enqueueKey(code) { const c = Number(code) & 255; if (c) this.cpu.pushKey(c); }
  enqueueText(text) {
    for (const character of String(text)) {
      const code = character === "\n" || character === "\r" ? 13 : character === "\b" ? 8 : character.charCodeAt(0);
      if (code > 0 && code < 256) this.enqueueKey(code);
    }
  }
  runCycles(cycleBudget = 16667) {
    let cycles = 0, instructions = 0, idleSpins = 0;
    while (cycles < cycleBudget && instructions < cycleBudget * 16) {
      const spent = this.cpu.step();
      this.pollDevices();
      if (!spent) { idleSpins++; break; }
      cycles += Math.max(1, spent | 0); instructions++;
    }
    this.instructionsExecuted += instructions;
    return { cycles, instructions, idle: this.cpu.idle, threads: this.cpu.getThreads() };
  }
  exportDisk() { return this.disk.toArrayBuffer(); }
  importDisk(buffer) { this.disk = DiskImage.fromArrayBuffer(buffer); this.onDiskChanged(this.disk); }
  getThreadSnapshot() { return this.cpu.getThreads(); }
}
export { IO, GRAPHICS };
