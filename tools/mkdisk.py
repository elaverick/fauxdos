#!/usr/bin/env python3
"""Create the bundled 256 KiB FauxDOS floppy image."""
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "disk.dsk"
SIZE = 256 * 1024
MAGIC = b"F6502DSK"
VERSION = 1
HEADER = 64
MAX_FILES = 24
RECORD = 32
DATA_START = 2048

files = [
    ("DIR", ROOT / "build" / "dir.prg"),
    ("CAT", ROOT / "build" / "cat.prg"),
    ("WRITE", ROOT / "build" / "write.prg"),
    ("HELP", ROOT / "build" / "help.prg"),
    ("HELLO", ROOT / "build" / "hello.prg"),
    ("THREADS", ROOT / "build" / "threads.prg"),
    ("DEMO", ROOT / "build" / "demo.prg"),
    ("SHEET", ROOT / "build" / "sheet.prg"),
    ("README.TXT", b"FAUXDOS 6502 COMPUTER\r\rThis is a small 6502 machine running an assembled ROM.\rCommands are executable files loaded from drive C.\rTry DIR, HELP, CAT README.TXT, HELLO, and WRITE NOTE.TXT HELLO WORLD.\r"),
    ("HELLO.TXT", b"This text lives in the disk image. CAT reads it through the OS LOAD call.\r"),
]

image = bytearray(SIZE)
image[0:8] = MAGIC
image[8] = VERSION
image[9] = MAX_FILES
struct.pack_into("<HHII", image, 10, HEADER, RECORD, DATA_START, SIZE)

cursor = DATA_START
for index, (name, source) in enumerate(files):
    if isinstance(source, Path): data = source.read_bytes()
    else: data = source
    encoded = name.encode("ascii")
    if not 0 < len(encoded) < 16: raise ValueError(f"Invalid disk filename: {name}")
    record = HEADER + index * RECORD
    image[record:record + len(encoded)] = encoded
    struct.pack_into("<II", image, record + 16, cursor, len(data))
    image[record + 24] = 1 if source is not None and isinstance(source, Path) else 0
    image[cursor:cursor + len(data)] = data
    cursor += len(data)

OUT.write_bytes(image)
print(f"Created {OUT} ({SIZE} bytes, {len(files)} files, {cursor - DATA_START} bytes used)")
