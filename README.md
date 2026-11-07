# FauxDOS 6502 WebToy

A tiny 6502 computer running in the browser. The CPU is [`elaverick/fake6502MP`](https://github.com/elaverick/fake6502MP), a multithreaded 6502 C core compiled to WebAssembly. It provides 16 guest CPU contexts, private stack banks, deterministic time-sliced scheduling, thread join/sleep/wake, semaphores and local/global interrupt routing. The ROM monitor and every bundled command are 6502 assembly.
The browser supplies only the memory-mapped display, keyboard and disk device,
plus a GPU-backed terminal texture.

## Run it

Serve the project over HTTP (WebAssembly modules are not loaded from a `file:`
URL in normal browser security contexts):

```sh
python3 -m http.server 8080
```

Open <http://localhost:8080/>. Click the terminal and type commands. There are
no visible controls; the display is the complete UI.

Try:

```text
DIR
HELP
CAT README.TXT
HELLO
WRITE NOTE.TXT HELLO FROM THE 6502
MKDIR NOTES
WRITE NOTES/NOTE.TXT HELLO FROM A DIRECTORY
CAT NOTES/NOTE.TXT
RM NOTES/NOTE.TXT
RMDIR NOTES
CLS
DEMO
SHEET
```

`CLS` clears the terminal and returns the prompt to the top. `MKDIR`, `RM`,
and `RMDIR` are ROM built-ins backed by the disk controller. Paths use `/`;
parent directories must exist and `RMDIR` refuses non-empty directories. There
is no `CD` command yet, so address nested files with full paths.
`DEMO` runs a small animated, masked sprite across a star field; press any key
to return to the shell. `SHEET` launches FauxSheet, an interactive 8-column by
16-row worksheet mock-up. Use the arrow keys to move, type to replace a cell,
Backspace to erase a character, Delete to clear a cell, Tab to move to the next
cell, F1 for help, and Escape to return to FauxDOS. It is intentionally a visual
and interaction prototype: it has no formulas, calculations, or save command yet.

The disk is automatically persisted in IndexedDB (localStorage fallback). On startup, missing bundled executable applications are merged into an existing saved disk without replacing user files, so newly added apps such as `SHEET` appear without clearing the virtual drive.
The original bundled `build/disk.dsk` remains available as the clean starter
image. In the browser developer console, `window.fake6502Computer.exportDisk()`
returns an `ArrayBuffer`; `importDisk(arrayBuffer)` restores an image.

## Build and test

Requirements: Python 3, Node.js 18+, and Clang with the `wasm32-unknown-unknown`
target plus `wasm-ld`.

```sh
./build.sh
npm test
```

`build.sh` assembles the ROM and programs, compiles the preserved C CPU source
to `build/fake6502mp.wasm`, and creates a starter disk image. The small local
assembler is in `tools/asm6502.py`; it supports the instruction/addressing-mode
subset used by the included sources. The `.asm` files are the authoritative
program sources; `.prg`, `.bin`, `.wasm`, and `.dsk` files are generated outputs.

The test suite checks the WebAssembly ABI, boot, guest thread scheduling,
text and graphics rendering, the ROM filesystem commands, and the assembled
`DEMO` program's animation and key-driven return to the shell.

## Design

- `src/fake6502mp.c`, `src/fake6502mp.h`: 6502MP core and public C ABI, kept in C to make a later native C build direct.
- `src/fake6502-wasm.js`: very thin binding. The original `read6502` and
  `write6502` callback names and CPU entry points remain unchanged.
- `asm/os.asm`: ROM monitor, command interpreter and fixed OS call table.
- `asm/*.asm`: executable commands and example programs (including FauxSheet), all assembled for
  entry at `$4000`.
- `src/computer.js`: 64 KiB memory bus, memory-mapped I/O, keyboard and CPU
  scheduler.
- `src/disk.js`: binary disk-image format and disk-controller operations.
- `src/renderer.js`: VT323 rasterisation and WebGPU/WebGL2 texture presentation.
- `src/phosphor.js`: browser-only Rec.709 luma conversion to green phosphor; it does not modify guest palette or framebuffer data.
- `docs/OS-STUB.md`: full memory map, executable ABI, disk device and disk
  image format required to reproduce the OS stub in another language.

## Graphics and NeonCity integration

The 80x25 character buffer is rendered to a 960x600 RGBA image. The 12-pixel-wide cells remove the excessive tracking visible in the earlier 40-column render. WebGPU is the
preferred presentation backend; WebGL2 is the fallback, with a 2D canvas fallback
for browsers without either GPU API. The exposed
`window.fake6502Computer.renderer.texture` is the image texture in that
renderer. `renderer.getFrameCanvas()` and `renderer.getPixels()` provide portable
frame boundaries. `renderer.uploadToWebGL(gl, texture)` uploads to a texture in
a caller-owned WebGL2 context; `renderer.uploadToWebGPU(device, texture)` copies
to a texture on a supplied WebGPU device.

A GPU texture belongs to its device/context. A browser WebGPU texture is not
magically shareable with an independent native Vulkan device. A native
NeonCity Vulkan integration should transfer the RGBA pixels (or use a future
shared-memory/native-WebView bridge) and upload them into its own Vulkan image.

## Multithreading

The browser hosts one deterministic WebAssembly machine. The machine itself schedules up to 16 guest 6502 threads; these are emulated CPU contexts, not JavaScript Web Workers. Guest threads share the 64 KiB memory map and video device, while each has a private hardware stack page. The ROM reserves semaphore 0 for terminal output. `PUTS` locks while emitting a complete string; because its pointer is shared zero-page state, callers that prepare `$00/$01` concurrently must hold the same semaphore around pointer setup and the call. The `THREADS` executable demonstrates descriptor-based spawn, join, exit and this critical-section pattern.

## Intentional first-version limits

- One mounted drive, displayed as `C:` in the prompt. The prompt reads its
  letter from zero-page `$10`, so multi-drive selection can be added without
  changing how the prompt is rendered.
- 80x25 ASCII-compatible text display and a 160x100 attribute graphics plane;
  no sound or hardware timing model yet.
- Disk controller exposes file-level LIST/LOAD/SAVE and directory operations.
  It is a deliberately small virtual drive, not a sector/FAT implementation.
- Paths and filenames are limited to 15 characters in total, with a 24-entry
  directory and a 256 KiB image. `WRITE` accepts a single command-line text
  payload (63 chars maximum due to the shell input buffer); the OS SAVE call
  supports up to 65535 bytes from an executable's RAM buffer.
- Raw executables load at `$4000` and return with RTS. No relocation, overlays,
  or executable header yet.
- The fake6502 core accounts for instruction cycle totals but is not a
  bus-cycle-accurate 6502 implementation.

See [`docs/OS-STUB.md`](docs/OS-STUB.md) before porting the ROM or host devices.

### Character-cell rendering

The VT323 display uses a strict fixed-cell renderer: each glyph is centred in its own 80×25 cell and horizontally constrained to that cell's width. No tracking or kerning is added, and glyph fitting does not compress the font vertically. This prevents the excessive apparent spacing and glyph overlap seen when relying on proportional font advances.

## Graphics BIOS

The machine includes a 160x100, 16-colour attribute graphics surface. The
6502-visible palette and attributes remain colour-capable. The browser renderer
converts those colours to green-phosphor intensities using Rec.709 luma, strictly
as a presentation effect; the guest memory, BIOS ABI and disk programs are
unchanged. A native C or hardware renderer can consume the same original colour
indices and palette. The current pen is selected with `JSR $F300` (`A=foreground`, `X=background`);
individual drawing calls do not take colour arguments. `JSR $F303` plots at
`X,Y`; `$F306`, `$F309`, and `$F30C` draw lines, outline rectangles, and filled
rectangles using the coordinate block at `$12-$15`; `$F30F` clears the surface;
`$F312` enables/disables mask-aware drawing; `$F315/$F318` draw outlined/filled circles and `$F31B` blits packed bitmap+mask sprites. See `docs/OS-STUB.md` for the
complete memory map, pixel layout, palette and calling convention.
