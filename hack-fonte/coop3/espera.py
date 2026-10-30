"""Espera antes da batalha coop: só o host (id 0) decide quando começar.

Antes, a tarefa de espera (0x081077F4) começava assim que achava UM parceiro esperando o mesmo
treinador. Agora:
  - convidados (id != 0) nunca começam sozinhos; esperam a liberação do cabo (linkhle.js);
  - o host pede "todos" quando todos os conectados esperam o mesmo treinador (com 3: tripla);
  - com 3 conectados e só 1 parceiro esperando, o host pede "dupla" com um A NOVO: o A fica armado só
    depois de solto, então o A que fecha o diálogo do treinador não conta.
Caixa de correio na EWRAM livre (o linkhle.js lê e escreve):
  MAIL+0 pedido do host: 0 nada, 2 dupla, 3 todos     (a ROM escreve, o JS zera ao ler)
  MAIL+1 liberação: != 0 começa agora                  (o JS escreve, a ROM zera ao usar)
  MAIL+4 parceiro da dupla (id no cabo)
uso: espera.py rom_entrada rom_saida
"""
import hashlib
import struct
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'metaknight'))
from thumb import Asm

src, dst = map(Path, sys.argv[1:3])
d = bytearray(src.read_bytes()); B = 0x08000000

MAIL = 0x0203FE80
COUNT, MYID = 0x030055F4, 0x030055F0                 # conectados no coop, meu id
WAITING, THEIR_TR, MY_TR, MY_TR2 = 0x030045A0, 0x03004590, 0x03004570, 0x0203A6D6
HELD, NEW = 0x0300268C, 0x0300268E                   # gMain.heldKeys / newKeys
IN_WORLD, MSG_DONE = 0x08261B54, 0x080DD718
ENTRY = 0x09FF9000

a = Asm(ENTRY)
def call(f): a.ldr_lit('r3', f | 1); a.bl('_r3')
# r4 = struct da tarefa (data[0] em +8). Devolve r0 != 0 = começar (o laço original acha o parceiro).
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
call(MSG_DONE); a.lsl('r0', 'r0', 24); a.bc('eq', 'nao')                 # mensagem ainda escrevendo
a.ldr_lit('r1', MAIL); a.ldrb_i('r0', 'r1', 1); a.cmpi('r0', 0); a.bc('eq', 'semgo')
a.mov('r0', 0); a.strb_i('r0', 'r1', 1); a.mov('r0', 1); a.b('volta')     # liberado pelo cabo
a.label('semgo')
a.ldr_lit('r0', MYID); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'nao')   # convidado: só espera
# A armado (data[7]) só depois de solto
a.ldr_lit('r0', HELD); a.ldrh_i('r0', 'r0', 0); a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'segura')
a.strh_i('r1', 'r4', 0x16)
a.label('segura')
# parceiros esperando o mesmo treinador (mesma regra do laço original, com o 2º treinador)
a.mov('r5', 0); a.mov('r6', 0); a.mov('r7', 1)
a.label('laco')
a.ldr_lit('r0', COUNT); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r7', 'r0'); a.bc('hs', 'contou')
a.movh('r0', 'r7'); call(IN_WORLD); a.lsl('r0', 'r0', 24); a.bc('eq', 'prox')
a.ldr_lit('r0', WAITING); a.ldrb_r('r0', 'r0', 'r7'); a.cmpi('r0', 0); a.bc('eq', 'prox')
a.ldr_lit('r0', THEIR_TR); a.lsl('r1', 'r7', 1); a.ldrh_r('r0', 'r0', 'r1')
a.ldr_lit('r1', MY_TR); a.ldrh_i('r1', 'r1', 0); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'igual')
a.ldr_lit('r1', MY_TR2); a.ldrh_i('r1', 'r1', 0); a.cmpi('r1', 0); a.bc('eq', 'prox'); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'prox')
a.label('igual'); a.addi('r5', 1); a.movh('r6', 'r7')
a.label('prox'); a.addi('r7', 1); a.b('laco')
a.label('contou')
a.cmpi('r5', 0); a.bc('eq', 'nao')
a.ldr_lit('r1', MAIL)
a.ldr_lit('r0', COUNT); a.ldrb_i('r0', 'r0', 0); a.subi('r0', 1); a.alu('cmp', 'r5', 'r0'); a.bc('ne', 'dupla')
a.mov('r0', 3); a.strb_i('r0', 'r1', 0); a.b('nao')                       # todos esperando: todos juntos
a.label('dupla')
a.ldrh_i('r0', 'r4', 0x16); a.cmpi('r0', 0); a.bc('eq', 'nao')
a.ldr_lit('r0', NEW); a.ldrh_i('r0', 'r0', 0); a.mov('r2', 1); a.alu('tst', 'r0', 'r2'); a.bc('eq', 'nao')
a.mov('r0', 0); a.strh_i('r0', 'r4', 0x16)                                 # desarma até soltar de novo
a.strb_i('r6', 'r1', 4); a.mov('r0', 2); a.strb_i('r0', 'r1', 0)
a.label('nao'); a.mov('r0', 0)
a.label('volta'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.bx('r1')
a.label('_r3'); a.bx('r3'); a.pool()
code = a.build()
assert set(d[ENTRY - B:ENTRY - B + len(code)]) == {0xFF}
d[ENTRY - B:ENTRY - B + len(code)] = code

# 0x081078A4..0x081078BB (bl 0x0826178C; ...; bl 0x080DD718; ...; movs r4,#0; b laço) vira:
#   ldr r3,=ENTRY; bl bx_r3; cmp r0,#0; beq fim; movs r4,#0; b laço; bx_r3: bx r3; .word ENTRY|1
HOOK = 0x081078A4
old = bytes.fromhex('59f172ff0006002853d0d5f733ff000600284ed0002448e0')
assert bytes(d[HOOK - B:HOOK - B + len(old)]) == old, d[HOOK - B:HOOK - B + len(old)].hex()
def bcond(at, to, cond=0):   # beq
    return 0xD000 | cond << 8 | (((to - (at + 4)) >> 1) & 0xFF)
def bl(at, to):
    off = to - (at + 4); return struct.pack('<HH', 0xF000 | ((off >> 12) & 0x7FF), 0xF800 | ((off >> 1) & 0x7FF))
new = struct.pack('<H', 0x4B03)                    # A4 ldr r3,[pc,#12] -> 0x081078B4
new += bl(HOOK + 2, HOOK + 0x0E)                   # A6 bl 0x081078B2
new += struct.pack('<HHHHH', 0x2800, bcond(HOOK + 0x08, 0x08107956), 0x2400,
                   0xE000 | (((0x0810794E - (HOOK + 0x0C + 4)) >> 1) & 0x7FF), 0x4718)  # AA..B2
new += struct.pack('<I', ENTRY | 1)               # B4
d[HOOK - B:HOOK - B + len(new)] = new
assert HOOK - B + len(new) <= HOOK - B + 0x18 and (HOOK + 0x10) % 4 == 0

dst.write_bytes(d)
print('espera do coop: só o host começa (dupla com A novo, todos quando todos esperam)')
print(dst, hashlib.sha256(d).hexdigest())
