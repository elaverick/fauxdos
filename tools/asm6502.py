#!/usr/bin/env python3
"""Small two-pass assembler for the instruction/directive subset used by this project."""
from __future__ import annotations
import argparse, ast, re, sys
from pathlib import Path

OPS = {
 'LDA': {'imm':0xA9,'zp':0xA5,'zpx':0xB5,'abs':0xAD,'absx':0xBD,'absy':0xB9,'indx':0xA1,'indy':0xB1},
 'LDX': {'imm':0xA2,'zp':0xA6,'zpy':0xB6,'abs':0xAE,'absy':0xBE},
 'LDY': {'imm':0xA0,'zp':0xA4,'zpx':0xB4,'abs':0xAC,'absx':0xBC},
 'STA': {'zp':0x85,'zpx':0x95,'abs':0x8D,'absx':0x9D,'absy':0x99,'indx':0x81,'indy':0x91},
 'STX': {'zp':0x86,'zpy':0x96,'abs':0x8E}, 'STY': {'zp':0x84,'zpx':0x94,'abs':0x8C},
 'ADC': {'imm':0x69,'zp':0x65,'zpx':0x75,'abs':0x6D,'absx':0x7D,'absy':0x79,'indx':0x61,'indy':0x71},
 'SBC': {'imm':0xE9,'zp':0xE5,'zpx':0xF5,'abs':0xED,'absx':0xFD,'absy':0xF9,'indx':0xE1,'indy':0xF1},
 'AND': {'imm':0x29,'zp':0x25,'zpx':0x35,'abs':0x2D,'absx':0x3D,'absy':0x39,'indx':0x21,'indy':0x31},
 'ORA': {'imm':0x09,'zp':0x05,'zpx':0x15,'abs':0x0D,'absx':0x1D,'absy':0x19,'indx':0x01,'indy':0x11},
 'EOR': {'imm':0x49,'zp':0x45,'zpx':0x55,'abs':0x4D,'absx':0x5D,'absy':0x59,'indx':0x41,'indy':0x51},
 'CMP': {'imm':0xC9,'zp':0xC5,'zpx':0xD5,'abs':0xCD,'absx':0xDD,'absy':0xD9,'indx':0xC1,'indy':0xD1},
 'CPX': {'imm':0xE0,'zp':0xE4,'abs':0xEC}, 'CPY': {'imm':0xC0,'zp':0xC4,'abs':0xCC},
 'CPX': {'imm':0xE0,'zp':0xE4,'abs':0xEC}, 'CPY': {'imm':0xC0,'zp':0xC4,'abs':0xCC},
 'INC': {'zp':0xE6,'zpx':0xF6,'abs':0xEE,'absx':0xFE}, 'DEC': {'zp':0xC6,'zpx':0xD6,'abs':0xCE,'absx':0xDE},
 'ASL': {'acc':0x0A,'zp':0x06,'zpx':0x16,'abs':0x0E,'absx':0x1E}, 'LSR': {'acc':0x4A,'zp':0x46,'zpx':0x56,'abs':0x4E,'absx':0x5E},
 'JMP': {'abs':0x4C,'ind':0x6C}, 'JSR': {'abs':0x20},
 'BCC': {'rel':0x90}, 'BCS': {'rel':0xB0}, 'BEQ': {'rel':0xF0}, 'BNE': {'rel':0xD0},
 'BMI': {'rel':0x30}, 'BPL': {'rel':0x10}, 'BVC': {'rel':0x50}, 'BVS': {'rel':0x70},
}
IMPLIED = {
 'BRK':0x00,'CLC':0x18,'SEC':0x38,'CLI':0x58,'SEI':0x78,'CLV':0xB8,'CLD':0xD8,'SED':0xF8,
 'TAX':0xAA,'TAY':0xA8,'TXA':0x8A,'TYA':0x98,'TSX':0xBA,'TXS':0x9A,
 'INX':0xE8,'INY':0xC8,'DEX':0xCA,'DEY':0x88,
 'PHA':0x48,'PHP':0x08,'PLA':0x68,'PLP':0x28,'RTI':0x40,'RTS':0x60,'NOP':0xEA,
}

class AsmError(Exception): pass

def num(expr, symbols):
    expr = expr.strip()
    lohi = None
    if expr.startswith('<') or expr.startswith('>'):
        lohi, expr = expr[0], expr[1:].strip()
    # Basic arithmetic used in source: symbol +/- constant.
    m = re.fullmatch(r'(.+?)\s*([+-])\s*(.+)', expr)
    if m:
        a = num(m.group(1), symbols); b = num(m.group(3), symbols)
        value = a + b if m.group(2) == '+' else a - b
    elif expr.startswith('$'):
        value = int(expr[1:], 16)
    elif expr.startswith('%'):
        value = int(expr[1:], 2)
    elif re.fullmatch(r'\d+', expr):
        value = int(expr, 10)
    elif expr.startswith("'") and expr.endswith("'") and len(expr) == 3:
        value = ord(expr[1])
    elif expr.startswith('"') and expr.endswith('"'):
        raise AsmError('string is not a numeric expression')
    elif expr in symbols:
        value = symbols[expr]
    else:
        raise AsmError(f'unknown expression: {expr}')
    if lohi == '<': value &= 0xff
    if lohi == '>': value = (value >> 8) & 0xff
    return value

def split_args(s):
    out=[]; cur=''; quote=None
    for ch in s:
        if quote:
            cur += ch
            if ch == quote: quote=None
        elif ch in ('"', "'"):
            quote=ch; cur+=ch
        elif ch==',': out.append(cur.strip()); cur=''
        else: cur+=ch
    if cur.strip(): out.append(cur.strip())
    return out

def parse_operand(op, symbols, pass1=False):
    op=op.strip()
    if not op: return 'imp', None
    if op.upper() == 'A': return 'acc', None
    if op.startswith('#'): return 'imm', op[1:].strip()
    if op.startswith('(') and op.endswith('),Y'):
        return 'indy', op[1:-3].strip()
    if op.startswith('(') and op.endswith(',X)'):
        return 'indx', op[1:-3].strip()
    if op.startswith('(') and op.endswith(')'):
        return 'ind', op[1:-1].strip()
    m=re.fullmatch(r'(.+),\s*([XY])',op,re.I)
    if m:
        expr, idx=m.group(1).strip(),m.group(2).lower()
        try: v=num(expr,symbols)
        except AsmError:
            if pass1: v=0x100
            else: raise
        mode=('zpx' if idx=='x' else 'zpy') if v<=0xff else ('absx' if idx=='x' else 'absy')
        return mode,expr
    try: v=num(op,symbols)
    except AsmError:
        if pass1: v=0x100
        else: raise
    return ('zp' if v<=0xff else 'abs'),op

def clean_line(line):
    quote=None; out=''
    for ch in line:
        if quote:
            out+=ch
            if ch==quote: quote=None
        elif ch in ('"',"'"):
            quote=ch; out+=ch
        elif ch==';': break
        else: out+=ch
    return out.strip()

def string_bytes(token):
    try: v=ast.literal_eval(token)
    except Exception as e: raise AsmError(f'invalid string literal {token}: {e}')
    if not isinstance(v,str): raise AsmError('expected string')
    return list(v.encode('ascii'))

def parse_source(path):
    lines=[]
    for no,raw in enumerate(Path(path).read_text().splitlines(),1):
        s=clean_line(raw)
        if not s: continue
        m=re.match(r'^([A-Za-z_][\w]*):\s*(.*)$',s)
        if m:
            lines.append((no,m.group(1)+':'))
            if m.group(2).strip(): lines.append((no,m.group(2).strip()))
        else:
            lines.append((no,s))
    return lines

def assemble(path, outpath, base=None, size=None, listing=False):
    lines=parse_source(path); symbols={}; pc=base or 0
    # Multiple passes allow forward labels used in operand width selection.
    for iteration in range(4):
        symbols_new={}; pc=base or 0
        for no,s in lines:
            if s.endswith(':'):
                symbols_new[s[:-1].strip()]=pc; continue
            if re.match(r'^[A-Za-z_][\w]*\s*=\s*',s):
                name,expr=s.split('=',1)
                try: symbols_new[name.strip()]=num(expr, {**symbols,**symbols_new})
                except AsmError: pass
                continue
            m=re.match(r'^([A-Za-z.]+)(?:\s+(.*))?$',s)
            if not m: raise AsmError(f'{path}:{no}: cannot parse {s}')
            op=m.group(1).upper(); arg=(m.group(2) or '').strip()
            sy={**symbols,**symbols_new}
            if op=='.ORG': pc=num(arg,sy)
            elif op=='.BYTE':
                for a in split_args(arg):
                    pc += len(string_bytes(a)) if a.startswith('"') else 1
            elif op=='.WORD': pc += 2*len(split_args(arg))
            elif op=='.FILL': pc += num(split_args(arg)[0],sy)
            else:
                if op in IMPLIED: pc+=1
                elif op in OPS:
                    mode,expr=parse_operand(arg,sy,True)
                    if op in ('BCC','BCS','BEQ','BNE','BMI','BPL','BVC','BVS'): mode='rel'
                    if mode not in OPS[op]: raise AsmError(f'{path}:{no}: unsupported mode {mode} for {op} ({arg})')
                    pc += 1 if mode in ('imp','acc') else 2 if mode in ('imm','zp','zpx','zpy','indx','indy','rel') else 3
                else: raise AsmError(f'{path}:{no}: unsupported opcode/directive {op}')
        if symbols_new==symbols: break
        symbols=symbols_new
    # Final pass emits bytes.
    image={}; pc=base or 0; listing_rows=[]
    for no,s in lines:
        if s.endswith(':') or re.match(r'^[A-Za-z_][\w]*\s*=\s*',s): continue
        m=re.match(r'^([A-Za-z.]+)(?:\s+(.*))?$',s); op=m.group(1).upper(); arg=(m.group(2) or '').strip(); sy=symbols
        if op=='.ORG': pc=num(arg,sy); continue
        emitted=[]; start=pc
        if op=='.BYTE':
            for a in split_args(arg): emitted += string_bytes(a) if a.startswith('"') else [num(a,sy)&0xff]
        elif op=='.WORD':
            for a in split_args(arg):
                v=num(a,sy); emitted += [v&0xff,(v>>8)&0xff]
        elif op=='.FILL':
            aa=split_args(arg); n=num(aa[0],sy); val=num(aa[1],sy) if len(aa)>1 else 0; emitted=[val&0xff]*n
        elif op in IMPLIED: emitted=[IMPLIED[op]]
        else:
            mode,expr=parse_operand(arg,sy)
            if op in ('BCC','BCS','BEQ','BNE','BMI','BPL','BVC','BVS'): mode='rel'
            opcode=OPS[op][mode]; emitted=[opcode]
            if mode=='rel':
                target=num(expr,sy); off=target-(pc+2)
                if off < -128 or off > 127: raise AsmError(f'{path}:{no}: branch out of range ({off})')
                emitted.append(off&0xff)
            elif mode not in ('imp','acc'):
                v=num(expr,sy)
                if mode in ('imm','zp','zpx','zpy','indx','indy'): emitted.append(v&0xff)
                else: emitted += [v&0xff,(v>>8)&0xff]
        for b in emitted:
            if pc in image: raise AsmError(f'{path}:{no}: overlapping output at ${pc:04X}')
            image[pc]=b; pc+=1
        listing_rows.append((start,emitted,s))
    if not image: raise AsmError('empty source')
    lo=min(image); hi=max(image)
    if size is not None:
        origin=base if base is not None else lo
        data=bytearray([0xff]*(size))
        for addr,b in image.items():
            if not origin<=addr<origin+size: raise AsmError(f'output at ${addr:04X} outside image range')
            data[addr-origin]=b
    else:
        origin=lo; data=bytearray(hi-lo+1)
        for addr,b in image.items(): data[addr-lo]=b
    Path(outpath).parent.mkdir(parents=True,exist_ok=True); Path(outpath).write_bytes(data)
    if listing:
        for addr,bs,s in listing_rows:
            print(f'{addr:04X}  {" ".join(f"{b:02X}" for b in bs):<9} {s}')
        print('Symbols:')
        for k,v in sorted(symbols.items(),key=lambda kv:kv[1]): print(f'  {k:<20} ${v:04X}')
    print(f'Assembled {path}: {len(data)} bytes -> {outpath}')
    return symbols

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('source'); p.add_argument('output'); p.add_argument('--base',type=lambda x:int(x,0)); p.add_argument('--size',type=lambda x:int(x,0)); p.add_argument('--listing',action='store_true')
    a=p.parse_args()
    try: assemble(a.source,a.output,a.base,a.size,a.listing)
    except Exception as e: print(e,file=sys.stderr); sys.exit(1)
