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
D_TRAMP, D_GUARDA = 0x09FEEB60, 0x09FEEBE0
D_DRENO, D_DANO, D_CURA, D_FASE = 0x09FEBE00, 0x09FEBF00, 0x09FEBF40, 0x09FEBFC0
D_TXT, D_PAL, D_ESCURO = 0x09FEE900, 0x09FEE9E0, 0x09FEEA00
D_ANIM2 = 0x09FEEC80                         # animação geral 62: absorção do Dream Eater (dreno do Distúrbio)
D_SAI = 0x09FEED00                           # tarefa da saída: a luz volta aos poucos quando o Distúrbio acaba
D_ROSA, D_ROSA_PAL = 0x09FEEE00, 0x09FEEE60   # tarefa que pinta as bolinhas do dreno de rosa + a paleta rosa
D_COBRE = 0x09FEEE80                         # antes de devolver o fundo normal: tela no escuro (o jogo leva 2 quadros)
SAI_QUADROS = 44                             # brilho 5/16 -> 16/16, +1/16 a cada 4 quadros
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
        else: o.append({' ': 0x00, '.': 0xAD, ',': 0xB8, '\n': 0xFE, 'ó': 0x23, 'ú': 0x27, 'é': 0x1B, 'á': 0x17, 'ç': 0x19, '!': 0xAB}[c])
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
g = [w32(OLD_GERAL + 4 * i) for i in range(N_GERAL)] + [ANIM, D_ANIM, D_ANIM2]
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
# O fundo visível (BG3, 30x14 blocos) é redesenhado pixel a pixel: nuvens do fundo 73 (fileiras 0-4, refeitas uma
# por vez para andarem) e o terreno em penumbra (fileiras 5-13), com uma vinheta suave (brilho por pixel, rampas de
# tons e pontilhado fino entre tons vizinhos; modelo em vinheta_ref.py). Uma tarefa (CreateTask) refaz isso quando um golpe troca o fundo e devolve o normal
# (DrawMainBattleBackground) quando nenhum Dusknoir com Distúrbio está em campo.
GTASKS, BATTLE_CB2, DRAWBG, CREATETASK, DESTROYTASK, LOADPAL = 0x03005640, 0x0803F431, 0x0803C06C, 0x080FADB0, 0x080FAE9C, 0x080F196C
D_START = D_CODE + 0x300
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
put(D_ESCURO, _pal[18:20])                   # cor 9 do fundo 73 (o escuro de baixo das nuvens)

def lsr(a, d, m, imm): a.h(0x0800 | imm << 6 | m << 3 | d)
def ldr_sp(a, d, off): a.h(0x9800 | d << 8 | off >> 2)
def str_sp(a, d, off): a.h(0x9000 | d << 8 | off >> 2)
def add_sp(a, d, off): a.h(0xA800 | d << 8 | off >> 2)      # rd = sp + off
def swi_div(a): a.h(0xDF06)                                 # BIOS Div: r0 = r0 / r1 (estraga r1, r3)

def pool_aqui(a, nome):
    """constantes no meio do código (o ldr de constante só alcança 1 KB)"""
    a.b(nome); a.pool(); a.label(nome)

def oito_px_p(a):
    """8 pixels: r6 = linha combinada (nível*16 + pontilhado) por pixel, r2 = tabela de saída, r3 = 8 cores -> r4"""
    a.mov('r4', 0)
    for xx in range(8):
        a.ldrb_i('r0', 'r6', xx); a.lsl('r0', 'r0', 4)
        a.lsl('r1', 'r3', 28); lsr(a, 1, 1, 28); a.add_r('r0', 'r0', 'r1')
        if xx < 7: lsr(a, 3, 3, 4)
        a.h(0x5C00 | 0 << 6 | 2 << 3 | 0)    # ldrb r0, [r2, r0]
        if xx: a.lsl('r0', 'r0', 4 * xx)
        a.alu('orr', 'r4', 'r0')

def oito_px(a, dec):
    """8 pixels: r6 = tabela de níveis (dec: aponta 7 antes), r7 = pontilhado da linha, r2 = tabela de saída,
    r3 = 8 cores de origem (pixel 0 nos 4 bits baixos) -> r4 = linha do bloco"""
    a.mov('r4', 0)
    for xx in range(8):
        a.ldrb_i('r0', 'r6', 7 - xx if dec else xx); a.lsl('r0', 'r0', 4)
        a.ldrb_i('r1', 'r7', xx & 3); a.add_r('r0', 'r0', 'r1'); a.lsl('r0', 'r0', 4)
        a.lsl('r1', 'r3', 28); lsr(a, 1, 1, 28); a.add_r('r0', 'r0', 'r1')
        if xx < 7: lsr(a, 3, 3, 4)
        a.h(0x5C00 | 0 << 6 | 2 << 3 | 0)    # ldrb r0, [r2, r0]
        if xx: a.lsl('r0', 'r0', 4 * xx)
        a.alu('orr', 'r4', 'r0')

# --- vinheta pixel a pixel (modelo em vinheta_ref.py, mesma conta inteira)
import vinheta_ref as VR
D_CODE = 0x09FE4800                          # código (até 0x09FE5FFF)
D_Q4, D_B4, D_PNUV, D_KQV, D_PFIXO1, D_OUTN = 0x09FE6000, 0x09FE7A40, 0x09FE7A60, 0x09FE7A80, 0x09FE7AC0, 0x09FE7B00
BUF = 0x0201C000                             # gDecompressionBuffer: cópia dos blocos do terreno enquanto desenha
OUTS = 0x0201E000                            # tabela de saída do fundo fixo (4 KB, no mesmo rascunho)
MAPA_COPIA = 0x0201F000                      # cópia do mapa (fileiras 0-13) enquanto a tela fica coberta
NUV0 = VR.BASE_NUVEM                         # blocos das nuvens 270..419; fundo fixo 0..269
ESC = struct.unpack('<H', _pal[18:20])[0]
L1 = VR.lum(ESC); M1 = VR.fator(L1, VR.N_ESC)
put(D_Q4, VR.tabela_quarto4()); put(D_B4, bytes(VR.B4)); put(D_KQV, bytes(VR.KQV))
_pn, _lm0 = VR.nuvem_dados(bytes(faixa), _pal[:32])
put(D_PNUV, struct.pack('<16H', *_pn))
put(D_OUTN, VR.tabela_saida([(l, 1, 14) for l in _lm0]))
D_PNV = 0x09FE8C00                          # linha da tabela de saída por pixel da área das nuvens (240x40)
put(D_PNV, bytes(VR.kql_esp(VR.tabela_quarto4(), x, y) * 16 + VR.B4[(y & 3) * 4 + (x & 3)] for y in range(40) for x in range(240)))
put(D_PFIXO1, struct.pack('<6H', 0, *VR.rampa(ESC, L1, VR.N_ESC)))
PAL_FIXO = PLTT_BASE + VR.PAL_FIXO * 32

a = Asm(D_CODE)
a.label('tarefa')                            # tarefa permanente (r0 = id)
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.h(0x1C07)                                  # add r7, r0, #0
a.lsl('r1', 'r0', 2); a.add_r('r1', 'r1', 'r0'); a.lsl('r1', 'r1', 3)
a.ldr_lit('r6', GTASKS); a.add_r('r6', 'r6', 'r1')
a.ldr_lit('r3', D_GUARDA | 1); a.bl('c3')      # Safeguard no lado de quem tem Distúrbio (ou desliga)
a.bl('tem'); a.cmpi('r0', 0); a.bc('ne', 'presente')
a.bl('embatalha'); a.cmpi('r0', 0); a.bc('eq', 'mata')   # a batalha acabou: só desliga
a.bl('pode'); a.cmpi('r0', 0); a.bc('eq', 'fim')         # animação ou outra tela: espera
a.bl('marca'); a.cmpi('r0', 0); a.bc('eq', 'mata')
a.ldr_lit('r3', D_COBRE | 1); a.bl('c3')      # o redesenho do jogo leva 2 quadros: começa com a tela no escuro
a.ldr_lit('r3', DRAWBG | 1); a.bl('c3')       # devolve o fundo normal, mas escuro: a luz volta aos poucos (D_SAI)
a.mov('r0', 0); a.strh_i('r0', 'r6', 8)
a.ldr_lit('r0', D_SAI | 1); a.str_i('r0', 'r6', 0)
a.h(0x1C38); a.ldr_lit('r3', D_SAI | 1); a.bl('c3'); a.b('fim')
a.label('mata')
a.h(0x1C38); a.ldr_lit('r3', DESTROYTASK | 1); a.bl('c3')
a.b('fim')
a.label('presente')
a.bl('embatalha'); a.cmpi('r0', 0); a.bc('eq', 'mata')
a.bl('pode'); a.cmpi('r0', 0); a.bc('eq', 'fim')
a.bl('marca'); a.cmpi('r0', 0); a.bc('ne', 'anda')
a.ldrh_i('r0', 'r6', 8); a.bl('aplica'); a.b('fim')
a.label('anda')                              # 1/3 de fileira de nuvens por quadro (10 blocos); 15 quadros = 1 pixel
a.ldrh_i('r0', 'r6', 12); a.addi('r0', 1); a.cmpi('r0', 3); a.bc('lo', 'a_parte')     # +12 = terço (0..2)
a.mov('r0', 0)
a.ldrh_i('r1', 'r6', 10); a.addi('r1', 1); a.cmpi('r1', 5); a.bc('lo', 'a_fil')       # +10 = fileira (0..4)
a.mov('r1', 0)
a.ldrh_i('r2', 'r6', 8); a.addi('r2', 1); a.mov('r3', 0xFF); a.alu('and_', 'r2', 'r3'); a.strh_i('r2', 'r6', 8)   # +8 = deslocamento
a.label('a_fil'); a.strh_i('r1', 'r6', 10)
a.label('a_parte'); a.strh_i('r0', 'r6', 12)
a.mov('r2', 10); a.alu('mul', 'r2', 'r0'); a.h(0x1C13); a.addi('r3', 10)                # colunas terço*10 .. +10
a.ldrh_i('r0', 'r6', 10); a.ldrh_i('r1', 'r6', 8); a.bl('nuvem_linha')
a.label('fim')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')

a.label('pode')                              # 1 se a batalha está na tela principal e sem animação de golpe
a.ldr_lit('r0', 0x03002664); a.ldr_i('r0', 'r0', 0); a.ldr_lit('r1', BATTLE_CB2); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'nao')
a.ldr_lit('r0', 0x02039EE5); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'nao')   # gAnimScriptActive
a.mov('r0', 1); a.bx('lr')
a.label('nao'); a.mov('r0', 0); a.bx('lr')
a.label('embatalha')                         # gMain.inBattle (0x03002660 + 0x439, bit 1)
a.ldr_lit('r0', 0x03002A99); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 2); a.alu('and_', 'r0', 'r1'); a.bx('lr')
a.label('marca')                             # 1 se o céu escuro está no mapa (bloco 270 no canto)
a.ldr_lit('r0', 0x0600D000); a.ldrh_i('r0', 'r0', 0); a.lsl('r0', 'r0', 22); lsr(a, 0, 0, 22)
a.ldr_lit('r1', NUV0); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'nao')
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
a.label('c3'); a.bx('r3')
a.pool()

# ---------------- aplica(r0 = deslocamento das nuvens): desenha o fundo inteiro com a vinheta
# quadro na pilha: 0x00 cnt[16] u16, 0x20 LMM[16] u32, 0x60 BASE[16], 0x70 MAX[16], 0x80 máscara do céu,
# 0x88.. temporários; 0xA0 r11 salvo, 0xA4 deslocamento, 0xA8.. r8-r10
a.label('aplica')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r1', 8); a.movh('r2', 9); a.movh('r3', 10); a.push(['r0', 'r1', 'r2', 'r3'])
a.movh('r1', 11); a.push(['r1'])
a.h(0xB080 | 0xA0 >> 2)                      # sub sp, #0xA0
# 1) máscara das cores do céu (blocos das fileiras 0-4 do terreno)
a.ldr_lit('r4', 0x0600D000); a.mov('r5', 0); a.mov('r6', 160)
a.label('m_laco')
a.ldrh_i('r0', 'r4', 0); a.lsl('r0', 'r0', 22); lsr(a, 0, 0, 17)
a.ldr_lit('r1', 0x06008000); a.add_r('r1', 'r1', 'r0')
a.h(0x1C0A); a.addi('r2', 32)
a.label('m_px')
a.ldrb_i('r3', 'r1', 0)
a.mov('r7', 15); a.alu('and_', 'r7', 'r3')
a.mov('r0', 1); a.h(0x4080 | 7 << 3 | 0); a.alu('orr', 'r5', 'r0')
lsr(a, 7, 3, 4)
a.mov('r0', 1); a.h(0x4080 | 7 << 3 | 0); a.alu('orr', 'r5', 'r0')
a.addi('r1', 1); a.alu('cmp', 'r1', 'r2'); a.bc('lo', 'm_px')
a.addi('r4', 2); a.subi('r6', 1); a.bc('ne', 'm_laco')
str_sp(a, 5, 0x80)
# 2) paleta 2: cores do céu -> escuro, chão -> 9/16 (penumbra); é a base das cores
a.mov('r6', 1)
a.label('e_laco')
a.h(0x1C28); a.h(0x40C0 | 6 << 3 | 0)
a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('eq', 'e_chao')
a.ldr_lit('r0', ESC); a.b('e_grava')
a.label('e_chao')
a.lsl('r4', 'r6', 1); a.ldr_lit('r7', PLTT_BASE + 0x40); a.add_r('r4', 'r4', 'r7'); a.ldrh_i('r0', 'r4', 0)
a.mov('r1', 31); a.alu('and_', 'r1', 'r0')
lsr(a, 2, 0, 5); a.mov('r3', 31); a.alu('and_', 'r2', 'r3')
lsr(a, 3, 0, 10); a.mov('r7', 31); a.alu('and_', 'r3', 'r7')
a.mov('r7', PENUMBRA); a.alu('mul', 'r1', 'r7'); a.alu('mul', 'r2', 'r7'); a.alu('mul', 'r3', 'r7')
lsr(a, 1, 1, 4); lsr(a, 2, 2, 4); lsr(a, 3, 3, 4)
a.lsl('r2', 'r2', 5); a.lsl('r3', 'r3', 10); a.alu('orr', 'r1', 'r2'); a.alu('orr', 'r1', 'r3'); a.h(0x1C08)
a.label('e_grava')
a.lsl('r4', 'r6', 1); a.ldr_lit('r7', PLTT_BASE + 0x40); a.add_r('r4', 'r4', 'r7'); a.strh_i('r0', 'r4', 0)
a.ldr_lit('r7', 0x400); a.add_r('r4', 'r4', 'r7'); a.strh_i('r0', 'r4', 0)
a.addi('r4', 32); a.strh_i('r0', 'r4', 0)        # paleta 3 exibida junto (tem as mesmas cores), senão o chão dela pisca claro
a.addi('r6', 1); a.cmpi('r6', 16); a.bc('lo', 'e_laco')
pool_aqui(a, 'pp1')
# 3) copia os blocos do terreno (8 KB) para o rascunho
a.ldr_lit('r0', 0x06008000); a.ldr_lit('r1', BUF); a.ldr_lit('r2', 0x06008000 + 0x2000)
a.label('cp')
a.ldr_i('r3', 'r0', 0); a.str_i('r3', 'r1', 0); a.addi('r0', 4); a.addi('r1', 4); a.alu('cmp', 'r0', 'r2'); a.bc('lo', 'cp')
# 4) conta as cores nas fileiras 5-13, colunas 0-29
a.mov('r0', 0); a.mov('r1', 0)
a.label('z')
a.movh('r2', 13); a.add_r('r2', 'r2', 'r1'); a.str_i('r0', 'r2', 0); a.addi('r1', 4); a.cmpi('r1', 0x20); a.bc('lo', 'z')
a.ldr_lit('r4', 0x0600D000 + 5 * 64); a.mov('r5', VR.LIN_FIXO)
a.label('c_lin'); a.mov('r6', 0)
a.label('c_col')
a.lsl('r0', 'r6', 1); a.ldrh_r('r0', 'r4', 'r0'); a.lsl('r0', 'r0', 22); lsr(a, 0, 0, 17)
a.ldr_lit('r1', BUF); a.add_r('r1', 'r1', 'r0'); a.h(0x1C0A); a.addi('r2', 32)
a.label('c_px')
a.ldrb_i('r3', 'r1', 0)
a.mov('r7', 15); a.alu('and_', 'r7', 'r3'); a.lsl('r7', 'r7', 1)
a.movh('r0', 13); a.add_r('r0', 'r0', 'r7'); a.ldrh_i('r7', 'r0', 0); a.addi('r7', 1); a.strh_i('r7', 'r0', 0)
lsr(a, 7, 3, 4); a.lsl('r7', 'r7', 1)
a.movh('r0', 13); a.add_r('r0', 'r0', 'r7'); a.ldrh_i('r7', 'r0', 0); a.addi('r7', 1); a.strh_i('r7', 'r0', 0)
a.addi('r1', 1); a.alu('cmp', 'r1', 'r2'); a.bc('lo', 'c_px')
a.addi('r6', 1); a.cmpi('r6', VR.COLS); a.bc('lo', 'c_col')
a.addi('r4', 64); a.subi('r5', 1); a.bc('ne', 'c_lin')
pool_aqui(a, 'pp2')
# 5) cor média e brilho máximo do chão (cores fora do céu, menos a 0)
a.mov('r0', 0)
for off in (0x88, 0x8C, 0x90, 0x94, 0x98): str_sp(a, 0, off)
a.mov('r6', 0)
a.label('k_laco')
a.cmpi('r6', 0); a.bc('eq', 'k_prox')
ldr_sp(a, 0, 0x80); a.h(0x40C0 | 6 << 3 | 0); a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'k_prox')
a.lsl('r1', 'r6', 1); a.movh('r0', 13); a.add_r('r0', 'r0', 'r1'); a.ldrh_i('r5', 'r0', 0)
a.cmpi('r5', 0); a.bc('eq', 'k_prox')
a.lsl('r1', 'r6', 1); a.ldr_lit('r0', PLTT_BASE + 0x40); a.add_r('r0', 'r0', 'r1'); a.ldrh_i('r4', 'r0', 0)
ldr_sp(a, 0, 0x88); a.add_r('r0', 'r0', 'r5'); str_sp(a, 0, 0x88)
for sh, off in ((0, 0x8C), (5, 0x90), (10, 0x94)):
    if sh: lsr(a, 1, 4, sh)
    else: a.h(0x1C21)                        # add r1, r4, #0
    a.mov('r2', 31); a.alu('and_', 'r1', 'r2'); a.alu('mul', 'r1', 'r5')
    ldr_sp(a, 0, off); a.add_r('r0', 'r0', 'r1'); str_sp(a, 0, off)
a.mov('r1', 31); a.alu('and_', 'r1', 'r4')
lsr(a, 2, 4, 5); a.mov('r3', 31); a.alu('and_', 'r2', 'r3'); a.add_r('r1', 'r1', 'r2')
lsr(a, 2, 4, 10); a.alu('and_', 'r2', 'r3'); a.add_r('r1', 'r1', 'r2')
ldr_sp(a, 0, 0x98); a.alu('cmp', 'r1', 'r0'); a.bc('ls', 'k_prox'); str_sp(a, 1, 0x98)
a.label('k_prox'); a.addi('r6', 1); a.cmpi('r6', 16); a.bc('lo', 'k_laco')
# 6) cor do chão (hue2) em 0x8C e multiplicador m2 em 0x90
ldr_sp(a, 0, 0x88); a.cmpi('r0', 0); a.bc('ne', 'tem2')
a.ldr_lit('r0', ESC); str_sp(a, 0, 0x8C); a.mov('r0', L1); str_sp(a, 0, 0x98); a.b('hue_ok')
a.label('tem2')
a.mov('r4', 0)
for sh, off in ((0, 0x8C), (5, 0x90), (10, 0x94)):
    ldr_sp(a, 0, off); ldr_sp(a, 1, 0x88); swi_div(a)
    if sh: a.lsl('r0', 'r0', sh)
    a.alu('orr', 'r4', 'r0')
str_sp(a, 4, 0x8C)
a.label('hue_ok')
ldr_sp(a, 1, 0x98); a.cmpi('r1', 0); a.bc('ne', 'lm_ok'); a.mov('r1', 1); str_sp(a, 1, 0x98)
a.label('lm_ok')
a.ldr_lit('r0', 9 * 16384); swi_div(a); str_sp(a, 0, 0x90)
pool_aqui(a, 'pp3')
# 7) paletas: 11 = [0, 5 tons do escuro, 10 tons do chão]; 7 = nuvens
a.ldr_lit('r0', D_PFIXO1); a.ldr_lit('r1', PAL_FIXO); a.mov('r2', 0)
a.label('p1')
a.ldrh_r('r3', 'r0', 'r2'); a.strh_r('r3', 'r1', 'r2'); a.ldr_lit('r4', 0x400); a.add_r('r4', 'r4', 'r1'); a.strh_r('r3', 'r4', 'r2')
a.addi('r2', 2); a.cmpi('r2', 12); a.bc('lo', 'p1')
a.ldr_lit('r0', PAL_FIXO + 12); ldr_sp(a, 1, 0x8C); ldr_sp(a, 2, 0x98); a.mov('r3', VR.N_CHAO); a.bl('rampa')
a.ldr_lit('r0', D_PNUV); a.mov('r1', VR.PAL_NUVEM * 16); a.mov('r2', 0x20); a.ldr_lit('r3', LOADPAL | 1); a.bl('c3')
# 7b) o desenho leva vários quadros e a tela está à mostra: antes de mexer nos blocos, o mapa inteiro (fileiras
#     0-13, as 2 telas) aponta para o bloco 511 todo na cor 2 da paleta 11 (escuro); o mapa certo entra no fim
a.ldr_lit('r0', 0x0600D000); a.ldr_lit('r1', MAPA_COPIA); a.mov('r2', 0)          # guarda o mapa (fileiras 0-13)
a.label('cb_cop'); a.ldrh_r('r3', 'r0', 'r2'); a.strh_r('r3', 'r1', 'r2'); a.addi('r2', 2); a.ldr_lit('r3', 14 * 64); a.alu('cmp', 'r2', 'r3'); a.bc('lo', 'cb_cop')
a.ldr_lit('r0', 0x06008000 + 511 * 32); a.ldr_lit('r1', 0x22222222); a.mov('r2', 0)
a.label('cb_blo'); a.h(0x5000 | 2 << 6 | 0 << 3 | 1); a.addi('r2', 4); a.cmpi('r2', 32); a.bc('lo', 'cb_blo')   # str r1, [r0, r2]
a.ldr_lit('r0', 0x0600D000); a.ldr_lit('r1', VR.PAL_FIXO << 12 | 511); a.mov('r2', 0)
a.label('cb_map'); a.lsl('r3', 'r2', 1); a.strh_r('r1', 'r0', 'r3')
a.addi('r2', 1)
a.ldr_lit('r3', 14 * 32); a.alu('cmp', 'r2', 'r3'); a.bc('lo', 'cb_map')
a.ldr_lit('r0', 0x0600D800); a.mov('r2', 0)
a.label('cb_map2'); a.lsl('r3', 'r2', 1); a.strh_r('r1', 'r0', 'r3')
a.addi('r2', 1); a.ldr_lit('r3', 14 * 32); a.alu('cmp', 'r2', 'r3'); a.bc('lo', 'cb_map2')
# 8) por cor da paleta 2: LMM = lum * m, BASE, MAX
a.mov('r6', 0)
a.label('l_laco')
a.lsl('r1', 'r6', 1); a.ldr_lit('r0', PLTT_BASE + 0x40); a.add_r('r0', 'r0', 'r1'); a.ldrh_i('r4', 'r0', 0)
a.mov('r1', 31); a.alu('and_', 'r1', 'r4')
lsr(a, 2, 4, 5); a.mov('r3', 31); a.alu('and_', 'r2', 'r3'); a.add_r('r1', 'r1', 'r2')
lsr(a, 2, 4, 10); a.alu('and_', 'r2', 'r3'); a.add_r('r1', 'r1', 'r2')          # r1 = lum
a.cmpi('r6', 0); a.bc('eq', 'l_esc')
ldr_sp(a, 0, 0x80); a.h(0x40C0 | 6 << 3 | 0); a.mov('r2', 1); a.alu('tst', 'r0', 'r2'); a.bc('ne', 'l_esc')
ldr_sp(a, 0, 0x90); a.mov('r2', 1 + VR.N_ESC); a.mov('r3', VR.N_CHAO - 1); a.b('l_grava')
a.label('l_esc')
a.ldr_lit('r0', M1); a.mov('r2', 1); a.mov('r3', VR.N_ESC - 1)
a.label('l_grava')
a.alu('mul', 'r1', 'r0')
add_sp(a, 0, 0x20); a.lsl('r4', 'r6', 2); a.h(0x5000 | 4 << 6 | 0 << 3 | 1)       # str r1, [r0, r4]
add_sp(a, 0, 0x60); a.h(0x5400 | 6 << 6 | 0 << 3 | 2)                            # strb r2, [r0, r6]
add_sp(a, 0, 0x70); a.h(0x5400 | 6 << 6 | 0 << 3 | 3)                            # strb r3, [r0, r6]
a.addi('r6', 1); a.cmpi('r6', 16); a.bc('lo', 'l_laco')
pool_aqui(a, 'pp4')
# 8b) tabela de saída do fundo fixo: OUTS[(nível * 16 + pontilhado) * 16 + cor]
a.ldr_lit('r4', OUTS); a.mov('r5', 0)
a.label('o_lin')
lsr(a, 0, 5, 4); a.ldr_lit('r1', D_KQV); a.h(0x5C0F)                             # r7 = KQV[nível]
a.mov('r6', 0)
a.label('o_cor')
add_sp(a, 0, 0x20); a.lsl('r1', 'r6', 2); a.h(0x5840); a.alu('mul', 'r0', 'r7'); lsr(a, 0, 0, 16)
a.mov('r1', 15); a.alu('and_', 'r1', 'r5'); a.add_r('r0', 'r0', 'r1'); lsr(a, 0, 0, 4)
add_sp(a, 1, 0x70); a.h(0x5D89); a.alu('cmp', 'r0', 'r1'); a.bc('ls', 'o_ok'); a.h(0x1C08)
a.label('o_ok'); add_sp(a, 1, 0x60); a.h(0x5D89); a.add_r('r0', 'r0', 'r1')
a.strb_i('r0', 'r4', 0); a.addi('r4', 1)
a.addi('r6', 1); a.cmpi('r6', 16); a.bc('lo', 'o_cor')
a.addi('r5', 1); lsr(a, 0, 5, 8); a.bc('eq', 'o_lin')
pool_aqui(a, 'pp5')
# 9) fundo fixo: fileiras 5-13, colunas 0-29 -> blocos 0..269 (0x88 fileira, 0x8C coluna, 0x94 entrada,
#    0x98 destino, 0x9C yy)
a.mov('r0', VR.LIN_NUVEM); str_sp(a, 0, 0x88)
a.ldr_lit('r0', 0x06008000); str_sp(a, 0, 0x98)
a.label('t_lin')
a.mov('r0', 0); str_sp(a, 0, 0x8C)
a.label('t_col')
ldr_sp(a, 0, 0x88); a.lsl('r0', 'r0', 5); ldr_sp(a, 1, 0x8C); a.add_r('r0', 'r0', 'r1'); a.lsl('r0', 'r0', 1)
a.ldr_lit('r1', MAPA_COPIA); a.ldrh_r('r0', 'r1', 'r0'); str_sp(a, 0, 0x94)   # mapa original (o da tela já está coberto)
a.mov('r0', 0); str_sp(a, 0, 0x9C)
a.label('t_y')
ldr_sp(a, 0, 0x88); a.lsl('r0', 'r0', 3); ldr_sp(a, 1, 0x9C); a.add_r('r2', 'r0', 'r1')            # r2 = y
a.mov('r0', 3); a.alu('and_', 'r0', 'r2'); a.lsl('r0', 'r0', 2); a.ldr_lit('r7', D_B4); a.add_r('r7', 'r7', 'r0')
a.cmpi('r2', 56); a.bc('lo', 'ym_ok'); a.mov('r0', 111); a.h(0x1A80); a.b('ym_x')
a.label('ym_ok'); a.h(0x1C10)
a.label('ym_x'); a.mov('r1', 120); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r6', D_Q4); a.add_r('r6', 'r6', 'r0')
ldr_sp(a, 0, 0x8C); a.mov('r5', 0); a.cmpi('r0', 15); a.bc('lo', 't_esq')
a.lsl('r0', 'r0', 3); a.mov('r1', 232); a.h(0x1A08); a.add_r('r6', 'r6', 'r0'); a.mov('r5', 1); a.b('t_w')   # r0 = 232 - c*8
a.label('t_esq'); a.lsl('r0', 'r0', 3); a.add_r('r6', 'r6', 'r0')
a.label('t_w')
ldr_sp(a, 0, 0x94); lsr(a, 1, 0, 11); a.mov('r2', 1); a.alu('and_', 'r1', 'r2')                # vf
ldr_sp(a, 2, 0x9C); a.cmpi('r1', 0); a.bc('eq', 'sy_ok'); a.mov('r1', 7); a.h(0x1A89); a.h(0x1C0A)
a.label('sy_ok')
a.lsl('r2', 'r2', 2); a.lsl('r0', 'r0', 22); lsr(a, 0, 0, 17); a.add_r('r0', 'r0', 'r2')
a.ldr_lit('r1', BUF); a.h(0x5800 | 0 << 6 | 1 << 3 | 3)                                         # r3 = 8 cores
ldr_sp(a, 0, 0x94); lsr(a, 0, 0, 10); a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('eq', 't_nf')
a.mov('r0', 0)                                                                                  # espelho: inverte a ordem
for _ in range(8):
    a.lsl('r0', 'r0', 4); a.lsl('r1', 'r3', 28); lsr(a, 1, 1, 28); a.alu('orr', 'r0', 'r1'); lsr(a, 3, 3, 4)
a.h(0x1C03)                                                                                     # r3 = r0
a.label('t_nf')
# blocos da paleta 3 (chão do Pokémon do jogador em vários terrenos): as cores usadas são iguais às da paleta 2 no
# mesmo índice, então o desenho nem olha a paleta
a.ldr_lit('r2', OUTS)
a.cmpi('r5', 0); a.bc('ne', 't_dec')
oito_px(a, False); a.b('t_grava')
a.label('t_dec')
oito_px(a, True)
a.label('t_grava')
ldr_sp(a, 0, 0x98); ldr_sp(a, 1, 0x9C); a.lsl('r1', 'r1', 2); a.h(0x5000 | 1 << 6 | 0 << 3 | 4)     # str r4, [r0, r1]
ldr_sp(a, 0, 0x9C); a.addi('r0', 1); str_sp(a, 0, 0x9C); a.cmpi('r0', 8); a.bfar('lo', 't_y')
ldr_sp(a, 0, 0x98); a.addi('r0', 32); str_sp(a, 0, 0x98)
ldr_sp(a, 0, 0x8C); a.addi('r0', 1); str_sp(a, 0, 0x8C); a.cmpi('r0', VR.COLS); a.bfar('lo', 't_col')
ldr_sp(a, 0, 0x88); a.addi('r0', 1); str_sp(a, 0, 0x88); a.cmpi('r0', VR.LIN_NUVEM + VR.LIN_FIXO); a.bfar('lo', 't_lin')
pool_aqui(a, 'pp6')
# 11) nuvens: as 5 fileiras
a.mov('r4', 0)
a.label('nv')
a.h(0x1C20); ldr_sp(a, 1, 0xA4); a.mov('r2', 0); a.mov('r3', VR.COLS); a.bl('nuvem_linha')
a.addi('r4', 1); a.cmpi('r4', VR.LIN_NUVEM); a.bc('lo', 'nv')
# 10) mapa: fileiras 0-4 nuvens (paleta 7), 5-13 fundo fixo (paleta 11); colunas 30-31 repetem a 0; as 2 telas
a.ldr_lit('r4', 0x0600D000); a.mov('r5', 0)
a.label('mp_lin')
a.cmpi('r5', VR.LIN_NUVEM); a.bc('hs', 'mp_fixo')
a.mov('r7', 30); a.alu('mul', 'r7', 'r5'); a.ldr_lit('r0', VR.PAL_NUVEM << 12 | NUV0); a.add_r('r7', 'r7', 'r0'); a.b('mp_ok')
a.label('mp_fixo')
a.h(0x1C2F); a.subi('r7', VR.LIN_NUVEM); a.mov('r0', 30); a.alu('mul', 'r7', 'r0')                # (r - 5) * 30
a.ldr_lit('r0', VR.PAL_FIXO << 12); a.add_r('r7', 'r7', 'r0')
a.label('mp_ok')
a.mov('r6', 0)
a.label('mp_col')
a.h(0x1C38); a.cmpi('r6', VR.COLS); a.bc('hs', 'mp_w'); a.add_r('r0', 'r0', 'r6')
a.label('mp_w')
a.lsl('r1', 'r5', 6); a.lsl('r2', 'r6', 1); a.add_r('r1', 'r1', 'r2'); a.h(0x5200 | 1 << 6 | 4 << 3 | 0)   # strh r0, [r4, r1]
a.ldr_lit('r2', 0x800); a.add_r('r1', 'r1', 'r2'); a.h(0x5200 | 1 << 6 | 4 << 3 | 0)
a.addi('r6', 1); a.cmpi('r6', 32); a.bc('lo', 'mp_col')
a.addi('r5', 1); a.cmpi('r5', VR.LIN_NUVEM + VR.LIN_FIXO); a.bc('lo', 'mp_lin')
a.h(0xB000 | 0xA0 >> 2)                      # add sp, #0xA0
a.pop(['r1']); a.movh(11, 'r1')
a.pop(['r0', 'r1', 'r2', 'r3']); a.movh(8, 'r1'); a.movh(9, 'r2'); a.movh(10, 'r3')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()

# ---------------- nuvem_linha(r0 = fileira 0..4, r1 = deslocamento): blocos 270 + fileira*30 ..
# pilha: 0 destino do bloco, 4 coluna, 8 yy, 12 fileira; r8 = linha do brilho, r9 = pontilhado, r11 = deslocamento
a.label('nuvem_linha')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r2', 11); a.push(['r2'])
a.h(0xB080 | 16 >> 2)
a.movh(11, 'r1'); str_sp(a, 0, 12)
a.movh('r1', 10); a.push(['r1']); a.movh(10, 'r3')                  # r10 = coluna final
str_sp(a, 2, 8)                                                  # (a pilha andou 4) coluna inicial
a.mov('r1', 30); a.alu('mul', 'r1', 'r0'); a.add_r('r1', 'r1', 'r2'); a.ldr_lit('r2', NUV0); a.add_r('r1', 'r1', 'r2'); a.lsl('r1', 'r1', 5)
a.ldr_lit('r2', 0x06008000); a.add_r('r1', 'r1', 'r2'); str_sp(a, 1, 4)
a.label('nl_col')
a.mov('r0', 0); str_sp(a, 0, 12)
a.label('nl_y')
ldr_sp(a, 0, 16); a.lsl('r0', 'r0', 3); ldr_sp(a, 1, 12); a.add_r('r2', 'r0', 'r1')               # y (< 56)
a.mov('r0', 240); a.alu('mul', 'r0', 'r2'); a.ldr_lit('r6', D_PNV); a.add_r('r6', 'r6', 'r0')
ldr_sp(a, 0, 8); a.lsl('r0', 'r0', 3); a.add_r('r6', 'r6', 'r0')                               # + coluna*8
a.label('nl_w')                              # 8 cores da faixa a partir de (coluna*8 + deslocamento) & 255
ldr_sp(a, 1, 8); a.lsl('r1', 'r1', 3); a.movh('r0', 11); a.add_r('r1', 'r1', 'r0'); a.mov('r0', 0xFF); a.alu('and_', 'r1', 'r0')
a.lsl('r0', 'r2', 7); a.ldr_lit('r3', D_NUVEM); a.add_r('r3', 'r3', 'r0')
lsr(a, 0, 1, 3); a.lsl('r0', 'r0', 2); a.h(0x5800 | 0 << 6 | 3 << 3 | 4)                        # r4 = palavra k
a.addi('r0', 4); a.lsl('r0', 'r0', 25); lsr(a, 0, 0, 25); a.h(0x5818)                          # r0 = palavra k+1
a.lsl('r1', 'r1', 29); lsr(a, 1, 1, 27)                                                         # r1 = s
a.h(0x40CC); a.mov('r2', 32); a.h(0x1A52); a.h(0x4090); a.alu('orr', 'r4', 'r0'); a.h(0x1C23)   # r3 = cores
a.ldr_lit('r2', D_OUTN)
oito_px_p(a)
a.label('nl_grava')
ldr_sp(a, 0, 4); ldr_sp(a, 1, 12); a.lsl('r1', 'r1', 2); a.h(0x5000 | 1 << 6 | 0 << 3 | 4)
ldr_sp(a, 0, 12); a.addi('r0', 1); str_sp(a, 0, 12); a.cmpi('r0', 8); a.bfar('lo', 'nl_y')
ldr_sp(a, 0, 4); a.addi('r0', 32); str_sp(a, 0, 4)
ldr_sp(a, 0, 8); a.addi('r0', 1); str_sp(a, 0, 8); a.movh('r1', 10); a.alu('cmp', 'r0', 'r1'); a.bfar('lo', 'nl_col')
a.pop(['r1']); a.movh(10, 'r1')
a.h(0xB000 | 16 >> 2)
a.pop(['r2']); a.movh(11, 'r2')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()

# ---------------- rampa(r0 = destino nas cores base, r1 = cor, r2 = brilho máximo, r3 = tons)
# grava também nas cores exibidas (+0x400). r8 = lum da cor, r9 = divisor, r10 = metade, r11 = j; pilha: 0 cor acumulada
a.label('rampa')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r4', 8); a.movh('r5', 9); a.movh('r6', 10); a.movh('r7', 11); a.push(['r4', 'r5', 'r6', 'r7'])
a.h(0xB080 | 8 >> 2)
a.h(0x1C04); a.h(0x1C0D); a.h(0x1C16); a.h(0x1C1F)               # r4 = destino, r5 = cor, r6 = brilho, r7 = tons
a.mov('r0', 31); a.alu('and_', 'r0', 'r5')
lsr(a, 1, 5, 5); a.mov('r2', 31); a.alu('and_', 'r1', 'r2'); a.add_r('r0', 'r0', 'r1')
lsr(a, 1, 5, 10); a.alu('and_', 'r1', 'r2'); a.add_r('r0', 'r0', 'r1'); a.movh(8, 'r0')          # lh
a.h(0x1C39); a.subi('r1', 1); a.alu('mul', 'r0', 'r1')                                            # lh * (n - 1)
a.cmpi('r0', 0); a.bc('ne', 'rp_d'); a.mov('r0', 1)
a.label('rp_d'); a.movh(9, 'r0'); lsr(a, 0, 0, 1); a.movh(10, 'r0')
a.mov('r0', 0); a.movh(11, 'r0')
a.label('rp_j')
a.mov('r0', 0); str_sp(a, 0, 0)
for sh in (0, 5, 10):
    if sh: lsr(a, 0, 5, sh)
    else: a.h(0x1C28)
    a.mov('r1', 31); a.alu('and_', 'r0', 'r1'); a.alu('mul', 'r0', 'r6'); a.movh('r1', 11); a.alu('mul', 'r0', 'r1')
    a.movh('r1', 10); a.add_r('r0', 'r0', 'r1'); a.movh('r1', 9); swi_div(a)
    a.cmpi('r0', 31); a.bc('ls', 'rp_ok%d' % sh); a.mov('r0', 31)
    a.label('rp_ok%d' % sh)
    if sh: a.lsl('r0', 'r0', sh)
    ldr_sp(a, 1, 0); a.alu('orr', 'r1', 'r0'); str_sp(a, 1, 0)
ldr_sp(a, 0, 0); a.movh('r1', 11); a.lsl('r1', 'r1', 1); a.h(0x5200 | 1 << 6 | 4 << 3 | 0)
a.ldr_lit('r2', 0x400); a.add_r('r2', 'r2', 'r4'); a.h(0x5200 | 1 << 6 | 2 << 3 | 0)
a.movh('r0', 11); a.addi('r0', 1); a.movh(11, 'r0'); a.alu('cmp', 'r0', 'r7'); a.bfar('lo', 'rp_j')
a.h(0xB000 | 8 >> 2)
a.pop(['r4', 'r5', 'r6', 'r7']); a.movh(8, 'r4'); a.movh(9, 'r5'); a.movh(10, 'r6'); a.movh(11, 'r7')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()
code = a.build(); assert D_CODE + len(code) <= D_Q4, hex(len(code))
put(D_CODE, code)
A_TAREFA, A_APLICA = a.labels['tarefa'], a.labels['aplica']

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
b.bl(a.labels['marca']); b.cmpi('r0', 0); b.bc('ne', 'ja')     # já aplicado: não refaz
b.mov('r0', 0); b.bl(A_APLICA)
b.label('ja')
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
c.ldrh_i('r0', 'r1', 8); c.bl(A_APLICA)
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
def treme(alvo): return bytes.fromhex('03e15418080503') + h16(alvo) + h16(5) + h16(50)        # tremor pela metade do Earthquake
put(D_ANIM, b'\x03' + p32(D_START | 1) + b'\x05\x00' + treme(5) + treme(4) + bytes.fromhex('19ea0000') + b'\x05\x08')
# script de batalha: balão da habilidade, animação 61, fecha o balão
put(D_SCRIPT, bytes([0xFF]) + p32(D_FASE | 1) + bytes.fromhex('760136394000') + bytes([0x45, 0x01, N_GERAL + 1]) + p32(0x02023500)
    + bytes.fromhex('0a') + bytes([0x10]) + struct.pack('<H', 745) + bytes.fromhex('124000')   # "Uma presença sombria..."
    + bytes.fromhex('760f623920003f'))
put(D_CASE, caso(D_CASE, D_SCRIPT))
put(D_TXT, enc('Distúrbio')); put(D_TXT + 0x20, enc('Escurece o céu ao entrar.'))
put(D_TXT + 0x60, enc('Ao entrar, a terra treme e o\ncéu fica coberto de nuvens\nescuras enquanto estiver lá.'))
assert ROM[0x54CF30:0x54CF36] == bytes.fromhex('2e0000007700')
put(0x0854CF30, struct.pack('<3H', NOVA2, NOVA2, NOVA2))      # Dusknoir: Distúrbio nas 3 vagas

# --- Distúrbio, fim de cada rodada: o Dusknoir rouba 1/8 da vida de cada inimigo em campo (aliados não), com a
# animação de absorção do Dream Eater, e recupera metade da própria vida máxima por rodada. Mensagem nova ao entrar.
D_TABTXT, D_MSG = 0x09FEB200, 0x09FEEB00     # tabela de textos da batalha (+1) e o texto novo
DISABLE_LIT, POS_LIT = 0x08052C74, 0x0808529C        # literais com gDisableStructs e gBattlerPositions (o Coop 3 mudou)
SIDE_STATUS, SIDE_TIMERS = 0x02023280, 0x02023288    # Safeguard = 0x20; timer +6 e dono +7 (0x20 bytes por lado)
OLD_TABTXT, N_TXT, ID_MSG, ID_DRENADA = 0x09253FF0, 733, 745, 45
D_MSG2, ID_DISSIPOU, ID_SALVAGUARDA = 0x09FEEB30, 746, 80   # "O Distúrbio dissipou a ameaça!" no lugar da Salvaguarda
D_DISSIPA, D_DISSIPA_S = 0x09FEEEE0, 0x09FEEF20              # escolhe a fala + as 3 cópias do script da fala
MAGIC_GUARD = 98

# texto: "Uma presença sombria cobre / o campo de batalha!"
_msg = bytearray()
for ch in 'Uma presença sombria cobre\no campo de batalha!':
    if 'A' <= ch <= 'Z': _msg.append(0xBB + ord(ch) - 65)
    elif 'a' <= ch <= 'z': _msg.append(0xD5 + ord(ch) - 97)
    else: _msg.append({' ': 0x00, '\n': 0xFE, '!': 0xAB, 'ç': 0x19}[ch])
put(D_MSG, bytes(_msg) + b'\xff')
put(D_MSG2, enc('O Distúrbio dissipou a ameaça!'))
_tab = [w32(OLD_TABTXT + 4 * i) for i in range(N_TXT)] + [D_MSG, D_MSG2]
put(D_TABTXT, b''.join(p32(x) for x in _tab))
_v = p32(OLD_TABTXT); _i = ROM.find(_v); _n = 0
while _i != -1:
    assert _i % 4 == 0 and _i < 0x400000
    put(0x08000000 + _i, p32(D_TABTXT)); _n += 1
    _i = ROM.find(_v, _i + 1)
assert _n == 24, _n
assert ROM[0x1D5BCC:0x1D5BD0] == bytes.fromhex('ba208000')
put(0x081D5BCC, bytes.fromhex('bb20'))         # limite do número do texto: 744 -> 748

# animação geral 62: a tarefa do dreno do Leech Seed (quem recebe/quem perde vêm do argumento) + a do Dream Eater
# o script do Dream Eater copiado sem trocar o fundo (o "call SetPsychicBackground" e o "call UnsetPsychicBg" chamam
# um "return"; nop trava a animação), para a absorção acontecer em cima do céu do Distúrbio
_de = w32(0x0846AB1C + 4 * 138) - 0x08000000
_de = bytearray(ROM[_de:_de + 0x6A])
assert _de[0x0E:0x13] == b'\x0e' + p32(0x0849DAC3) and _de[0x64:0x69] == b'\x0e' + p32(0x0849DACF) and _de[0x69] == 0x08
_ret = D_ANIM2 + 7 + 7 + len(_de)            # "return" logo depois do script: as duas chamadas não fazem nada
_de[0x0E:0x13] = b'\x0e' + p32(_ret); _de[0x64:0x69] = b'\x0e' + p32(_ret)
# as bolinhas (tag 0x27A3) usam as cores 1-7, laranja/amarelo; no Dream Eater elas parecem rosadas por estarem meio
# transparentes em cima do fundo roxo. Sem o fundo, uma tarefa troca essas cores por rosa logo depois de carregar.
TAG_BOLINHA = 0x27A3
_pb = w32(0x09128CD8)                        # paleta das bolinhas (tabela de paletas de animação, tag 0x27A3)
assert struct.unpack_from('<H', ROM, 0x09128CDC - 0x08000000)[0] == TAG_BOLINHA
_pb = bytearray(lz77(ROM, _pb - 0x08000000)[0][:32])
for _k, _c in enumerate([(31, 9, 13), (31, 11, 16), (31, 14, 18), (31, 17, 21), (31, 20, 24), (31, 23, 27), (31, 26, 29)]):
    struct.pack_into('<H', _pb, 2 * (_k + 1), _c[0] | _c[1] << 5 | _c[2] << 10)
put(D_ROSA_PAL, bytes(_pb))
a = Asm(D_ROSA)
a.push(['r4'], lr=True)
a.h(0x1C04)                                  # r4 = taskId
a.ldr_lit('r1', 0x03000CF0); a.mov('r2', 0); a.ldr_lit('r0', TAG_BOLINHA)
a.label('laco'); a.ldr_i('r3', 'r1', 0); a.alu('cmp', 'r3', 'r0'); a.bc('eq', 'achou')
a.addi('r1', 4); a.addi('r2', 1); a.cmpi('r2', 16); a.bc('lo', 'laco'); a.b('fim')
a.label('achou')
a.lsl('r1', 'r2', 4); a.addi('r1', 0x80); a.addi('r1', 0x80)                 # 0x100 + vaga*16
a.ldr_lit('r0', D_ROSA_PAL); a.mov('r2', 0x20); a.ldr_lit('r3', LOADPAL | 1); a.bl('c3')
a.label('fim')
a.h(0x1C20); a.ldr_lit('r3', 0x080F43A9); a.bl('c3')                         # DestroyAnimVisualTask
a.pop(['r4']); a.pop(['r0']); a.bx('r0')
a.label('c3'); a.bx('r3')
a.pool()
put(D_ROSA, a.build())
_de[6:6] = b'\x03' + p32(D_ROSA | 1) + b'\x05\x00'     # depois dos 2 loadspritegfx
assert len(_de) + 7 + 1 <= 0x80
put(D_ANIM2, bytes.fromhex('03817c1f080500') + bytes(_de) + b'\x0f')

# 1/8 da vida máxima do alvo em gBattleMoveDamage (mínimo 1); callnative: avança 5 bytes
a = Asm(D_DANO)
a.ldr_lit('r0', 0x02023205); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 0x60); a.alu('mul', 'r0', 'r1')
a.ldr_lit('r1', 0x0806DBC8); a.ldr_i('r1', 'r1', 0); a.add_r('r0', 'r0', 'r1'); a.ldrh_i('r0', 'r0', 0x2E)
lsr(a, 0, 0, 3); a.cmpi('r0', 0); a.bc('ne', 'ok'); a.mov('r0', 1)
a.label('ok'); a.ldr_lit('r1', 0x020231E8); a.str_i('r0', 'r1', 0)
a.ldr_lit('r1', 0x0202320C); a.ldr_i('r0', 'r1', 0); a.addi('r0', 5); a.str_i('r0', 'r1', 0)
a.bx('lr')
a.pool()
put(D_DANO, a.build())

# cura do Dusknoir: 9/16 da vida máxima dele na fase 3, dividida entre os inimigos vivos (o alvo atual conta)
a = Asm(D_CURA)
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r0', 0x02023204); a.ldrb_i('r4', 'r0', 0)
a.ldr_lit('r0', 0x0806DBC8); a.ldr_i('r5', 'r0', 0)
a.ldr_lit('r0', 0x02023044); a.ldrb_i('r3', 'r0', 0)
a.mov('r6', 0); a.mov('r7', 0)
a.label('laco')
a.h(0x1C38); a.alu('eor', 'r0', 'r4'); a.mov('r1', 1); a.alu('and_', 'r0', 'r1'); a.bc('eq', 'prox')
a.ldr_lit('r1', 0x02023205); a.ldrb_i('r1', 'r1', 0); a.alu('cmp', 'r1', 'r7'); a.bc('eq', 'conta')
a.mov('r0', 0x60); a.alu('mul', 'r0', 'r7'); a.add_r('r0', 'r0', 'r5'); a.ldrh_i('r0', 'r0', 0x2A)
a.cmpi('r0', 0); a.bc('eq', 'prox')
a.label('conta'); a.addi('r6', 1)
a.label('prox'); a.addi('r7', 1); a.alu('cmp', 'r7', 'r3'); a.bc('lo', 'laco')
a.cmpi('r6', 0); a.bc('ne', 'tem'); a.mov('r6', 1)
a.label('tem')
a.mov('r0', 0x60); a.alu('mul', 'r0', 'r4'); a.add_r('r0', 'r0', 'r5'); a.ldrh_i('r0', 'r0', 0x2E)
lsr(a, 1, 0, 4); lsr(a, 0, 0, 1); a.add_r('r0', 'r0', 'r1')   # metade + 1/16 (54 PS -> 30)
a.h(0x1C31); a.h(0xDF06)                         # r0 = r0 / r6 (BIOS Div)
a.cmpi('r0', 0); a.bc('ne', 'ok'); a.mov('r0', 1)
a.label('ok'); a.ldr_lit('r1', 0x020231E8); a.str_i('r0', 'r1', 0)
a.ldr_lit('r1', 0x0202320C); a.ldr_i('r0', 'r1', 0); a.addi('r0', 5); a.str_i('r0', 'r1', 0)
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()
put(D_CURA, a.build())

# script do fim de rodada
s = bytearray(); lab = {}; fix = []
def jmp(name): fix.append((len(s), name)); s.extend(b'\0\0\0\0')
s += bytes.fromhex('760136392000')             # balão da habilidade
s += bytes.fromhex('2e0532020200')             # alvo = 0
lab['laco'] = len(s)
s += bytes.fromhex('760137'); jmp('prox')       # aliado
s += bytes.fromhex('760061'); jmp('prox')       # ausente
s += bytes.fromhex('ff3998080800'); jmp('prox') # desmaiado
s += bytes([0x1E, 0x00, MAGIC_GUARD, 0x00]); jmp('prox')
s += bytes.fromhex('31003502020432020201')     # sB_ANIM_ARG1 = Dusknoir (recebe)
s += bytes.fromhex('31013502020532020201')     # sB_ANIM_ARG2 = inimigo (perde)
s += bytes([0x45, 0x01, N_GERAL + 2]) + p32(0x02023500) + b'\x0a'   # animação 62 e espera
s += b'\xff' + p32(D_DANO | 1)                 # dano = 1/8 da vida máxima do inimigo
s += bytes.fromhex('357432020200011000') + bytes.fromhex('0b000c00')
s += bytes([0x10]) + struct.pack('<H', ID_DRENADA) + bytes.fromhex('124000')
s += bytes([0xFF]) + p32(D_CURA | 1)                # cura = metade da vida do Dusknoir / inimigos vivos
s += bytes.fromhex('8007')                     # vira cura (com a Big Root)
s += bytes.fromhex('357432020200011000') + bytes.fromhex('0b010c01')
s += bytes.fromhex('19000000000000')           # tryfaintmon inimigo
lab['prox'] = len(s)
s += bytes.fromhex('2f0532020201')
s += bytes.fromhex('2d053202024430020201'); jmp('laco')
s += bytes.fromhex('760f62390f003f')           # fecha o balão, pausa, end3
for at, name in fix: s[at:at + 4] = p32(D_DRENO + lab[name])
put(D_DRENO, s)

# desvio no começo das comparações do fim de rodada (0x08053E52): 320 -> script do dreno
assert ROM[0x53E52:0x53E5C] == bytes.fromhex('0d480188832900d19de2')
a = Asm(D_TRAMP)
a.ldr_lit('r0', 0x02023202); a.ldrh_i('r1', 'r0', 0)
a.ldr_lit('r3', NOVA2); a.alu('cmp', 'r1', 'r3'); a.bc('eq', 'dreno')   # r2 (batalhador) fica intacto
a.cmpi('r1', 0x83); a.bc('ne', 'segue')
a.ldr_lit('r3', 0x08054398); a.h(0x469F)          # mov pc, r3 (caso 0x83, como antes)
a.label('segue'); a.ldr_lit('r3', 0x08053E5C); a.h(0x469F)
a.label('dreno')                                  # fase: contador da Slow Start (o jogo zera ao entrar e tira 1 por rodada)
a.ldr_lit('r0', DISABLE_LIT); a.ldr_i('r0', 'r0', 0); a.mov('r1', 0x2C); a.alu('mul', 'r1', 'r2'); a.add_r('r0', 'r0', 'r1')
a.ldrb_i('r1', 'r0', 0x1F); a.cmpi('r1', 0); a.bc('eq', 'fase3')
a.ldr_lit('r3', 0x08058604); a.h(0x469F)          # fases 1 e 2: nada (por enquanto)
a.label('fase3'); a.mov('r1', 3); a.strb_i('r1', 'r0', 0x1F)   # o jogo já tira 1 nesta rodada: 2, 1, 0 de novo
a.ldr_lit('r0', D_DRENO); a.ldr_lit('r3', PUSH_SCRIPT); a.bl('c3')
a.ldr_lit('r3', 0x08057E16); a.h(0x469F)          # efeito++ e fim do switch
a.label('c3'); a.bx('r3')
a.pool()
put(D_TRAMP, a.build())
put(0x08053E52, struct.pack('<HHHI', 0x4801, 0x4700, 0x46C0, D_TRAMP | 1))

# status barrado pelo Distúrbio: fala própria. A proteção dele é a Salvaguarda com timer 200 (o golpe de verdade fica
# em 5 ou menos); a Salvaguarda do golpe continua com a fala normal. callnative: +5 = fala normal, +13 = fala nova
a = Asm(D_DISSIPA)
a.ldr_lit('r0', 0x02023205); a.ldrb_i('r0', 'r0', 0)                    # gBattlerTarget
a.ldr_lit('r1', POS_LIT); a.ldr_i('r1', 'r1', 0); a.ldrb_r('r0', 'r1', 'r0')
a.mov('r1', 1); a.alu('and_', 'r0', 'r1'); a.lsl('r0', 'r0', 5)          # lado * 0x20
a.ldr_lit('r1', SIDE_TIMERS); a.add_r('r0', 'r0', 'r1'); a.ldrb_i('r0', 'r0', 6)
a.mov('r2', 5); a.cmpi('r0', 190); a.bc('lo', 'ok'); a.mov('r2', 13)
a.label('ok'); a.ldr_lit('r1', 0x0202320C); a.ldr_i('r0', 'r1', 0); a.add_r('r0', 'r0', 'r2'); a.str_i('r0', 'r1', 0)
a.bx('lr')
a.pool()
put(D_DISSIPA, a.build())

# os 3 lugares que mostram a fala 80 (pause, printstring, waitmessage + o que vem depois): viram um goto para a cópia
_at = D_DISSIPA_S
for _site, _fim in ((0x084AF6C2, bytes.fromhex('2896f64a08')), (0x084B0145, b'\x3e'), (0x084B3A37, bytes.fromhex('28533a4b08'))):
    _o = _site - 0x08000000
    assert ROM[_o:_o + 9] + ROM[_o + 9:_o + 9 + len(_fim)] == bytes.fromhex('392000105000124000') + _fim
    _fala = _at + 3 + 5 + 3 + 5 + 3
    _s = bytes.fromhex('392000') + b'\xff' + p32(D_DISSIPA | 1)
    _s += bytes([0x10]) + struct.pack('<H', ID_SALVAGUARDA) + b'\x28' + p32(_fala)
    _s += bytes([0x10]) + struct.pack('<H', ID_DISSIPOU)
    assert len(_s) == 19
    _s += bytes.fromhex('124000') + _fim
    put(_at, _s); put(_site, b'\x28' + p32(_at)); _at += (len(_s) + 3) & ~3
assert _at <= 0x09FEF000

# entrada: começa a contagem das 3 fases (callnative, gBattlerAttacker = Dusknoir)
a = Asm(D_FASE)
a.ldr_lit('r0', 0x02023204); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 0x2C); a.alu('mul', 'r0', 'r1')
a.ldr_lit('r1', DISABLE_LIT); a.ldr_i('r1', 'r1', 0); a.add_r('r0', 'r0', 'r1'); a.mov('r1', 2); a.strb_i('r1', 'r0', 0x1F)   # vê 2, 1, 0 (o jogo tira 1 depois)
a.ldr_lit('r1', 0x0202320C); a.ldr_i('r0', 'r1', 0); a.addi('r0', 5); a.str_i('r0', 'r1', 0)
a.bx('lr')
a.pool()
put(D_FASE, a.build())

# guarda (todo quadro, pela tarefa): lado com Dusknoir com Distúrbio e vida = Safeguard ligado (timer 200, nunca acaba);
# sem ele, desliga o Safeguard que foi ligado aqui (timer >= 190)
a = Asm(D_GUARDA)
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r4', 0x0806DBC8); a.ldr_i('r4', 'r4', 0)
a.ldr_lit('r5', POS_LIT); a.ldr_i('r5', 'r5', 0)
a.mov('r6', 0)
a.label('lado')
a.mov('r7', 0); a.mov('r2', 0xFF)
a.label('bat')
a.ldr_lit('r0', 0x02023044); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r7', 'r0'); a.bc('hs', 'bfim')
a.ldrb_r('r0', 'r5', 'r7'); a.mov('r1', 1); a.alu('and_', 'r0', 'r1'); a.alu('cmp', 'r0', 'r6'); a.bc('ne', 'bprox')
a.mov('r0', 0x60); a.alu('mul', 'r0', 'r7'); a.add_r('r0', 'r0', 'r4')
a.ldrh_i('r1', 'r0', 0x20); a.ldr_lit('r3', NOVA2); a.alu('cmp', 'r1', 'r3'); a.bc('ne', 'bprox')
a.ldrh_i('r1', 'r0', 0x2A); a.cmpi('r1', 0); a.bc('eq', 'bprox')
a.h(0x1C3A)                                       # r2 = batalhador
a.label('bprox'); a.addi('r7', 1); a.b('bat')
a.label('bfim')
a.ldr_lit('r0', SIDE_STATUS); a.lsl('r1', 'r6', 2); a.add_r('r0', 'r0', 'r1')
a.ldr_lit('r1', SIDE_TIMERS); a.lsl('r3', 'r6', 5); a.add_r('r1', 'r1', 'r3')
a.ldr_i('r3', 'r0', 0); a.mov('r7', 0x20)
a.cmpi('r2', 0xFF); a.bc('eq', 'sem')
a.alu('orr', 'r3', 'r7'); a.str_i('r3', 'r0', 0)
a.mov('r3', 200); a.strb_i('r3', 'r1', 6); a.strb_i('r2', 'r1', 7); a.b('prox')
a.label('sem')
a.alu('tst', 'r3', 'r7'); a.bc('eq', 'prox')
a.ldrb_i('r2', 'r1', 6); a.cmpi('r2', 190); a.bc('lo', 'prox')
a.alu('bic', 'r3', 'r7'); a.str_i('r3', 'r0', 0); a.mov('r2', 0); a.strb_i('r2', 'r1', 6)
a.label('prox')
a.addi('r6', 1); a.cmpi('r6', 2); a.bc('lo', 'lado')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()
put(D_GUARDA, a.build())

# saída do Distúrbio: o fundo normal volta com 5/16 do brilho e clareia até o normal em SAI_QUADROS quadros
# (dados da tarefa: +8 quadro). Paletas 2 e 3 do terreno (a 3 é o chão do Pokémon do jogador em vários terrenos):
# lê as cores originais (Unfaded, o jogo não mexe) e grava só as exibidas (Faded). Espera animações; se um Dusknoir
# com Distúrbio voltar, devolve as cores e sai (a entrada dele cria a tarefa do céu de novo).
a = Asm(D_SAI)
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.h(0x1C07)
a.lsl('r1', 'r0', 2); a.add_r('r1', 'r1', 'r0'); a.lsl('r1', 'r1', 3)
a.ldr_lit('r6', GTASKS); a.add_r('r6', 'r6', 'r1')
a.ldr_lit('r3', D_GUARDA | 1); a.bl('c3')
a.ldr_lit('r0', 0x03002A99); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 2); a.alu('and_', 'r0', 'r1'); a.cmpi('r0', 0); a.bc('eq', 'mata')
a.ldr_lit('r0', 0x0806DBC8); a.ldr_i('r0', 'r0', 0)
a.ldr_lit('r1', 0x02023044); a.ldrb_i('r1', 'r1', 0); a.ldr_lit('r2', NOVA2)
a.label('t_laco'); a.cmpi('r1', 0); a.bc('eq', 'sem')
a.ldrh_i('r3', 'r0', 0x20); a.alu('cmp', 'r3', 'r2'); a.bc('ne', 't_prox')
a.ldrh_i('r3', 'r0', 0x2A); a.cmpi('r3', 0); a.bc('ne', 'volta')
a.label('t_prox'); a.addi('r0', 0x60); a.subi('r1', 1); a.b('t_laco')
a.label('volta'); a.mov('r5', SAI_QUADROS); a.b('pinta')
a.label('sem')
a.ldr_lit('r0', 0x03002664); a.ldr_i('r0', 'r0', 0); a.ldr_lit('r1', BATTLE_CB2); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'fim')
a.ldr_lit('r0', 0x02039EE5); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'fim')
a.ldrh_i('r5', 'r6', 8); a.addi('r5', 1); a.strh_i('r5', 'r6', 8)
a.label('pinta')
lsr(a, 4, 5, 2); a.addi('r4', 5)                  # brilho k = 5 + quadro/4 (16 no último)
a.mov('r3', 0)
a.label('cor')
a.ldr_lit('r0', PLTT_BASE + 0x40); a.lsl('r1', 'r3', 1); a.ldrh_r('r0', 'r0', 'r1')
a.lsl('r1', 'r0', 27); lsr(a, 1, 1, 27); a.alu('mul', 'r1', 'r4'); lsr(a, 1, 1, 4)
a.lsl('r2', 'r0', 22); lsr(a, 2, 2, 27); a.alu('mul', 'r2', 'r4'); lsr(a, 2, 2, 4); a.lsl('r2', 'r2', 5); a.alu('orr', 'r1', 'r2')
a.lsl('r2', 'r0', 17); lsr(a, 2, 2, 27); a.alu('mul', 'r2', 'r4'); lsr(a, 2, 2, 4); a.lsl('r2', 'r2', 10); a.alu('orr', 'r1', 'r2')
a.ldr_lit('r2', PLTT_BASE + 0x440); a.lsl('r0', 'r3', 1); a.add_r('r2', 'r2', 'r0'); a.strh_i('r1', 'r2', 0)
a.addi('r3', 1); a.cmpi('r3', 32); a.bc('lo', 'cor')
a.cmpi('r5', SAI_QUADROS); a.bc('lo', 'fim')
a.label('mata'); a.h(0x1C38); a.ldr_lit('r3', DESTROYTASK | 1); a.bl('c3')
a.label('fim'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.label('c3'); a.bx('r3')
a.pool()
put(D_SAI, a.build())

# cobre a tela antes do DrawMainBattleBackground da saída: ele troca os blocos num quadro e o mapa e as paletas no
# seguinte (dava um quadro de blocos pretos e um com o fundo claro). Mapa (fileiras 0-13, 2 telas) -> bloco 511 escuro
# (cor 2 da paleta 11, que ele não mexe) e as cores exibidas das paletas 2 e 3 -> esse mesmo escuro.
a = Asm(D_COBRE)
a.ldr_lit('r0', 0x06008000 + 511 * 32); a.ldr_lit('r1', 0x22222222); a.mov('r2', 0)
a.label('blo'); a.h(0x5000 | 2 << 6 | 0 << 3 | 1); a.addi('r2', 4); a.cmpi('r2', 32); a.bc('lo', 'blo')
a.ldr_lit('r0', 0x0600D000); a.ldr_lit('r1', VR.PAL_FIXO << 12 | 511); a.mov('r2', 0); a.ldr_lit('r3', 14 * 64)
a.label('map'); a.strh_r('r1', 'r0', 'r2'); a.addi('r2', 2); a.alu('cmp', 'r2', 'r3'); a.bc('lo', 'map')
a.ldr_lit('r0', 0x0600D800); a.mov('r2', 0)
a.label('map2'); a.strh_r('r1', 'r0', 'r2'); a.addi('r2', 2); a.alu('cmp', 'r2', 'r3'); a.bc('lo', 'map2')
a.ldr_lit('r0', PLTT_BASE + 0x400 + VR.PAL_FIXO * 32 + 4); a.ldrh_i('r1', 'r0', 0)
a.ldr_lit('r0', PLTT_BASE + 0x440); a.mov('r2', 0)
a.label('pal'); a.strh_r('r1', 'r0', 'r2'); a.addi('r2', 2); a.cmpi('r2', 64); a.bc('lo', 'pal')
a.bx('lr')
a.pool()
put(D_COBRE, a.build())

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
