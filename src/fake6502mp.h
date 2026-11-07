#ifndef FAKE6502MP_H
#define FAKE6502MP_H
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif
#define CPU6502MP_ABI_VERSION_MAJOR 1u
#define CPU6502MP_ABI_VERSION_MINOR 1u
#define CPU6502MP_MAX_THREADS 16u
#define CPU6502MP_SEMAPHORES 16u
#define CPU6502MP_NO_THREAD 0xffu
#define CPU6502MP_THREAD_DESC_SIZE 5u
#define CPU6502MP_STACK_BASE 0x0100u
#define CPU6502MP_STACK_SIZE 256u
typedef enum cpu6502mp_thread_state { CPU6502MP_FREE=0, CPU6502MP_READY, CPU6502MP_RUNNING, CPU6502MP_BLOCKED, CPU6502MP_SLEEPING, CPU6502MP_DEAD } cpu6502mp_thread_state_t;
typedef enum cpu6502mp_interrupt_kind { CPU6502MP_IRQ=0, CPU6502MP_NMI=1 } cpu6502mp_interrupt_kind_t;
typedef enum cpu6502mp_interrupt_scope { CPU6502MP_INTERRUPT_LOCAL=0, CPU6502MP_INTERRUPT_GLOBAL=1 } cpu6502mp_interrupt_scope_t;
typedef struct cpu6502mp_thread_descriptor { uint16_t entry; uint8_t initial_sp, argument, status; } cpu6502mp_thread_descriptor_t;
typedef struct cpu6502mp_context {
 uint16_t pc; uint8_t a,x,y,sp,p,id,state,priority,quantum_left; uint16_t wait_target; uint8_t wait_kind,exit_code,irq_pending,nmi_pending; uint64_t cycles; uint8_t stack_bank[CPU6502MP_STACK_SIZE];
} cpu6502mp_context_t;
typedef struct cpu6502mp {
 uint8_t *memory; cpu6502mp_context_t threads[CPU6502MP_MAX_THREADS]; int8_t current; uint8_t next_hint,quantum,enabled,halted,irq_scope,nmi_scope; uint8_t semaphore_owner[CPU6502MP_SEMAPHORES],semaphore_depth[CPU6502MP_SEMAPHORES]; uint16_t semaphore_waiters[CPU6502MP_SEMAPHORES]; uint64_t total_cycles,total_instructions,total_interrupts;
} cpu6502mp_t;
void cpu6502mp_init(cpu6502mp_t*,uint8_t memory[65536]);
void cpu6502mp_reset(cpu6502mp_t*,uint16_t,uint8_t);
int cpu6502mp_reset_from_vector(cpu6502mp_t*);
uint8_t cpu6502mp_spawn(cpu6502mp_t*,uint16_t,uint8_t);
uint8_t cpu6502mp_spawn_descriptor(cpu6502mp_t*,const cpu6502mp_thread_descriptor_t*);
uint8_t cpu6502mp_spawn_descriptor_at(cpu6502mp_t*,uint16_t);
uint32_t cpu6502mp_run(cpu6502mp_t*,uint32_t);
int cpu6502mp_step(cpu6502mp_t*);
void cpu6502mp_yield(cpu6502mp_t*);
void cpu6502mp_exit(cpu6502mp_t*,uint8_t);
int cpu6502mp_wake(cpu6502mp_t*,uint8_t);
int cpu6502mp_join(cpu6502mp_t*,uint8_t);
int cpu6502mp_lock(cpu6502mp_t*,uint8_t);
int cpu6502mp_unlock(cpu6502mp_t*,uint8_t);
void cpu6502mp_set_interrupt_scope(cpu6502mp_t*,cpu6502mp_interrupt_kind_t,cpu6502mp_interrupt_scope_t);
uint8_t cpu6502mp_raise_interrupt(cpu6502mp_t*,cpu6502mp_interrupt_kind_t,uint8_t);
const cpu6502mp_context_t *cpu6502mp_thread(const cpu6502mp_t*,uint8_t);
#ifdef __cplusplus
}
#endif
#endif
