#ifndef FAKE6502MP_STDIO_SHIM_H
#define FAKE6502MP_STDIO_SHIM_H
/* Minimal freestanding compatibility shim: the CPU core does not use stdio. */
typedef struct { int unused; } FILE;
#define NULL ((void*)0)
#endif
