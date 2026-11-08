# Luta dos 3: o 3º Pokémon escolhido (a reserva, RES3 do gen_reserva.py) aparece na tela de equipe e pode ser escolhido para
# entrar a qualquer hora (pedido do usuário em 08/11: "quero 3, os mesmos que escolhi no começo"). A batalha só tem 6 espaços
# (2 por jogador), então a reserva continua fora deles:
#   mostra  (chamada pelo gen_esconde.py ao abrir a tela, depois de esconder os outros): copia a reserva do jogador para a vaga 3
#           da tela (sempre uma vaga escondida de outro jogador; volta sozinha ao fechar) e marca RESNA = 1;
#   escolhe (chamada pelo gen_troca.py na conferência do aliado de TrySwitchInPokemon, 0x0823F716, r0 = vaga): se é a vaga 3 com
#           a reserva viva, troca a reserva com o Pokémon do banco do jogador (o que não está em campo): o do banco vai para a
#           reserva e a reserva para a vaga dele, e devolve a vaga do banco. O jogo segue como se o jogador tivesse escolhido o
#           Pokémon do banco (as conferências e o pedido pelo cabo ficam os de sempre). Marca USADA (devolução no fim, gen_volta)
#           e deixa em SINAL (p+1) | (banco ímpar << 4) para o linkhle avisar os outros jogos, que fazem a mesma troca.
# Uso: python gen_reserva2.py -> linha para TELA_COOP3 (linkhle.js) e os endereços MOSTRA / ESCOLHE.
import sys, os, struct, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'metaknight'))
from thumb import Asm
R = 0x08000000
E = 0x09FF7980                     # depois da IA (gen_ia.py vai até 0x09FF796C)
FLAG, PARTY, RES3, USADA, VALE = 0x0203FE00, 0x020235CC, 0x0203F270, 0x0203F3A8, 0x0203F3AC
MASCARA = 0x0203F3FB               # vagas escondidas (gen_esconde)
RESNA, SINAL = 0x0203F3AB, 0x0203F3AF
MEU, PIDX, MENU = 0x030055F0, 0x0203F400, 0x0203E9FC   # id do cabo, gBattlerPartyIndexes, gPartyMenu (+9 = vaga)
GETMON, MEMCPY = 0x0809EAC5, 0x084BFF15
ROM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba')
d = open(ROM, 'rb').read()

a = Asm(E)
def chama(f): a.ldr_lit('r3', f); a.bl('via')

# ---- mostra ----
a.label('mostra')
a.push(['r4'], lr=True)
a.ldr_lit('r0', RESNA); a.mov('r1', 0); a.strb_i('r1', 'r0', 0)
a.ldr_lit('r0', VALE); a.ldrh_i('r0', 'r0', 0); a.ldr_lit('r1', 0xA55A); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'm_fim')
a.ldr_lit('r0', MASCARA); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 8); a.alu('tst', 'r0', 'r1'); a.bc('eq', 'm_fim')   # vaga 3 escondida?
a.ldr_lit('r0', MEU); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 0x68); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r4', RES3); a.add_r('r4', 'r4', 'r0')
a.movh('r0', 'r4'); a.mov('r1', 0x0B); chama(GETMON); a.cmpi('r0', 0); a.bc('eq', 'm_fim')                      # espécie
a.ldr_lit('r0', PARTY + 3 * 0x68); a.movh('r1', 'r4'); a.mov('r2', 0x68); chama(MEMCPY)
a.ldr_lit('r0', RESNA); a.mov('r1', 1); a.strb_i('r1', 'r0', 0)
a.label('m_fim')
a.pop(['r4']); a.pop(['r0']); a.bx('r0')
a.label('via'); a.bx('r3')
a.pool()

# ---- escolhe: r0 = vaga -> r0 = vaga a usar ----
if a.here() % 4: a.h(0x46C0)
a.label('escolhe')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.h(0xB09A)                                                                          # sub sp, #0x68
a.movh('r7', 'r0')
a.cmpi('r0', 3); a.bc('ne', 'e_fim')
a.ldr_lit('r0', RESNA); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 1); a.bc('ne', 'e_fim')
a.ldr_lit('r4', PARTY + 3 * 0x68)
a.movh('r0', 'r4'); a.mov('r1', 0x39); chama(GETMON); a.cmpi('r0', 0); a.bc('eq', 'e_fim')                     # reserva sem vida
a.ldr_lit('r0', MEU); a.ldrb_i('r6', 'r0', 0)                                        # r6 = p
a.lsl('r0', 'r6', 2); a.ldr_lit('r1', PIDX); a.add_r('r1', 'r1', 'r0'); a.ldrh_i('r0', 'r1', 0)   # em campo (lugar 2p)
a.lsl('r1', 'r6', 1); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'e_seg')
a.mov('r7', 0); a.mov('r5', 0); a.b('e_tem')                                         # banco = 2p (vaga 0 da tela)
a.label('e_seg'); a.mov('r7', 2); a.mov('r5', 1)                                     # banco = 2p+1 (vaga 2 da tela)
a.label('e_tem')
a.push(['r5'])                                                                       # guarda "banco ímpar" (sp desce 4)
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r5', PARTY); a.add_r('r5', 'r5', 'r0')   # r5 = vaga do banco
a.h(0xA801); a.movh('r1', 'r5'); a.mov('r2', 0x68); chama(MEMCPY)                    # add r0, sp, #4 ; guarda o do banco
a.movh('r0', 'r5'); a.movh('r1', 'r4'); a.mov('r2', 0x68); chama(MEMCPY)            # banco <- reserva
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r6'); a.ldr_lit('r1', RES3); a.add_r('r0', 'r0', 'r1'); a.h(0xA901); a.mov('r2', 0x68); chama(MEMCPY)   # reserva <- antigo do banco
a.movh('r0', 'r4'); a.h(0xA901); a.mov('r2', 0x68); chama(MEMCPY)                   # vaga 3 da tela mostra o antigo
a.pop(['r5'])
a.ldr_lit('r0', USADA); a.add_r('r0', 'r0', 'r6'); a.mov('r1', 1); a.strb_i('r1', 'r0', 0)
a.movh('r0', 'r6'); a.addi('r0', 1); a.lsl('r1', 'r5', 4); a.alu('orr', 'r0', 'r1'); a.ldr_lit('r1', SINAL); a.strb_i('r0', 'r1', 0)
a.ldr_lit('r0', MENU); a.strb_i('r7', 'r0', 9)                                       # a tela passa a apontar o banco
a.ldr_lit('r0', RESNA); a.mov('r1', 0); a.strb_i('r1', 'r0', 0)
a.label('e_fim')
a.movh('r0', 'r7')
a.h(0xB01A)                                                                          # add sp, #0x68
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.bx('r1')
a.label('via2'); a.bx('r3')
a.pool()
code = a.build()
fim = E + len(code)
assert fim <= 0x09FF7F00 and all(b == 0xFF for b in d[E - R:fim - R]), hex(fim)
MOSTRA, ESCOLHE = a.labels['mostra'] | 1, a.labels['escolhe'] | 1
json.dump({'mostra': MOSTRA, 'escolhe': ESCOLHE}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reserva2.json'), 'w'))
print('    // MOSTRA 0x%08X ESCOLHE 0x%08X, código 0x%08X..0x%08X' % (MOSTRA, ESCOLHE, E, fim))
print('    [0x%X, [%s]],' % (E - R, ', '.join('0x%02X' % x for x in code)))
