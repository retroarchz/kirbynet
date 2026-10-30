"""Alvos com 6 lugares na tripla (o lugar 4 é o Pokémon do 3º jogador, no meio).

O motor (pokeemerald-expansion) ainda tinha laços fixos em 4 batalhadores:
  - GetNextTarget (0x08073B6C), que escolhe o próximo alvo dos golpes de área (Surf etc.), ia de 0 a 3 e
    devolvia 4 = "não há mais": o lugar 4 nunca era atingido. Agora vai de 0 a 5 e "não há mais" = 6;
  - gBattleStruct->targetsDone[atacante] (+0x402, 4 bytes) passa para a área livre antes do bloco
    (-0x100, criada pelo passo 15 do gancho.py), com espaço para 6 atacantes;
  - menu de escolha de alvo (0x0808E2BA esquerda / 0x0808E3DA direita): tabela de posições {0,2,3,1} ->
    {0,4,2,5,3,1} (ordem da tela) e limites 3 -> 5. Posição sem batalhador o próprio laço já pula.
uso: alvos6.py rom_entrada rom_saida
"""
import hashlib
import struct
import sys
from pathlib import Path

src, dst = map(Path, sys.argv[1:3])
d = bytearray(src.read_bytes()); B = 0x08000000

def h16(at, new, old):
    cur = struct.unpack_from('<H', d, at - B)[0]
    assert cur == old, (hex(at), hex(cur), hex(old))
    struct.pack_into('<H', d, at - B, new)

def literal_de(at):
    # endereço do literal de um "ldr rX,[pc,#imm]"
    h = struct.unpack_from('<H', d, at - B)[0]; assert h >> 11 == 0b01001, hex(at)
    return ((at + 4) & ~3) + (h & 0xFF) * 4

def troca_literal(usos, old, new):
    # troca um literal do pool só se TODOS os "ldr" que o leem estão na lista (nada mais usa aquele word)
    lits = {literal_de(u) for u in usos}
    for lit in lits:
        assert struct.unpack_from('<I', d, lit - B)[0] == old, hex(lit)
        quem = [x for x in range(lit - 0x400, lit, 2)
                if struct.unpack_from('<H', d, x - B)[0] >> 11 == 0b01001 and literal_de(x) == lit]
        assert set(quem) <= set(usos), ('literal compartilhado', hex(lit), [hex(q) for q in quem])
        struct.pack_into('<I', d, lit - B, new & 0xFFFFFFFF)

# GetNextTarget: i <= 3 -> i <= 5; chamadores: "== 4" (nenhum) -> "== 6"
h16(0x08073BD2, 0x2C05, 0x2C03)
h16(0x080704FE, 0x2806, 0x2804)
h16(0x080754D0, 0x2D06, 0x2D04)
h16(0x08075638, 0x2D06, 0x2D04)

# targetsDone: +0x402 -> -0x100 (os três acessos achados pelo literal 0x402 perto de gBattleStruct)
troca_literal([0x08073BA4, 0x08075452, 0x080766F2], 0x402, -0x100)

# menu de alvo: tabela nova de 6 posições
TAB = 0x09FFA000
assert set(d[TAB - B:TAB - B + 8]) == {0xFF}
d[TAB - B:TAB - B + 6] = bytes([0, 4, 2, 5, 3, 1])
troca_literal([0x0808E2BA, 0x0808E2D0], 0x08539880, TAB)
troca_literal([0x0808E3DA, 0x0808E3F0], 0x08539880, TAB)
h16(0x0808E2D4, 0x2C05, 0x2C03)   # esquerda: procura a posição atual em 0..5
h16(0x0808E2E6, 0x2405, 0x2403)   # esquerda: antes do 0 volta para o último (5)
h16(0x0808E3F4, 0x2C05, 0x2C03)   # direita: procura a posição atual em 0..5
h16(0x0808E402, 0x2C05, 0x2C03)   # direita: depois do último (5) volta para o 0

# menu de alvo: depois de achar a posição, um switch aceitava só 0..3 (1/3 inimigo; 0/2 aliado, com checagem)
# e descartava o resto, então o lugar 4 nunca era oferecido. Agora: posição ímpar = inimigo, par = aliado.
def filtro(at):
    # cmp r0,#1; beq INI; cmp r0,#1; blo ALI; cmp r0,#2; beq ALI; cmp r0,#3; beq INI; b FORA
    hs = [struct.unpack_from('<H', d, at - B + 2 * k)[0] for k in range(9)]
    assert hs[0] == 0x2801 and hs[1] >> 8 == 0xD0 and hs[2] == 0x2801 and hs[3] >> 8 == 0xD3 and hs[4] == 0x2802, [hex(h) for h in hs]
    alvo = lambda k: at + 2 * k + 4 + ((hs[k] & 0xFF) - (0x100 if hs[k] & 0x80 else 0)) * 2
    ini, ali = alvo(1), alvo(3)
    novo = [0x07C0,                                                       # lsls r0,r0,#31 (Z = par)
            0xD100 | (((ini - (at + 2 + 4)) >> 1) & 0xFF),                # bne inimigo
            0xE000 | (((ali - (at + 4 + 4)) >> 1) & 0x7FF)]               # b aliado
    for k, h in enumerate(novo): struct.pack_into('<H', d, at - B + 2 * k, h)
filtro(0x0808E30C)
filtro(0x0808E42C)

# x do treinador do jogador na abertura (multi): era (pos & 2) ? 90 : 32, então o da posição 4 ficava atrás do
# da posição 0. Agora x = 32 + 29*pos: 0 -> 32, 2 -> 90 (como antes), 4 -> 148 (os três lado a lado).
def x_treinador(at, reg, olds, fim=None):
    for k, o in enumerate(olds): assert struct.unpack_from('<H', d, at - B + 2 * k)[0] == o, (hex(at), k)
    novo = [0x211D, 0x4348, 0x3020, 0x1C00 | reg]          # movs r1,#29; muls r0,r1; adds r0,#0x20; adds rR,r0,#0
    if fim: novo.append(0xE000 | (((fim - (at + 2 * len(novo) + 4)) >> 1) & 0x7FF))
    novo += [0x46C0] * (len(olds) - len(novo))
    for k, h in enumerate(novo): struct.pack_into('<H', d, at - B + 2 * k, h)
x_treinador(0x081D5212, 4, [0x2102, 0x4008, 0x2420, 0x2800, 0xD00A, 0x245A, 0xE008], fim=0x081D5232)   # parceiro
x_treinador(0x0820C164, 3, [0x2102, 0x4008, 0x2320, 0x2800, 0xD000, 0x235A])                        # 0x0820C1C4
x_treinador(0x08091528, 7, [0x2102, 0x4008, 0x2720, 0x2800, 0xD000, 0x275A])                        # o jogador (0x0809160C)

dst.write_bytes(d)
print('alvos com 6 lugares: golpes de área, targetsDone e menu de alvo')
print(dst, hashlib.sha256(d).hexdigest())
