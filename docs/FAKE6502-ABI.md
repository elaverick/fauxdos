# fake6502 C ↔ WebAssembly ABI

The following contract is retained from `fake6502.h` and the definitions in
`fake6502.c`.

| C declaration | WebAssembly ABI | JS adapter |
|---|---|---|
| `uint8_t read6502(uint16_t address)` | import `env.read6502`: `(i32) -> i32` | `read6502(address)` |
| `void write6502(uint16_t address, uint8_t value)` | import `env.write6502`: `(i32, i32) -> void` | `write6502(address, value)` |
| `uint16_t PC` | exported data-symbol address; 16-bit little-endian in linear memory | `cpu.PC` |
| `uint8_t SP, A, X, Y` | exported data-symbol addresses; 8-bit in linear memory | `cpu.SP`, `cpu.A`, `cpu.X`, `cpu.Y` |
| `void setP(uint8_t)` | exported function `(i32) -> void` | `cpu.setP(value)` |
| `uint8_t getP(void)` | exported function `() -> i32` | `cpu.getP()` |
| `int nmi6502(void)` | exported function `() -> i32` | `cpu.nmi6502()` |
| `int reset6502(void)` | exported function `() -> i32` | `cpu.reset6502()` |
| `int irq6502(void)` | exported function `() -> i32` | `cpu.irq6502()` |
| `int step6502(void)` | exported function `() -> i32` | `cpu.step6502()` |

WebAssembly uses `i32` for both `uint16_t` and `uint8_t` function arguments
under the C ABI. The JS adapter explicitly masks those values to the original C
widths. The register globals are exported as addresses, not copied values, so
JavaScript reads and writes the exact C storage in module linear memory.

`status` appears in the upstream header's `extern` declaration but has no
corresponding definition in the upstream `.c` file. It is intentionally not
created as a new symbol; `getP` and `setP` remain the supported API for flags.

The CPU functions, imported memory callbacks, and register symbol names are
not renamed. This is deliberate: a C translation of a future host can continue
to use the same names and prototypes.
