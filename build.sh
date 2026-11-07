#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLANG=${CLANG:-clang}
PYTHON=${PYTHON:-python3}
mkdir -p "$ROOT/build"
rm -f "$ROOT/build/fake6502mp.wasm"
"$PYTHON" "$ROOT/tools/asm6502.py" "$ROOT/asm/os.asm" "$ROOT/build/rom.bin" --base 0xF000 --size 4096
for name in dir cat write help hello threads demo sheet; do
  "$PYTHON" "$ROOT/tools/asm6502.py" "$ROOT/asm/$name.asm" "$ROOT/build/$name.prg" --base 0x4000
done
"$CLANG" --target=wasm32-unknown-unknown -std=c11 -O2 -Wall -Wextra -Wno-unused-parameter -nostdlib -fno-builtin -I"$ROOT/src" \
  "$ROOT/src/fake6502mp.c" "$ROOT/src/wasm_bridge.c" "$ROOT/src/freestanding.c" \
  -Wl,--no-entry -Wl,--export-memory -Wl,--initial-memory=2097152 -Wl,--max-memory=2097152 \
  -Wl,--export=mp_init -Wl,--export=mp_push_key -Wl,--export=mp_reset -Wl,--export=mp_step -Wl,--export=mp_run -Wl,--export=mp_spawn -Wl,--export=mp_wake -Wl,--export=mp_raise_irq -Wl,--export=mp_raise_nmi -Wl,--export=mp_set_quantum -Wl,--export=mp_get_thread_state -Wl,--export=mp_get_thread_pc -Wl,--export=mp_get_thread_a -Wl,--export=mp_get_thread_x -Wl,--export=mp_get_thread_y -Wl,--export=mp_get_thread_sp -Wl,--export=mp_get_thread_p -Wl,--export=mp_get_total_cycles -Wl,--export=mp_get_total_instructions -Wl,--export=mp_get_active_thread -Wl,--export=mp_is_idle \
  -o "$ROOT/build/fake6502mp.wasm"
"$PYTHON" "$ROOT/tools/mkdisk.py"
printf 'Build complete. Serve this directory over HTTP (not file://).\n'
