# Protetor Glacial (golpe 681, no lugar do Buzzy Buzz que ninguém aprende): escudo de gelo do Cubchoo.
# Roda dentro do build.py (mesmas funções put, Asm, enc, p32...). Regras em hack-fonte/nuvem/protetor/LEIA-ME.md.
#
# Estado na EWRAM livre (0x0203FF80+, igual nas duas ROMs), 16 bytes por batalhador (6 lugares do Coop 3):
#   +0 fase (0 nada, 1 placa, 2 coroa)  +1 rodadas  +2 quem usou  +3 sprite+1  +4 personalidade de quem tem o escudo
#   +8 personalidade de quem usou       +12 rodadas até poder usar de novo     +13 fase desenhada  +14 mosaico  +15 sumiço
# A personalidade confere se ainda é o mesmo Pokémon: quem sai de campo perde o escudo sem precisar de outro gancho.
ID_PG = 681
EF_PG = 14                                   # efeito sem nenhum golpe (o 204 tem regra de golpe condicional: vira Struggle)
PG_FOGO_T, PG_GELO_T, PG_AGUA_T = 0x0A, 0x0F, 0x0B
PG_BASE, PG_G = 0x0203FF80, 0x0203FFE0       # globais: +0 já contou a rodada, +1 fogo pendente (alvo+1), +2 viu o tracker
                                             # andar, +4 retorno do fim de turno
PG_DONE, PG_FOGO, PG_VIU, PG_QUEBRA, PG_RET = 0, 1, 2, 3, 4    # +3 quebrar ao fim da animação do golpe (alvo+1)
INSTR, ATK, ALVO, CURMOVE, DMG, NBAT = 0x0202320C, 0x02023204, 0x02023205, 0x020231E2, 0x020231E8, 0x02023044
MOVES, BS, RESULT = 0x0853AD34, 0x0202352C, 0x02023272
MONS_LIT, STATUS3_LIT, SPRIDS_LIT = 0x0806DBC8, 0x08042A54, 0x08037CE8    # literais do jogo: o Coop 3 moveu essas tabelas
GSPRITES = 0x02020630
CREATESPRITE, DESTROYSPRITE, LOADSHEET, LOADPAL_S, TILESTART = 0x08007575, 0x08007A61, 0x08009425, 0x08009645, 0x08009519
FREETILES = 0x08009495
PUSHSCR, EXECSCR = 0x0804C231, 0x08058CC5
CMD_TAB = 0x08538F54
CMD_ACC, CMD_ADJ, CMD_HAZE, CMD_PERISH = 0x0806D455, 0x0806DFC9, 0x08082021, 0x08084E19
CMD_WAIT = w32(CMD_TAB + 4 * 0x0A)           # waitanimation
FIMTURNO = 0x0804D31C
PG_MOVEEND = 0x084ACFBC
PG_CODE, PG_DADOS, PG_GFX = 0x09FFA400, 0x09FFAF00, 0x09FFB000
PG_ESCR = 0x09FEF100
TAG_PLACA, TAG_COROA, TAG_COROAI, TAG_PLACAI, TAG_PG_PAL = 0x7A10, 0x7A11, 0x7A12, 0x7A13, 0x7A10
MOSAICO_Q = 32                               # quadros do efeito de transformação (como o do Castform)

_dir = os.path.join(os.path.dirname(__file__), 'protetor')
_gfx = open(os.path.join(_dir, 'escudos.bin'), 'rb').read()
_pal = open(os.path.join(_dir, 'escudos.pal'), 'rb').read()
assert len(_gfx) == 0x1400

# --- scripts de batalha
_id = lambda n: struct.pack('<H', n)
ID_ENVOLVE, ID_CRESCEU, ID_BLOQUEOU, ID_DERRETEU, ID_DESFEZ = 747, 748, 749, 750, 751
_fim = b'\x28' + p32(PG_MOVEEND)
_esp = bytes.fromhex('124000')               # waitmessage
_falou = lambda i: b'\x10' + _id(i) + _esp
_ini = bytes.fromhex('0203392000')           # attackstring, ppreduce, pause 32
_esc = {}
def escr(nome, dados):
    global _pgat
    _esc[nome] = _pgat
    put(_pgat, dados)
    _pgat += (len(dados) + 3) & ~3
_pgat = PG_ESCR
escr('bloq', _ini + _falou(ID_BLOQUEOU) + _fim)
escr('cresce', _ini + _falou(ID_CRESCEU) + _fim)
_esc['derrete'] = _pgat; _pgat += 0x20             # preenchido no fim: precisa do endereço de 'quebra'
escr('falha', _ini + _falou(229) + _fim)                        # "Mas isso falhou!"
escr('quebra_ret', bytes.fromhex('392000') + _falou(ID_DERRETEU) + b'\x3c')   # fase 1 + fogo com dano: volta ao golpe
escr('cresce_ret', bytes.fromhex('392000') + _falou(ID_CRESCEU) + b'\x3c')    # Haze: cresce e volta ao golpe
escr('fim', bytes.fromhex('392000') + _falou(ID_DESFEZ) + b'\x3e')            # acabaram as rodadas

# --- código
a = Asm(PG_CODE)
def mv(a, d, s): a.h(0x1C00 | s << 3 | d)    # rd = rs (registradores baixos)

# DrawMainBattleBackground acabou: na montagem da batalha limpa tudo; na volta de um menu (tarefas e sprites apagados)
# recria a tarefa e os sprites, sem repetir o efeito de transformação
a.push(['r4', 'r5'], lr=True)
a.ldr_lit('r0', 0x03002664); a.ldr_i('r0', 'r0', 0)
for cb in (0x0803DED9, 0x0803D24D, 0x080499BD):
    a.ldr_lit('r1', cb); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'd_limpa')
a.bl('t_acha'); a.cmpi('r0', 0); a.bc('ne', 'd_fim')
a.ldr_lit('r4', PG_BASE); a.mov('r5', 0); a.mov('r3', 0)
a.label('d_laco')
a.ldrb_i('r0', 'r4', 0); a.cmpi('r0', 0); a.bc('eq', 'd_prox')
a.addi('r3', 1); a.strb_i('r0', 'r4', 13)
a.label('d_prox')
a.mov('r0', 0); a.strb_i('r0', 'r4', 3); a.strb_i('r0', 'r4', 14); a.strb_i('r0', 'r4', 15)
a.addi('r4', 16); a.addi('r5', 1); a.cmpi('r5', 6); a.bc('lo', 'd_laco')
a.cmpi('r3', 0); a.bc('eq', 'd_fim')
a.bl('t_cria'); a.b('d_fim')
a.label('d_limpa')
a.ldr_lit('r1', PG_BASE); a.mov('r0', 0); a.mov('r2', 0)
a.label('d_l2'); a.strb_r('r0', 'r1', 'r2'); a.addi('r2', 1); a.cmpi('r2', 0x68); a.bc('lo', 'd_l2')
a.label('d_fim')
a.pop(['r4', 'r5']); a.pop(['r0']); a.bx('r0')
a.label('c3'); a.bx('r3')

a.label('ent')                               # r0 = batalhador -> r0 = entrada
a.lsl('r0', 'r0', 4); a.ldr_lit('r1', PG_BASE); a.add_r('r0', 'r0', 'r1'); a.bx('lr')
a.label('mon')                               # r0 = batalhador -> r0 = &gBattleMons[b]
a.mov('r1', 0x60); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r1', MONS_LIT); a.ldr_i('r1', 'r1', 0); a.add_r('r0', 'r0', 'r1'); a.bx('lr')
a.label('lado')                              # r0 = batalhador -> 0 jogador, 1 oponente
a.ldr_lit('r1', POS_LIT); a.ldr_i('r1', 'r1', 0); a.ldrb_r('r0', 'r1', 'r0'); a.mov('r1', 1); a.alu('and_', 'r0', 'r1'); a.bx('lr')
a.label('dados')                             # r0 = &gBattleMoves[golpe atual]
a.ldr_lit('r0', CURMOVE); a.ldrh_i('r0', 'r0', 0); a.mov('r1', 24); a.alu('mul', 'r0', 'r1')
a.ldr_lit('r1', MOVES); a.add_r('r0', 'r0', 'r1'); a.bx('lr')
a.label('forca')                             # r0 = poder do golpe atual
a.push([], lr=True); a.bl('dados'); a.ldrb_i('r0', 'r0', 2); a.pop(['r1']); a.bx('r1')
a.label('tipo')                              # r0 = tipo do golpe atual (o dinâmico, de Weather Ball e afins, vem antes)
a.push([], lr=True)
a.ldr_lit('r0', BS); a.ldr_i('r0', 'r0', 0); a.addi('r0', 0x27); a.ldrb_i('r0', 'r0', 0)
a.mov('r1', 0x3F); a.alu('and_', 'r0', 'r1'); a.bc('ne', 'ti_f')
a.bl('dados'); a.ldrb_i('r0', 'r0', 3)
a.label('ti_f'); a.pop(['r1']); a.bx('r1')
a.label('ativo')                             # r0 = batalhador -> r0 = entrada se o escudo vale, senão 0
a.push(['r4', 'r5'], lr=True)
mv(a, 5, 0); a.bl('ent'); mv(a, 4, 0)
a.ldrb_i('r0', 'r4', 0); a.cmpi('r0', 0); a.bc('eq', 'a_nao')
mv(a, 0, 5); a.bl('mon'); a.ldrh_i('r1', 'r0', 0x2A); a.cmpi('r1', 0); a.bc('eq', 'a_nao')
a.ldr_i('r1', 'r0', 0x48); a.ldr_i('r2', 'r4', 4); a.alu('cmp', 'r1', 'r2'); a.bc('ne', 'a_nao')
mv(a, 0, 4); a.b('a_fim')
a.label('a_nao'); a.mov('r0', 0)
a.label('a_fim'); a.pop(['r4', 'r5']); a.pop(['r1']); a.bx('r1')
a.label('acaba')                             # r0 = entrada: tira o escudo e libera quem usou
a.mov('r1', 0); a.strb_i('r1', 'r0', 0)
a.ldrb_i('r0', 'r0', 2); a.lsl('r0', 'r0', 4); a.ldr_lit('r2', PG_BASE); a.add_r('r0', 'r0', 'r2'); a.strb_i('r1', 'r0', 12)
a.bx('lr')
a.label('salta')                             # r0 = script: o golpe termina nele, marcado como sem efeito
a.ldr_lit('r1', INSTR); a.str_i('r0', 'r1', 0)
a.ldr_lit('r1', RESULT); a.ldrh_i('r2', 'r1', 0); a.mov('r3', 1); a.alu('orr', 'r2', 'r3'); a.strh_i('r2', 'r1', 0)
a.bx('lr')
a.pool()

# comando 1 (accuracycheck): é aqui que o golpe decide se pega no alvo
a.label('acc')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r0', PG_G); a.mov('r1', 0); a.strb_i('r1', 'r0', PG_FOGO); a.strb_i('r1', 'r0', PG_QUEBRA)
a.ldr_lit('r5', ALVO); a.ldrb_i('r5', 'r5', 0); a.ldr_lit('r6', ATK); a.ldrb_i('r6', 'r6', 0)
a.alu('cmp', 'r5', 'r6'); a.bc('eq', 'acc_orig')
mv(a, 0, 5); a.bl('ativo'); a.cmpi('r0', 0); a.bc('eq', 'acc_orig'); mv(a, 4, 0)
mv(a, 0, 5); a.bl('lado'); mv(a, 7, 0); mv(a, 0, 6); a.bl('lado'); a.alu('cmp', 'r0', 'r7'); a.bc('ne', 'acc_ini')
a.bl('forca'); a.cmpi('r0', 0); a.bc('eq', 'acc_orig')           # golpe de status do parceiro passa (cura etc.)
a.label('acc_ini')
a.bl('tipo')
a.cmpi('r0', PG_FOGO_T); a.bc('eq', 'acc_fogo')
a.cmpi('r0', PG_GELO_T); a.bc('eq', 'acc_cresce')
a.cmpi('r0', PG_AGUA_T); a.bc('eq', 'acc_cresce')
a.label('acc_bloq')
a.ldr_lit('r0', _esc['bloq']); a.bl('salta'); a.b('acc_fim')
a.label('acc_cresce')
a.ldrb_i('r0', 'r4', 0); a.cmpi('r0', 1); a.bc('ne', 'acc_bloq')  # a coroa não cresce de novo
a.mov('r0', 2); a.strb_i('r0', 'r4', 0); a.mov('r0', 5); a.strb_i('r0', 'r4', 1)
a.ldr_lit('r0', _esc['cresce']); a.bl('salta'); a.b('acc_fim')
a.label('acc_fogo')
a.ldrb_i('r0', 'r4', 0); a.cmpi('r0', 1); a.bc('ne', 'acc_quebra')
a.bl('forca'); a.cmpi('r0', 0); a.bc('eq', 'acc_quebra')
a.ldr_lit('r0', PG_G); a.addi('r5', 1); a.strb_i('r5', 'r0', PG_FOGO)   # fase 1 com dano: segue, adjustdamage faz 10%
a.b('acc_orig')
a.label('acc_quebra')
a.ldr_lit('r0', _esc['derrete']); a.ldr_lit('r1', INSTR); a.str_i('r0', 'r1', 0); a.b('acc_fim')
a.label('acc_orig')
a.ldr_lit('r3', CMD_ACC); a.bl('c3')
a.label('acc_fim')
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()

# comando 7 (adjustdamage): fogo na fase 1 = 10% do golpe; o escudo quebra quando a animação do golpe acabar
a.label('adj')
a.push(['r4'], lr=True)
a.ldr_lit('r3', CMD_ADJ); a.bl('c3')
a.ldr_lit('r4', PG_G); a.ldrb_i('r0', 'r4', PG_FOGO); a.cmpi('r0', 0); a.bc('eq', 'adj_fim')
a.mov('r1', 0); a.strb_i('r1', 'r4', PG_FOGO); a.strb_i('r0', 'r4', PG_QUEBRA)
a.ldr_lit('r4', DMG); a.ldr_i('r0', 'r4', 0); a.cmpi('r0', 0); a.bc('le', 'adj_fim')
a.mov('r1', 10); swi_div(a); a.cmpi('r0', 0); a.bc('ne', 'adj_ok'); a.mov('r0', 1)
a.label('adj_ok'); a.str_i('r0', 'r4', 0)
a.label('adj_fim')
a.pop(['r4']); a.pop(['r0']); a.bx('r0')
a.pool()

# comando 0x0A (waitanimation): acabou a animação do golpe de fogo, agora o escudo quebra e só depois vem a perda de vida
a.label('espera')
a.push(['r4', 'r5'], lr=True)
a.ldr_lit('r4', INSTR); a.ldr_i('r5', 'r4', 0)
a.ldr_lit('r3', CMD_WAIT); a.bl('c3')
a.ldr_i('r0', 'r4', 0); a.alu('cmp', 'r0', 'r5'); a.bc('eq', 'es_fim')    # ainda esperando
a.ldr_lit('r3', PG_G); a.ldrb_i('r0', 'r3', PG_QUEBRA); a.cmpi('r0', 0); a.bc('eq', 'es_fim')
a.mov('r1', 0); a.strb_i('r1', 'r3', PG_QUEBRA); a.subi('r0', 1)
a.bl('ativo'); a.cmpi('r0', 0); a.bc('eq', 'es_fim'); a.bl('acaba')
a.ldr_i('r0', 'r4', 0); a.ldr_lit('r3', PUSHSCR); a.bl('c3')
a.ldr_lit('r0', _esc['quebra_ret']); a.str_i('r0', 'r4', 0)
a.label('es_fim')
a.pop(['r4', 'r5']); a.pop(['r0']); a.bx('r0')
a.pool()

# callnative do script 'derrete': depois da animação do golpe, escudo quebra e o golpe fica sem efeito
a.label('quebra')
a.push([], lr=True)
a.ldr_lit('r0', ALVO); a.ldrb_i('r0', 'r0', 0); a.bl('ativo'); a.cmpi('r0', 0); a.bc('eq', 'qb_m'); a.bl('acaba')
a.label('qb_m')
a.ldr_lit('r1', RESULT); a.ldrh_i('r2', 'r1', 0); a.mov('r3', 1); a.alu('orr', 'r2', 'r3'); a.strh_i('r2', 'r1', 0)
a.ldr_lit('r1', INSTR); a.ldr_i('r0', 'r1', 0); a.addi('r0', 5); a.str_i('r0', 'r1', 0)
a.pop(['r0']); a.bx('r0')
a.pool()

# comando 0x8A (normalisebuffs = Haze): toda placa em campo vira coroa e o Haze continua
a.label('haze')
a.push(['r4', 'r5', 'r6'], lr=True)
a.mov('r5', 0); a.mov('r6', 0)
a.label('h_laco')
mv(a, 0, 5); a.bl('ativo'); a.cmpi('r0', 0); a.bc('eq', 'h_prox')
a.ldrb_i('r1', 'r0', 0); a.cmpi('r1', 1); a.bc('ne', 'h_prox')
a.mov('r1', 2); a.strb_i('r1', 'r0', 0); a.mov('r1', 5); a.strb_i('r1', 'r0', 1); a.mov('r6', 1)
a.label('h_prox')
a.addi('r5', 1); a.ldr_lit('r0', NBAT); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r5', 'r0'); a.bc('lo', 'h_laco')
a.cmpi('r6', 0); a.bc('eq', 'h_orig')
a.ldr_lit('r4', INSTR); a.ldr_i('r0', 'r4', 0); a.ldr_lit('r3', PUSHSCR); a.bl('c3')
a.ldr_lit('r0', _esc['cresce_ret']); a.str_i('r0', 'r4', 0); a.b('h_fim')
a.label('h_orig'); a.ldr_lit('r3', CMD_HAZE); a.bl('c3')
a.label('h_fim'); a.pop(['r4', 'r5', 'r6']); a.pop(['r0']); a.bx('r0')
a.pool()

# comando 0xB2 (trysetperishsong): para o jogo quem tem escudo "já tem" Perish Song, aí ele pula; depois devolve
a.label('perish')
a.push(['r4', 'r5', 'r6'], lr=True)
a.mov('r5', 0); a.mov('r6', 0)
a.ldr_lit('r4', STATUS3_LIT); a.ldr_i('r4', 'r4', 0)
a.label('p_laco')
mv(a, 0, 5); a.bl('ativo'); a.cmpi('r0', 0); a.bc('eq', 'p_prox')
a.lsl('r0', 'r5', 2)
a.h(0x5800 | 0 << 6 | 4 << 3 | 1)            # ldr r1, [r4, r0]
a.mov('r2', 0x20); a.alu('tst', 'r1', 'r2'); a.bc('ne', 'p_prox')
a.alu('orr', 'r1', 'r2'); a.h(0x5000 | 0 << 6 | 4 << 3 | 1)     # str r1, [r4, r0]
a.mov('r2', 1); a.h(0x4080 | 5 << 3 | 2); a.alu('orr', 'r6', 'r2')  # lsl r2, r5
a.label('p_prox')
a.addi('r5', 1); a.ldr_lit('r0', NBAT); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r5', 'r0'); a.bc('lo', 'p_laco')
a.ldr_lit('r3', CMD_PERISH); a.bl('c3')
a.mov('r5', 0)
a.label('p_tira')
a.mov('r2', 1); a.h(0x4080 | 5 << 3 | 2); a.alu('tst', 'r6', 'r2'); a.bc('eq', 'p_t2')
a.lsl('r0', 'r5', 2); a.h(0x5800 | 0 << 6 | 4 << 3 | 1); a.mov('r2', 0x20); a.alu('bic', 'r1', 'r2'); a.h(0x5000 | 0 << 6 | 4 << 3 | 1)
a.label('p_t2'); a.addi('r5', 1); a.cmpi('r5', 6); a.bc('lo', 'p_tira')
a.pop(['r4', 'r5', 'r6']); a.pop(['r0']); a.bx('r0')
a.pool()

# callnative do golpe: pode usar? (antes da animação; se não pode, "Mas isso falhou!")
a.label('pode_usar')
a.push(['r4'], lr=True)
a.ldr_lit('r0', ATK); a.ldrb_i('r0', 'r0', 0); mv(a, 4, 0); a.bl('ent'); a.ldrb_i('r1', 'r0', 12); a.cmpi('r1', 0); a.bc('eq', 'u_livre')
a.ldr_i('r2', 'r0', 8); mv(a, 0, 4); a.push(['r2']); a.bl('mon'); a.pop(['r2']); a.ldr_i('r1', 'r0', 0x48); a.alu('cmp', 'r1', 'r2'); a.bc('eq', 'u_nao')
a.label('u_livre')
a.ldr_lit('r0', ALVO); a.ldrb_i('r0', 'r0', 0); a.bl('ativo'); a.cmpi('r0', 0); a.bc('ne', 'u_nao')
a.ldr_lit('r1', INSTR); a.ldr_i('r0', 'r1', 0); a.addi('r0', 5); a.str_i('r0', 'r1', 0); a.b('u_fim')
a.label('u_nao')
a.ldr_lit('r0', _esc['falha'] + 5); a.ldr_lit('r1', INSTR); a.str_i('r0', 'r1', 0)     # o nome do golpe já saiu
a.label('u_fim'); a.pop(['r4']); a.pop(['r0']); a.bx('r0')
a.pool()

# callnative do golpe: cria o escudo (depois da animação)
a.label('usa')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r5', ALVO); a.ldrb_i('r5', 'r5', 0); a.ldr_lit('r6', ATK); a.ldrb_i('r6', 'r6', 0)
mv(a, 0, 5); a.bl('ent'); mv(a, 4, 0)
a.mov('r0', 1); a.strb_i('r0', 'r4', 0); a.mov('r0', 3); a.strb_i('r0', 'r4', 1); a.strb_i('r6', 'r4', 2)
a.mov('r0', 0); a.strb_i('r0', 'r4', 15)
mv(a, 0, 5); a.bl('mon'); a.ldr_i('r0', 'r0', 0x48); a.str_i('r0', 'r4', 4)
mv(a, 0, 6); a.bl('ent'); mv(a, 7, 0); a.mov('r0', 2); a.strb_i('r0', 'r7', 12)
mv(a, 0, 6); a.bl('mon'); a.ldr_i('r0', 'r0', 0x48); a.str_i('r0', 'r7', 8)
a.bl('t_acha'); a.cmpi('r0', 0); a.bc('ne', 'us_ok'); a.bl('t_cria')
a.label('us_ok')
a.ldr_lit('r1', INSTR); a.ldr_i('r0', 'r1', 0); a.addi('r0', 5); a.str_i('r0', 'r1', 0)
a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.pool()

# fim de turno: entrada de DoFieldEndTurnEffects (primeiras 4 instruções refeitas aqui)
a.label('fim_entra')
a.ldr_lit('r3', PG_G); a.movh('r0', 'lr'); a.str_i('r0', 'r3', PG_RET)
a.bl('fim_conta'); a.cmpi('r0', 0); a.bc('eq', 'fim_segue')
a.mov('r0', 1); a.ldr_lit('r3', PG_G); a.ldr_i('r3', 'r3', PG_RET); a.bx('r3')
a.label('fim_segue')
a.ldr_lit('r3', 0); a_fix_depois = len(a.lits) - 1                # = fim_depois | 1, preenchido no fim
a.h(0x469E)                                  # mov lr, r3
a.h(0xB5F0); a.h(0x4657); a.h(0x464E); a.h(0x4645)
a.ldr_lit('r3', FIMTURNO + 9); a.bx('r3')
a.label('fim_depois')
a.lits[a_fix_depois] = (a.lits[a_fix_depois][0], a.labels['fim_depois'] | 1)
a.ldr_lit('r1', BS); a.ldr_i('r1', 'r1', 0); a.ldrb_i('r1', 'r1', 2)
a.ldr_lit('r2', PG_G); a.cmpi('r1', 0); a.bc('eq', 'fd_v'); a.mov('r1', 1); a.strb_i('r1', 'r2', PG_VIU)
a.label('fd_v'); a.ldr_i('r3', 'r2', PG_RET); a.bx('r3')
a.label('fim_conta')                         # 1 = rodou um script nosso; 0 = segue o jogo
a.push(['r4', 'r5', 'r6'], lr=True)
a.ldr_lit('r4', PG_G)
a.ldr_lit('r0', BS); a.ldr_i('r0', 'r0', 0); a.ldrb_i('r0', 'r0', 2); a.cmpi('r0', 0); a.bc('ne', 'fc_nao')
a.ldrb_i('r0', 'r4', PG_VIU); a.cmpi('r0', 0); a.bc('eq', 'fc_d')    # rodada nova: o tracker voltou a zero
a.mov('r0', 0); a.strb_i('r0', 'r4', PG_VIU); a.strb_i('r0', 'r4', PG_DONE)
a.label('fc_d')
a.ldrb_i('r0', 'r4', PG_DONE); a.cmpi('r0', 0); a.bc('ne', 'fc_nao')
a.mov('r0', 1); a.strb_i('r0', 'r4', PG_DONE)
a.mov('r5', 0); a.mov('r6', 0)
a.label('fc_laco')
mv(a, 0, 5); a.bl('ent'); mv(a, 4, 0)
a.ldrb_i('r1', 'r4', 12); a.cmpi('r1', 0); a.bc('eq', 'fc_e'); a.subi('r1', 1); a.strb_i('r1', 'r4', 12)
a.label('fc_e')
a.ldrb_i('r1', 'r4', 0); a.cmpi('r1', 0); a.bc('eq', 'fc_prox')
mv(a, 0, 5); a.bl('ativo'); a.cmpi('r0', 0); a.bc('ne', 'fc_vale')
mv(a, 0, 4); a.bl('acaba'); a.b('fc_prox')                        # saiu de campo ou desmaiou
a.label('fc_vale')
a.ldrb_i('r1', 'r4', 1); a.subi('r1', 1); a.strb_i('r1', 'r4', 1); a.cmpi('r1', 0); a.bc('ne', 'fc_prox')
mv(a, 0, 4); a.bl('acaba'); a.mov('r6', 1)
a.label('fc_prox')
a.addi('r5', 1); a.cmpi('r5', 6); a.bc('lo', 'fc_laco')
a.cmpi('r6', 0); a.bc('eq', 'fc_nao')
a.ldr_lit('r0', _esc['fim']); a.ldr_lit('r3', EXECSCR); a.bl('c3')
a.mov('r0', 1); a.b('fc_fim')
a.label('fc_nao'); a.mov('r0', 0)
a.label('fc_fim'); a.pop(['r4', 'r5', 'r6']); a.pop(['r1']); a.bx('r1')
a.pool()

# t_acha / t_cria: a tarefa fica em endereço fixo (PG_TAREFA), montada à parte
PG_TAREFA = 0x09FFAA00
a.label('t_acha')                            # r0 = 1 se a tarefa existe
a.ldr_lit('r1', GTASKS); a.mov('r2', 0); a.ldr_lit('r3', PG_TAREFA | 1)
a.label('ta_l')
a.ldrb_i('r0', 'r1', 4); a.cmpi('r0', 0); a.bc('eq', 'ta_p')
a.ldr_i('r0', 'r1', 0); a.alu('cmp', 'r0', 'r3'); a.bc('eq', 'ta_s')
a.label('ta_p'); a.addi('r1', 40); a.addi('r2', 1); a.cmpi('r2', 16); a.bc('lo', 'ta_l')
a.mov('r0', 0); a.bx('lr')
a.label('ta_s'); a.mov('r0', 1); a.bx('lr')
a.label('t_cria')
a.push([], lr=True)
a.ldr_lit('r0', PG_TAREFA | 1); a.mov('r1', 4); a.ldr_lit('r3', CREATETASK | 1); a.bl('c3')
a.pop(['r0']); a.bx('r0')
a.pool()
assert a.here() <= PG_TAREFA, hex(a.here())
put(PG_CODE, a.build())
L = a.labels

# tarefa: sprites dos escudos (cria, segue o Pokémon, mosaico ao transformar, some como o Substitute)
t = Asm(PG_TAREFA)
t.push(['r4', 'r5', 'r6', 'r7'], lr=True)
mv(t, 7, 0); t.mov('r5', 0); t.mov('r6', 0)
t.label('laco')
mv(t, 0, 5); t.bl(L['ent']); mv(t, 4, 0)
mv(t, 0, 5); t.bl(L['ativo']); t.cmpi('r0', 0); t.bc('ne', 'vivo')
t.ldrb_i('r0', 'r4', 3); t.cmpi('r0', 0); t.bc('eq', 'prox')
t.addi('r6', 1)                              # acabou o escudo: some aos poucos
t.subi('r0', 1); t.bl('spr'); mv(t, 2, 0)
t.ldrb_i('r1', 'r4', 15); t.cmpi('r1', 0); t.bc('ne', 'some')
t.ldrh_i('r0', 'r2', 0); t.ldr_lit('r3', 0x0C00); t.alu('bic', 'r0', 'r3'); t.ldr_lit('r3', 0x0400); t.alu('orr', 'r0', 'r3'); t.strh_i('r0', 'r2', 0)
t.ldr_lit('r0', 0x3F40); t.ldr_lit('r3', 0x04000050); t.strh_i('r0', 'r3', 0)
t.mov('r1', 17)
t.label('some')
t.subi('r1', 1); t.strb_i('r1', 'r4', 15)
t.mov('r0', 16); t.h(0x1A40); t.lsl('r0', 'r0', 8); t.alu('orr', 'r0', 'r1')   # r0 = (16 - r1) << 8 | r1
t.ldr_lit('r3', 0x04000052); t.strh_i('r0', 'r3', 0)
t.cmpi('r1', 0); t.bc('ne', 'prox')
t.ldr_lit('r0', 0x04000050); t.mov('r3', 0); t.strh_i('r3', 'r0', 0); t.ldr_lit('r0', 0x04000052); t.strh_i('r3', 'r0', 0)
mv(t, 0, 2); t.ldr_lit('r3', DESTROYSPRITE); t.bl('c3')
t.mov('r0', 0); t.strb_i('r0', 'r4', 3); t.strb_i('r0', 'r4', 13); t.b('prox')
t.label('vivo')
t.addi('r6', 1)
t.ldrb_i('r0', 'r4', 3); t.cmpi('r0', 0); t.bc('eq', 'novo')
t.ldrb_i('r1', 'r4', 13); t.ldrb_i('r2', 'r4', 0); t.alu('cmp', 'r1', 'r2'); t.bc('eq', 'pos')
t.subi('r0', 1); t.bl('spr'); t.ldr_lit('r3', DESTROYSPRITE); t.bl('c3')        # a fase mudou: troca a imagem
t.mov('r0', 0); t.strb_i('r0', 'r4', 3)
t.label('novo')
t.ldrb_i('r1', 'r4', 13); t.ldrb_i('r2', 'r4', 0); t.alu('cmp', 'r1', 'r2'); t.bc('eq', 'sem')
t.mov('r0', MOSAICO_Q); t.strb_i('r0', 'r4', 14)
t.label('sem')
t.strb_i('r2', 'r4', 13)
t.bl('indice'); t.bl('cria'); t.strb_i('r0', 'r4', 3)
t.cmpi('r0', 0); t.bc('eq', 'prox')
t.label('pos')
t.bl('segue')
t.label('prox')
t.addi('r5', 1); t.cmpi('r5', 6); t.bc('hs', 'fora'); t.b('laco')
t.label('fora')
t.cmpi('r6', 0); t.bc('ne', 'fim')
for tag in (TAG_PLACA, TAG_PLACAI, TAG_COROA, TAG_COROAI):
    t.ldr_lit('r0', tag); t.ldr_lit('r3', FREETILES); t.bl('c3')
mv(t, 0, 7); t.ldr_lit('r3', DESTROYTASK | 1); t.bl('c3')
t.label('fim')
t.pop(['r4', 'r5', 'r6', 'r7']); t.pop(['r0']); t.bx('r0')
t.label('c3'); t.bx('r3')
t.label('c4'); t.bx('r4')
t.pool()

t.label('spr')                               # r0 = id -> r0 = &gSprites[id]
t.mov('r1', 68); t.alu('mul', 'r0', 'r1'); t.ldr_lit('r1', GSPRITES); t.add_r('r0', 'r0', 'r1'); t.bx('lr')
t.label('indice')                            # r0 = lado + 2 * (fase - 1): 0 placa jogador, 1 placa oponente, 2 e 3 coroa
t.push([], lr=True)
mv(t, 0, 5); t.bl(L['lado']); t.ldrb_i('r1', 'r4', 0); t.subi('r1', 1); t.lsl('r1', 'r1', 1); t.add_r('r0', 'r0', 'r1')
t.pop(['r1']); t.bx('r1')

t.label('cria')                              # r0 = índice -> r0 = id + 1 (0 se não deu)
t.push(['r4', 'r5'], lr=True)
mv(t, 4, 0)
t.lsl('r0', 'r4', 3); t.ldr_lit('r1', PG_DADOS); t.add_r('r0', 'r0', 'r1'); mv(t, 5, 0)   # r5 = {imagem, tamanho, tag}
t.ldrh_i('r0', 'r5', 6); t.ldr_lit('r3', TILESTART); t.bl('c3')
t.ldr_lit('r1', 0xFFFF); t.alu('cmp', 'r0', 'r1'); t.bc('ne', 'c_tem')
mv(t, 0, 5); t.ldr_lit('r3', LOADSHEET); t.bl('c3')
t.label('c_tem')
t.ldr_lit('r0', PG_DADOS + 0x20); t.ldr_lit('r3', LOADPAL_S); t.bl('c3')
t.mov('r0', 24); t.alu('mul', 'r0', 'r4'); t.ldr_lit('r1', PG_DADOS + 0x28); t.add_r('r0', 'r0', 'r1')
t.ldr_lit('r3', PG_DADOS + 0x90); t.ldrb_r('r3', 'r3', 'r4')
t.mov('r1', 0); t.mov('r2', 0)
t.ldr_lit('r4', CREATESPRITE); t.bl('c4')
t.cmpi('r0', 64); t.bc('lo', 'c_ok'); t.mov('r0', 0); t.b('c_fim')
t.label('c_ok'); t.addi('r0', 1)
t.label('c_fim'); t.pop(['r4', 'r5']); t.pop(['r1']); t.bx('r1')

t.label('segue')                             # r4 = entrada, r5 = batalhador: posição, invisibilidade e mosaico
t.push(['r6', 'r7'], lr=True)
t.ldrb_i('r0', 'r4', 3); t.subi('r0', 1); t.bl('spr'); mv(t, 6, 0)               # r6 = escudo
t.ldr_lit('r0', SPRIDS_LIT); t.ldr_i('r0', 'r0', 0); t.ldrb_r('r0', 'r0', 'r5'); t.bl('spr'); mv(t, 7, 0)   # r7 = Pokémon
t.bl('indice'); t.lsl('r0', 'r0', 1); t.ldr_lit('r1', PG_DADOS + 0x98); t.add_r('r3', 'r0', 'r1')
t.ldrh_i('r0', 'r7', 0x20); t.ldrb_i('r1', 'r3', 0); t.lsl('r1', 'r1', 24); t.h(0x1609); t.add_r('r0', 'r0', 'r1'); t.strh_i('r0', 'r6', 0x20)
t.ldrh_i('r0', 'r7', 0x22); t.ldrb_i('r1', 'r3', 1); t.lsl('r1', 'r1', 24); t.h(0x1609); t.add_r('r0', 'r0', 'r1'); t.strh_i('r0', 'r6', 0x22)
t.ldr_lit('r0', 0x02039EE5); t.ldrb_i('r0', 'r0', 0); t.cmpi('r0', 0); t.bc('ne', 's_mos')   # animação esconde o Pokémon de propósito: o escudo fica
t.mov('r2', 0x3E); t.ldrb_r('r0', 'r7', 'r2'); t.mov('r3', 4); t.alu('and_', 'r0', 'r3')
t.ldrb_r('r1', 'r6', 'r2'); t.alu('bic', 'r1', 'r3'); t.alu('orr', 'r1', 'r0'); t.strb_r('r1', 'r6', 'r2')
t.label('s_mos')
t.ldrb_i('r0', 'r4', 14); t.cmpi('r0', 0); t.bc('eq', 's_fim')
t.subi('r0', 1); t.strb_i('r0', 'r4', 14)
t.ldrh_i('r1', 'r6', 0); t.ldr_lit('r2', 0x1000)
t.cmpi('r0', 0); t.bc('eq', 's_tira')
t.alu('orr', 'r1', 'r2'); t.strh_i('r1', 'r6', 0)
lsr(t, 0, 0, 1); t.lsl('r1', 'r0', 4); t.alu('orr', 'r0', 'r1'); t.lsl('r0', 'r0', 8)   # mosaico só nos sprites
t.ldr_lit('r1', 0x0400004C); t.strh_i('r0', 'r1', 0); t.b('s_fim')
t.label('s_tira')
t.alu('bic', 'r1', 'r2'); t.strh_i('r1', 'r6', 0)
t.ldr_lit('r1', 0x0400004C); t.strh_i('r0', 'r1', 0)
t.label('s_fim')
t.pop(['r6', 'r7']); t.pop(['r0']); t.bx('r0')
t.pool()
assert t.here() <= PG_DADOS, hex(t.here())
put(PG_TAREFA, t.build())

# --- dados: folhas, paleta, modelos de sprite, posição em relação ao Pokémon
_d = bytearray(0x100)
_folhas = ((PG_GFX, 0x400, TAG_PLACA), (PG_GFX + 0x400, 0x400, TAG_PLACAI), (PG_GFX + 0x800, 0x800, TAG_COROA), (PG_GFX + 0x1000, 0x400, TAG_COROAI))
for _k, (_p, _s, _t) in enumerate(_folhas): struct.pack_into('<IHH', _d, 8 * _k, _p, _s, _t)
struct.pack_into('<IHH', _d, 0x20, PG_DADOS + 0xC0, TAG_PG_PAL, 0)
_dummy = ROM[0x4C32E4:0x4C32FC]
assert _dummy[:4] == bytes.fromhex('0000ffff')
_alto, _quad, _alto_f = PG_DADOS + 0x88, PG_DADOS + 0xA0, PG_DADOS + 0xA8
for _k, (_p, _s, _t) in enumerate(_folhas):
    _m = bytearray(_dummy); struct.pack_into('<HHI', _m, 0, _t, TAG_PG_PAL, _quad if _k == 2 else _alto_f if _k == 1 else _alto)
    _d[0x28 + 24 * _k:0x28 + 24 * _k + 24] = _m
# prioridade 3 = atrás do Pokémon mesmo quando a animação o desenha numa camada de fundo; só a placa do oponente fica na frente
struct.pack_into('<HHHH', _d, 0x88, 2 << 14, 3 << 14, 3 << 10, 0)     # 32x64
struct.pack_into('<HHHH', _d, 0xA8, 2 << 14, 3 << 14, 2 << 10, 0)     # 32x64, na frente
_d[0x90:0x94] = bytes((40, 10, 40, 40))                               # plano: como nos prints, só a placa do oponente fica na frente
_d[0x98:0xA0] = struct.pack('<8b', 17, -2, -20, 9, -1, -8, -21, 0)    # x, y de cada índice, medidos nos prints (Pokémon em 72,92 e 176,52)
struct.pack_into('<HHHH', _d, 0xA0, 0, 3 << 14, 3 << 10, 0)           # 64x64
_d[0xC0:0xE0] = _pal
put(PG_DADOS, bytes(_d))
put(PG_GFX, _gfx)

put(_esc['derrete'], bytes.fromhex('0203090a') + b'\xff' + p32(L['quebra'] | 1) + bytes.fromhex('392000') + _falou(ID_DERRETEU) + _fim)

# --- ganchos nos comandos do script de batalha
for _cmd, _orig, _nome in ((0x01, CMD_ACC, 'acc'), (0x07, CMD_ADJ, 'adj'), (0x0A, CMD_WAIT, 'espera'), (0x8A, CMD_HAZE, 'haze'), (0xB2, CMD_PERISH, 'perish')):
    assert w32(CMD_TAB + 4 * _cmd) == _orig
    put(CMD_TAB + 4 * _cmd, p32(L[_nome] | 1))
assert ROM[0x4D31C:0x4D324] == bytes.fromhex('f0b557464e464546')
put(FIMTURNO, struct.pack('<HHI', 0x4B00, 0x4718, L['fim_entra'] | 1))

# --- o golpe em si
_usa = bytes.fromhex('000203') + b'\xff' + p32(L['pode_usar'] | 1) + bytes.fromhex('090a') + b'\xff' + p32(L['usa'] | 1)
escr('golpe', _usa + bytes.fromhex('392000') + _falou(ID_ENVOLVE) + _fim)
EF_TAB = 0x084A9994
put(EF_TAB + 4 * EF_PG, p32(_esc['golpe']))
assert _pgat <= 0x09FEFF00
_mv = bytearray(ROM[0x53AD34 + 24 * 367:0x53AD34 + 24 * 367 + 24])    # Acupressure: alvo "eu ou aliado"
struct.pack_into('<H', _mv, 0, EF_PG); _mv[2] = 0; _mv[3] = PG_GELO_T; _mv[4] = 0; _mv[5] = 5; _mv[10] = 7   # prioridade +7: antes de qualquer golpe
put(0x0853AD34 + 24 * ID_PG, bytes(_mv))
_nm = enc('Protetor Glacial'); assert len(_nm) <= 17     # com o 0xFF do fim
put(0x085188EB - 17 + 17 * ID_PG, _nm + b'\xff' * (17 - len(_nm)))
# animação: som; o resto é o efeito de transformação do sprite
PG_ANIM = 0x09FEFF00
put(PG_ANIM, bytes.fromhex('19980000' '08'))
put(0x0846AB1C + 4 * ID_PG, p32(PG_ANIM))
# Cubchoo aprende no nível 15, antes de Frost Breath
LS_TAB, CUBCHOO, PG_NIVEL, PG_LS = 0x085B4584, 613, 15, 0x09FEFF40
_o = w32(LS_TAB + 4 * CUBCHOO) - 0x08000000; _l = []
while True:
    _m, _n = struct.unpack_from('<HH', ROM, _o)
    if _m == 0xFFFF: break
    _l.append((_m, _n)); _o += 4
_i = next(k for k, (_, n) in enumerate(_l) if n > PG_NIVEL)
_l.insert(_i, (ID_PG, PG_NIVEL))
put(PG_LS, b''.join(struct.pack('<HH', m, n) for m, n in _l) + b'\xff\xff\x00\x00')
assert PG_LS + 4 * (len(_l) + 1) <= 0x09FF0000
put(LS_TAB + 4 * CUBCHOO, p32(PG_LS))

# descrição do golpe (tabela achada pelo texto do Pound, índice = golpe - 1)
DESC_TAB, PG_DESC = 0x092DB0A4, 0x09FEFFA0
put(PG_DESC, enc('Escudo de gelo que\nbloqueia golpes por 3\nrodadas. Fogo derrete.'))
put(DESC_TAB + 4 * (ID_PG - 1), p32(PG_DESC))
