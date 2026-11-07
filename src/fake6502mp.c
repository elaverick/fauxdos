/*
 * 6502MP standalone emulator. Derived from fake6502 by Mike Chambers and
 * Ivo van Poorten; MP extensions Copyright 2026 Edward Laverick.
 * BSD 2-Clause; see LICENSE.
 */
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include "fake6502mp.h"

static void (*addrtable[256])();
static void (*optable[256])();
static uint8_t penaltyop, penaltyaddr;
static uint64_t clockticks6502;
static uint16_t PC;
static uint8_t SP,A,X,Y;
static bool C,Z,I,D,V,N;
static uint16_t ea;
static uint8_t opcode;
static cpu6502mp_t *active_machine;
static uint8_t mp_direct_video;
extern uint8_t mp_take_key(void);
static uint8_t read6502(uint16_t a){
    if (a == 0xd010) return mp_take_key();
    return active_machine&&active_machine->memory?active_machine->memory[a]:0xff;
}
static void write6502(uint16_t a,uint8_t v){
    if(active_machine&&active_machine->memory){
        active_machine->memory[a]=v;
        if(a==0xd000)mp_direct_video=v;
    }
}
static inline void calcZ(uint8_t x){Z=!x;}
static inline void calcN(uint8_t x){N=x&0x80;}
static inline void calcZN(uint8_t x){calcZ(x),calcN(x);}
static inline void calcC(uint16_t x){C=x&0xff00;}
static inline void calcCZN(uint16_t x){calcC(x),calcZN(x);}
static inline void calcV(uint16_t r,uint8_t a,uint16_t v){V=(r^a)&(r^v)&0x80;}
static void setP(uint8_t x){N=x&0x80,V=x&0x40,D=x&8,I=x&4,Z=x&2,C=x&1;}
static uint8_t getP(void){return(N<<7)|(V<<6)|(1<<5)|(0<<4)|(D<<3)|(I<<2)|(Z<<1)|C;}
static void push16(uint16_t v){write6502(0x100+SP,(v>>8)&255);write6502(0x100+((SP-1)&255),v&255);SP-=2;}
static void push8(uint8_t v){write6502(0x100+SP--,v);}
static uint8_t pull8(void){return read6502(0x100+ ++SP);}
static uint16_t pull16(void){SP+=2;return read6502(0x100+((SP-1)&255))|(read6502(0x100+SP)<<8);}
static uint16_t read6502word(uint16_t a){return read6502(a)|(read6502(a+1)<<8);}
static void imp(void){} static void acc(void){} static void imm(void){ea=PC++;} static void zp(void){ea=read6502(PC++);} static void zpx(void){ea=(read6502(PC++)+X)&255;} static void zpy(void){ea=(read6502(PC++)+Y)&255;} static void abso(void){ea=read6502word(PC);PC+=2;} static void rel(void){ea=PC+1;ea+=(int8_t)read6502(PC++);}
static void absx(void){ea=read6502word(PC);uint16_t p=ea&0xff00;ea+=X;penaltyaddr=p!=(ea&0xff00);PC+=2;}
static void absy(void){ea=read6502word(PC);uint16_t p=ea&0xff00;ea+=Y;penaltyaddr=p!=(ea&0xff00);PC+=2;}
static void ind(void){ea=read6502word(PC);uint16_t e2=(ea&0xff00)|((ea+1)&255);ea=read6502(ea)|(read6502(e2)<<8);PC+=2;}
static void indx(void){ea=(read6502(PC++)+X)&255;ea=read6502(ea)|(read6502((ea+1)&255)<<8);}
static void indy(void){ea=read6502(PC++);ea=read6502(ea)|(read6502((ea+1)&255)<<8);uint16_t p=ea&0xff00;ea+=Y;penaltyaddr=p!=(ea&0xff00);}
static inline uint16_t getvalue(void){return addrtable[opcode]==acc?A:read6502(ea);}
static inline void putvalue(uint16_t v){if(addrtable[opcode]==acc)A=v;else write6502(ea,v);}
static void and(void){penaltyop=1;calcZN(A=A&getvalue());} static void eor(void){penaltyop=1;A^=getvalue();calcZN(A);} static void ora(void){penaltyop=1;A|=getvalue();calcZN(A);}
static void branch(bool c){if(c){uint16_t old=PC;PC=ea;if((old&0xff00)!=(PC&0xff00))clockticks6502+=2;else clockticks6502++;}}
static void bcc(void){branch(!C);} static void bcs(void){branch(C);} static void bne(void){branch(!Z);} static void beq(void){branch(Z);} static void bpl(void){branch(!N);} static void bmi(void){branch(N);} static void bvc(void){branch(!V);} static void bvs(void){branch(V);}
static void clc(void){C=0;} static void sec(void){C=1;} static void cld(void){D=0;} static void sed(void){D=1;} static void cli(void){I=0;} static void sei(void){I=1;} static void clv(void){V=0;}
static void inx(void){calcZN(++X);} static void iny(void){calcZN(++Y);} static void dex(void){calcZN(--X);} static void dey(void){calcZN(--Y);}
static void jmp(void){PC=ea;} static void jsr(void){push16(PC-1);PC=ea;}
static void lda(void){penaltyop=1;A=getvalue();calcZN(A);} static void ldx(void){penaltyop=1;X=getvalue();calcZN(X);} static void ldy(void){penaltyop=1;Y=getvalue();calcZN(Y);} static void sta(void){putvalue(A);} static void stx(void){putvalue(X);} static void sty(void){putvalue(Y);}
static inline void compare(uint8_t r,uint8_t v){calcN(r-v);C=r>=v;Z=r==v;} static void cmp(void){compare(A,getvalue());penaltyop=1;} static void cpx(void){compare(X,getvalue());} static void cpy(void){compare(Y,getvalue());}
static void pha(void){push8(A);} static void php(void){push8(getP()|16);} static void pla(void){A=pull8();calcZN(A);} static void plp(void){setP(pull8());}
static void rti(void){setP(pull8());PC=pull16();} static void rts(void){PC=pull16()+1;}
static void tax(void){X=A;calcZN(X);} static void tay(void){Y=A;calcZN(Y);} static void tsx(void){X=SP;calcZN(X);} static void txa(void){A=X;calcZN(A);} static void txs(void){SP=X;} static void tya(void){A=Y;calcZN(A);}
static void bit(void){uint16_t v=getvalue();calcZ(A&v);N=v&128;V=v&64;}
static void brk(void){push16(++PC);php();I=1;PC=read6502word(0xfffe);}
static void dec(void){uint16_t r=getvalue()-1;calcZN(r);putvalue(r);} static void inc(void){uint16_t r=getvalue()+1;calcZN(r);putvalue(r);}
static void asl(void){uint16_t r=getvalue()<<1;calcCZN(r);putvalue(r);} static void lsr(void){uint16_t v=getvalue(),r=v>>1;C=v&1;calcZN(r);putvalue(r);} static void rol(void){uint16_t r=(getvalue()<<1)|C;calcCZN(r);putvalue(r);} static void ror(void){uint16_t v=getvalue(),r=(v>>1)|(C<<7);C=v&1;calcZN(r);putvalue(r);}
static void nop(void){switch(opcode){case 0x1c:case 0x3c:case 0x5c:case 0x7c:case 0xdc:case 0xfc:penaltyop=1;break;}}
static void adc(void){penaltyop=1;uint16_t v=getvalue(),r=A+v+C;calcZ(r);if(!D){calcC(r);calcV(r,A,v);calcN(r);}else{r=(A&15)+(v&15)+C;if(r>=10)r=((r+6)&15)+16;r+=(A&240)+(v&240);calcN(r);calcV(r,A,v);if(r>=160)r+=96;calcC(r);clockticks6502++;}A=r;}
static void sbc(void){bool cc=C;penaltyop=1;uint16_t v=getvalue()^255,r=A+v+C;calcCZN(r);calcV(r,A,v);if(D){uint16_t al,b;b=v^255;al=(A&15)-(b&15)+cc-1;if(al&0x8000)al=((al-6)&15)-16;r=(A&240)-(b&240)+al;if(r&0x8000)r-=96;clockticks6502++;}A=r;}
static void SLO(void){asl();ora();} static void RLA(void){rol();and();penaltyop=0;} static void SRE(void){lsr();eor();penaltyop=0;} static void RRA(void){ror();adc();penaltyop=0;if(D)clockticks6502--;} static void SAX(void){putvalue(A&X);} static void LAX(void){penaltyop=1;lda();ldx();} static void DCP(void){dec();cmp();penaltyop=0;} static void ISC(void){inc();sbc();penaltyop=0;if(D)clockticks6502--;} static void ANC(void){and();C=A&128;} static void ALR(void){and();C=A&1;A>>=1;calcZN(A);} static void LAS(void){penaltyop=1;calcZN(SP=A=X=getvalue()&SP);} static void JAM(void){nop();}
static void ARR(void){and();uint8_t in=A;A>>=1;A|=C<<7;calcZN(A);if(!D){C=A&64;V=C^((A>>5)&1);}else{V=(A^in)&64;if(((in&15)+(in&1))>5)A=(A&240)|((A+6)&15);if((uint16_t)in+(in&16)>=96){A+=96;C=1;}else C=0;}}
static void SBX(void){uint8_t v=getvalue();X&=A;compare(X,v);X-=v;}
static void SHA(void){putvalue(A&X&((ea>>8)+1));} static void SHX(void){uint8_t v=X&(((ea-Y)>>8)+1);if(((ea-Y)&255)+Y>255)ea=(ea&255)|(v<<8);putvalue(v);} static void SHY(void){uint8_t v=Y&(((ea-X)>>8)+1);if(((ea-X)&255)+X>255)ea=(ea&255)|(v<<8);putvalue(v);} static void TAS(void){SP=A&X;putvalue(SP&((ea>>8)+1));}
static void ANE(void){A=(A|0xef)&X&getvalue();calcZN(A);} static void LXA(void){A=X=(A|0xee)&getvalue();calcZN(A);}
static void (*addrtable[256])()={
imp,indx,imp,indx,zp,zp,zp,zp,imp,imm,acc,imm,abso,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpx,zpx,imp,absy,imp,absy,absx,absx,absx,absx,
abso,indx,imp,indx,zp,zp,zp,zp,imp,imm,acc,imm,abso,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpx,zpx,imp,absy,imp,absy,absx,absx,absx,absx,
imp,indx,imp,indx,zp,zp,zp,zp,imp,imm,acc,imm,abso,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpx,zpx,imp,absy,imp,absy,absx,absx,absx,absx,
imp,indx,imp,indx,zp,zp,zp,zp,imp,imm,acc,imm,ind,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpx,zpx,imp,absy,imp,absy,absx,absx,absx,absx,
imm,indx,imm,indx,zp,zp,zp,zp,imp,imm,imp,imm,abso,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpx,zpx,imp,absy,imp,absy,absx,absx,absy,absy,
imm,indx,imm,indx,zp,zp,zp,zp,imp,imm,imp,imm,abso,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpy,zpy,imp,absy,imp,absy,absx,absx,absy,absy,
imm,indx,imm,indx,zp,zp,zp,zp,imp,imm,imp,imm,abso,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpx,zpx,imp,absy,imp,absy,absx,absx,absx,absx,
imm,indx,imm,indx,zp,zp,zp,zp,imp,imm,imp,imm,abso,abso,abso,abso,
rel,indy,imp,indy,zpx,zpx,zpx,zpx,imp,absy,imp,absy,absx,absx,absx,absx};
static void (*optable[256])()={
brk,ora,JAM,SLO,nop,ora,asl,SLO,php,ora,asl,ANC,nop,ora,asl,SLO,bpl,ora,JAM,SLO,nop,ora,asl,SLO,clc,ora,nop,SLO,nop,ora,asl,SLO,
jsr,and,JAM,RLA,bit,and,rol,RLA,plp,and,rol,ANC,bit,and,rol,RLA,bmi,and,JAM,RLA,nop,and,rol,RLA,sec,and,nop,RLA,nop,and,rol,RLA,
rti,eor,JAM,SRE,nop,eor,lsr,SRE,pha,eor,lsr,ALR,jmp,eor,lsr,SRE,bvc,eor,JAM,SRE,nop,eor,lsr,SRE,cli,eor,nop,SRE,nop,eor,lsr,SRE,
rts,adc,JAM,RRA,nop,adc,ror,RRA,pla,adc,ror,ARR,jmp,adc,ror,RRA,bvs,adc,JAM,RRA,nop,adc,ror,RRA,sei,adc,nop,RRA,nop,adc,ror,RRA,
nop,sta,nop,SAX,sty,sta,stx,SAX,dey,nop,txa,ANE,sty,sta,stx,SAX,bcc,sta,JAM,SHA,sty,sta,stx,SAX,tya,sta,txs,TAS,SHY,sta,SHX,SHA,
ldy,lda,ldx,LAX,ldy,lda,ldx,LAX,tay,lda,tax,LXA,ldy,lda,ldx,LAX,bcs,lda,JAM,LAX,ldy,lda,ldx,LAX,clv,lda,tsx,LAS,ldy,lda,ldx,LAX,
cpy,cmp,nop,DCP,cpy,cmp,dec,DCP,iny,cmp,dex,SBX,cpy,cmp,dec,DCP,bne,cmp,JAM,DCP,nop,cmp,dec,DCP,cld,cmp,nop,DCP,nop,cmp,dec,DCP,
cpx,sbc,nop,ISC,cpx,sbc,inc,ISC,inx,sbc,nop,sbc,cpx,sbc,inc,ISC,beq,sbc,JAM,ISC,nop,sbc,inc,ISC,sed,sbc,nop,ISC,nop,sbc,inc,ISC};
static const uint32_t ticktable[256]={
7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6,
2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6,
2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6,
2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6,
2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5,
2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
2,6,2,6,3,3,5,5,2,2,2,2,4,4,6,6,
2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
2,6,2,6,3,3,5,5,2,2,2,2,4,4,6,6,
2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7};
static int nmi6502(void){push16(PC);push8(getP());I=1;PC=read6502word(0xfffa);return 7;}
static int reset6502(void){PC=read6502word(0xfffc);A=X=Y=C=Z=I=D=V=N=0;SP=0xfd;return 7;}
static int irq6502(void){push16(PC);push8(getP());I=1;PC=read6502word(0xfffe);return 7;}
static int step6502(void){opcode=read6502(PC++);penaltyop=penaltyaddr=0;clockticks6502=ticktable[opcode];addrtable[opcode]();optable[opcode]();if(penaltyop&&penaltyaddr)clockticks6502++;return(int)clockticks6502;}
#define FLAG_N 0x80u
#define FLAG_V 0x40u
#define FLAG_I 0x04u
#define FLAG_Z 0x02u
#define FLAG_C 0x01u
#define P_NORMALISE(p) (uint8_t)(((p)&0xcfu)|0x20u)
static void stack_bank_save(cpu6502mp_t *m,cpu6502mp_context_t *t){if(m->memory)memcpy(t->stack_bank,m->memory+CPU6502MP_STACK_BASE,CPU6502MP_STACK_SIZE);}
static void stack_bank_load(cpu6502mp_t *m,const cpu6502mp_context_t *t){if(m->memory)memcpy(m->memory+CPU6502MP_STACK_BASE,t->stack_bank,CPU6502MP_STACK_SIZE);}
static void context_load_registers(const cpu6502mp_context_t *t){PC=t->pc;A=t->a;X=t->x;Y=t->y;SP=t->sp;setP(t->p);}
static void context_load(cpu6502mp_t *m,const cpu6502mp_context_t *t){stack_bank_load(m,t);context_load_registers(t);}
static void context_save_registers(cpu6502mp_context_t *t){t->pc=PC;t->a=A;t->x=X;t->y=Y;t->sp=SP;t->p=P_NORMALISE(getP());}
static void context_save(cpu6502mp_t *m,cpu6502mp_context_t *t){context_save_registers(t);stack_bank_save(m,t);}
static int is_live(const cpu6502mp_context_t *t){return t->state!=CPU6502MP_FREE&&t->state!=CPU6502MP_DEAD;}
static int find_ready(cpu6502mp_t *m){unsigned n;for(n=0;n<CPU6502MP_MAX_THREADS;n++){unsigned id=(unsigned)(m->next_hint+n)%CPU6502MP_MAX_THREADS;if(m->threads[id].state==CPU6502MP_READY){m->next_hint=(uint8_t)((id+1u)%CPU6502MP_MAX_THREADS);return(int)id;}}return-1;}
static int schedule(cpu6502mp_t *m){int next;if(m->current>=0){cpu6502mp_context_t *old=&m->threads[(unsigned)m->current];if(old->state==CPU6502MP_RUNNING){context_save(m,old);old->state=CPU6502MP_READY;}}next=find_ready(m);m->current=(int8_t)next;if(next>=0){cpu6502mp_context_t *t=&m->threads[(unsigned)next];t->state=CPU6502MP_RUNNING;t->quantum_left=m->quantum?m->quantum:1;context_load(m,t);}return next;}
static void clear_thread_wait_membership(cpu6502mp_t *m,uint8_t id){unsigned s;uint16_t bit=(uint16_t)(1u<<id);for(s=0;s<CPU6502MP_SEMAPHORES;s++)m->semaphore_waiters[s]&=(uint16_t)~bit;}
static void set_context_result(cpu6502mp_context_t *t,uint8_t v,int ok){t->a=v;t->p&=(uint8_t)~(FLAG_N|FLAG_Z|FLAG_C);if(v&128)t->p|=FLAG_N;if(!v)t->p|=FLAG_Z;if(ok)t->p|=FLAG_C;}
static void set_current_result(uint8_t v,int ok){uint8_t p=getP();A=v;p&=(uint8_t)~(FLAG_N|FLAG_Z|FLAG_C);if(v&128)p|=FLAG_N;if(!v)p|=FLAG_Z;if(ok)p|=FLAG_C;setP(p);}
static void wake_joiners(cpu6502mp_t *m,uint8_t dead){unsigned i;uint8_t ec=m->threads[dead].exit_code;for(i=0;i<CPU6502MP_MAX_THREADS;i++){cpu6502mp_context_t *t=&m->threads[i];if(t->state==CPU6502MP_BLOCKED&&t->wait_kind==1&&t->wait_target==dead){set_context_result(t,ec,1);t->state=CPU6502MP_READY;t->wait_kind=0;}}}
static int semaphore_release(cpu6502mp_t *m,uint8_t owner,uint8_t sem){uint16_t waiters;unsigned i;if(!m||sem>=CPU6502MP_SEMAPHORES||m->semaphore_owner[sem]!=owner)return 0;if(m->semaphore_depth[sem]>1){--m->semaphore_depth[sem];return 1;}m->semaphore_depth[sem]=0;m->semaphore_owner[sem]=CPU6502MP_NO_THREAD;waiters=m->semaphore_waiters[sem];for(i=0;i<CPU6502MP_MAX_THREADS;i++)if(waiters&(uint16_t)(1u<<i)){cpu6502mp_context_t *n=&m->threads[i];m->semaphore_waiters[sem]&=(uint16_t)~(1u<<i);m->semaphore_owner[sem]=(uint8_t)i;m->semaphore_depth[sem]=1;n->wait_kind=0;set_context_result(n,n->a,1);n->state=CPU6502MP_READY;break;}return 1;}
static void release_all_semaphores(cpu6502mp_t *m,uint8_t owner){unsigned s;for(s=0;s<CPU6502MP_SEMAPHORES;s++)if(m->semaphore_owner[s]==owner){m->semaphore_depth[s]=1;(void)semaphore_release(m,owner,(uint8_t)s);}}
void cpu6502mp_init(cpu6502mp_t *m,uint8_t memory[65536]){unsigned i;if(!m)return;memset(m,0,sizeof(*m));m->memory=memory;m->current=-1;m->quantum=32;m->enabled=1;m->irq_scope=CPU6502MP_INTERRUPT_LOCAL;m->nmi_scope=CPU6502MP_INTERRUPT_LOCAL;for(i=0;i<16;i++){m->threads[i].id=(uint8_t)i;m->threads[i].state=CPU6502MP_FREE;}for(i=0;i<16;i++)m->semaphore_owner[i]=CPU6502MP_NO_THREAD;}
void cpu6502mp_reset(cpu6502mp_t *m,uint16_t entry,uint8_t sp){unsigned i;if(!m)return;for(i=0;i<16;i++){uint8_t id=(uint8_t)i;memset(&m->threads[i],0,sizeof(m->threads[i]));m->threads[i].id=id;m->threads[i].state=i==0?CPU6502MP_READY:CPU6502MP_FREE;m->threads[i].sp=sp;m->threads[i].priority=1;}m->threads[0].pc=entry;m->threads[0].p=0x24;if(m->memory)memcpy(m->threads[0].stack_bank,m->memory+0x100,256);m->current=-1;m->next_hint=0;m->halted=0;m->total_cycles=0;m->total_instructions=0;m->total_interrupts=0;for(i=0;i<16;i++){m->semaphore_owner[i]=255;m->semaphore_depth[i]=0;m->semaphore_waiters[i]=0;}}
uint8_t cpu6502mp_spawn_descriptor(cpu6502mp_t *m,const cpu6502mp_thread_descriptor_t *d){unsigned i;if(!m||!m->enabled||!d||!m->memory)return 255;for(i=1;i<16;i++){cpu6502mp_context_t *t=&m->threads[i];if(t->state==CPU6502MP_FREE||t->state==CPU6502MP_DEAD){clear_thread_wait_membership(m,(uint8_t)i);memset(t,0,sizeof(*t));t->id=(uint8_t)i;t->pc=d->entry;t->sp=d->initial_sp;t->a=d->argument;t->p=P_NORMALISE(d->status);t->state=CPU6502MP_READY;t->priority=1;return(uint8_t)i;}}return 255;}
uint8_t cpu6502mp_spawn_descriptor_at(cpu6502mp_t *m,uint16_t a){cpu6502mp_thread_descriptor_t d;if(!m||!m->memory)return 255;d.entry=(uint16_t)(m->memory[a]|((uint16_t)m->memory[(uint16_t)(a+1)]<<8));d.initial_sp=m->memory[(uint16_t)(a+2)];d.argument=m->memory[(uint16_t)(a+3)];d.status=m->memory[(uint16_t)(a+4)];return cpu6502mp_spawn_descriptor(m,&d);}
uint8_t cpu6502mp_spawn(cpu6502mp_t *m,uint16_t entry,uint8_t sp){cpu6502mp_thread_descriptor_t d={entry,sp,0,0x20};return cpu6502mp_spawn_descriptor(m,&d);}
void cpu6502mp_yield(cpu6502mp_t *m){cpu6502mp_context_t *t;if(!m||m->current<0)return;t=&m->threads[(unsigned)m->current];context_save(m,t);t->state=CPU6502MP_READY;t->quantum_left=0;schedule(m);}
void cpu6502mp_exit(cpu6502mp_t *m,uint8_t code){cpu6502mp_context_t *t;if(!m||m->current<0)return;t=&m->threads[(unsigned)m->current];context_save(m,t);t->exit_code=code;release_all_semaphores(m,t->id);t->state=CPU6502MP_DEAD;wake_joiners(m,t->id);schedule(m);}
int cpu6502mp_wake(cpu6502mp_t *m,uint8_t id){if(!m||id>=16||m->threads[id].state!=CPU6502MP_SLEEPING)return 0;m->threads[id].state=CPU6502MP_READY;return 1;}
int cpu6502mp_join(cpu6502mp_t *m,uint8_t id){cpu6502mp_context_t *target,*self;if(!m||id>=16||m->current<0)return 0;target=&m->threads[id];if(target->state==CPU6502MP_DEAD||target->state==CPU6502MP_FREE)return 1;if(id==(uint8_t)m->current)return 0;self=&m->threads[(unsigned)m->current];context_save(m,self);self->state=CPU6502MP_BLOCKED;self->wait_kind=1;self->wait_target=id;schedule(m);return 0;}
int cpu6502mp_lock(cpu6502mp_t *m,uint8_t sem){uint8_t id;cpu6502mp_context_t *self;if(!m||sem>=16||m->current<0)return 0;id=(uint8_t)m->current;if(m->semaphore_owner[sem]==255||m->semaphore_owner[sem]==id){m->semaphore_owner[sem]=id;if(m->semaphore_depth[sem]!=255)++m->semaphore_depth[sem];return 1;}m->semaphore_waiters[sem]|=(uint16_t)(1u<<id);self=&m->threads[id];context_save(m,self);self->state=CPU6502MP_BLOCKED;self->wait_kind=2;self->wait_target=sem;schedule(m);return 0;}
int cpu6502mp_unlock(cpu6502mp_t *m,uint8_t sem){if(!m||sem>=16||m->current<0)return 0;return semaphore_release(m,(uint8_t)m->current,sem);}
void cpu6502mp_set_interrupt_scope(cpu6502mp_t *m,cpu6502mp_interrupt_kind_t k,cpu6502mp_interrupt_scope_t s){if(!m||(s!=CPU6502MP_INTERRUPT_LOCAL&&s!=CPU6502MP_INTERRUPT_GLOBAL))return;if(k==CPU6502MP_IRQ)m->irq_scope=(uint8_t)s;else if(k==CPU6502MP_NMI)m->nmi_scope=(uint8_t)s;}
uint8_t cpu6502mp_raise_interrupt(cpu6502mp_t *m,cpu6502mp_interrupt_kind_t k,uint8_t id){unsigned i;uint8_t count=0,scope;if(!m||(k!=CPU6502MP_IRQ&&k!=CPU6502MP_NMI))return 0;scope=k==CPU6502MP_IRQ?m->irq_scope:m->nmi_scope;if(scope==CPU6502MP_INTERRUPT_GLOBAL){for(i=0;i<16;i++){cpu6502mp_context_t *t=&m->threads[i];if(!is_live(t))continue;if(k==CPU6502MP_IRQ)t->irq_pending=1;else t->nmi_pending=1;if(t->state==CPU6502MP_SLEEPING)t->state=CPU6502MP_READY;++count;}}else{cpu6502mp_context_t *t;if(id>=16)return 0;t=&m->threads[id];if(!is_live(t))return 0;if(k==CPU6502MP_IRQ)t->irq_pending=1;else t->nmi_pending=1;if(t->state==CPU6502MP_SLEEPING)t->state=CPU6502MP_READY;count=1;}return count;}
static int service_pending_interrupt(cpu6502mp_t *m,cpu6502mp_context_t *t){int c;if(t->nmi_pending){t->nmi_pending=0;c=nmi6502();}else if(t->irq_pending&&!(t->p&FLAG_I)){t->irq_pending=0;c=irq6502();}else return 0;context_save_registers(t);++m->total_interrupts;m->total_cycles+=(uint64_t)c;t->cycles+=(uint64_t)c;return c;}
static int execute_mp_opcode(cpu6502mp_t *m,cpu6502mp_context_t *t,uint8_t op,int *cycles){uint8_t operand;switch(op){case 0x02:{cpu6502mp_thread_descriptor_t d;uint8_t id;uint16_t target=(uint16_t)(m->memory[PC]|((uint16_t)m->memory[(uint16_t)(PC+1)]<<8));PC=(uint16_t)(PC+2);d.entry=target;d.initial_sp=0xfd;d.argument=0;d.status=0x20;id=cpu6502mp_spawn_descriptor(m,&d);set_current_result(id,id!=255);*cycles=6;return 1;}case 0x12:context_save(m,t);t->state=CPU6502MP_READY;t->quantum_left=0;schedule(m);*cycles=2;return 2;case 0x22:context_save(m,t);t->exit_code=A;release_all_semaphores(m,t->id);t->state=CPU6502MP_DEAD;wake_joiners(m,t->id);schedule(m);*cycles=2;return 2;case 0x32:A=t->id;*cycles=2;return 1;case 0x42:operand=m->memory[PC++];operand=m->memory[operand];if(operand>=16||operand==t->id||m->threads[operand].state==CPU6502MP_FREE){set_current_result(255,0);*cycles=3;return 1;}if(m->threads[operand].state==CPU6502MP_DEAD){set_current_result(m->threads[operand].exit_code,1);*cycles=3;return 1;}context_save(m,t);t->state=CPU6502MP_BLOCKED;t->wait_kind=1;t->wait_target=operand;schedule(m);*cycles=3;return 2;case 0x52:operand=m->memory[PC++];operand=m->memory[operand];set_current_result(operand<16?m->threads[operand].state:CPU6502MP_FREE,operand<16);*cycles=3;return 1;case 0x62:operand=m->memory[PC++];operand=m->memory[operand];if(operand<16&&operand!=t->id){if(Y==0&&m->threads[operand].state==CPU6502MP_READY)m->threads[operand].state=CPU6502MP_SLEEPING;else if(Y!=0&&m->threads[operand].state==CPU6502MP_SLEEPING)m->threads[operand].state=CPU6502MP_READY;}*cycles=3;return 1;case 0x72:case 0x92:operand=m->memory[PC++];operand=m->memory[operand];if(operand>=16){set_current_result(255,0);*cycles=3;return 1;}if(m->semaphore_owner[operand]!=255&&m->semaphore_owner[operand]!=t->id){m->semaphore_waiters[operand]|=(uint16_t)(1u<<t->id);context_save(m,t);t->state=CPU6502MP_BLOCKED;t->wait_kind=2;t->wait_target=operand;schedule(m);*cycles=3;return 2;}m->semaphore_owner[operand]=t->id;if(m->semaphore_depth[operand]!=255)++m->semaphore_depth[operand];set_current_result(A,1);*cycles=3;return 1;case 0x82:operand=m->memory[PC++];operand=m->memory[operand];set_current_result(A,operand<16?semaphore_release(m,t->id,operand):0);*cycles=3;return 1;case 0xb2:*cycles=2;return 1;case 0xc2:{uint8_t z=m->memory[PC++],id;cpu6502mp_thread_descriptor_t d;d.entry=(uint16_t)(m->memory[z]|((uint16_t)m->memory[(uint8_t)(z+1)]<<8));d.initial_sp=m->memory[(uint8_t)(z+2)];d.argument=m->memory[(uint8_t)(z+3)];d.status=m->memory[(uint8_t)(z+4)];id=cpu6502mp_spawn_descriptor(m,&d);set_current_result(id,id!=255);*cycles=7;return 1;}case 0xd2:{uint16_t a=(uint16_t)(m->memory[PC]|((uint16_t)m->memory[(uint16_t)(PC+1)]<<8));uint8_t old,p;PC=(uint16_t)(PC+2);old=m->memory[a];A=old;p=getP();p&=(uint8_t)~(FLAG_N|FLAG_Z|FLAG_C);if(!old){m->memory[a]=1;p|=FLAG_Z|FLAG_C;}if(old&128)p|=FLAG_N;setP(p);*cycles=5;return 1;}default:return 0;}}
int cpu6502mp_step(cpu6502mp_t *m){cpu6502mp_context_t *t;uint8_t op;int cycles=0,special;if(!m||m->halted||!m->memory)return 0;active_machine=m;if(m->current<0||m->threads[(unsigned)m->current].state!=CPU6502MP_RUNNING)if(schedule(m)<0)return 0;t=&m->threads[(unsigned)m->current];context_load_registers(t);cycles=service_pending_interrupt(m,t);if(cycles){m->total_cycles+=(uint64_t)cycles;++m->total_instructions;return cycles;}op=m->memory[PC++];special=execute_mp_opcode(m,t,op,&cycles);if(!special){PC--;cycles=step6502();context_save_registers(t);}else if(special==1)context_save_registers(t);m->total_cycles+=(uint64_t)cycles;++m->total_instructions;if(special!=2&&m->current>=0 && &m->threads[(unsigned)m->current]==t&&t->state==CPU6502MP_RUNNING&&t->quantum_left>0){--t->quantum_left;if(!t->quantum_left)schedule(m);}return cycles;}
uint32_t cpu6502mp_run(cpu6502mp_t *m,uint32_t max){uint64_t start;if(!m)return 0;start=m->total_instructions;while(m->total_instructions-start<max&&!m->halted)if(cpu6502mp_step(m)==0)break;return(uint32_t)(m->total_instructions-start);}
const cpu6502mp_context_t *cpu6502mp_thread(const cpu6502mp_t *m,uint8_t id){if(!m||id>=16)return NULL;return&m->threads[id];}
int cpu6502mp_reset_from_vector(cpu6502mp_t *m){int cycles;uint16_t entry;if(!m||!m->memory)return 0;active_machine=m;cycles=reset6502();entry=PC;cpu6502mp_reset(m,entry,SP);m->threads[0].a=A;m->threads[0].x=X;m->threads[0].y=Y;m->threads[0].p=(uint8_t)(getP()|4);m->threads[0].cycles=(uint64_t)cycles;m->total_cycles=(uint64_t)cycles;active_machine=NULL;return cycles;}

unsigned char mp_video_byte(void) { return mp_direct_video; }
void mp_clear_video_byte(void) { mp_direct_video = 0; }
