void mp_clear_video_byte(void);
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "fake6502mp.h"

static cpu6502mp_t machine;
static uint8_t memory[65536];
static uint8_t key_queue[256];
static uint16_t key_head, key_tail, key_count;

uint8_t mp_take_key(void) {
    uint8_t value;
    if (!key_count) return 0;
    value = key_queue[key_head];
    key_head = (uint16_t)((key_head + 1u) & 255u);
    --key_count;
    return value;
}

__attribute__((export_name("mp_push_key")))
uint32_t mp_push_key(uint32_t value) {
    if (key_count >= 256u) return 0;
    key_queue[key_tail] = (uint8_t)value;
    key_tail = (uint16_t)((key_tail + 1u) & 255u);
    ++key_count;
    return 1;
}

__attribute__((export_name("mp_init")))
void mp_init(uint8_t *initial_memory, uint32_t length) {
    memset(memory, 0, sizeof(memory));
    memset(key_queue, 0, sizeof(key_queue));
    key_head = key_tail = key_count = 0;
    if (initial_memory && length) {
        uint32_t n = length > 65536u ? 65536u : length;
        memcpy(memory, initial_memory, n);
    }
    cpu6502mp_init(&machine, memory);
}
__attribute__((export_name("mp_reset")))
void mp_reset(uint32_t entry, uint32_t sp) { cpu6502mp_reset(&machine, (uint16_t)entry, (uint8_t)sp); }
__attribute__((export_name("mp_step")))
int32_t mp_step(void) { return cpu6502mp_step(&machine); }
__attribute__((export_name("mp_run")))
uint32_t mp_run(uint32_t limit) { return cpu6502mp_run(&machine, limit); }
__attribute__((export_name("mp_spawn")))
uint32_t mp_spawn(uint32_t entry, uint32_t sp) { return cpu6502mp_spawn(&machine, (uint16_t)entry, (uint8_t)sp); }
__attribute__((export_name("mp_wake")))
uint32_t mp_wake(uint32_t id) { return (uint32_t)cpu6502mp_wake(&machine, (uint8_t)id); }
__attribute__((export_name("mp_raise_irq")))
uint32_t mp_raise_irq(uint32_t id) { return cpu6502mp_raise_interrupt(&machine, CPU6502MP_IRQ, (uint8_t)id); }
__attribute__((export_name("mp_raise_nmi")))
uint32_t mp_raise_nmi(uint32_t id) { return cpu6502mp_raise_interrupt(&machine, CPU6502MP_NMI, (uint8_t)id); }
__attribute__((export_name("mp_set_quantum")))
void mp_set_quantum(uint32_t q) { machine.quantum = q ? (uint8_t)(q > 255u ? 255u : q) : 1u; }
__attribute__((export_name("mp_get_thread_state")))
uint32_t mp_get_thread_state(uint32_t id) { const cpu6502mp_context_t *t=cpu6502mp_thread(&machine,(uint8_t)id); return t ? t->state : 0xffffffffu; }
__attribute__((export_name("mp_get_thread_pc")))
uint32_t mp_get_thread_pc(uint32_t id) { const cpu6502mp_context_t *t=cpu6502mp_thread(&machine,(uint8_t)id); return t ? t->pc : 0xffffffffu; }
__attribute__((export_name("mp_get_thread_a")))
uint32_t mp_get_thread_a(uint32_t id) { const cpu6502mp_context_t *t=cpu6502mp_thread(&machine,(uint8_t)id); return t ? t->a : 0xffffffffu; }
__attribute__((export_name("mp_get_thread_x")))
uint32_t mp_get_thread_x(uint32_t id) { const cpu6502mp_context_t *t=cpu6502mp_thread(&machine,(uint8_t)id); return t ? t->x : 0xffffffffu; }
__attribute__((export_name("mp_get_thread_y")))
uint32_t mp_get_thread_y(uint32_t id) { const cpu6502mp_context_t *t=cpu6502mp_thread(&machine,(uint8_t)id); return t ? t->y : 0xffffffffu; }
__attribute__((export_name("mp_get_thread_sp")))
uint32_t mp_get_thread_sp(uint32_t id) { const cpu6502mp_context_t *t=cpu6502mp_thread(&machine,(uint8_t)id); return t ? t->sp : 0xffffffffu; }
__attribute__((export_name("mp_get_thread_p")))
uint32_t mp_get_thread_p(uint32_t id) { const cpu6502mp_context_t *t=cpu6502mp_thread(&machine,(uint8_t)id); return t ? t->p : 0xffffffffu; }
__attribute__((export_name("mp_get_total_cycles")))
uint32_t mp_get_total_cycles(void) { return (uint32_t)machine.total_cycles; }
__attribute__((export_name("mp_get_total_instructions")))
uint32_t mp_get_total_instructions(void) { return (uint32_t)machine.total_instructions; }
__attribute__((export_name("mp_get_active_thread")))
int32_t mp_get_active_thread(void) { return machine.current; }
__attribute__((export_name("mp_is_idle")))
uint32_t mp_is_idle(void) { return machine.current < 0 ? 1u : 0u; }
__attribute__((export_name("mp_memory_ptr")))
uint32_t mp_memory_ptr(void) { return (uint32_t)(uintptr_t)memory; }
__attribute__((export_name("mp_sizeof_machine")))
uint32_t mp_sizeof_machine(void) { return (uint32_t)sizeof(machine); }
__attribute__((export_name("mp_abi_major")))
uint32_t mp_abi_major(void) { return CPU6502MP_ABI_VERSION_MAJOR; }
__attribute__((export_name("mp_abi_minor")))
uint32_t mp_abi_minor(void) { return CPU6502MP_ABI_VERSION_MINOR; }

__attribute__((export_name("mp_get_video_byte")))
uint32_t mp_get_video_byte(void) { extern unsigned char mp_video_byte(void); return mp_video_byte(); }


__attribute__((export_name("mp_clear_video_byte")))
void mp_clear_video_byte_export(void) { mp_clear_video_byte(); }
