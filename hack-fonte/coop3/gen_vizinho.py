# Luta dos 3: ao abrir a tela de troca de um jogador, o host manda "Ligação em espera" ao Pokémon da frente
# (GetBattlerAtPosition(pos ^ 1), 0x080781F8). Para o lugar 4 a frente é o 5, que não existe na luta 3 contra 2:
# o comando ficava sem resposta e a batalha travava. Se o lugar não existe (>= gBattlersCount), usa o inimigo 1
# (o jogo já troca para o 3 se o 1 estiver fora).
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm
E = 0x09FF3740; SITE = 0x080781F8; VOLTA = 0x08078206; VEN = 0x0808A492
a = Asm(E)
a.push([], lr=True)
a.ldr_lit('r0', 0x0203F40C); a.add_r('r0', 'r0', 'r6'); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 1); a.alu('eor', 'r0', 'r1')
a.ldr_lit('r3', 0x080F7859); a.bl('via')                      # GetBattlerAtPosition
a.ldr_lit('r1', 0x02023044); a.ldrb_i('r1', 'r1', 0); a.alu('cmp', 'r0', 'r1'); a.bc('lo', 'ok')
a.mov('r0', 1)
a.label('ok')
a.ldr_lit('r1', VOLTA | 1); a.h(0x9100)                        # str r1,[sp] (volta depois do bl original)
a.pop([], pc=True)
a.label('via'); a.bx('r3'); a.pool()
code = a.build()
assert E + len(code) <= 0x09FF3800
off = (VEN - (SITE + 2 + 4)) >> 1
site = struct.pack('<H', 0x4B01) + struct.pack('<HH', 0xF000 | (off >> 11) & 0x7FF, 0xF800 | off & 0x7FF) + struct.pack('<H', 0x46C0) + struct.pack('<I', E | 1)   # ldr r3,[pc,#4]; bl; nop; literal (alinhado)
assert SITE % 4 == 0
esc = [[E - 0x08000000, list(code)], [SITE - 0x08000000, list(site)]]
json.dump(esc, open('vizinho.json', 'w'))
for at, b in esc: print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
