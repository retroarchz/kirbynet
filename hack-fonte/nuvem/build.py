# Pokémon Quetzal: habilidade nova 319 "Nuvem Tóxica" (ao entrar na batalha, envenena todos os adversários).
# Molde: o caso da Intimidate (0x0805338C) no switch "ao entrar" de AbilityBattleEffects e o script dela (0x084B18F8).
# uso: python build.py ROM.gba [saida.gba]  -> imprime os trechos (endereço, original, novo) para o game.js
import struct, sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'metaknight'))
from thumb import Asm

ROM = open(sys.argv[1], 'rb').read()
NOVA = 319
NOVA2 = 320                                  # "Distúrbio" (Dusknoir)
# Distúrbio: área livre igual nas duas ROMs
D_NUVEM, D_CODE, D_CASE, D_SCRIPT, D_ANIM = 0x09FED000, 0x09FEE400, 0x09FEE800, 0x09FEE880, 0x09FEE8C0
D_TXT, D_PAL, D_ESCURO = 0x09FEE900, 0x09FEE9E0, 0x09FEEA00
# área livre (0xFF) igual nas duas ROMs do Quetzal (a do Coop 3 usa até 0x09FFA31C)
CASE, NOME_HOOK, SCRIPT, TXT = 0x09FFE000, 0x09FFE080, 0x09FFE100, 0x09FFE200
JTAB, DESC_C, DESC_L = 0x09FFE400, 0x09FFEA00, 0x09FFF000
ANIM, PAL, TASK, GERAL = 0x09FFE2C0, 0x09FFE300, 0x09FFE340, 0x09FFF600   # animação "Haze roxo"
OLD_GERAL, N_GERAL = 0x0846B9E8, 60          # gBattleAnims_General (só LaunchBattleAnimation 0x080F4088 usa)
ROXO = 18 | 4 << 5 | 22 << 10                # cor que os Pokémon ganham (no Haze é preto)
OLD_JTAB, OLD_DESC_C, OLD_DESC_L = 0x08052608, 0x085371B0, 0x085376AC
DEFAULT, EFEITO_OK, PUSH_SCRIPT = 0x08058604, 0x080583AE, 0x08058D05

def w32(a): return struct.unpack_from('<I', ROM, a - 0x08000000)[0]
def enc(s):
    o = bytearray()
    for c in s:
        if 'A' <= c <= 'Z': o.append(0xBB + ord(c) - 65)
        elif 'a' <= c <= 'z': o.append(0xD5 + ord(c) - 97)
        else: o.append({' ': 0x00, '.': 0xAD, ',': 0xB8, '\n': 0xFE, 'ó': 0x23, 'ú': 0x27, 'é': 0x1B, 'á': 0x17}[c])
    return bytes(o) + b'\xff'

patches = []   # (endereço, bytes novos)
def put(at, data): patches.append((at, bytes(data)))

# --- caso de habilidade nova no switch "ao entrar" (registradores como no caso da Intimidate: sl = batalhador)
def caso(addr, script):
  a = Asm(addr)
  a.ldr_lit('r0', 0x080533C0)          # literal da Intimidate com o endereço de gSpecialStatuses
  a.ldr_i('r0', 'r0', 0)               # (a ROM do Coop 3 mudou a tabela de lugar: 0x0203F8C0)
  a.movh('r5', 10)                     # r5 = sl
  a.lsl('r1', 'r5', 1)
  a.h(0x4451)                          # add r1, sl
  a.lsl('r1', 'r1', 3)                 # batalhador * 0x18
  a.add_r('r3', 'r1', 'r0')
  a.ldrb_i('r0', 'r3', 0x10)
  a.lsl('r0', 'r0', 0x1E)
  a.cmpi('r0', 0)
  a.bc('lt', 'ja')                     # switchInAbilityDone já ligado
  a.ldr_lit('r0', 0x02023204)          # gBattlerAttacker = batalhador
  a.strb_i('r5', 'r0', 0)
  a.ldrb_i('r0', 'r3', 0x10)
  a.mov('r1', 2)
  a.alu('orr', 'r0', 'r1')
  a.strb_i('r0', 'r3', 0x10)
  a.ldr_lit('r0', script)
  a.ldr_lit('r1', PUSH_SCRIPT)         # BattleScriptPushCursorAndCallback
  a.bl('chama')
  a.ldr_lit('r0', EFEITO_OK)           # effect++ e fim do switch
  a.h(0x4687)                          # mov pc, r0
  a.label('ja')
  a.ldr_lit('r0', DEFAULT)
  a.h(0x4687)
  a.label('chama')
  a.bx('r1')
  a.pool()
  return a.build()
put(CASE, caso(CASE, SCRIPT))

# --- GetAbilityName (0x080A5628): a 319 devolve o nome novo; as outras seguem a função original
a = Asm(NOME_HOOK)
a.push([], lr=True)
a.lsl('r0', 'r0', 16)
a.h(0x0C01)                          # lsr r1, r0, #16
a.h(0x1C0B)                          # add r3, r1, #0
a.ldr_lit('r0', NOVA)
a.alu('cmp', 'r1', 'r0'); a.bc('eq', 'n319')
a.addi('r0', 1)
a.alu('cmp', 'r1', 'r0'); a.bc('eq', 'n320')
a.ldr_lit('r0', 0x080A5631)
a.bx('r0')
a.label('n319'); a.ldr_lit('r0', TXT); a.pop(['r1']); a.bx('r1')
a.label('n320'); a.ldr_lit('r0', D_TXT); a.pop(['r1']); a.bx('r1')
a.pool()
put(NOME_HOOK, a.build())
put(0x080A5628, struct.pack('<HHI', 0x4900, 0x4708, NOME_HOOK | 1))   # ldr r1,[pc,#0]; bx r1; .word

# --- script de batalha (mesmos comandos do script da Intimidate; no lugar de baixar o Ataque: veneno)
p32 = lambda v: struct.pack('<I', v)
s = bytearray()
lab = {}; fix = []
def jmp(name): fix.append((len(s), name)); s.extend(b'\0\0\0\0')
s += bytes.fromhex('ff91980808')                 # savetarget
s += bytes.fromhex('760136')                     # showabilitypopup BS_ATTACKER
s += bytes.fromhex('394000')                     # pause
s += bytes([0x45, 0x01, N_GERAL]) + p32(0x02023500)   # playanimation BS_ATTACKER, Haze roxo, sB_ANIM_ARG1
s += bytes.fromhex('0a')                         # waitanimation
s += bytes.fromhex('760f62')                     # destroyabilitypopup
s += bytes.fromhex('2e0532020200')               # setbyte gBattlerTarget, 0
lab['laco'] = len(s)
s += bytes.fromhex('2c053202020432020201'); jmp('prox')   # alvo == quem entrou
s += bytes.fromhex('760137'); jmp('prox')        # jumpiftargetally
s += bytes.fromhex('760061'); jmp('prox')        # jumpifabsent BS_TARGET
s += bytes.fromhex('1d0000000001'); jmp('prox')   # jumpifstatus2 BS_TARGET, STATUS2_SUBSTITUTE
s += bytes.fromhex('2e1e350202022e1f350202002e1c350202022e1d35020200')   # setmoveeffect MOVE_EFFECT_POISON
s += bytes.fromhex('16')                         # seteffectprimary (confere imunidades e mostra a mensagem)
lab['prox'] = len(s)
s += bytes.fromhex('2f0532020201')               # addbyte gBattlerTarget, 1
s += bytes.fromhex('2d053202024430020201'); jmp('laco')   # até gBattlersCount
s += bytes.fromhex('31073502020432020201')       # copybyte sBATTLER, gBattlerAttacker
s += bytes.fromhex('760f62')                     # destroyabilitypopup
s += bytes.fromhex('ffb1980808')                 # restoretarget
s += bytes.fromhex('393000')                     # pause
s += bytes.fromhex('3f')                         # end3
for at, name in fix: s[at:at + 4] = p32(SCRIPT + lab[name])
put(SCRIPT, s)

# --- animação "Haze roxo": o script do Haze (0x084988F2) com a neblina roxa e escurecendo para roxo, não preto
h16 = lambda v: struct.pack('<H', v & 0xFFFF)
blend = lambda a, b, c: bytes.fromhex('03fd6818080a05') + h16(0x1E) + h16(a) + h16(b) + h16(c) + h16(ROXO)
anim = bytes.fromhex('0519f60000') + b'\x03' + p32(TASK | 1) + bytes.fromhex('0500') + bytes.fromhex('041e')      + blend(2, 0, 16) + bytes.fromhex('045a') + blend(1, 16, 0) + b'\x08'
put(ANIM, anim)
# paleta da neblina (0x091756D8, 16 cores cinza) puxada para o roxo
pal = b''
for k in range(16):
    c = struct.unpack_from('<H', ROM, 0x011756D8 + 2 * k)[0]
    l = max(c & 31, c >> 5 & 31, c >> 10 & 31)
    pal += h16(0 if k == 0 else round(l * 0.8) | round(l * 0.3) << 5 | l << 10)
put(PAL, pal)
# tarefa da neblina: roda a do Haze (0x0817AF3C, carrega a paleta cinza) e troca pela roxa; o alvo da animação
# vira o adversário da frente (atacante ^ 1) para os dois lados ficarem roxos, como no Haze de um golpe
a = Asm(TASK)
a.push(['r4'], lr=True)
a.h(0xB084)                          # sub sp, #0x10
a.ldr_lit('r1', 0x0817AF3D)
a.bl('c1')
a.movh('r0', 13)                     # r0 = sp (BattleAnimBgData)
a.ldr_lit('r1', 0x080F794D)          # GetBattleAnimBg
a.bl('c1')
a.movh('r0', 13)
a.ldrb_i('r1', 'r0', 8)              # paletteId
a.lsl('r1', 'r1', 4)
a.ldr_lit('r0', PAL)
a.mov('r2', 0x20)
a.ldr_lit('r3', 0x080F196D)          # LoadPalette
a.bl('c3')
a.ldr_lit('r0', 0x02039F1E)          # gBattleAnimAttacker
a.ldrb_i('r1', 'r0', 0)
a.mov('r2', 1)
a.alu('eor', 'r1', 'r2')
a.strb_i('r1', 'r0', 1)              # gBattleAnimTarget = atacante ^ 1
a.h(0xB004)                          # add sp, #0x10
a.pop(['r4'])
a.pop(['r0'])
a.bx('r0')
a.label('c1'); a.bx('r1')
a.label('c3'); a.bx('r3')
a.pool()
put(TASK, a.build())
assert w32(0x080F40AC) == OLD_GERAL
g = [w32(OLD_GERAL + 4 * i) for i in range(N_GERAL)] + [ANIM, D_ANIM]
put(GERAL, b''.join(p32(x) for x in g))
put(0x080F40AC, p32(GERAL))

# --- Razor Leaf da Arboliva com folhas roxas: o golpe 75 ganha um script que carrega os gráficos como o original,
# roda uma tarefa (se o atacante for a Arboliva, troca as paletas das folhas pelas roxas) e segue no script original
RL_TASK, RL_SCRIPT, RL_PAL1, RL_PAL2 = 0x09FFF740, 0x09FFF800, 0x09FFF820, 0x09FFF840
MOVES_ANIM, RAZOR = 0x0846AB1C, 75
ARBOLIVA, TAG_FOLHA, TAG_LAMINA = 1259, 0x274F, 0x27B0
from lz import lz77
def roxo_folha(addr_tab, idxs):
    p = w32(addr_tab)
    d = lz77(ROM, p - 0x08000000)[0]
    cs = list(struct.unpack('<16H', d))
    for k in idxs:
        c = cs[k]; R, G, B = c & 31, c >> 5 & 31, c >> 10 & 31
        cs[k] = round(G * 0.85) | round(min(R, B) * 0.5) << 5 | G << 10
    return struct.pack('<16H', *cs)
put(RL_PAL1, roxo_folha(0x09128A38, range(1, 8)))     # folha pequena (cores 1-7 verdes; laranja/vermelho ficam)
put(RL_PAL2, roxo_folha(0x09128D40, range(2, 16)))    # lâmina em meia-lua (cores 2-15 verdes)
a = Asm(RL_TASK)
a.push(['r4', 'r5', 'r6'], lr=True)
a.h(0x1C06)                          # add r6, r0, #0 (taskId)
a.ldr_lit('r0', 0x02039F1E); a.ldrb_i('r0', 'r0', 0)    # gBattleAnimAttacker
a.mov('r1', 0x60); a.alu('mul', 'r0', 'r1')
a.ldr_lit('r1', 0x0806DBC8); a.ldr_i('r1', 'r1', 0)    # gBattleMons pelo literal do jogo (muda na ROM do Coop 3)
a.add_r('r0', 'r0', 'r1'); a.ldrh_i('r0', 'r0', 0)     # espécie do atacante
a.ldr_lit('r1', ARBOLIVA); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'fim')
for tag, pal, nome in ((TAG_FOLHA, RL_PAL1, 'p1'), (TAG_LAMINA, RL_PAL2, 'p2')):
    a.ldr_lit('r0', tag); a.bl('acha')
    a.cmpi('r0', 16); a.bc('hs', nome)
    a.lsl('r1', 'r0', 4); a.addi('r1', 0x80); a.addi('r1', 0x80)   # 0x100 + vaga*16 (paletas de sprite)
    a.ldr_lit('r0', pal); a.mov('r2', 0x20)
    a.ldr_lit('r3', 0x080F196D); a.bl('c3')           # LoadPalette
    a.label(nome)
a.label('fim')
a.h(0x1C30)                          # add r0, r6, #0
a.ldr_lit('r3', 0x080F43A9); a.bl('c3')               # DestroyAnimVisualTask
a.pop(['r4', 'r5', 'r6']); a.pop(['r0']); a.bx('r0')
a.label('acha')                      # r0 = tag -> r0 = vaga em sSpritePaletteTags (0x03000CF0, u32 cada) ou 16
a.ldr_lit('r1', 0x03000CF0); a.mov('r2', 0)          # (o FreeAllSpritePalettes 0x08009604 zera essa lista)
a.label('laco'); a.ldr_i('r3', 'r1', 0); a.alu('cmp', 'r3', 'r0'); a.bc('eq', 'achou')
a.addi('r1', 4); a.addi('r2', 1); a.cmpi('r2', 16); a.bc('lo', 'laco')
a.label('achou'); a.h(0x1C10); a.bx('lr')            # add r0, r2, #0
a.label('c3'); a.bx('r3')
a.pool()
code = a.build(); assert RL_TASK + len(code) <= RL_SCRIPT, len(code)
put(RL_TASK, code)
orig_rl = w32(MOVES_ANIM + 4 * RAZOR)
put(RL_SCRIPT, ROM[orig_rl - 0x08000000:orig_rl - 0x08000000 + 9] + b'\x03' + p32(RL_TASK | 1) + b'\x05\x00'
    + b'\x13' + p32(orig_rl + 9))
assert ROM[orig_rl - 0x08000000:orig_rl - 0x08000000 + 9] == bytes.fromhex('004f2700b027009727')
put(MOVES_ANIM + 4 * RAZOR, p32(RL_SCRIPT))

# --- Distúrbio (habilidade 320, Dusknoir): ao entrar a terra treme (tremor do Earthquake) e, enquanto ele estiver
# em campo, o céu da batalha vira as nuvens escuras do fundo de animação 73 (as nuvens andam; o chão fica).
# O céu = fileiras 0-4 do mapa do fundo (BG3, mapa 0x0600D000, blocos em 0x06008000) apontando para 160 blocos
# novos (128..287, paleta 6) desenhados a partir de uma faixa 256x40; as cores das listras do céu na paleta 2
# viram escuro. Uma tarefa (CreateTask) refaz isso quando um golpe troca o fundo e devolve o normal
# (DrawMainBattleBackground) quando nenhum Dusknoir com Distúrbio está em campo.
GTASKS, BATTLE_CB2, DRAWBG, CREATETASK, DESTROYTASK, LOADPAL = 0x03005640, 0x0803F431, 0x0803C06C, 0x080FADB0, 0x080FAE9C, 0x080F196C
D_START = 0x09FEED00
D_NIVEIS, D_VTAB, D_TAB2, D_TAB6 = 0x09FEEB00, 0x09FEECC0, 0x09FEECE0, 0x09FEECE4
PLTT_BASE = 0x020391FC                       # gPlttBufferUnfaded (o Faded fica 0x400 depois)
PENUMBRA = 9                                 # chão com 9/16 do brilho
from lz import lz77 as _lz
_bg = [w32(0x09129530 + 12 * 73 + 4 * k) - 0x08000000 for k in range(3)]
_tiles = _lz(ROM, _bg[0])[0]; _pal = _lz(ROM, _bg[1])[0]; _map = _lz(ROM, _bg[2])[0]
def _px(x, y):
    e = struct.unpack_from('<H', _map, 2 * ((y // 8) * 32 + x // 8))[0]
    tn, hf, vf = e & 0x3FF, e >> 10 & 1, e >> 11 & 1
    sx, sy = (7 - x % 8) if hf else x % 8, (7 - y % 8) if vf else y % 8
    b = _tiles[tn * 32 + sy * 4 + sx // 2]
    return (b >> 4) if sx & 1 else b & 15
faixa = bytearray()
for y in range(40):
    for w in range(32):
        v = 0
        for i in range(8): v |= _px(w * 8 + i, y) << (4 * i)
        faixa += p32(v)
put(D_NUVEM, faixa)
put(D_PAL, _pal[:32])
put(D_ESCURO, _pal[18:20])
import math
niveis = bytearray()
for ry in range(14):
    for cx in range(32):
        d = math.hypot((cx + 0.5 - 15) / 15, (ry + 0.5 - 7) / 7.5)
        niveis.append(0 if d < 0.72 else 1 if d < 0.92 else 2 if d < 1.1 else 3)
put(D_NIVEIS, niveis)
VIN = (11, 7, 3)                             # brilho (de 16) dos 3 níveis da borda
put(D_VTAB, bytes([2, 7, VIN[0], 2, 11, VIN[1], 2, 12, VIN[2], 6, 13, VIN[0], 6, 14, VIN[1], 6, 15, VIN[2]]))
put(D_TAB2, bytes([2, 7, 11, 12])); put(D_TAB6, bytes([6, 13, 14, 15]))                   # cor 9 do fundo 73 (o escuro de baixo das nuvens)

def lsr(a, d, m, imm): a.h(0x0800 | imm << 6 | m << 3 | d)
a = Asm(D_CODE)
a.label('tarefa')                            # tarefa permanente (r0 = id)
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.h(0x1C07)                                  # add r7, r0, #0
a.lsl('r1', 'r0', 2); a.add_r('r1', 'r1', 'r0'); a.lsl('r1', 'r1', 3)
a.ldr_lit('r6', GTASKS); a.add_r('r6', 'r6', 'r1')
a.bl('tem'); a.cmpi('r0', 0); a.bc('ne', 'presente')
a.bl('embatalha'); a.cmpi('r0', 0); a.bc('eq', 'mata')   # a batalha acabou: só desliga
a.bl('pode'); a.cmpi('r0', 0); a.bc('eq', 'fim')         # animação ou outra tela: espera
a.bl('marca'); a.cmpi('r0', 0); a.bc('eq', 'mata')
a.ldr_lit('r3', DRAWBG | 1); a.bl('c3')       # devolve o fundo normal
a.label('mata')
a.h(0x1C38); a.ldr_lit('r3', DESTROYTASK | 1); a.bl('c3')
a.b('fim')
a.label('presente')
a.bl('embatalha'); a.cmpi('r0', 0); a.bc('eq', 'mata')
a.bl('pode'); a.cmpi('r0', 0); a.bc('eq', 'fim')
a.bl('marca'); a.cmpi('r0', 0); a.bc('ne', 'anda')
a.bl('aplica'); a.ldrh_i('r0', 'r6', 8); a.bl('nuvens'); a.b('fim')
a.label('anda')
a.ldrh_i('r0', 'r6', 10); a.addi('r0', 1); a.strh_i('r0', 'r6', 10)
a.mov('r1', 3); a.alu('and_', 'r0', 'r1'); a.bc('ne', 'fim')     # anda 1 pixel a cada 4 quadros
a.ldrh_i('r0', 'r6', 8); a.addi('r0', 1); a.mov('r1', 0xFF); a.alu('and_', 'r0', 'r1'); a.strh_i('r0', 'r6', 8)
a.bl('nuvens')
a.label('fim')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')

a.label('pode')                              # 1 se a batalha está na tela principal e sem animação de golpe
a.ldr_lit('r0', 0x03002664); a.ldr_i('r0', 'r0', 0); a.ldr_lit('r1', BATTLE_CB2); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'nao')
a.ldr_lit('r0', 0x02039EE5); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'nao')   # gAnimScriptActive
a.mov('r0', 1); a.bx('lr')
a.label('nao'); a.mov('r0', 0); a.bx('lr')
a.label('embatalha')                         # gMain.inBattle (0x03002660 + 0x439, bit 1)
a.ldr_lit('r0', 0x03002A99); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 2); a.alu('and_', 'r0', 'r1'); a.bx('lr')
a.label('marca')                             # 1 se o céu escuro está no mapa
a.ldr_lit('r0', 0x0600D000); a.ldrh_i('r0', 'r0', 0); a.lsl('r0', 'r0', 22); lsr(a, 0, 0, 22); a.cmpi('r0', 0x80); a.bc('ne', 'nao')
a.mov('r0', 1); a.bx('lr')
a.label('tem')                               # 1 se algum batalhador tem Distúrbio e vida
a.ldr_lit('r0', 0x0806DBC8); a.ldr_i('r0', 'r0', 0)
a.ldr_lit('r1', 0x02023044); a.ldrb_i('r1', 'r1', 0)
a.ldr_lit('r2', NOVA2)
a.label('t_laco')
a.cmpi('r1', 0); a.bc('eq', 'nao')
a.ldrh_i('r3', 'r0', 0x20); a.alu('cmp', 'r3', 'r2'); a.bc('ne', 't_prox')
a.ldrh_i('r3', 'r0', 0x2A); a.cmpi('r3', 0); a.bc('ne', 't_sim')
a.label('t_prox'); a.addi('r0', 0x60); a.subi('r1', 1); a.b('t_laco')
a.label('t_sim'); a.mov('r0', 1); a.bx('lr')

a.label('aplica')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r4', 0x0600D000); a.mov('r5', 0); a.mov('r6', 160)
a.label('m_laco')                            # cores usadas pelos blocos das fileiras 0-4 (o céu)
a.ldrh_i('r0', 'r4', 0); a.lsl('r0', 'r0', 22); lsr(a, 0, 0, 17)
a.ldr_lit('r1', 0x06008000); a.add_r('r1', 'r1', 'r0')
a.h(0x1C0A); a.addi('r2', 32)                # add r2, r1, #0 ; +32
a.label('m_px')
a.ldrb_i('r3', 'r1', 0)
a.mov('r7', 15); a.alu('and_', 'r7', 'r3')
a.mov('r0', 1); a.h(0x4080 | 7 << 3 | 0); a.alu('orr', 'r5', 'r0')     # lsl r0, r7
lsr(a, 7, 3, 4)
a.mov('r0', 1); a.h(0x4080 | 7 << 3 | 0); a.alu('orr', 'r5', 'r0')
a.addi('r1', 1); a.alu('cmp', 'r1', 'r2'); a.bc('lo', 'm_px')
a.addi('r4', 2); a.subi('r6', 1); a.bc('ne', 'm_laco')
a.ldr_lit('r0', D_PAL); a.mov('r1', 0x60); a.mov('r2', 0x20); a.ldr_lit('r3', LOADPAL | 1); a.bl('c3')   # paleta 6
a.mov('r6', 1)
a.label('e_laco')                            # paleta 2: cores do céu -> escuro; as outras (chão) -> 9/16 (penumbra)
a.h(0x1C28); a.h(0x40C0 | 6 << 3 | 0)        # r0 = r5 >> r6
a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('eq', 'e_chao')
a.ldr_lit('r0', D_ESCURO); a.ldrh_i('r0', 'r0', 0); a.b('e_grava')
a.label('e_chao')
a.lsl('r4', 'r6', 1); a.ldr_lit('r7', PLTT_BASE + 0x40); a.add_r('r4', 'r4', 'r7'); a.ldrh_i('r0', 'r4', 0)
a.mov('r1', 31); a.alu('and_', 'r1', 'r0')
lsr(a, 2, 0, 5); a.mov('r3', 31); a.alu('and_', 'r2', 'r3')
lsr(a, 3, 0, 10); a.mov('r7', 31); a.alu('and_', 'r3', 'r7')
a.mov('r7', PENUMBRA); a.alu('mul', 'r1', 'r7'); a.alu('mul', 'r2', 'r7'); a.alu('mul', 'r3', 'r7')
lsr(a, 1, 1, 4); lsr(a, 2, 2, 4); lsr(a, 3, 3, 4)
a.lsl('r2', 'r2', 5); a.lsl('r3', 'r3', 10); a.alu('orr', 'r1', 'r2'); a.alu('orr', 'r1', 'r3'); a.h(0x1C08)   # r0 = r1
a.label('e_grava')                           # grava nas cores base e nas exibidas (como o LoadPalette)
a.lsl('r4', 'r6', 1); a.ldr_lit('r7', PLTT_BASE + 0x40); a.add_r('r4', 'r4', 'r7'); a.strh_i('r0', 'r4', 0)
a.ldr_lit('r7', 0x400); a.add_r('r4', 'r4', 'r7'); a.strh_i('r0', 'r4', 0)
a.addi('r6', 1); a.cmpi('r6', 16); a.bc('lo', 'e_laco')
a.ldr_lit('r4', D_VTAB); a.mov('r5', 6)
a.label('v_laco')                            # cópias escurecidas: [origem, destino, fator/16] x 6
a.ldrb_i('r6', 'r4', 0); a.ldrb_i('r7', 'r4', 1); a.lsl('r6', 'r6', 5); a.lsl('r7', 'r7', 5)
a.ldr_lit('r0', PLTT_BASE); a.add_r('r6', 'r6', 'r0'); a.add_r('r7', 'r7', 'r0')
a.push(['r5']); a.mov('r5', 32); a.add_r('r5', 'r5', 'r6')
a.label('c_laco')
a.ldrh_i('r0', 'r6', 0)
a.mov('r1', 31); a.alu('and_', 'r1', 'r0')
lsr(a, 2, 0, 5); a.mov('r3', 31); a.alu('and_', 'r2', 'r3')
lsr(a, 3, 0, 10); a.mov('r0', 31); a.alu('and_', 'r3', 'r0')
a.ldrb_i('r0', 'r4', 2); a.alu('mul', 'r1', 'r0'); a.alu('mul', 'r2', 'r0'); a.alu('mul', 'r3', 'r0')
lsr(a, 1, 1, 4); lsr(a, 2, 2, 4); lsr(a, 3, 3, 4)
a.lsl('r2', 'r2', 5); a.lsl('r3', 'r3', 10); a.alu('orr', 'r1', 'r2'); a.alu('orr', 'r1', 'r3')
a.strh_i('r1', 'r7', 0); a.ldr_lit('r0', 0x400); a.add_r('r0', 'r0', 'r7'); a.strh_i('r1', 'r0', 0)
a.addi('r6', 2); a.addi('r7', 2); a.alu('cmp', 'r6', 'r5'); a.bc('lo', 'c_laco')
a.pop(['r5'])
a.addi('r4', 3); a.subi('r5', 1); a.bc('ne', 'v_laco')
a.ldr_lit('r4', 0x0600D000); a.ldr_lit('r5', 0x0600D800); a.ldr_lit('r0', 0x6080); a.mov('r1', 0)
a.label('p_laco')                            # fileiras 0-4 das duas telas do mapa -> blocos 128+i, paleta 6
a.add_r('r2', 'r0', 'r1'); a.lsl('r3', 'r1', 1)
a.strh_r('r2', 'r4', 'r3'); a.strh_r('r2', 'r5', 'r3')
a.addi('r1', 1); a.cmpi('r1', 160); a.bc('lo', 'p_laco')
a.ldr_lit('r4', 0x0600D000); a.ldr_lit('r5', D_NIVEIS); a.mov('r6', 0)
a.label('g_laco')                            # vinheta: fileiras 0-13, cada bloco aponta para a cópia do seu nível
a.h(0x5C00 | 6 << 6 | 5 << 3 | 1)            # ldrb r1, [r5, r6]
a.cmpi('r1', 0); a.bc('eq', 'g_prox')
a.lsl('r2', 'r6', 1); a.h(0x5A00 | 2 << 6 | 4 << 3 | 0)   # ldrh r0, [r4, r2]
lsr(a, 3, 0, 12)
a.cmpi('r3', 2); a.bc('eq', 'g2'); a.cmpi('r3', 6); a.bc('ne', 'g_prox')
a.ldr_lit('r7', D_TAB6); a.b('g_set')
a.label('g2'); a.ldr_lit('r7', D_TAB2)
a.label('g_set')
a.h(0x5C00 | 1 << 6 | 7 << 3 | 7)            # ldrb r7, [r7, r1]
a.lsl('r0', 'r0', 20); lsr(a, 0, 0, 20); a.lsl('r7', 'r7', 12); a.alu('orr', 'r0', 'r7')
a.h(0x5200 | 2 << 6 | 4 << 3 | 0)            # strh r0, [r4, r2]
a.label('g_prox')
a.addi('r6', 1); a.ldr_lit('r0', 14 * 32); a.alu('cmp', 'r6', 'r0'); a.bc('lo', 'g_laco')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')

a.label('nuvens')                            # r0 = deslocamento 0..255: desenha os blocos 128..287
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r1', 8); a.movh('r2', 9); a.push(['r1', 'r2'])
lsr(a, 1, 0, 3); a.mov('r7', 31); a.alu('and_', 'r1', 'r7'); a.movh(9, 'r1')       # r9 = coluna inicial
a.lsl('r2', 'r0', 29); lsr(a, 2, 2, 27)                                             # r2 = (off & 7) * 4
a.mov('r3', 32); a.h(0x1A9B)                                                        # r3 = 32 - r2
a.ldr_lit('r4', D_NUVEM)
a.mov('r7', 0); a.movh(8, 'r7')
a.label('n_linha')
a.movh('r7', 8)
lsr(a, 5, 7, 3); a.lsl('r5', 'r5', 10); a.ldr_lit('r6', 0x06009000); a.add_r('r5', 'r5', 'r6')
a.lsl('r6', 'r7', 29); lsr(a, 6, 6, 27); a.add_r('r5', 'r5', 'r6')
a.mov('r6', 1); a.lsl('r6', 'r6', 10); a.add_r('r6', 'r6', 'r5')
a.movh('r0', 9)
a.label('n_col')
a.lsl('r7', 'r0', 2); a.h(0x5800 | 7 << 6 | 4 << 3 | 1)          # ldr r1, [r4, r7]
a.addi('r0', 1); a.mov('r7', 31); a.alu('and_', 'r0', 'r7')
a.lsl('r7', 'r0', 2); a.h(0x5800 | 7 << 6 | 4 << 3 | 7)          # ldr r7, [r4, r7]
a.h(0x40C0 | 2 << 3 | 1); a.h(0x4080 | 3 << 3 | 7)               # lsr r1, r2 ; lsl r7, r3
a.alu('orr', 'r1', 'r7'); a.str_i('r1', 'r5', 0)
a.addi('r5', 32); a.alu('cmp', 'r5', 'r6'); a.bc('lo', 'n_col')
a.addi('r4', 128)
a.movh('r7', 8); a.addi('r7', 1); a.movh(8, 'r7'); a.cmpi('r7', 40); a.bc('lo', 'n_linha')
a.pop(['r1', 'r2']); a.movh(8, 'r1'); a.movh(9, 'r2')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.label('c3'); a.bx('r3')
a.pool()
code = a.build(); assert D_CODE + len(code) <= D_CASE, hex(len(code))
put(D_CODE, code)
A_TAREFA, A_APLICA, A_NUVENS = a.labels['tarefa'], a.labels['aplica'], a.labels['nuvens']

b = Asm(D_START)                             # tarefa visual da animação 61: liga o céu e cria a tarefa permanente
b.push(['r4', 'r5'], lr=True)
b.h(0x1C04)
b.ldr_lit('r1', GTASKS); b.mov('r2', 0); b.ldr_lit('r5', A_TAREFA | 1)
b.label('laco')
b.ldrb_i('r3', 'r1', 4); b.cmpi('r3', 0); b.bc('eq', 'prox')
b.ldr_i('r3', 'r1', 0); b.alu('cmp', 'r3', 'r5'); b.bc('eq', 'existe')
b.label('prox'); b.addi('r1', 40); b.addi('r2', 1); b.cmpi('r2', 16); b.bc('lo', 'laco')
b.h(0x1C28); b.mov('r1', 3); b.ldr_lit('r3', CREATETASK | 1); b.bl('c3')
b.label('existe')
b.bl(a.labels['marca']); b.cmpi('r0', 0); b.bc('ne', 'ja')     # já aplicado: não escurece de novo
b.bl(A_APLICA)
b.label('ja'); b.mov('r0', 0); b.bl(A_NUVENS)
b.h(0x1C20); b.ldr_lit('r3', 0x080F43A9); b.bl('c3')                # DestroyAnimVisualTask
b.pop(['r4', 'r5']); b.pop(['r0']); b.bx('r0')
b.label('c3'); b.bx('r3')
b.pool()
put(D_START, b.build())

# desvio em DrawMainBattleBackground (0x0803C06C): quando o jogo redesenha o fundo normal (fim de animação de
# golpe com restorebg, volta da bolsa...), refaz o céu na hora se a tarefa existe e o Distúrbio está em campo
D_HOOK = 0x09FEEA40
A_TEM = a.labels['tem']
c = Asm(D_HOOK)
c.label('depois')                            # a função original volta para cá; o retorno de verdade está na pilha
c.bl(A_TEM); c.cmpi('r0', 0); c.bc('eq', 'sai')
c.bl(a.labels['embatalha']); c.cmpi('r0', 0); c.bc('eq', 'sai')
c.ldr_lit('r0', 0x03002664); c.ldr_i('r0', 'r0', 0)     # montando a batalha: dados da batalha anterior ainda
for cb in (0x0803DED9, 0x0803D24D, 0x080499BD):        # estão na tabela, então não mexe
    c.ldr_lit('r1', cb); c.alu('cmp', 'r0', 'r1'); c.bc('eq', 'sai')
c.ldr_lit('r1', GTASKS); c.mov('r2', 0); c.ldr_lit('r3', A_TAREFA | 1)
c.label('laco')
c.ldrb_i('r0', 'r1', 4); c.cmpi('r0', 0); c.bc('eq', 'prox')
c.ldr_i('r0', 'r1', 0); c.alu('cmp', 'r0', 'r3'); c.bc('eq', 'achou')
c.label('prox'); c.addi('r1', 40); c.addi('r2', 1); c.cmpi('r2', 16); c.bc('lo', 'laco')
c.h(0x1C18); c.mov('r1', 3); c.ldr_lit('r3', CREATETASK | 1); c.bl('c3')   # a bolsa/o time apagam as tarefas: recria
c.lsl('r1', 'r0', 2); c.add_r('r1', 'r1', 'r0'); c.lsl('r1', 'r1', 3); c.ldr_lit('r0', GTASKS); c.add_r('r1', 'r1', 'r0')
c.label('achou')
c.push(['r1']); c.bl(A_APLICA); c.pop(['r1']); c.ldrh_i('r0', 'r1', 8); c.bl(A_NUVENS)
c.label('sai')
c.pop(['r0']); c.bx('r0')
c.label('c3'); c.bx('r3')
c.label('entra')                             # entrada desviada: refaz as 4 primeiras instruções da função
c.push([], lr=True)
c.ldr_lit('r3', D_HOOK | 1); c.movh(14, 'r3')    # o retorno da função passa por 'depois'
c.push(['r4', 'r5'], lr=True)
c.ldr_lit('r0', w32(0x0803C090)); c.ldr_i('r1', 'r0', 0); c.ldr_lit('r0', w32(0x0803C094))
c.ldr_lit('r3', 0x0803C075); c.bx('r3')
c.pool()
put(D_HOOK, c.build())
assert ROM[0x3C06C:0x3C074] == bytes.fromhex('30b5084801680848')
put(0x0803C06C, struct.pack('<HHI', 0x4B00, 0x4718, c.labels['entra'] | 1))

# animação geral 61: liga o céu e treme a tela como o Earthquake (tarefa 0x081854E1: fundo e Pokémon)
def treme(alvo): return bytes.fromhex('03e15418080503') + h16(alvo) + h16(10) + h16(50)
put(D_ANIM, b'\x03' + p32(D_START | 1) + b'\x05\x00' + treme(5) + treme(4) + bytes.fromhex('19ea0000') + b'\x05\x08')
# script de batalha: balão da habilidade, animação 61, fecha o balão
put(D_SCRIPT, bytes.fromhex('760136394000') + bytes([0x45, 0x01, N_GERAL + 1]) + p32(0x02023500)
    + bytes.fromhex('0a760f623920003f'))
put(D_CASE, caso(D_CASE, D_SCRIPT))
put(D_TXT, enc('Distúrbio')); put(D_TXT + 0x20, enc('Escurece o céu ao entrar.'))
put(D_TXT + 0x60, enc('Ao entrar, a terra treme e o\ncéu fica coberto de nuvens\nescuras enquanto estiver lá.'))
assert ROM[0x54CF30:0x54CF36] == bytes.fromhex('2e0000007700')
put(0x0854CF30, struct.pack('<3H', NOVA2, NOVA2, NOVA2))      # Dusknoir: Distúrbio nas 3 vagas

# --- textos
nome = enc('Nuvem Tóxica')
curta = enc('Envenena os rivais ao entrar.')
longa = enc('Ao entrar em combate, solta\numa nuvem tóxica que envenena\ntodos os inimigos.')
put(TXT, nome); put(TXT + 0x20, curta); put(TXT + 0x60, longa)

# --- tabela do switch "ao entrar" (habilidade - 2), agora até a 319
old_n = w32(0x08052600) + 1                      # 0x133 + 1 = 308 entradas (habilidades 2..309)
jt = [w32(OLD_JTAB + 4 * i) for i in range(old_n)]
while len(jt) < NOVA - 2: jt.append(DEFAULT)     # 310..318: como antes (fora da tabela = nada)
jt.append(CASE)
jt.append(D_CASE)
put(JTAB, b''.join(p32(x) for x in jt))
put(0x08052600, p32(NOVA2 - 2))
put(0x08052604, p32(JTAB))

# --- descrições (curta e longa): copia as 319 e põe a 319
for old, new, txt, txt2, refs in ((OLD_DESC_C, DESC_C, TXT + 0x20, D_TXT + 0x20, (0x08247C4C, 0x08284704, 0x08284748)),
                                  (OLD_DESC_L, DESC_L, TXT + 0x60, D_TXT + 0x60, (0x08297700,))):
    t = [w32(old + 4 * i) for i in range(NOVA)] + [txt, txt2]
    put(new, b''.join(p32(x) for x in t))
    for r_ in refs:
        assert w32(r_) == old
        put(r_, p32(new))

# confere que cada trecho cai em área livre ou no lugar esperado e monta a saída
out = []
rom = bytearray(ROM)
fim_ant = 0
for at, data in sorted(patches):             # nenhum trecho pode invadir outro
    assert at >= fim_ant, 'sobreposição em %x' % at
    fim_ant = at + len(data)
for at, data in sorted(patches):
    o = at - 0x08000000
    orig = ROM[o:o + len(data)]
    livre = all(b == 0xFF for b in orig)
    assert livre or at < 0x09000000, hex(at)
    out.append([o, None if livre else orig.hex(), data.hex()])
    rom[o:o + len(data)] = data
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'nuvem.json'), 'w'))
for o, orig, data in out: print(hex(o), orig and orig[:24], len(data) // 2)
if len(sys.argv) > 2: open(sys.argv[2], 'wb').write(rom)
