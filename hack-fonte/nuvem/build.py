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
a.ldr_lit('r0', 0x020233F8)          # gSpecialStatuses
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
