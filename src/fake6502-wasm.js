const MASK8 = 0xff;
const MASK16 = 0xffff;
const THREAD_STATES = Object.freeze({ FREE: 0, READY: 1, RUNNING: 2, BLOCKED: 3, SLEEPING: 4, DEAD: 5 });

/** Load the 6502MP C machine compiled to WebAssembly. One WASM instance = one computer. */
export async function createFake6502MP({ wasm, initialMemory, quantum = 32 } = {}) {
  if (!(wasm instanceof WebAssembly.Module) && !(wasm instanceof ArrayBuffer) && !ArrayBuffer.isView(wasm)) {
    throw new TypeError("wasm must be WebAssembly.Module, ArrayBuffer, or typed-array view");
  }
  let input;
  if (initialMemory instanceof Uint8Array) input = initialMemory;
  else if (initialMemory) input = new Uint8Array(initialMemory);
  else input = new Uint8Array(65536);
  if (input.byteLength !== 65536) throw new RangeError("6502MP machine memory must be exactly 65536 bytes");

  const result = await WebAssembly.instantiate(wasm, {});
  const instance = result instanceof WebAssembly.Instance ? result : result.instance;
  const e = instance.exports;
  const memory = e.memory;
  e.mp_init(0, 0);
  const memoryPointer = e.mp_memory_ptr() >>> 0;
  const ram = new Uint8Array(memory.buffer, memoryPointer, 65536);
  ram.set(input);
  e.mp_set_quantum(quantum);

  const validThread = id => {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 0 || n >= 16) throw new RangeError("Thread ID must be 0-15");
    return n;
  };
  const cpu = {
    memory: ram,
    wasmInstance: instance,
    wasmMemory: memory,
    wasmExports: e,
    memoryPointer,
    abiVersion: `${e.mp_abi_major()}.${e.mp_abi_minor()}`,
    threadStates: THREAD_STATES,
    reset(entry = 0xf000, stackPointer = 0xfd) { e.mp_reset(entry & MASK16, stackPointer & MASK8); },
    resetFromROM(entry = 0xf000, stackPointer = 0xfd) { e.mp_reset(entry, stackPointer); },
    step() { return e.mp_step() | 0; },
    pushKey(value) { return !!e.mp_push_key(Number(value) & MASK8); },
    run(maxInstructions = 10000) { return e.mp_run(maxInstructions >>> 0) >>> 0; },
    spawn(entry, stackPointer = 0xfd) { return e.mp_spawn(entry & MASK16, stackPointer & MASK8) & MASK8; },
    wake(id) { return !!e.mp_wake(validThread(id)); },
    raiseIRQ(id = 0) { return e.mp_raise_irq(validThread(id)) & MASK8; },
    raiseNMI(id = 0) { return e.mp_raise_nmi(validThread(id)) & MASK8; },
    setQuantum(value) { e.mp_set_quantum(value >>> 0); },
    get activeThread() { return e.mp_get_active_thread() | 0; },
    get idle() { return !!e.mp_is_idle(); },
    get totalCycles() { return e.mp_get_total_cycles() >>> 0; },
    get totalInstructions() { return e.mp_get_total_instructions() >>> 0; },
    getThread(id) {
      const n = validThread(id);
      const state = e.mp_get_thread_state(n) >>> 0;
      if (state === 0xffffffff) return null;
      return Object.freeze({
        id: n,
        state,
        pc: e.mp_get_thread_pc(n) & MASK16,
        a: e.mp_get_thread_a(n) & MASK8,
        x: e.mp_get_thread_x(n) & MASK8,
        y: e.mp_get_thread_y(n) & MASK8,
        sp: e.mp_get_thread_sp(n) & MASK8,
        p: e.mp_get_thread_p(n) & MASK8,
      });
    },
    getThreads() { return Array.from({ length: 16 }, (_, i) => cpu.getThread(i)); },
  };
  return cpu;
}

export async function loadFake6502MP({ wasmURL = new URL("../build/fake6502mp.wasm", import.meta.url), ...options } = {}) {
  const response = await fetch(wasmURL);
  if (!response.ok) throw new Error(`Unable to load fake6502mp.wasm: HTTP ${response.status}`);
  return createFake6502MP({ ...options, wasm: await response.arrayBuffer() });
}
