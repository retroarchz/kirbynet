# Alguém saiu no meio da luta pelo cabo (08/11, pedido do usuário: "faz como quando foge"): antes de voltar para a foto de
# antes do treinador (linkhle.js fazVolta), o jogo de quem ficou mostra a fuga do próprio jogo.
#   FUGA (tarefa, criada pelo linkhle): no 1º quadro, se data[1] = 1 (na batalha), escreve na caixa da batalha o texto de fuga
#   do jogo "Saiu fora em segurança!" (0x092501AA: começa com {PLAY_SE SE_FLEE}, o barulhinho), e abaixa a música;
#   no quadro FADE_AT escurece a tela (BeginNormalPaletteFade 0 -> 16, preto). O linkhle conta os quadros e volta.
#   ENTRA (tarefa, criada logo depois da volta, no mapa): a tela sai do preto (16 -> 0) e a tarefa acaba.
# Uso: python gen_fuga.py -> linhas para TELA_COOP3 (linkhle.js) e os endereços FUGA/ENTRA; JSON=arquivo grava em json.
import sys, os, json, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'metaknight'))
from thumb import Asm
E = 0x09FF7100                               # depois da rotina do item (gen_item.py vai até 0x09FF70F4)
GTASKS = 0x03005640
TXT_FUGA = 0x092501AA                        # "{PLAY_SE SE_FLEE} Saiu fora em segurança!{PAUSE_UNTIL_PRESS}"
PUTTEXT = 0x081D7020                         # BattlePutTextOnWindow(texto, janela) (o "Ligação em espera" usa, 0x080913C0)
FADEBGM = 0x080F3700                         # FadeOutBGMTemporarily(velocidade) (comando de script fadeoutbgm)
PALFADE = 0x080F1B08                         # BeginNormalPaletteFade(paletas, espera, de, até, cor) (FadeScreen)
DESTROY = 0x080FAE9C                         # DestroyTask
FADE_AT = 70
ROM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba')
d = open(ROM, 'rb').read()
R = 0x08000000
assert d[TXT_FUGA - R:TXT_FUGA - R + 4] == bytes([0xFC, 0x10, 0x11, 0x00]), d[TXT_FUGA - R:TXT_FUGA - R + 4].hex()
assert d[PUTTEXT - R:PUTTEXT - R + 2] and struct.unpack_from('<I', d, 0x913D4)[0] == 0x09254E53   # quem usa PUTTEXT

a = Asm(E)

def fade(de, ate):
    a.h(0xB081)                                        # sub sp, #4
    a.mov('r0', 0); a.h(0x9000)                        # str r0, [sp] (cor preta)
    a.ldr_lit('r0', 0xFFFFFFFF); a.mov('r1', 0); a.mov('r2', de); a.mov('r3', ate)
    a.ldr_lit('r7', PALFADE | 1); a.bl('c7')
    a.h(0xB001)                                        # add sp, #4

# ---- FUGA ----
a.label('fuga')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r4', 'r0')
a.mov('r5', 40); a.alu('mul', 'r5', 'r4'); a.ldr_lit('r1', GTASKS); a.add_r('r5', 'r5', 'r1')
a.ldrh_i('r6', 'r5', 8); a.ldrh_i('r7', 'r5', 10)
a.cmpi('r6', 0); a.bc('ne', 'naoInicio')
a.cmpi('r7', 0); a.bc('eq', 'semTexto')
a.ldr_lit('r0', TXT_FUGA); a.mov('r1', 0); a.ldr_lit('r3', PUTTEXT | 1); a.bl('c3')
a.label('semTexto')
a.mov('r0', 4); a.ldr_lit('r3', FADEBGM | 1); a.bl('c3')
a.label('naoInicio')
a.cmpi('r6', FADE_AT); a.bc('ne', 'naoFade')
fade(0, 16)
a.label('naoFade')
a.addi('r6', 1); a.strh_i('r6', 'r5', 8)
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.label('c3'); a.bx('r3')
a.label('c7'); a.bx('r7')
a.pool()

# ---- ENTRA ----
if a.here() % 4: a.h(0x46C0)
a.label('entra')
a.push(['r4', 'r7'], lr=True)
a.movh('r4', 'r0')
fade(16, 0)
a.movh('r0', 'r4'); a.ldr_lit('r3', DESTROY | 1); a.bl('c3b')
a.pop(['r4', 'r7']); a.pop(['r0']); a.bx('r0')
a.label('c3b'); a.bx('r3')
a.label('c7b')
a.pool()
# o fade() da ENTRA chama 'c7', que fica na FUGA (perto o bastante para o bl)
code = a.build()
fim = E + len(code)
assert fim <= 0x09FF7F00
assert all(b == 0xFF for b in d[E - R:fim - R]), "área não está livre"
FUGA, ENTRA = a.labels['fuga'], a.labels['entra']
patch = [[E - R, list(code)]]
if os.environ.get('JSON'): json.dump(patch, open(os.environ['JSON'], 'w'))
print('    // FUGA 0x%08X, ENTRA 0x%08X, fim 0x%08X' % (FUGA | 1, ENTRA | 1, fim))
for at, b in patch:
    print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
