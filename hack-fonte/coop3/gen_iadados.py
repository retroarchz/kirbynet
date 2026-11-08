# Dados da IA na luta dos 3 (08/11): SetAiLogicDataForTurn (0x081A5E44) preenche gBattleResources->aiData para
# gBattlersCount Pokémon (5 na tripla), mas a tabela (0x228 bytes) é feita para 4: os dados do meio (lugar 4) caíam por cima
# de outros campos a cada turno (habilidade do meio virava o item do lugar 0, % de vida dos lugares 0 e 1 viravam 0,
# partnerMove recebia o % do meio...). Agora o preenchimento vai até no máximo 4 (o meio fica sem dados de IA, que é o que
# a tabela comporta). Troca no lugar dos 20 bytes 0x081A5EA6..0x081A5EB9 (mesmo literal de gBattlersCount; r6 = aiData).
# Uso: python gen_iadados.py -> linha para TELA_COOP3 (linkhle.js).
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'metaknight'))
from thumb import Asm
R = 0x08000000; DE = 0x081A5EA6
ROM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba')
d = open(ROM, 'rb').read()
assert d[DE - R:DE - R + 20].hex() == '2148057821480068816909190878082210430870'
a = Asm(DE)
a.h(0x4821); a.h(0x7805)                                            # ldr r0, =gBattlersCount ; ldrb r5, [r0]
a.cmpi('r5', 4); a.bc('ls', 'ok'); a.mov('r5', 4); a.label('ok')     # no máximo 4
a.add_r('r1', 'r6', 'r4')                                           # r1 = aiData + 0x224 (r4 = 0x224)
a.ldrb_i('r0', 'r1', 0); a.mov('r2', 8); a.alu('orr', 'r0', 'r2'); a.strb_i('r0', 'r1', 0)
c = a.build(); assert len(c) == 20
print('    [0x%X, [%s]],' % (DE - R, ', '.join('0x%02X' % x for x in c)))
