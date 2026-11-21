# Pokémon Quetzal: habilidade nova 321 "Caçador" (Sirfetch'd, nas 3 vagas).
# Ao entrar: balão da habilidade, a floresta (fundo de animação 72, do Jungle Healing) aparece e, em cada adversário,
# nascem as raízes do Ingrain e a armadilha do Snap Trap fecha e morde; fala "Ninguém escapa do Caçador!".
# Enquanto ele estiver em campo: o fundo da batalha vira a floresta com as duas bases de musgo (desenhadas por
# código, pixel a pixel; modelo em modelo.py) e NENHUM adversário pode trocar ou fugir (nem Fantasma, nem Run Away).
# Espaço: a ROM quase não tem área livre; o código vai nos lugares das imagens de frente antigas do Sirfetch'd e da
# Arboliva (as duas ganharam desenho novo em outro lugar) e a paleta nova da Arboliva volta para o lugar da antiga,
# liberando 0x09FFF700 para a tabela de animações gerais crescer (64 -> 66).
# uso: python cacador.py ROM.gba [ROM_COOP3.gba]  -> grava entradas.json (lido por aplica_gamejs.py)
import struct, sys, os, json
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..', '..', 'metaknight'))
from thumb import Asm

ROMS = [open(p, 'rb').read() for p in sys.argv[1:]]
ROM = ROMS[0]
HAB = 321
def w32(a): return struct.unpack_from('<I', ROM, a - 0x08000000)[0]
p32 = lambda v: struct.pack('<I', v & 0xFFFFFFFF)
h16 = lambda v: struct.pack('<H', v & 0xFFFF)
def lsr(a, d, m, imm): a.h(0x0800 | imm << 6 | m << 3 | d)
def ldr_r(a, d, n, m): a.h(0x5800 | m << 6 | n << 3 | d)
def str_r(a, d, n, m): a.h(0x5000 | m << 6 | n << 3 | d)
def sub_r(a, d, n, m): a.h(0x1A00 | m << 6 | n << 3 | d)
def lsl_r(a, d, m): a.h(0x4080 | m << 3 | d)                 # lsls rd, rm
def ldr_sp(a, d, off): a.h(0x9800 | d << 8 | off >> 2)
def str_sp(a, d, off): a.h(0x9000 | d << 8 | off >> 2)
def enc(s):
    o = bytearray()
    for c in s:
        if 'A' <= c <= 'Z': o.append(0xBB + ord(c) - 65)
        elif 'a' <= c <= 'z': o.append(0xD5 + ord(c) - 97)
        else: o.append({' ': 0x00, '.': 0xAD, ',': 0xB8, '\n': 0xFE, 'ó': 0x23, 'ú': 0x27, 'é': 0x1B, 'á': 0x17, 'ç': 0x19, '!': 0xAB}[c])
    return bytes(o) + b'\xff'

# --- endereços do jogo
GTASKS, BATTLE_CB2, CREATETASK, DESTROYTASK = 0x03005640, 0x0803F431, 0x080FADB0, 0x080FAE9C
DRAWBG = 0x0803C06C                          # DrawMainBattleBackground (desviada pelo Distúrbio e agora por aqui)
DIST_ENTRA = 0x09FEEAA6                      # entrada do desvio do Distúrbio (faz o fundo normal e o céu dele)
IMP15 = 0x0203FFFF                           # bit 0 = gelo do Tempo do Imperador na tela (ganha de tudo)
MONS_LIT, COUNT = 0x0806DBC8, 0x02023044     # literal com gBattleMons (o Coop 3 mudou de lugar) e gBattlersCount
PLTT = 0x020391FC                            # gPlttBufferUnfaded (Faded +0x400)
BUF, MAPBUF = 0x0201C000, 0x0201F800         # gDecompressionBuffer: blocos (0x3700) e mapa (0x380) da floresta
PAL_N = 12                                   # paleta 12 de BG (livre na batalha)
FT, FP, FM = (w32(0x09129530 + 12 * 72 + 4 * k) for k in range(3))   # fundo 72 (floresta do Jungle Healing)
SETUP_CBS = (0x0803DED9, 0x0803D24D, 0x080499BD)   # montando a batalha: dados da anterior ainda na tabela
ISABILITY_OPP = 0x08058A79                   # IsAbilityOnOpposingSide(batalhador, habilidade)
ESC_FN = 0x08058AFC                          # IsAbilityPreventingEscape
NOME_VELHO = 0x09FFE081                      # desvio do GetAbilityName da Nuvem Tóxica/Distúrbio (319/320)
DEFAULT, EFEITO_OK, PUSH_SCRIPT = 0x08058604, 0x080583AE, 0x08058D05
ID_MSG = 757                                 # texto da batalha novo (índice 745 da tabela copiada)
N_ANIM_FLORESTA, N_ANIM_PRESA = 64, 65       # animações gerais novas
TERRENO = 0x02022FC0                         # gBattleTerrain: 0 mato, 1 mato alto, 2 areia, 3 debaixo d'água, 4 mar,
SEM_MATA = 1 << 2 | 1 << 3 | 1 << 4 | 1 << 5 | 1 << 7  # 5 lago, 6 montanha, 7 caverna, 8 construção, 9 chão; sem mata = 2,3,4,5,7

# --- espaços: imagens de frente antigas (só a tabela de frente apontava para elas)
S1, S1_N = 0x09B4EEAC, 892                   # Sirfetch'd (imagem nova em 0x09FEC588)
S2, S2_N = 0x09B5E4B0, 1068                  # Arboliva (imagem nova em 0x09FEC000)
for R in ROMS:
    assert struct.unpack_from('<I', R, 0x4F7FC8 + 8 * 865)[0] == S1 and struct.unpack_from('<I', R, 0x4F7FC8 + 8 * 1259)[0] == S2
    assert R.count(p32(S1)) == 1 and R.count(p32(S2)) == 1
    assert R[S1 - 0x08000000:S1 - 0x08000000 + S1_N] == ROM[S1 - 0x08000000:S1 - 0x08000000 + S1_N]
    assert R[S2 - 0x08000000:S2 - 0x08000000 + S2_N] == ROM[S2 - 0x08000000:S2 - 0x08000000 + S2_N]

# formato da base (128x32): borda esquerda por fileira; a direita é 351 - L (base inimiga em x 112..239, y 48..79;
# a do jogador é a mesma deslocada de (-112, +53))
LTAB = [154, 145, 140, 135, 130, 127, 124, 122, 120, 118, 116, 115, 114, 113, 112, 112,
        112, 112, 113, 114, 115, 116, 118, 120, 122, 124, 127, 130, 135, 140, 145, 154]

# ============================ S2: floresta (tarefa, desenho, desvio do fundo) ============================
a = Asm(S2)
# ---- tarefa permanente (r0 = id): mantém a floresta enquanto o Caçador estiver em campo
a.label('tarefa')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r7', 'r0')
a.bl('embatalha'); a.cmpi('r0', 0); a.bc('eq', 't_mata')
a.bl('pode'); a.cmpi('r0', 0); a.bc('eq', 't_fim')
a.bl('presente'); a.movh('r4', 'r0')
a.bl('marca'); a.movh('r5', 'r0')
a.cmpi('r4', 0); a.bc('eq', 't_sem')
a.cmpi('r5', 0); a.bc('ne', 't_fim')
# recém-criada: espera 60 quadros (a animação 64 escurece e o desvio desenha a floresta uma vez só; sem animações
# de batalha nas opções, a tarefa desenha depois desse tempo)
a.lsl('r1', 'r7', 2); a.add_r('r1', 'r1', 'r7'); a.lsl('r1', 'r1', 3); a.ldr_lit('r0', GTASKS); a.add_r('r1', 'r1', 'r0')
a.ldrh_i('r0', 'r1', 8); a.cmpi('r0', 60); a.bc('hs', 't_desenha')
a.addi('r0', 1); a.strh_i('r0', 'r1', 8); a.b('t_fim')
a.label('t_desenha')
a.bl('desenha'); a.b('t_fim')
a.label('t_sem')                              # o Caçador saiu: devolve o fundo normal (ou o céu do Distúrbio) e acaba
a.cmpi('r5', 0); a.bc('eq', 't_mata')
a.ldr_lit('r3', DRAWBG | 1); a.bl('c3')
a.label('t_mata')
a.movh('r0', 'r7'); a.ldr_lit('r3', DESTROYTASK | 1); a.bl('c3')
a.label('t_fim')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.label('c3'); a.bx('r3')

a.label('pode')                               # 1 se a batalha está na tela principal e sem animação de golpe
a.ldr_lit('r0', 0x03002664); a.ldr_i('r0', 'r0', 0); a.ldr_lit('r1', BATTLE_CB2); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'nao')
a.ldr_lit('r0', 0x02039EE5); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'nao')
a.label('sim'); a.mov('r0', 1); a.bx('lr')
a.label('nao'); a.mov('r0', 0); a.bx('lr')
a.label('embatalha')                          # gMain.inBattle
a.ldr_lit('r0', 0x03002A99); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 2); a.alu('and_', 'r0', 'r1'); a.bx('lr')
a.label('marca')                              # 1 se a floresta está no mapa (paleta 12 no canto)
a.ldr_lit('r0', 0x0600D000); a.ldrh_i('r0', 'r0', 0); lsr(a, 0, 0, 12); a.cmpi('r0', PAL_N); a.bc('eq', 'sim'); a.b('nao')
a.label('lugar')                              # 1 se a luta é num lugar sem mata: mar, debaixo d'água, lago ou caverna
a.ldr_lit('r0', TERRENO); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 8); a.bc('hs', 'nao')
a.mov('r1', SEM_MATA); a.h(0x40C1)            # lsrs r1, r0
a.mov('r0', 1); a.alu('and_', 'r0', 'r1'); a.bx('lr')
a.label('presente')                           # 1 se alguém com Caçador tem vida e não há Distúrbio nem gelo do Imperador
a.push(['r4', 'r5'])
a.ldr_lit('r0', TERRENO); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 8); a.bc('hs', 'p_lugar_ok')
a.mov('r1', SEM_MATA); a.h(0x40C1); a.lsl('r1', 'r1', 31); a.bc('ne', 'p_nao')   # lugar sem mata: nada de floresta
a.label('p_lugar_ok')
a.ldr_lit('r0', IMP15); a.ldrb_i('r0', 'r0', 0); a.lsl('r0', 'r0', 31); a.bc('ne', 'p_nao')
a.ldr_lit('r0', MONS_LIT); a.ldr_i('r0', 'r0', 0)
a.ldr_lit('r1', COUNT); a.ldrb_i('r1', 'r1', 0)
a.ldr_lit('r4', 320); a.ldr_lit('r5', HAB); a.mov('r2', 0)
a.label('p_laco')
a.cmpi('r1', 0); a.bc('eq', 'p_fim')
a.ldrh_i('r3', 'r0', 0x2A); a.cmpi('r3', 0); a.bc('eq', 'p_prox')
a.ldrh_i('r3', 'r0', 0x20)
a.alu('cmp', 'r3', 'r4'); a.bc('eq', 'p_nao')   # Dusknoir com Distúrbio: o céu escuro dele fica
a.alu('cmp', 'r3', 'r5'); a.bc('ne', 'p_prox'); a.mov('r2', 1)
a.label('p_prox'); a.addi('r0', 0x60); a.subi('r1', 1); a.b('p_laco')
a.label('p_nao'); a.mov('r2', 0)
a.label('p_fim'); a.movh('r0', 'r2'); a.pop(['r4', 'r5']); a.bx('lr')
a.label('acha')                               # r0 = tarefa da floresta (endereço) ou 0
a.ldr_lit('r1', GTASKS); a.mov('r2', 16); a.ldr_lit('r3', 0)   # placeholder: endereço da tarefa
a.label('a_laco')
a.ldrb_i('r0', 'r1', 4); a.cmpi('r0', 0); a.bc('eq', 'a_prox')
a.ldr_i('r0', 'r1', 0); a.alu('cmp', 'r0', 'r3'); a.bc('ne', 'a_prox')
a.movh('r0', 'r1'); a.bx('lr')
a.label('a_prox'); a.addi('r1', 40); a.subi('r2', 1); a.bc('ne', 'a_laco')
a.mov('r0', 0); a.bx('lr')
a.label('garante')                            # cria a tarefa se ela não existe (a bolsa e o time apagam as tarefas)
a.push([], lr=True)
a.bl('acha'); a.cmpi('r0', 0); a.bc('ne', 'g_fim')
a.ldr_lit('r0', 0); a.mov('r1', 3); a.ldr_lit('r3', CREATETASK | 1); a.bl('c3')   # placeholder: endereço da tarefa
a.label('g_fim'); a.pop(['r0']); a.bx('r0')
a.pool()

# ---- desvio do DrawMainBattleBackground: faz o normal (e o Distúrbio) e, com o Caçador em campo, a floresta
a.label('entra')
a.push(['r4'], lr=True)
a.ldr_lit('r3', DIST_ENTRA | 1); a.bl('c3')
a.bl('embatalha'); a.cmpi('r0', 0); a.bc('eq', 'e_sai')
a.ldr_lit('r0', 0x03002664); a.ldr_i('r0', 'r0', 0)
for cb in SETUP_CBS:
    a.ldr_lit('r1', cb); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'e_sai')
a.bl('presente'); a.cmpi('r0', 0); a.bc('eq', 'e_sai')
a.bl('garante'); a.bl('desenha')
a.label('e_sai'); a.pop(['r4']); a.pop(['r0']); a.bx('r0')

# ---- inverte os 8 pixels de uma linha de bloco (espelho horizontal): r0 -> r0
a.label('rev')
a.mov('r1', 0); a.mov('r2', 8)
a.label('rv'); a.lsl('r1', 'r1', 4); a.lsl('r3', 'r0', 28); lsr(a, 3, 3, 28); a.alu('orr', 'r1', 'r3'); lsr(a, 0, 0, 4)
a.subi('r2', 1); a.bc('ne', 'rv')
a.movh('r0', 'r1'); a.bx('lr')

# ---- uma base de musgo sobre 8 pixels: r0 = linha do bloco, r1 = Y, r2 = X0, r3 = y da base, r4 = deslocamento x
a.label('umabase')
a.push(['r1', 'r2', 'r4', 'r5', 'r6', 'r7'], lr=True)
a.h(0xB084)                                   # sub sp, #16: [0] l, [4] r, [8] k
sub_r(a, 5, 1, 3); a.bc('mi', 'u_fim')        # k = Y - y da base
a.cmpi('r5', 32); a.bc('ge', 'u_fim')
str_sp(a, 5, 8)
a.ldr_lit('r6', 0); a.ldrb_r('r6', 'r6', 'r5')   # placeholder: LTAB
a.ldr_lit('r7', 351); sub_r(a, 7, 7, 6); a.add_r('r7', 'r7', 'r4')
a.add_r('r6', 'r6', 'r4')
str_sp(a, 6, 0); str_sp(a, 7, 4)
a.h(0x1DD3)                                   # adds r3, r2, #7
a.alu('cmp', 'r3', 'r6'); a.bc('lt', 'u_fim')
a.alu('cmp', 'r2', 'r7'); a.bc('gt', 'u_fim')
a.mov('r4', 0)
a.label('u_i')
a.add_r('r3', 'r2', 'r4')                     # x
ldr_sp(a, 5, 0); a.alu('cmp', 'r3', 'r5'); a.bc('lt', 'u_prox')
ldr_sp(a, 6, 4); a.alu('cmp', 'r3', 'r6'); a.bc('gt', 'u_prox')
sub_r(a, 5, 3, 5); sub_r(a, 6, 6, 3)          # x - l, r - x
a.alu('cmp', 'r5', 'r6'); a.bc('le', 'u_d'); a.movh('r5', 'r6')
a.label('u_d')                                # r5 = d
ldr_sp(a, 6, 8); a.mov('r7', 31); sub_r(a, 7, 7, 6)
a.alu('cmp', 'r6', 'r7'); a.bc('le', 'u_dy'); a.movh('r6', 'r7')
a.label('u_dy')                               # r6 = dy
a.mov('r7', 15)
a.cmpi('r5', 0); a.bc('eq', 'u_cor')
a.cmpi('r6', 0); a.bc('eq', 'u_cor')
a.mov('r7', 5)
a.cmpi('r5', 2); a.bc('le', 'u_cor')
a.cmpi('r6', 1); a.bc('le', 'u_cor')
a.mov('r7', 3)
a.cmpi('r5', 4); a.bc('le', 'u_cor')
ldr_sp(a, 6, 8); a.cmpi('r6', 27); a.bc('ge', 'u_cor')
a.mov('r7', 14)
a.lsl('r5', 'r3', 3); sub_r(a, 5, 5, 3)       # x*7
a.mov('r6', 13); a.alu('mul', 'r6', 'r1')     # Y*13
a.add_r('r5', 'r5', 'r6'); a.lsl('r5', 'r5', 28); a.bc('eq', 'u_cor')
a.mov('r7', 9)
a.lsl('r5', 'r3', 2); a.add_r('r5', 'r5', 'r3')   # x*5
a.lsl('r6', 'r1', 1); a.add_r('r6', 'r6', 'r1')   # Y*3
a.add_r('r5', 'r5', 'r6'); a.lsl('r5', 'r5', 27); lsr(a, 5, 5, 27); a.cmpi('r5', 7); a.bc('eq', 'u_cor')
a.mov('r7', 12)
a.label('u_cor')
a.lsl('r5', 'r4', 2)
a.mov('r6', 15); lsl_r(a, 6, 5); a.alu('bic', 'r0', 'r6')
lsl_r(a, 7, 5); a.alu('orr', 'r0', 'r7')
a.label('u_prox')
a.addi('r4', 1); a.cmpi('r4', 8); a.bc('lo', 'u_i')
a.label('u_fim')
a.addsp(16)
a.pop(['r1', 'r2', 'r4', 'r5', 'r6', 'r7']); a.pop(['r3']); a.bx('r3')
a.pool()

# ---- desenha: floresta + bases nos blocos 0..419 (30x14), paleta 12, mapa das 2 telas (fileiras 0-13)
a.label('desenha')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r4', 8); a.movh('r5', 9); a.movh('r6', 10); a.movh('r7', 11); a.push(['r4', 'r5', 'r6', 'r7'])
a.ldr_lit('r0', FT); a.ldr_lit('r1', BUF); a.h(0xDF11)          # LZ77UnCompWram
a.ldr_lit('r0', FM); a.ldr_lit('r1', MAPBUF); a.h(0xDF11)
a.ldr_lit('r0', FP); a.ldr_lit('r1', PLTT + PAL_N * 32); a.h(0xDF11)
a.ldr_lit('r0', PLTT + PAL_N * 32); a.ldr_lit('r1', PLTT + 0x400 + PAL_N * 32); a.mov('r2', 0)
a.label('d_pal'); ldr_r(a, 3, 0, 2); str_r(a, 3, 1, 2); a.addi('r2', 4); a.cmpi('r2', 32); a.bc('lo', 'd_pal')
a.ldr_lit('r0', 0x06008000); a.movh(10, 'r0')
a.mov('r0', 0); a.movh(8, 'r0')
a.label('d_fil'); a.mov('r0', 0); a.movh(9, 'r0')
a.label('d_col')
a.movh('r0', 8); a.lsl('r0', 'r0', 5); a.movh('r1', 9); a.add_r('r0', 'r0', 'r1'); a.lsl('r0', 'r0', 1)
a.ldr_lit('r1', MAPBUF); a.ldrh_r('r7', 'r1', 'r0')            # r7 = entrada do mapa da floresta
a.lsl('r6', 'r7', 22); lsr(a, 6, 6, 17); a.ldr_lit('r1', BUF); a.add_r('r6', 'r6', 'r1')   # r6 = bloco de origem
a.mov('r5', 0)
a.label('d_y')
a.lsl('r0', 'r7', 20); a.bc('pl', 'd_nv')     # espelho vertical
a.mov('r1', 7); sub_r(a, 1, 1, 5); a.b('d_sy')
a.label('d_nv'); a.movh('r1', 'r5')
a.label('d_sy'); a.lsl('r1', 'r1', 2); ldr_r(a, 0, 6, 1)
a.lsl('r1', 'r7', 21); a.bc('pl', 'd_nh')     # espelho horizontal
a.bl('rev')
a.label('d_nh')
a.movh('r1', 8); a.lsl('r1', 'r1', 3); a.add_r('r1', 'r1', 'r5')   # Y
a.movh('r2', 9); a.lsl('r2', 'r2', 3)                               # X0
a.mov('r3', 48); a.mov('r4', 0); a.bl('umabase')
a.mov('r3', 101); a.ldr_lit('r4', -112); a.bl('umabase')
a.movh('r1', 10); a.str_i('r0', 'r1', 0); a.addi('r1', 4); a.movh(10, 'r1')
a.addi('r5', 1); a.cmpi('r5', 8); a.bc('lo', 'd_y')
a.movh('r0', 9); a.addi('r0', 1); a.movh(9, 'r0'); a.cmpi('r0', 30); a.bc('lo', 'd_col')
a.movh('r0', 8); a.addi('r0', 1); a.movh(8, 'r0'); a.cmpi('r0', 14); a.bc('lo', 'd_fil')
# mapa
a.ldr_lit('r0', 0x0600D000); a.mov('r1', 0)
a.label('m_fil'); a.mov('r2', 0)
a.label('m_col')
a.movh('r3', 'r2'); a.cmpi('r3', 30); a.bc('lo', 'm_ok'); a.subi('r3', 30)
a.label('m_ok')
a.mov('r4', 30); a.alu('mul', 'r4', 'r1'); a.add_r('r3', 'r3', 'r4')
a.ldr_lit('r4', PAL_N << 12); a.alu('orr', 'r3', 'r4')
a.lsl('r4', 'r1', 5); a.add_r('r4', 'r4', 'r2'); a.lsl('r4', 'r4', 1)
a.strh_r('r3', 'r0', 'r4'); a.ldr_lit('r5', 0x800); a.add_r('r5', 'r5', 'r4'); a.strh_r('r3', 'r0', 'r5')
a.addi('r2', 1); a.cmpi('r2', 32); a.bc('lo', 'm_col')
a.addi('r1', 1); a.cmpi('r1', 14); a.bc('lo', 'm_fil')
a.pop(['r4', 'r5', 'r6', 'r7']); a.movh(8, 'r4'); a.movh(9, 'r5'); a.movh(10, 'r6'); a.movh(11, 'r7')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()
# ---- tarefa visual da animação 65: as raízes (tag 0x27EF) ficam verde-escuro de cipó (só aqui; o Ingrain fica igual)
a.label('raiz')
a.push(['r4'], lr=True)
a.movh('r4', 'r0')
a.ldr_lit('r0', 0x27EF); a.ldr_lit('r1', 0x03000CF0); a.mov('r2', 0)   # sSpritePaletteTags (u32 por vaga)
a.label('r_laco'); a.ldr_i('r3', 'r1', 0); a.alu('cmp', 'r3', 'r0'); a.bc('eq', 'r_achou')
a.addi('r1', 4); a.addi('r2', 1); a.cmpi('r2', 16); a.bc('lo', 'r_laco'); a.b('r_fim')
a.label('r_achou')
a.lsl('r1', 'r2', 4); a.addi('r1', 0x80); a.addi('r1', 0x80)          # 0x100 + vaga*16 (paletas de sprite)
a.ldr_lit('r0', 0); a.mov('r2', 0x20); a.ldr_lit('r3', 0x080F196D); a.bl('c3')   # LoadPalette (placeholder: paleta)
a.label('r_fim')
a.movh('r0', 'r4'); a.ldr_lit('r3', 0x080F43A9); a.bl('c3')          # DestroyAnimVisualTask
a.pop(['r4']); a.pop(['r0']); a.bx('r0')
a.pool()
# paleta das raízes: a rampa marrom (cores 1 clara .. 9 escura) vira verde-escuro de cipó
CIPO = [(0, 0, 0), (120, 168, 72), (96, 148, 56), (80, 128, 48), (64, 112, 40), (52, 96, 32), (44, 80, 28), (36, 66, 24),
        (28, 52, 20), (20, 40, 16)] + [(0, 0, 0)] * 6
a.label('cipo')
for k_ in range(0, 16, 2):
    c0, c1 = [(r_ >> 3) | (g_ >> 3) << 5 | (b_ >> 3) << 10 for r_, g_, b_ in CIPO[k_:k_ + 2]]
    a.word(c0 | c1 << 16)
L_TAREFA = a.labels['tarefa']
code2 = a.build()

# ============================ S1: nome, fuga, entrada, script, animações, textos ============================
s1 = bytearray()
def at1(): return S1 + len(s1)
def alinha():
    while len(s1) % 4: s1.append(0)

# textos
T_NOME = at1(); s1 += enc('Caçador')
T_CURTA = at1(); s1 += enc('Prende os rivais na floresta.')
T_LONGA = at1(); s1 += enc('Ao entrar, a floresta cerca a\nbatalha e nenhum inimigo\nconsegue trocar ou fugir.')
T_MSG = at1(); s1 += enc('Ninguém escapa do Caçador!')
L_LTAB = at1(); s1 += bytes(LTAB)
alinha()

# GetAbilityName: 321 -> "Caçador"; as outras seguem para o desvio antigo (319/320 e original)
n = Asm(at1())
n.lsl('r1', 'r0', 16); lsr(n, 1, 1, 16); n.ldr_lit('r2', HAB); n.alu('cmp', 'r1', 'r2'); n.bc('ne', 'outro')
n.ldr_lit('r0', T_NOME); n.bx('lr')
n.label('outro'); n.ldr_lit('r1', NOME_VELHO); n.bx('r1')
n.pool()
NOME_HOOK = n.base; s1 += n.build(); alinha()

# IsAbilityPreventingEscape: Caçador do outro lado prende sempre (antes da exceção de Fantasma e Run Away)
e = Asm(at1())
e.push(['r4', 'r5'], lr=True)
e.movh('r5', 'r0')
e.bl(a.labels['lugar']); e.cmpi('r0', 0); e.bc('ne', 'segue')   # mar/lago/caverna: o Caçador não prende
e.movh('r0', 'r5')
e.ldr_lit('r1', HAB); e.ldr_lit('r3', ISABILITY_OPP); e.bl('c3')
e.cmpi('r0', 0); e.bc('ne', 'preso')
e.label('segue')
e.movh('r0', 'r5'); e.mov('r1', 0); e.mov('r2', 0)
e.ldr_lit('r3', ESC_FN + 8 + 1); e.bx('r3')   # segue na função (o bl de 0x08058B04 em diante)
e.label('preso'); e.pop(['r4', 'r5']); e.pop(['r1']); e.bx('r1')
e.label('c3'); e.bx('r3')
e.pool()
ESC_HOOK = e.base; s1 += e.build(); alinha()
assert ROM[ESC_FN - 0x08000000:ESC_FN - 0x08000000 + 8] == bytes.fromhex('30b5051c00210022')

# callnative do script: garante a tarefa da floresta e avança 5 bytes
c = Asm(at1())
c.push([], lr=True)
c.ldr_lit('r3', a.labels['garante'] | 1); c.bl('c3')
c.ldr_lit('r1', 0x0202320C); c.ldr_i('r0', 'r1', 0); c.addi('r0', 5); c.str_i('r0', 'r1', 0)
c.pop(['r0']); c.bx('r0')
c.label('c3'); c.bx('r3')
c.pool()
CRIA = c.base; s1 += c.build(); alinha()

# animação geral 64 (no Sirfetch'd): o fundo escurece uma vez e volta já como a floresta com as bases de musgo (o
# restorebg chama o DrawMainBattleBackground e o desvio desenha a floresta)
ANIM_FLORESTA = at1()
s1 += bytes.fromhex('15') + bytes.fromhex('17') + b'\x08'      # restorebg, waitbgfadein, end
# animação geral 65 (no adversário: atacante = alvo = ele): raízes do Ingrain + armadilha do Snap Trap que morde
def trecho(de, ate): return ROM[de - 0x08000000:ate - 0x08000000]
ANIM_PRESA = at1()
s1 += trecho(0x08499D8E, 0x08499D94)          # Ingrain: carrega as raízes
s1 += b'\x03' + p32(a.labels['raiz'] | 1) + b'\x05\x00' + b'\x05'   # raízes verde-cipó (espera a tarefa acabar)
s1 += trecho(0x08499D94, 0x08499DF0)          # 4 raízes nascem (com o som)
s1 += trecho(0x08482D04, 0x08482DE5)          # Snap Trap inteiro até o clearmonbg (dentes, folhas, tremor)
s1 += bytes.fromhex('0d') + bytes.fromhex('0401') + b'\x08'   # blendoff, delay 1, end
alinha()

# script de batalha
s = bytearray(); lab = {}; fix = []
def jmp(name): fix.append((len(s), name)); s.extend(b'\0\0\0\0')
s += bytes.fromhex('ff91980808')                 # savetarget
s += bytes.fromhex('760136')                     # showabilitypopup BS_ATTACKER
s += bytes.fromhex('394000')                     # pause
s += b'\xff' + p32(CRIA | 1)                     # callnative: tarefa da floresta
s += bytes([0x45, 0x01, N_ANIM_FLORESTA]) + p32(0x02023500)   # playanimation BS_ATTACKER: a floresta
s += bytes.fromhex('0a')                         # waitanimation
s += bytes.fromhex('2e0532020200')               # setbyte gBattlerTarget, 0
lab['laco'] = len(s)
s += bytes.fromhex('2c053202020432020201'); jmp('prox')   # alvo == quem entrou
s += bytes.fromhex('760137'); jmp('prox')        # jumpiftargetally
s += bytes.fromhex('760061'); jmp('prox')        # jumpifabsent BS_TARGET
s += bytes([0x45, 0x00, N_ANIM_PRESA]) + p32(0x02023500)       # playanimation BS_TARGET: raízes + armadilha
s += bytes.fromhex('0a')                         # waitanimation
lab['prox'] = len(s)
s += bytes.fromhex('2f0532020201')               # addbyte gBattlerTarget, 1
s += bytes.fromhex('2d053202024430020201'); jmp('laco')   # até gBattlersCount
s += bytes.fromhex('31073502020432020201')       # copybyte sBATTLER, gBattlerAttacker
s += bytes([0x10]) + h16(ID_MSG) + bytes.fromhex('124000')   # "Ninguém escapa do Caçador!"
s += bytes.fromhex('760f62')                     # destroyabilitypopup
s += bytes.fromhex('ffb1980808')                 # restoretarget
s += bytes.fromhex('392000')                     # pause
s += bytes.fromhex('3f')                         # end3
SCRIPT = at1()
for at, name in fix: s[at:at + 4] = p32(SCRIPT + lab[name])
s1 += s; alinha()

# caso no switch "ao entrar" (igual ao da Nuvem Tóxica: sl = batalhador)
k = Asm(at1())
k.bl(a.labels['lugar']); k.cmpi('r0', 0); k.bc('ne', 'ja')   # mar/lago/caverna: sem balão nem floresta
k.ldr_lit('r0', 0x080533C0); k.ldr_i('r0', 'r0', 0)
k.movh('r5', 10); k.lsl('r1', 'r5', 1); k.h(0x4451); k.lsl('r1', 'r1', 3); k.add_r('r3', 'r1', 'r0')
k.ldrb_i('r0', 'r3', 0x10); k.lsl('r0', 'r0', 0x1E); k.cmpi('r0', 0); k.bc('lt', 'ja')
k.ldr_lit('r0', 0x02023204); k.strb_i('r5', 'r0', 0)
k.ldrb_i('r0', 'r3', 0x10); k.mov('r1', 2); k.alu('orr', 'r0', 'r1'); k.strb_i('r0', 'r3', 0x10)
k.ldr_lit('r0', SCRIPT); k.ldr_lit('r1', PUSH_SCRIPT); k.bl('chama')
k.ldr_lit('r0', EFEITO_OK); k.h(0x4687)
k.label('ja'); k.ldr_lit('r0', DEFAULT); k.h(0x4687)
k.label('chama'); k.bx('r1')
k.pool()
CASE = k.base; s1 += k.build(); alinha()
assert len(s1) <= S1_N, (len(s1), S1_N)

# placeholders do S2 (literais 0): endereço da tarefa (acha, garante) e da LTAB (umabase)
code2 = bytearray(code2)
# conferência: exatamente os literais zero do pool (acha, garante, umabase)
lits0 = []
for nm, addr in a.labels.items():
    if nm.startswith('_lit') and addr - S2 + 4 <= len(code2) and code2[addr - S2:addr - S2 + 4] == b'\0\0\0\0': lits0.append((addr, nm))
lits0.sort()
assert len(lits0) == 4, lits0
for (addr, nm), v in zip(lits0, [L_TAREFA | 1, L_TAREFA | 1, L_LTAB, a.labels['cipo']]):
    code2[addr - S2:addr - S2 + 4] = p32(v)
assert len(code2) <= S2_N, (len(code2), S2_N)

# --- paleta nova da Arboliva volta para o lugar da antiga (libera 0x09FFF700 para a tabela de animações gerais)
ARB_PAL_VELHA = 0x09C67B6C
ARB_PAL_NOVA = bytes.fromhex('102000000053532b300410fa78001a79000093600d200004085638ff7b882c00fc62b8482c2c230c')
for R in ROMS: assert struct.unpack_from('<I', R, 0x4E5D2C)[0] == ARB_PAL_VELHA

# ============================ fim de cada rodada: a floresta ataca ============================
# Em cada adversário: folhas do Leaf Tornado (sem o redemoinho) girando nele, tremor e 1/16 da vida máxima.
# Áreas livres (0xFF) depois das tabelas copiadas (cada tabela tem folga para mais 4 habilidades/textos):
N1, N1_FIM = 0x09FFE910, 0x09FFEA00          # desvio do fim de rodada + dano
N2, N2_FIM = 0x09FFEF20, 0x09FFF000          # script, texto e animação 66
ID_MSG2, N_ANIM_FOLHAS = 758, 66
D_TRAMP_VELHO = 0x09FEEB61                   # desvio do Distúrbio (320) no fim de rodada
MAGIC_GUARD = 98
for R in ROMS:
    for ini, fim_ in ((N1, N1_FIM), (N2, N2_FIM)):
        assert all(b == 0xFF for b in R[ini - 0x08000000:fim_ - 0x08000000]), hex(ini)
assert ROM[0x0847578E - 0x08000000:0x0847578E - 0x08000000 + 3] == bytes.fromhex('001927')

n2 = bytearray()
def at2(): return N2 + len(n2)
T_MSG2 = at2(); n2 += bytes([0xFD, 0x10]) + enc(' foi atacado\npela floresta!')   # "<alvo> foi atacado pela floresta!"
ANIM_FOLHAS = at2()
n2 += bytes.fromhex('004f27')                     # loadspritegfx folhas
n2 += bytes.fromhex('1984003f')                   # som do Leaf Tornado
n2 += b'\x03' + p32(0x08141361) + b'\x05\x05' + b''.join(h16(v) for v in (1, 0, 2, 47, 1))   # tremor do alvo
n2 += (b'\x0e' + p32(0x084757D7)) * 3            # 3 rajadas de folhas girando no alvo (sem o redemoinho)
n2 += bytes.fromhex('05') + bytes.fromhex('2f') + b'\x08'   # waitforvisualfinish, stopsound, end
while len(n2) % 4: n2.append(0)

# native: 1/16 da vida máxima do alvo em gBattleMoveDamage (mínimo 1); avança 5 bytes
d = Asm(N1)
d.label('dano')
d.ldr_lit('r0', 0x02023205); d.ldrb_i('r0', 'r0', 0); d.mov('r1', 0x60); d.alu('mul', 'r0', 'r1')
d.ldr_lit('r1', MONS_LIT); d.ldr_i('r1', 'r1', 0); d.add_r('r0', 'r0', 'r1'); d.ldrh_i('r0', 'r0', 0x2E)
lsr(d, 0, 0, 4); d.cmpi('r0', 0); d.bc('ne', 'ok'); d.mov('r0', 1)
d.label('ok'); d.ldr_lit('r1', 0x020231E8); d.str_i('r0', 'r1', 0)
d.ldr_lit('r1', 0x0202320C); d.ldr_i('r0', 'r1', 0); d.addi('r0', 5); d.str_i('r0', 'r1', 0)
d.bx('lr')
d.pool()
# desvio no fim de rodada (r2 = batalhador, fica intacto): 321 -> script da floresta; o resto segue para o do Distúrbio
d.label('tramp')
d.ldr_lit('r0', 0x02023202); d.ldrh_i('r1', 'r0', 0)
d.ldr_lit('r3', HAB); d.alu('cmp', 'r1', 'r3'); d.bc('eq', 'meu')
d.ldr_lit('r3', D_TRAMP_VELHO); d.bx('r3')
d.label('meu')
d.ldr_lit('r3', a.labels['lugar'] | 1); d.bl('c3'); d.cmpi('r0', 0); d.bc('ne', 'nada')   # mar/lago/caverna/areia: sem floresta
d.ldr_lit('r0', 0); d.ldr_lit('r3', PUSH_SCRIPT); d.bl('c3')    # placeholder: script
d.ldr_lit('r3', 0x08057E16); d.h(0x469F)                          # efeito++ e fim do switch
d.label('nada'); d.ldr_lit('r3', DEFAULT); d.h(0x469F)
d.label('c3'); d.bx('r3')
d.pool()
DANO16, TRAMP = d.labels['dano'], d.labels['tramp']

# script do fim de rodada (molde: o dreno do Distúrbio)
s = bytearray(); lab = {}; fix = []
s += bytes.fromhex('760136392000')                # balão da habilidade
s += bytes.fromhex('2e0532020200')                # alvo = 0
lab['laco'] = len(s)
s += bytes.fromhex('760137'); jmp('prox')         # aliado
s += bytes.fromhex('760061'); jmp('prox')         # ausente
s += bytes.fromhex('ff3998080800'); jmp('prox')   # desmaiado
s += bytes([0x1E, 0x00, MAGIC_GUARD, 0x00]); jmp('prox')
s += bytes([0x45, 0x00, N_ANIM_FOLHAS]) + p32(0x02023500) + b'\x0a'   # folhas no alvo e espera
s += b'\xff' + p32(DANO16 | 1)                    # dano = 1/16 da vida máxima
s += bytes.fromhex('357432020200011000') + bytes.fromhex('0b000c00')  # barra de vida do alvo
s += bytes([0x10]) + h16(ID_MSG2) + bytes.fromhex('124000')         # "<alvo> foi atacado pela floresta!"
s += bytes.fromhex('19000000000000')              # tryfaintmon alvo
lab['prox'] = len(s)
s += bytes.fromhex('2f0532020201')
s += bytes.fromhex('2d053202024430020201'); jmp('laco')
s += bytes.fromhex('760f62390f003f')              # fecha o balão, pausa, end3
SCRIPT2 = at2()
for at, name in fix: s[at:at + 4] = p32(SCRIPT2 + lab[name])
n2 += s
assert N2 + len(n2) <= N2_FIM, hex(N2 + len(n2))
code_n1 = bytearray(d.build())
z = [ad for nm, ad in d.labels.items() if nm.startswith('_lit') and code_n1[ad - N1:ad - N1 + 4] == b'\0\0\0\0']
assert len(z) == 1, z
code_n1[z[0] - N1:z[0] - N1 + 4] = p32(SCRIPT2)
assert N1 + len(code_n1) <= N1_FIM, hex(N1 + len(code_n1))
assert ROM[0x53E52:0x53E5C] == bytes.fromhex('0d480188832900d19de2')

# ============================ Sacred Sword do Sirfetch'd: espada verde ============================
# O golpe 533 ganha um script: carrega os gráficos como o original, uma tarefa vê se o atacante é o Sirfetch'd (865);
# se for, pinta de verde a espada/corte (paleta 0x2851) e as cores azuis do brilho (0x2715), põe gBattleAnimArgs[7] = 1
# e a animação segue numa cópia com o clarão verde (no lugar do ciano 32754); senão segue no script original.
N3, N3_FIM = 0x09FFF520, 0x09FFF600          # área livre depois da tabela de descrições longas
for R in ROMS: assert all(b == 0xFF for b in R[N3 - 0x08000000:N3_FIM - 0x08000000])
SS_MOVE, SS_ORIG = 533, w32(0x0846AB1C + 4 * 533)
ANIM_ARGS, ANIM_ATK = 0x02039F06, 0x02039F1E
assert SS_ORIG == 0x08475628 and ROM[SS_ORIG - 0x08000000:SS_ORIG - 0x08000000 + 12] == bytes.fromhex('009a27001527005128004c28')
sys.path.insert(0, os.path.join(AQUI, '..'))
from lz import lz77
def verde(c):
    R_, G_, B_ = c & 31, c >> 5 & 31, c >> 10 & 31
    return (R_ // 2) | B_ << 5 | (G_ // 2) << 10            # azul -> verde de alho-poró
def pal_tag(tag):
    p = w32(0x09128A38 - 63 * 8 + (tag - 0x2710) * 8)
    return list(struct.unpack('<16H', lz77(ROM, p - 0x08000000)[0][:32]))
P2851 = pal_tag(0x2851); P2851 = [P2851[0]] + [verde(c) for c in P2851[1:]]
P2715 = pal_tag(0x2715); P2715[4] = verde(P2715[4]); P2715[6] = verde(P2715[6])
VERDE_CLARAO = 10 | 31 << 5 | 12 << 10       # no lugar de 32754 (ciano claro)
N4, N4_FIM = 0x09FEBDC0, 0x09FEBE00          # as 2 paletas (depois da tabela de textos, com folga para mais 4 textos)
for R in ROMS: assert all(b == 0xFF for b in R[N4 - 0x08000000:N4_FIM - 0x08000000])
n4 = struct.pack('<16H', *P2851) + struct.pack('<16H', *P2715)
L_P2851, L_P2715 = N4, N4 + 32
n3 = bytearray()
def at3(): return N3 + len(n3)
t = Asm(at3())
t.push(['r4', 'r5'], lr=True)
t.movh('r5', 'r0')
t.ldr_lit('r4', ANIM_ARGS); t.mov('r0', 0); t.strh_i('r0', 'r4', 14)          # gBattleAnimArgs[7] = 0
t.ldr_lit('r0', ANIM_ATK); t.ldrb_i('r0', 'r0', 0); t.mov('r1', 0x60); t.alu('mul', 'r0', 'r1')
t.ldr_lit('r1', MONS_LIT); t.ldr_i('r1', 'r1', 0); t.add_r('r0', 'r0', 'r1'); t.ldrh_i('r0', 'r0', 0)   # espécie
t.ldr_lit('r1', 865); t.alu('cmp', 'r0', 'r1'); t.bc('ne', 'fim')
t.mov('r0', 1); t.strh_i('r0', 'r4', 14)                                    # gBattleAnimArgs[7] = 1
for tag, pal, nome in ((0x2851, L_P2851, 'p1'), (0x2715, L_P2715, 'p2')):
    t.ldr_lit('r0', tag); t.ldr_lit('r1', 0x03000CF0); t.mov('r2', 0)
    t.label(nome + 'l'); t.ldr_i('r3', 'r1', 0); t.alu('cmp', 'r3', 'r0'); t.bc('eq', nome + 'a')
    t.addi('r1', 4); t.addi('r2', 1); t.cmpi('r2', 16); t.bc('lo', nome + 'l'); t.b(nome)
    t.label(nome + 'a'); t.lsl('r1', 'r2', 4); t.addi('r1', 0x80); t.addi('r1', 0x80)
    t.ldr_lit('r0', pal); t.mov('r2', 0x20); t.ldr_lit('r3', 0x080F196D); t.bl('c3')
    t.label(nome)
t.label('fim')
t.movh('r0', 'r5'); t.ldr_lit('r3', 0x080F43A9); t.bl('c3')
t.pop(['r4', 'r5']); t.pop(['r0']); t.bx('r0')
t.label('c3'); t.bx('r3')
t.pool()
SS_TASK = t.base; n3 += t.build()
SS_SCRIPT = (N1 + len(code_n1) + 3) & ~3     # o script vai no fim da área N1 (sobra espaço lá)
resto = bytearray(ROM[0x08475634 - 0x08000000:0x0847565F - 0x08000000])      # do monbg até o clarão (createvisualtask)
i_cor = resto.index(h16(32754)); resto[i_cor:i_cor + 2] = h16(VERDE_CLARAO)
resto += b'' + p32(0x0847565F)                                          # e volta para o original
ss = ROM[SS_ORIG - 0x08000000:SS_ORIG - 0x08000000 + 12]                     # os 4 loadspritegfx
ss += b'\x03' + p32(SS_TASK | 1) + b'\x05\x00' + b'\x05'                     # tarefa + waitforvisualfinish
ss_verde = SS_SCRIPT + len(ss) + 8 + 5
ss += b'\x21\x07' + h16(1) + p32(ss_verde)                                   # jumpargeq 7, 1, versão verde
ss += b'\x13' + p32(0x08475634)                                              # goto resto original
ss += resto
assert SS_SCRIPT + len(ss) <= N1_FIM, hex(SS_SCRIPT + len(ss))
assert N3 + len(n3) <= N3_FIM, hex(N3 + len(n3))

# ============================ Behemoth Blade (709) em dois turnos, como o Fly ============================
# 1º turno: escurece e ele sobe (sem a espada e sem as pedrinhas), some e fica no ar (STATUS3_ON_AIR: só Thunder,
# Gust, Sky Uppercut... acertam), fala "desapareceu num instante" (a do Phantom Force). 2º turno: escurece, ele
# volta e ataca com os cortes (verdes se for o Sirfetch'd), sem a explosão.
# Tudo no lugar do script de animação antigo do Behemoth Blade (só a tabela de animações apontava para ele).
BB, BB_R0, BB_R1 = 709, 0x08482E98, 0x08483007
for R in ROMS: assert R[BB_R0 - 0x08000000:BB_R1 - 0x08000000] == ROM[BB_R0 - 0x08000000:BB_R1 - 0x08000000]
SEMI_FN, EFEITO_TAB, EF_SEMI = 0x08085D80, 0x084A9994, 0x96
assert ROM[SEMI_FN - 0x08000000:SEMI_FN - 0x08000000 + 8] == bytes.fromhex('10b509490b680948')
rb = bytearray()
def atb(): return BB_R0 + len(rb)
# sprite do mergulho do Fly (0x092095F4) com a paleta preta da subida do Behemoth Blade (tag 0x27AA)
TMPL_DESCE = atb()
_tm = bytearray(ROM[0x092095F4 - 0x08000000:0x092095F4 - 0x08000000 + 24]); assert _tm[0:4] == bytes.fromhex('ac27ac27')
_tm[2:4] = h16(0x27AA); rb += _tm
# setsemiinvulnerablebit: Behemoth Blade -> no ar (os endereços vêm dos literais do próprio jogo: o Coop 3 mudou gStatuses3)
h = Asm(atb())
h.ldr_lit('r0', 0x08085DAC); h.ldr_i('r0', 'r0', 0); h.ldrh_i('r2', 'r0', 0)     # gCurrentMove
h.ldr_lit('r1', BB); h.alu('cmp', 'r2', 'r1'); h.bc('ne', 'orig')
h.ldr_lit('r0', 0x08085DF0); h.ldr_i('r0', 'r0', 0); h.ldrb_i('r1', 'r0', 0); h.lsl('r1', 'r1', 2)   # gBattlerAttacker
h.ldr_lit('r0', 0x08085DEC); h.ldr_i('r0', 'r0', 0); h.add_r('r1', 'r1', 'r0')   # gStatuses3[atacante]
h.ldr_i('r0', 'r1', 0); h.mov('r2', 0x40); h.alu('orr', 'r0', 'r2'); h.str_i('r0', 'r1', 0)   # STATUS3_ON_AIR
h.ldr_lit('r1', 0x08085DA8); h.ldr_i('r1', 'r1', 0); h.ldr_i('r0', 'r1', 0); h.addi('r0', 1); h.str_i('r0', 'r1', 0)
h.bx('lr')
h.label('orig')                                # as 4 instruções trocadas pelo desvio e volta para a função
h.push(['r4'], lr=True)
h.ldr_lit('r1', 0x08085DA8); h.ldr_i('r1', 'r1', 0); h.ldr_i('r3', 'r1', 0)
h.ldr_lit('r0', 0x08085DAC); h.ldr_i('r0', 'r0', 0)
h.ldr_lit('r2', SEMI_FN + 8 + 1); h.bx('r2')
h.pool()
BB_SEMI = h.base; rb += h.build()
while len(rb) % 4: rb.append(0)
# script do efeito 0x96 (dois turnos, fora de alcance): as 2 primeiras checagens + Behemoth Blade -> fala do Phantom Force
EF_VELHO = w32(EFEITO_TAB + 4 * EF_SEMI)
assert EF_VELHO == 0x084AED10 and ROM[0x4AED28:0x4AED2E] == bytes.fromhex('2a00e2310202')   # 3º comando: jumpifhalfword gCurrentMove
BB_EF = atb()
rb += ROM[EF_VELHO - 0x08000000:EF_VELHO - 0x08000000 + 24]                       # jumpifstatus2 / jumpifword (2º turno)
rb += b'\x2a\x00' + p32(0x020231E2) + h16(BB) + p32(0x084AED85)                   # jumpifhalfword ==709 -> fala 8
rb += b'\x28' + p32(EF_VELHO + 24)                                                # goto resto original
assert ROM[0x4AED85:0x4AED8B] == bytes.fromhex('2eff34020208')                    # setbyte sTWOTURN_STRINGID, 8
# animação
def trecho_bb(de, ate): return ROM[de - 0x08000000:ate - 0x08000000]
ESCURECE = trecho_bb(0x08482EA4, 0x08482EBB)   # monbg 00, setalpha, escurece, waitforvisualfinish
CLAREIA = trecho_bb(0x08482FF1, 0x08483003)    # clareia, waitforvisualfinish
assert ESCURECE[0] == 0x0A and CLAREIA[0] == 0x03
BB_T1 = None
t1 = bytearray()
t1 += bytes.fromhex('00ac27') + bytes.fromhex('00aa27')        # subida (sem 0x2873/0x274A das pedrinhas)
t1 += ESCURECE + bytes.fromhex('0b00')       # clearmonbg 00
t1 += trecho_bb(0x08482EF2, 0x08482F19)        # monbg 01, setalpha, som, ele sobe (0x0920C560), tremor, delay 18
t1 += bytes.fromhex('05') + bytes.fromhex('0b01') + bytes.fromhex('0d')   # espera, clearmonbg 01, blendoff
t1 += CLAREIA + b'\x08'
t2 = bytearray()
t2 += bytes.fromhex('00ac27') + bytes.fromhex('00aa27') + bytes.fromhex('009727') + bytes.fromhex('003128')   # mergulho (preto), pancada, cortezinhos
_fly2 = bytearray(ROM[0x08497CB5 - 0x08000000:0x08497CEF - 0x08000000])
_i = _fly2.index(p32(0x092095F4)); _fly2[_i:_i + 4] = p32(TMPL_DESCE)
t2 += _fly2                                    # o 2º turno do Fly (mergulho preto): ele desce do alto no alvo,
assert t2[-17:-13] == bytes.fromhex('19880003')[:0] + t2[-17:-13]   # pancada, tremor forte e som
t2 += b'\x0e' + p32(0x0848309B)                # rajada dos cortezinhos do Behemoth Blade original (8 riscos com som)
t2 += trecho_bb(0x08482F70, 0x08482F81)        # mais um tremor no alvo
t2 += bytes.fromhex('05') + bytes.fromhex('0b03') + bytes.fromhex('0d')   # espera, clearmonbg 03, blendoff
t2 += bytes.fromhex('2c00') + bytes.fromhex('013128')   # visible atacante (garantia), unloadspritegfx
t2 += b'\x08'                                  # fim (sem o corte grande e sem a explosão)
assert ROM[0x08497CB5 - 0x08000000] == 0x0A and ROM[0x08497CEF - 0x08000000] == 0x05
assert ROM[0x0848309B - 0x08000000] == 0x02 and ROM[0x08483123 - 0x08000000] == 0x0F
BB_ANIM = atb()
cab = 1 + 4 + 4 + 1 + 1                        # choosetwoturnanim t1 t2, waitforvisualfinish, end
rb += b'\x11' + p32(BB_ANIM + cab) + p32(BB_ANIM + cab + len(t1)) + b'\x05\x08'
rb += t1 + t2
assert BB_R0 + len(rb) <= BB_R1, (len(rb), BB_R1 - BB_R0)
# dados do golpe: efeito 0x015D -> 0x0096 e marca de dois turnos (byte 15: 0x01 -> 0x81)
BB_DADOS = 0x0853AD34 + 24 * BB
bd = bytearray(ROM[BB_DADOS - 0x08000000:BB_DADOS - 0x08000000 + 16])
assert bd[0:2] == bytes.fromhex('5d01') and bd[15] == 0x01
bd[0:2] = h16(EF_SEMI); bd[15] = 0x81

def orig(addr, n_): return ROM[addr - 0x08000000:addr - 0x08000000 + n_].hex()
saida = {
  'novos': [
    [N1 - 0x08000000, bytes(code_n1).hex(), "Caçador, fim de rodada: desvio (321 -> floresta ataca; o resto segue para o Distúrbio) e dano de 1/16"],
    [N2 - 0x08000000, bytes(n2).hex(), "Caçador, fim de rodada: texto, animação 66 (folhas do Leaf Tornado sem o redemoinho) e script"],
    [SS_SCRIPT - 0x08000000, bytes(ss).hex(), "Sacred Sword: script (tarefa da cor; se for o Sirfetch'd, clarão verde)"],
    [N4 - 0x08000000, bytes(n4).hex(), "Sacred Sword do Sirfetch'd: paletas verdes da espada (0x2851) e do brilho (0x2715)"],
    [N3 - 0x08000000, bytes(n3).hex(), "Sacred Sword do Sirfetch'd com espada verde: paletas, tarefa e script (os outros Pokémon seguem no azul)"],
  ],
  'fix_novos': [
    [S1 - 0x08000000, orig(S1, len(s1)), bytes(s1).hex(), "Caçador (habilidade 321): nome, fuga, entrada, script, animações e textos (no lugar da imagem antiga do Sirfetch'd)"],
    [S2 - 0x08000000, orig(S2, len(code2)), bytes(code2).hex(), "Caçador: floresta com bases de musgo, tarefa e desvio do fundo (no lugar da imagem antiga da Arboliva)"],
    [ESC_FN - 0x08000000, orig(ESC_FN, 8), (struct.pack('<HH', 0x4B00, 0x4718) + p32(ESC_HOOK | 1)).hex(), "IsAbilityPreventingEscape: Caçador do outro lado prende sempre"],
    [0x5505C0, '500000007100', struct.pack('<3H', HAB, HAB, HAB).hex(), "Sirfetch'd: Caçador nas 3 vagas"],
    [ARB_PAL_VELHA - 0x08000000, orig(ARB_PAL_VELHA, 40), ARB_PAL_NOVA.hex(), "Arboliva: paleta nova no lugar da antiga (era 0x09FFF700)"],
    [0x46AB1C + 4 * SS_MOVE, orig(0x0846AB1C + 4 * SS_MOVE, 4), p32(SS_SCRIPT).hex(), "animação do Sacred Sword -> script com a espada verde do Sirfetch'd"],
    [BB_R0 - 0x08000000, orig(BB_R0, len(rb)), bytes(rb).hex(), "Behemoth Blade em 2 turnos (no lugar da animação antiga): desvio do 'no ar', script do efeito e animação nova"],
    [0x46AB1C + 4 * BB, orig(0x0846AB1C + 4 * BB, 4), p32(BB_ANIM).hex(), "animação do Behemoth Blade -> a nova de dois turnos"],
    [SEMI_FN - 0x08000000, orig(SEMI_FN, 8), (struct.pack('<HH', 0x4B00, 0x4718) + p32(BB_SEMI | 1)).hex(), "setsemiinvulnerablebit: Behemoth Blade fica no ar"],
    [EFEITO_TAB + 4 * EF_SEMI - 0x08000000, orig(EFEITO_TAB + 4 * EF_SEMI, 4), p32(BB_EF).hex(), "efeito 'dois turnos fora de alcance' -> script que aceita o Behemoth Blade"],
    [BB_DADOS - 0x08000000, orig(BB_DADOS, 16), bytes(bd).hex(), "Behemoth Blade: efeito do Fly (dois turnos) e marca de dois turnos"],
  ],
  'fix_trocas': {   # endereço -> novo valor
    '0x52600': '3f010000',
    '0xA5628': (struct.pack('<HH', 0x4900, 0x4708) + p32(NOME_HOOK | 1)).hex(),
    '0x3C06C': (struct.pack('<HH', 0x4B00, 0x4718) + p32(a.labels['entra'] | 1)).hex(),
    '0x53E52': (struct.pack('<HHH', 0x4801, 0x4700, 0x46C0) + p32(TRAMP | 1)).hex(),
  },
  'fix_remover': ['0x4E5D2C'],
  'novo_remover': ['0x1FFF700'],
  'tabelas': {   # destino -> (novo total, valores a acrescentar no fim)
    '0x1FFE400': [320, [CASE]],
    '0x1FFEA00': [322, [T_CURTA]],
    '0x1FFF000': [322, [T_LONGA]],
    '0x1FFF600': [67, [ANIM_FLORESTA, ANIM_PRESA, ANIM_FOLHAS]],
    '0x1FEB200': [747, [T_MSG, T_MSG2]],
  },
}
json.dump(saida, open(os.path.join(AQUI, 'entradas.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('S1 usados', len(s1), 'de', S1_N, '| S2 usados', len(code2), 'de', S2_N)
print('nome', hex(NOME_HOOK), 'fuga', hex(ESC_HOOK), 'cria', hex(CRIA), 'script', hex(SCRIPT), 'caso', hex(CASE))
print('anim floresta', hex(ANIM_FLORESTA), 'presa', hex(ANIM_PRESA), 'entra', hex(a.labels['entra']), 'tarefa', hex(L_TAREFA), 'desenha', hex(a.labels['desenha']))
