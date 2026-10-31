# Pokémon Quetzal: habilidade nova 319 "Nuvem Tóxica" (ao entrar na batalha, envenena todos os adversários).
# Molde: o caso da Intimidate (0x0805338C) no switch "ao entrar" de AbilityBattleEffects e o script dela (0x084B18F8).
# uso: python build.py ROM.gba [saida.gba]  -> imprime os trechos (endereço, original, novo) para o game.js
import struct, sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'metaknight'))
from thumb import Asm

ROM = open(sys.argv[1], 'rb').read()
NOVA = 319
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
        else: o.append({' ': 0x00, '.': 0xAD, ',': 0xB8, '\n': 0xFE, 'ó': 0x23}[c])
    return bytes(o) + b'\xff'

patches = []   # (endereço, bytes novos)
def put(at, data): patches.append((at, bytes(data)))

# --- caso da habilidade 319 no switch "ao entrar" (registradores como no caso da Intimidate: sl = batalhador)
a = Asm(CASE)
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
a.ldr_lit('r0', SCRIPT)
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
put(CASE, a.build())

# --- GetAbilityName (0x080A5628): a 319 devolve o nome novo; as outras seguem a função original
a = Asm(NOME_HOOK)
a.push([], lr=True)
a.lsl('r0', 'r0', 16)
a.h(0x0C01)                          # lsr r1, r0, #16
a.h(0x1C0B)                          # add r3, r1, #0
a.ldr_lit('r0', NOVA)
a.alu('cmp', 'r1', 'r0')
a.bc('ne', 'orig')
a.ldr_lit('r0', TXT)
a.pop(['r1'])
a.bx('r1')
a.label('orig')
a.ldr_lit('r0', 0x080A5631)
a.bx('r0')
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
g = [w32(OLD_GERAL + 4 * i) for i in range(N_GERAL)] + [ANIM]
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
put(JTAB, b''.join(p32(x) for x in jt))
put(0x08052600, p32(NOVA - 2))
put(0x08052604, p32(JTAB))

# --- descrições (curta e longa): copia as 319 e põe a 319
for old, new, txt, refs in ((OLD_DESC_C, DESC_C, TXT + 0x20, (0x08247C4C, 0x08284704, 0x08284748)),
                            (OLD_DESC_L, DESC_L, TXT + 0x60, (0x08297700,))):
    t = [w32(old + 4 * i) for i in range(NOVA)] + [txt]
    put(new, b''.join(p32(x) for x in t))
    for r_ in refs:
        assert w32(r_) == old
        put(r_, p32(new))

# confere que cada trecho cai em área livre ou no lugar esperado e monta a saída
out = []
rom = bytearray(ROM)
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
