# FauxDOS OS stub and machine ABI

This document describes the hardware contract and the small ROM that makes the
6502 machine usable. The intent is that the ROM and its interfaces can be
reproduced in C, Rust, JavaScript, or another implementation language without
changing the 6502 programs that run on the disk.

## 1. Machine model

| Resource | Address / range | Contract |
|---|---:|---|
| Zero page | `$0000-$00FF` | OS and executable call parameters |
| Main RAM | `$0000-$CFFF` | 64 KiB address space, except mapped I/O and ROM |
| Command line | `$0200-$023F` | 63 printable characters plus NUL |
| Directory result | `$0300-$04DF` | Up to 24 records, 20 bytes each |
| Program load address | `$4000` | Raw executable entry point |
| Text output | `$D000` | Write an ASCII byte to the text device |
| Text control | `$D001` | Write bit 0 = clear screen |
| Graphics mode | `$D028` | 0 = text terminal, 1 = attribute graphics display |
| Keyboard input | `$D010` | Read queued ASCII byte; returns 0 when empty |
| Disk controller | `$D100-$D108` | File-level directory/load/save and directory-management interface |
| ROM | `$F000-$FFFF` | 4 KiB read-only system ROM and vectors |

The machine exposes an 80-column by 25-row text display. The 6502 does not know
about fonts or pixels: it writes character bytes to `$D000`. The host display
converts those bytes to a raster using VT323. This clean separation lets a
future implementation replace the browser renderer without changing the ROM.

The processor is the upstream `fake6502` C core compiled to WebAssembly. It
runs one instruction at a time and returns the cycle count for that
instruction. The host schedules approximately 1 MHz of reported CPU cycles.
This is an instruction/cycle-counted emulator, not a per-bus-cycle or
transistor-level 6502 model.

## 2. ROM entry and shell

The reset vector at `$FFFC-$FFFD` points to `$F000`. The NMI and IRQ vectors
currently also point to the reset entry as a safe placeholder. The reset code:

1. Clears the display device.
2. Sets the active drive letter at zero-page `$10` to `C`.
3. Prints the startup banner.
4. Enters the command loop and prints `<drive>> ` (initially `C> `).
5. Reads a line through the keyboard system call, echoes input, supports
   backspace, and terminates on Return.
6. Uppercases only the command token, preserves argument case, then splits the
   first word from its arguments.
7. Handles `CLS`, `MKDIR`, `RM`, and `RMDIR` directly in the ROM. Other command
   names are loaded as executables from the disk.
8. Prints `? COMMAND NOT FOUND` if no executable with that name exists.

The prompt character is not hard-coded into the prompt output sequence: the
shell reads `$10`. A future multi-drive implementation can change that byte
when selecting another mounted drive.

## 3. Fixed ROM call table

These absolute entry points are the executable ABI. Keep them fixed when
reimplementing the OS stub. Each entry is a three-byte JMP vector to its ROM
implementation.

| Address | Name | Calling convention |
|---:|---|---|
| `$F200` | `OS_PUTCHAR` | Character in A; writes it to the text output device |
| `$F203` | `OS_PUTS` | NUL-terminated string pointer in `$00/$01` |
| `$F206` | `OS_GETCHAR` | Blocks until a key is available; returns ASCII byte in A |
| `$F209` | `OS_DIR` | Lists files into `$0300`; returns entry count in A |
| `$F20C` | `OS_LOAD` | Filename pointer in `$00/$01`, destination in `$02/$03`; returns size in `$08/$09`, carry set on error |
| `$F20F` | `OS_SAVE` | Filename pointer in `$00/$01`, source in `$02/$03`, length in `$08/$09`; carry set on error |
| `$F212` | `OS_EXEC` | Filename pointer in `$00/$01`; loads at `$4000`, calls the program, returns carry set if not found/load failed |
| `$F215` | `OS_CLS` | Switches to text mode, clears the terminal and homes the cursor |
| `$F218` | `OS_MKDIR` | Argument path pointer in `$06/$07`; creates a directory; carry set on error |
| `$F21B` | `OS_RM` | Argument file path pointer in `$06/$07`; removes a file; carry set on error |
| `$F21E` | `OS_RMDIR` | Argument directory path pointer in `$06/$07`; removes an empty directory; carry set on error |

`OS_PUTS` uses the zero-page pointer and does not impose a string encoding
beyond NUL termination. The current ROM assumes ASCII-compatible bytes.

### Zero-page contract

| Address | Meaning |
|---:|---|
| `$00/$01` | General pointer; filename or string pointer for OS calls |
| `$02/$03` | General data pointer; load destination or save source |
| `$06/$07` | Pointer to the command-line argument string for an executable |
| `$08/$09` | 16-bit byte count returned by `OS_LOAD`, or supplied to `OS_SAVE` |
| `$10` | Active drive letter displayed in the prompt; initialized to `C` |
| `$11` | Semaphore 0, reserved by ROM for terminal output |
| `$1A` | Semaphore 1, reserved by ROM for disk-controller named operations |

`OS_EXEC` calls a program with JSR semantics. A program must return with RTS.
The loader places the binary at `$4000` and enters its first byte. There is no
relocation header or executable metadata in this first version. An executable
must be assembled for `$4000` and must not overwrite the ROM or its own code
while it is running.

The shell preserves the argument string at `$0200` and passes a pointer to the
first non-space byte in `$06/$07`. The command word is NUL-terminated in place.
Only the command token is uppercased; argument spelling and case are preserved.

## 4. Disk controller ABI

The browser host implements a small file-aware drive controller. It is
intentionally a high-level disk device rather than a sector-level floppy
controller: the ROM asks the device to enumerate, load, or save a named file.
The disk image itself is a persistent binary image and is not a JavaScript
object hidden outside the emulated machine.

| Register | Address | Meaning |
|---|---:|---|
| Command | `$D100` | Write an operation number to execute it |
| Status | `$D101` | 0 success, 1 missing/wrong-type/non-empty error, 2 invalid-name/capacity error, `$FF` unsupported command |
| Filename pointer low/high | `$D102/$D103` | Pointer to NUL-terminated filename in RAM |
| Data pointer low/high | `$D104/$D105` | Directory result buffer, load destination, or save source |
| Size low/high | `$D106/$D107` | Save input size; load output size |
| Directory count | `$D108` | Number of records produced by LIST |

Operations:

- **1 — LIST:** `D104/D105` points to the output buffer. The controller writes
  up to 24 directory records, each 20 bytes: 16-byte NUL-padded path,
  16-bit size (little-endian), flags byte, and one reserved byte. It writes the
  number of records to `$D108`. Flag bit 1 (`$02`) marks a directory.
- **2 — LOAD:** `D102/D103` points to the filename and `D104/D105` points to
  the destination. The file bytes are copied into RAM and the 16-bit length is
  returned in `$D106/$D107`.
- **3 — SAVE:** `D102/D103` points to the path, `D104/D105` points to the
  source bytes, and `$D106/$D107` supplies the 16-bit length. The controller
  creates or replaces the file.
- **4 — MKDIR:** `D102/D103` points to a directory path. The parent must exist.
- **5 — RM:** `D102/D103` points to a regular file path. Directories are rejected.
- **6 — RMDIR:** `D102/D103` points to an empty directory path. Non-empty
  directories are rejected.

The ROM serializes these named operations with semaphore 1. A new controller written in another language must preserve these registers,
record layouts, status values, and copy semantics if it is to run the same ROM.
A future sector-level device can be substituted, but then the ROM's disk
routines (or a compatibility controller implementing these commands) must be
updated accordingly.

## 5. Disk image format (F6502DSK version 1)

The bundled `build/disk.dsk` is a 256 KiB binary image.

- Bytes `0..7`: ASCII `F6502DSK`.
- Byte `8`: version (`1`).
- Byte `9`: directory capacity (`24`).
- Bytes `10..11`: directory offset (`64`, little-endian).
- Bytes `12..13`: directory record size (`32`, little-endian).
- Bytes `14..17`: data-area offset (`2048`, little-endian 32-bit).
- Bytes `18..21`: image size (`262144`, little-endian 32-bit).
- Directory: 24 records of 32 bytes starting at offset 64.
  - `0..15`: uppercase ASCII filename, NUL padded.
  - `16..19`: data offset (little-endian 32-bit).
  - `20..23`: file size (little-endian 32-bit).
  - `24`: flags (`$01` executable, `$02` directory; bits may be combined).
  - `25..31`: reserved.
- File data begins at byte 2048. The current disk writer compacts files when
  saving so the image does not accumulate fragmentation.

A path is 1-15 characters total, using `A-Z`, `0-9`, underscore, dash,
dot, and `/` separators. Each path component must be non-empty; `.` and `..`
components are not allowed. Names are stored uppercase. Parent directories
must already exist. The disk has one flat record table, with directory records
providing a small hierarchical namespace; there is no current-working-directory
command yet, so programs pass paths such as `NOTES/IDEAS.TXT`. Files may be up
to 65535 bytes individually, subject to total disk capacity. The directory can
contain 24 combined file and directory records. The first record with an empty
first filename byte is unused. `RMDIR` only succeeds when no records have that
path as a parent prefix.

## 6. Included 6502 programs

All included programs are source files under `asm/` and are assembled by
`tools/asm6502.py`. The generated `.prg` files are copied into the disk image.

- `DIR`: calls `OS_DIR` and prints each filename.
- `CAT`: calls `OS_LOAD` to `$5000` (not `$4000`, because the executable itself
  occupies `$4000`) and prints the returned byte count.
- `WRITE`: parses `WRITE filename text`, then calls `OS_SAVE` to create or
  replace the named text file.
- `HELP`: prints command usage through `OS_PUTS`.
- `HELLO`: example independent executable that prints a message and returns
  with RTS.
- `DEMO`: an animated 16x12 masked sprite crossing a star field; any key exits.

`CLS`, `MKDIR`, `RM`, and `RMDIR` are built into the system ROM rather than
being separate disk executables. `MKDIR` creates one path component (and any
parent must already exist); `RM` removes regular files; `RMDIR` refuses a
non-empty directory. `DIR` marks directory entries with a trailing `/`.

A new executable can be assembled at `$4000`, saved as a raw file under its
command name, and will be runnable by typing that name at the prompt.

## 7. Reimplementing this OS stub in another language

The host-side OS/device implementation needs these pieces, regardless of
language:

1. **6502 memory bus:** 64 KiB address translation; ROM reads at `$F000+`;
   ignore writes to ROM; map the I/O addresses described above.
2. **Text device:** consume writes to `$D000`, implement newline/backspace and
   an 80x25 character buffer. Pixel rendering is outside the OS ABI.
3. **Keyboard device:** queue ASCII bytes and return one byte per read from
   `$D010`, with zero meaning no key is waiting.
4. **Disk device:** parse/serialize F6502DSK v1 and implement LIST, LOAD, SAVE,
   MKDIR, RM and RMDIR exactly as specified.
5. **ROM:** assemble `asm/os.asm` or translate its routines while retaining
   the fixed `$F200-$F21E` vectors and calling conventions.
6. **Executable loader:** look up the first command token by name, copy the
   raw file to `$4000`, and invoke it with JSR/RTS semantics.
7. **Persistence:** persist the modified disk image and provide an import/export
   path so changes survive page reloads and can be moved between hosts.

The browser build uses IndexedDB for automatic persistence, with localStorage
as a fallback. The page also exposes `window.fake6502Computer.exportDisk()` and
`importDisk(arrayBuffer)` for a host application or developer console.

## 8. Display texture integration

The renderer prefers WebGPU, falls back to WebGL2, and uses a 2D canvas when
neither GPU API can be created. On the GPU paths, the 960x600 terminal raster
is uploaded as a texture and presented to the simple webpage canvas. The 2D
fallback draws the same raster directly; it does not create a GPU texture.

`window.fake6502Computer.renderer` exposes:

- `backend`: `webgpu`, `webgl2`, or `canvas2d` (also exposed as
  `window.fake6502Computer.textureBackend`).
- `texture`: the terminal image texture in the renderer's GPU context, or
  `null` when the 2D fallback is active.
- `device`: the WebGPU device when WebGPU is selected.
- `getFrameCanvas()`: current CPU-rendered raster source.
- `getPixels()`: a copy of RGBA pixels, suitable for a native Vulkan upload.
- `uploadToWebGL(gl, texture)`: upload the raster to a caller-owned WebGL2 texture.
- `uploadToWebGPU(device, texture)`: copy the raster to a caller-owned texture on
  the supplied WebGPU device.

The 2D canvas path is a compatibility fallback only; NeonCity integration should
use one of the GPU backends or consume `getPixels()` and upload it itself.

GPU resources are context/device-local. A WebGL texture cannot be sampled from
a different WebGL context, and a browser WebGPU texture is not automatically
shareable with a separate native Vulkan device. For a native NeonCity Vulkan
process, `getPixels()` (or a future shared-memory frame transport) is the
portable boundary; upload those pixels into a Vulkan image in NeonCity. If
NeonCity uses the same WebGPU device, it can sample the exported GPUTexture
without a CPU readback.


## 6502MP threading additions (ABI 1.1)

The machine is based on `fake6502MP`, not the original single-context `fake6502`.
It supports 16 contexts (thread IDs 0-15), with context states FREE=0, READY=1,
RUNNING=2, BLOCKED=3, SLEEPING=4 and DEAD=5. Contexts share the 64 KiB memory
array. Each context has a private 256-byte hardware stack bank mapped at
`$0100-$01FF`; the MP core swaps that bank on context switches. The browser
executes the scheduler synchronously inside WASM; it does not create host threads.

The MP instruction extensions occupy selected undocumented opcode slots:

| Opcode | Mnemonic | Operand / effect |
|---|---|---|
| `$02` | TSPAWN abs | Spawn at absolute address; A=thread ID, C=success |
| `$12` | TYIELD | Yield current time slice |
| `$22` | TEXIT | Terminate current context; A is exit code |
| `$32` | TID | A=current thread ID |
| `$42` | TJOIN zp | Wait for thread ID stored at zero-page operand |
| `$52` | TGET zp | A=state of thread ID stored at zero-page operand |
| `$62` | TSET zp | Y=0 sleeps, Y!=0 wakes target thread |
| `$72` | TLOCK zp | Acquire semaphore ID stored at zero-page operand |
| `$82` | TUNLOCK zp | Release semaphore ID stored at zero-page operand |
| `$C2` | TSPAWND zp | Spawn from five-byte descriptor at zero-page address |
| `$D2` | TAS abs | Atomic compare-zero-and-set at absolute address |

A thread descriptor is five bytes: entry low, entry high, initial SP, initial A
argument, initial processor status. The OS demo stores one at `$20` and executes
`TSPAWND $20`. The returned thread ID is stored at `$25`; `TJOIN $25` blocks the
parent until the child exits.

Semaphore 0 is reserved by the ROM for terminal output. The OS `PUTS` call acquires
this semaphore before writing a NUL-terminated string and releases it afterward.
The raw character routine is called while the lock is held, avoiding recursive
per-character locking. Standalone `PUTCHAR` also acquires/releases semaphore 0.
This prevents concurrent guest threads from interleaving terminal strings. The
OS string pointer itself is in shared zero page, so callers must acquire semaphore
0 before preparing `$00/$01` when more than one thread can call OS_PUTS. The
THREADS demo shows this calling convention. Programs that share other mutable
structures should reserve and document additional semaphore IDs.

The browser-facing WASM bridge exports the upstream `cpu6502mp_*` machine API
through stable `mp_*` wrappers, plus a pointer to the machine's 64 KiB memory.
The host writes keyboard bytes into a bounded queue consumed by reads from
`$D010`; writes to `$D000` update the video-byte latch. Disk controller registers
remain at `$D100-$D108` and are serviced by the browser host after each emulated
instruction.

## Terminal character-cell rendering

The host display is a fixed 80-column by 25-row character grid. The renderer must not position glyphs by accumulating font advance widths. For each cell `(x, y)`, compute its rectangle from the output dimensions, centre the glyph horizontally, and constrain its maximum rendered width to the cell width minus a small inset. Horizontal fitting must not alter the vertical font scale. Disable letter spacing and kerning so every character remains anchored to its own cell. The VT323 font is presentation-only; the guest OS writes character codes and does not depend on host font metrics.

## 5. Attribute graphics device

The graphics device is a 160 x 100 pixel, 16-colour surface. Its guest-visible
storage is ordinary shared 6502 RAM; the host only converts that storage into a
raster for display. Pixels are 1-bit foreground/background selectors grouped
into 8 x 8 attribute cells, with a separate 1-bit mask plane. This follows the
ZX Spectrum attribute-cell model while allowing masked drawing to preserve
pixels already on screen.

| Range | Meaning |
|---|---|
| `$8000-$87CF` | 1-bit bitmap, 2,000 bytes, row-major, least-significant bit first |
| `$87D0-$89D7` | 260 attribute pairs: foreground byte then background byte |
| `$89D8-$91A7` | 1-bit mask plane, same layout as bitmap; 1=opaque, 0=transparent |
| `$D020` | Current foreground palette index (0..15) |
| `$D021` | Current background palette index (0..15) |
| `$D022` | Graphics command register; host clears it after execution |
| `$D023/$D024` | X0/Y0 |
| `$D025/$D026` | X1/Y1 |
| `$D027` | Masked drawing enable (0=overwrite, 1=skip mask-zero pixels) |
| `$D028` | Display mode (0=text terminal, 1=graphics surface) |

The bitmap selects foreground (bit 1) or background (bit 0) within each
8 x 8 cell. Attribute cells are shared, so changing a cell's pen attributes
changes the colours of all pixels in that cell, just as on the Spectrum.
The mask plane is independent: masked drawing skips pixels whose mask bit is
zero. The initial mask is all opaque. The BIOS provides pixel, line, rectangle, circle and packed 1bpp blit primitives. A blit source consists of a packed 1bpp bitmap followed immediately by a packed 1bpp opacity mask (1=draw, 0=transparent). The current pen supplies the foreground/background attributes for the destination cells.

### Graphics BIOS jump table

| Address | Routine | Calling convention |
|---|---|---|
| `$F300` | `GFX_COLOUR` | A=foreground, X=background; palette indices 0..15 |
| `$F303` | `GFX_PLOT` | X=x, Y=y |
| `$F306` | `GFX_LINE` | `$12=x0, $13=y0, $14=x1, $15=y1` |
| `$F309` | `GFX_RECT` | Same coordinate block; outline rectangle |
| `$F30C` | `GFX_FILLRECT` | Same coordinate block; filled rectangle |
| `$F30F` | `GFX_CLEAR` | Clears bitmap and resets mask to opaque |
| `$F312` | `GFX_MASK` | A=0 disables masking; non-zero enables it |
| `$F315` | `GFX_CIRCLE` | Centre `$12/$13`, radius `$14` |
| `$F318` | `GFX_FILLCIRCLE` | Centre `$12/$13`, radius `$14` |
| `$F31B` | `GFX_BLIT` | Top-left `$12/$13`, source pointer `$16/$17`, width `$18`, height `$19` |

Drawing calls never accept colours. They use the current pen set by
`GFX_COLOUR`. Coordinates are unsigned 8-bit screen pixels. The display host
executes a command when `$D022` is written, but the resulting pixels and
attributes live in guest RAM, so the same memory contract can be implemented
by a native C host or a different renderer.
