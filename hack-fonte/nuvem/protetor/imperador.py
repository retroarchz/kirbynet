# Tempo do Imperador: a transformação secreta do Cubchoo. Roda dentro do protetor.py (mesmo Asm, put, L...).
# Só para Pokémon do lado do jogador. Regras em hack-fonte/nuvem/protetor/LEIA-ME.md.
#
# Estado em 0x0203FFF0 (limpo no início de cada batalha, junto com o do Protetor Glacial):
#   +0, +4, +8  personalidade de quem transformou (até 3)
#   +12..+14    rota: 1 vida no vermelho, 2 vida cheia; bit 7 = animação ainda não mostrada
#   +15         bit 0 fundo de gelo na tela; bits 4-6 alvo guardado durante o script
# 0x0203FFEF: batalhadores que aguentaram com 1 de vida e ainda vão transformar (um bit por batalhador).
# Os dados de batalha só mudam dentro de comandos do script (iguais em todos os GBAs do cabo); a tarefa só cuida da tela.
SP_CUB, ID_SC = 613, 329
IMP_PEND = 0x0203FFEF
ST_ATQ, ST_VEL, ST_ATQE = 0x19, 0x1B, 0x1C
M_PID, M_HP, M_MAX, M_NIV, M_PP, M_ST2 = 0x4C, 0x2A, 0x2E, 0x2C, 0x25, 0x54
EXEC, HITMARKER = 0x02023040, 0x02023274
CMD_HB, CMD_ME, CMD_TR, CMD_KO = 0x0806E84D, 0x08073C45, 0x08076A65, 0x080829D9
BATTLER_DO_ARG, SPRITES_LIT, DESTROYANIM = 0x0804B9E1, 0x08093BF4, 0x080F43A9
IMP_TAREFA = IMP_CODE + 0xE00
_ld = lambda n: open(os.path.join(_dir, n), 'rb').read()
_costas, _cpal, _fblocos, _fmapa, _fpal = _ld('imp_costas.bin'), _ld('imp_costas.pal'), _ld('imp_fundo_blocos.bin'), _ld('imp_fundo_mapa.bin'), _ld('imp_fundo.pal')
IMP_COSTAS = IMP_DADOS; IMP_CPAL = IMP_COSTAS + ((len(_costas) + 3) & ~3)
IMP_FPAL = IMP_CPAL + 32; IMP_FMAPA = IMP_FPAL + 96; IMP_FBLOCOS = IMP_FMAPA + ((len(_fmapa) + 3) & ~3)
assert IMP_FBLOCOS + len(_fblocos) <= 0x09FF8000
put(IMP_COSTAS, _costas); put(IMP_CPAL, _cpal); put(IMP_FPAL, _fpal); put(IMP_FMAPA, _fmapa); put(IMP_FBLOCOS, _fblocos)
def LSLR(a, d, s): a.h(0x4080 | s << 3 | d)   # lsl rd, rs
def SUB3(a, d, s, n): a.h(0x1A00 | n << 6 | s << 3 | d)

i = Asm(IMP_CODE)
for _k in range(6): i.word(0)                 # 3 entradas (ldr r3 + bx r3 + endereço): usadas pelo protetor.py
i.label('c3'); i.bx('r3')

i.label('busca')                              # r0 = personalidade -> índice, 3 se não transformou
i.ldr_lit('r1', IMP); i.mov('r2', 0); i.cmpi('r0', 0); i.bc('eq', 'bu_nao')
i.label('bu_l'); i.ldr_i('r3', 'r1', 0); i.alu('cmp', 'r3', 'r0'); i.bc('eq', 'bu_s')
i.addi('r1', 4); i.addi('r2', 1); i.cmpi('r2', 3); i.bc('lo', 'bu_l')
i.label('bu_nao'); i.mov('r2', 3)
i.label('bu_s'); mv(i, 0, 2); i.bx('lr')

i.label('cubchoo')                            # r0 = batalhador -> &gBattleMons, ou 0 se não é Cubchoo do jogador com vida
i.push(['r4'], lr=True); mv(i, 4, 0)
i.bl(L['lado']); i.cmpi('r0', 0); i.bc('ne', 'cu_n')
mv(i, 0, 4); i.bl(L['mon']); i.ldrh_i('r1', 'r0', 0); i.ldr_lit('r2', SP_CUB); i.alu('cmp', 'r1', 'r2'); i.bc('ne', 'cu_n')
i.ldrh_i('r1', 'r0', M_HP); i.cmpi('r1', 0); i.bc('ne', 'cu_f')
i.label('cu_n'); i.mov('r0', 0)
i.label('cu_f'); i.pop(['r4']); i.pop(['r1']); i.bx('r1')

i.label('checa')                              # -> r0 = batalhador + 1 que transforma agora (0 nenhum), r1 = rota
i.push(['r4', 'r5'], lr=True); i.mov('r4', 0)
i.label('ch_l')
i.ldr_lit('r0', NBAT); i.ldrb_i('r0', 'r0', 0); i.alu('cmp', 'r4', 'r0'); i.bc('hs', 'ch_0')
mv(i, 0, 4); i.bl('cubchoo'); i.cmpi('r0', 0); i.bc('eq', 'ch_p'); mv(i, 5, 0)
i.ldr_i('r0', 'r5', M_PID); i.bl('busca'); i.cmpi('r0', 3); i.bc('ne', 'ch_p')
i.ldr_lit('r0', IMP_PEND); i.ldrb_i('r0', 'r0', 0); i.mov('r1', 1); LSLR(i, 1, 4); i.alu('tst', 'r0', 'r1'); i.bc('ne', 'ch_2')
i.ldrb_i('r0', 'r5', STAGE_DEF); i.cmpi('r0', STAGE_MAX); i.bc('ne', 'ch_p')
i.ldrb_i('r0', 'r5', STAGE_DEFE); i.cmpi('r0', STAGE_MAX); i.bc('ne', 'ch_p')
i.ldrh_i('r0', 'r5', M_HP); i.mov('r1', 48); i.alu('mul', 'r0', 'r1')      # zona vermelha: até 9 dos 48 pontos da barra
i.ldrh_i('r2', 'r5', M_MAX); i.mov('r1', 10); i.alu('mul', 'r2', 'r1'); i.alu('cmp', 'r0', 'r2'); i.bc('hs', 'ch_p')
i.mov('r1', 1); i.b('ch_a')
i.label('ch_2'); i.mov('r1', 2)
i.label('ch_a'); mv(i, 0, 4); i.addi('r0', 1); i.b('ch_f')
i.label('ch_p'); i.addi('r4', 1); i.b('ch_l')
i.label('ch_0'); i.mov('r0', 0)
i.label('ch_f'); i.pop(['r4', 'r5']); i.pop(['r2']); i.bx('r2')
i.pool()

i.label('marca')                              # r0 = batalhador, r1 = rota: guarda quem transforma e o alvo -> r0 = 1 se coube
i.push(['r4', 'r5'], lr=True); mv(i, 4, 0); mv(i, 5, 1)
i.ldr_lit('r0', IMP_PEND); i.ldrb_i('r1', 'r0', 0); i.mov('r2', 1); LSLR(i, 2, 4); i.alu('bic', 'r1', 'r2'); i.strb_i('r1', 'r0', 0)
i.ldr_lit('r0', IMP + 12); i.mov('r2', 0)
i.label('ma_l'); i.ldrb_r('r3', 'r0', 'r2'); i.cmpi('r3', 0); i.bc('eq', 'ma_a')
i.addi('r2', 1); i.cmpi('r2', 3); i.bc('lo', 'ma_l')
i.mov('r0', 0); i.b('ma_f')
i.label('ma_a')
i.mov('r3', 0x80); i.alu('orr', 'r3', 'r5'); i.strb_r('r3', 'r0', 'r2'); mv(i, 5, 2)
mv(i, 0, 4); i.bl(L['mon']); i.ldr_i('r1', 'r0', M_PID)
i.lsl('r2', 'r5', 2); i.ldr_lit('r0', IMP); i.h(0x5000 | 2 << 6 | 0 << 3 | 1)   # str r1, [r0, r2]
i.ldr_lit('r0', ALVO); i.ldrb_i('r1', 'r0', 0); i.strb_i('r4', 'r0', 0)
i.ldr_lit('r0', IMP + 15); i.ldrb_i('r2', 'r0', 0); i.mov('r3', 0x0F); i.alu('and_', 'r2', 'r3'); i.lsl('r1', 'r1', 4); i.alu('orr', 'r2', 'r1'); i.strb_i('r2', 'r0', 0)
i.mov('r0', 1)
i.label('ma_f'); i.pop(['r4', 'r5']); i.pop(['r1']); i.bx('r1')

i.label('imperador_sc')                       # r0 = &gBattleMons do atacante se ele é imperador da rota 2 usando Sheer Cold, senão 0
i.push(['r4'], lr=True)
i.ldr_lit('r0', CURMOVE); i.ldrh_i('r0', 'r0', 0); i.ldr_lit('r1', ID_SC); i.alu('cmp', 'r0', 'r1'); i.bc('ne', 'sc_n')
i.ldr_lit('r0', ATK); i.ldrb_i('r0', 'r0', 0); i.bl(L['mon']); mv(i, 4, 0)
i.ldr_i('r0', 'r4', M_PID); i.bl('busca'); i.cmpi('r0', 3); i.bc('hs', 'sc_n')
i.ldr_lit('r1', IMP + 12); i.ldrb_r('r1', 'r1', 'r0'); i.mov('r2', 0x0F); i.alu('and_', 'r1', 'r2'); i.cmpi('r1', 2); i.bc('ne', 'sc_n')
mv(i, 0, 4); i.b('sc_f')
i.label('sc_n'); i.mov('r0', 0)
i.label('sc_f'); i.pop(['r4']); i.pop(['r1']); i.bx('r1')
i.pool()

i.label('aplica')                             # r0 = batalhador, r1 = índice: defesas, e na rota 2 tudo no máximo e o Sheer Cold, em silêncio
i.push(['r4', 'r5', 'r6'], lr=True); mv(i, 4, 0)
i.ldr_lit('r2', IMP + 12); i.ldrb_r('r5', 'r2', 'r1'); i.mov('r0', 0x0F); i.alu('and_', 'r5', 'r0')
mv(i, 0, 4); i.bl(L['mon']); mv(i, 6, 0)
i.mov('r0', STAGE_MAX); i.strb_i('r0', 'r6', STAGE_DEF); i.strb_i('r0', 'r6', STAGE_DEFE)
i.cmpi('r5', 2); i.bc('ne', 'ap_f')
i.strb_i('r0', 'r6', ST_ATQ); i.strb_i('r0', 'r6', ST_VEL); i.strb_i('r0', 'r6', ST_ATQE)
i.mov('r2', 0); i.ldr_lit('r0', ID_SC)
i.label('ap_j'); i.lsl('r1', 'r2', 1); i.add_r('r1', 'r1', 'r6'); i.ldrh_i('r3', 'r1', 0x0C); i.alu('cmp', 'r3', 'r0'); i.bc('eq', 'ap_f')  # já sabe
i.addi('r2', 1); i.cmpi('r2', 4); i.bc('lo', 'ap_j')
i.mov('r2', 0); i.ldr_lit('r0', ID_PG)
i.label('ap_l'); i.lsl('r1', 'r2', 1); i.add_r('r1', 'r1', 'r6'); i.ldrh_i('r3', 'r1', 0x0C); i.alu('cmp', 'r3', 'r0'); i.bc('eq', 'ap_a')
i.addi('r2', 1); i.cmpi('r2', 4); i.bc('lo', 'ap_l')
i.mov('r2', 3)                                # sem o escudo: vaga 4
i.label('ap_a')
i.lsl('r1', 'r2', 1); i.add_r('r1', 'r1', 'r6'); i.ldr_lit('r3', ID_SC); i.strh_i('r3', 'r1', 0x0C)
i.add_r('r1', 'r6', 'r2'); i.addi('r1', M_PP); i.mov('r3', 5); i.strb_i('r3', 'r1', 0)
i.ldr_lit('r0', DISABLE_LIT); i.ldr_i('r0', 'r0', 0); i.mov('r1', 0x2C); i.alu('mul', 'r1', 'r4'); i.add_r('r0', 'r0', 'r1')
i.ldrb_i('r1', 'r0', 0x1C); i.mov('r3', 4); LSLR(i, 3, 2); i.alu('orr', 'r1', 'r3'); i.strb_i('r1', 'r0', 0x1C)   # como o Mimic: o PP do time não muda
i.label('ap_f'); i.pop(['r4', 'r5', 'r6']); i.pop(['r0']); i.bx('r0')
i.pool()

# comando 0x49 (moveend): quem está pronto transforma ao fim do golpe
i.label('h_fimgolpe')
i.push(['r4'], lr=True)
i.ldr_lit('r0', EXEC); i.ldr_i('r0', 'r0', 0); i.cmpi('r0', 0); i.bc('ne', 'he_o')
i.bl('checa'); i.cmpi('r0', 0); i.bc('eq', 'he_o')
i.subi('r0', 1); i.bl('marca'); i.cmpi('r0', 0); i.bc('eq', 'he_o')
i.ldr_lit('r4', INSTR); i.ldr_i('r0', 'r4', 0); i.ldr_lit('r3', PUSHSCR); i.bl('c3')
i.ldr_lit('r0', IMP_ESCR); i.str_i('r0', 'r4', 0); i.b('he_f')
i.label('he_o'); i.ldr_lit('r3', CMD_ME); i.bl('c3')
i.label('he_f'); i.pop(['r4']); i.pop(['r0']); i.bx('r0')

# comando 0x0B (healthbarupdate): com a vida cheia, golpe que zeraria a vida deixa 1
i.label('h_barra')
i.push(['r4', 'r5', 'r6'], lr=True)
i.ldr_lit('r0', EXEC); i.ldr_i('r0', 'r0', 0); i.cmpi('r0', 0); i.bc('ne', 'hb_o')
i.ldr_lit('r0', INSTR); i.ldr_i('r0', 'r0', 0); i.ldrb_i('r0', 'r0', 1); i.cmpi('r0', 0); i.bc('ne', 'hb_o')
i.ldr_lit('r0', RESULT); i.ldrh_i('r0', 'r0', 0); i.mov('r1', 0x29); i.alu('tst', 'r0', 'r1'); i.bc('ne', 'hb_o')
i.ldr_lit('r4', ALVO); i.ldrb_i('r4', 'r4', 0); mv(i, 0, 4); i.bl('cubchoo'); i.cmpi('r0', 0); i.bc('eq', 'hb_o'); mv(i, 5, 0)
i.ldr_i('r0', 'r5', M_PID); i.bl('busca'); i.cmpi('r0', 3); i.bc('ne', 'hb_o')
i.ldr_lit('r6', DMG); i.mov('r1', 1); LSLR(i, 1, 4)
i.ldr_lit('r2', IMP_PEND); i.ldrb_i('r0', 'r2', 0); i.alu('tst', 'r0', 'r1'); i.bc('eq', 'hb_c')
i.mov('r0', 0); i.str_i('r0', 'r6', 0); i.b('hb_o')    # golpe de vários acertos: os seguintes não matam quem já aguentou
i.label('hb_c')
i.ldrh_i('r3', 'r5', M_HP); i.ldrh_i('r0', 'r5', M_MAX); i.alu('cmp', 'r3', 'r0'); i.bc('ne', 'hb_o')
i.cmpi('r3', 1); i.bc('ls', 'hb_o')
i.ldr_i('r0', 'r5', M_ST2); i.ldr_lit('r1', 0x01000000); i.alu('tst', 'r0', 'r1'); i.bc('ne', 'hb_o')     # o substituto levou o golpe
i.ldr_i('r0', 'r6', 0); i.alu('cmp', 'r0', 'r3'); i.bc('lt', 'hb_o')
i.subi('r3', 1); i.str_i('r3', 'r6', 0)
i.ldr_lit('r2', IMP_PEND); i.ldrb_i('r0', 'r2', 0); i.mov('r1', 1); LSLR(i, 1, 4); i.alu('orr', 'r0', 'r1'); i.strb_i('r0', 'r2', 0)
i.label('hb_o'); i.ldr_lit('r3', CMD_HB); i.bl('c3')
i.pop(['r4', 'r5', 'r6']); i.pop(['r0']); i.bx('r0')
i.pool()

# comando 0x93 (tryko): o Sheer Cold do imperador ignora a chance e o nível do alvo (nível alto só durante a conta)
i.label('h_ko')
i.push(['r4', 'r5'], lr=True)
i.bl('imperador_sc'); mv(i, 4, 0); i.cmpi('r0', 0); i.bc('eq', 'hk_o')
i.addi('r4', M_NIV); i.ldrb_i('r5', 'r4', 0); i.mov('r0', 255); i.strb_i('r0', 'r4', 0)
i.label('hk_o'); i.ldr_lit('r3', CMD_KO); i.bl('c3')
i.cmpi('r4', 0); i.bc('eq', 'hk_f'); i.strb_i('r5', 'r4', 0)
i.label('hk_f'); i.pop(['r4', 'r5']); i.pop(['r0']); i.bx('r0')

# comando 0x01 (accuracycheck): antes da mira, o alvo fica "travado" para o Sheer Cold do imperador (voo, buraco...)
i.label('h_mira')
i.push(['r4', 'r5'], lr=True); i.mov('r4', 0)
i.bl('imperador_sc'); i.cmpi('r0', 0); i.bc('eq', 'hm_o')
i.ldr_lit('r0', ALVO); i.ldrb_i('r0', 'r0', 0)
i.ldr_lit('r1', DISABLE_LIT); i.ldr_i('r1', 'r1', 0); i.mov('r2', 0x2C); i.alu('mul', 'r2', 'r0'); i.add_r('r1', 'r1', 'r2')
i.ldr_lit('r2', ATK); i.ldrb_i('r2', 'r2', 0); i.strb_i('r2', 'r1', 0x1A)
i.ldr_lit('r4', STATUS3_LIT); i.ldr_i('r4', 'r4', 0); i.lsl('r0', 'r0', 2); i.add_r('r4', 'r4', 'r0')
i.ldr_i('r5', 'r4', 0); i.mov('r0', 0x18); i.alu('orr', 'r0', 'r5'); i.str_i('r0', 'r4', 0)
i.label('hm_o'); i.ldr_lit('r3', L['acc'] | 1); i.bl('c3')
i.cmpi('r4', 0); i.bc('eq', 'hm_f'); i.str_i('r5', 'r4', 0)
i.label('hm_f'); i.pop(['r4', 'r5']); i.pop(['r0']); i.bx('r0')
i.pool()

# comando 0x4D (switchindataupdate): quem transformou e volta a campo continua forte
i.label('h_troca')
i.push(['r4', 'r5'], lr=True)
i.ldr_lit('r4', INSTR); i.ldr_i('r5', 'r4', 0)
i.ldr_lit('r3', CMD_TR); i.bl('c3')
i.ldr_i('r0', 'r4', 0); i.alu('cmp', 'r0', 'r5'); i.bc('eq', 'ht_f')
i.ldrb_i('r0', 'r5', 1); i.ldr_lit('r3', BATTLER_DO_ARG); i.bl('c3'); mv(i, 4, 0)
i.bl('cubchoo'); i.cmpi('r0', 0); i.bc('eq', 'ht_f')
i.ldr_i('r0', 'r0', M_PID); i.bl('busca'); i.cmpi('r0', 3); i.bc('hs', 'ht_f')
mv(i, 1, 0); mv(i, 0, 4); i.bl('aplica')
i.label('ht_f'); i.pop(['r4', 'r5']); i.pop(['r0']); i.bx('r0')

# entrada do fim de turno: vermelho por veneno, clima ou com o escudo acabando
i.label('h_turno')
i.push([], lr=True); i.bl('checa'); i.cmpi('r0', 0); i.bc('eq', 'hu_o')
i.subi('r0', 1); i.bl('marca'); i.cmpi('r0', 0); i.bc('eq', 'hu_o')
i.ldr_lit('r0', IMP_ESCR + IMP_ESCR_T); i.ldr_lit('r3', EXECSCR); i.bl('c3')
i.pop(['r3']); i.mov('r0', 1); i.bx('r3')
i.label('hu_o'); i.pop(['r3']); i.movh(14, 'r3'); i.ldr_lit('r3', L['fim_entra'] | 1); i.bx('r3')
i.pool()

# carga do sprite (fim de BattleLoadMonSpriteGfx): r7 = Pokémon, sl = batalhador
i.label('h_carga')
mv(i, 0, 7); i.h(0x4651)                      # mov r1, sl
i.bl('carrega_se')
i.addsp(12); i.pop(['r3', 'r4', 'r5']); i.movh(8, 'r3'); i.h(0x46A1); i.h(0x46AA)   # mov sb, r4; mov sl, r5
i.ldr_lit('r3', 0x08093451); i.bx('r3')
i.label('carrega_se')                         # r0 = Pokémon, r1 = batalhador
i.push(['r4', 'r5'], lr=True); mv(i, 4, 0); mv(i, 5, 1)
mv(i, 0, 5); i.bl(L['lado']); i.cmpi('r0', 0); i.bc('ne', 'cs_f')
i.ldr_i('r0', 'r4', 0); i.bl('busca'); i.cmpi('r0', 3); i.bc('hs', 'cs_f')
mv(i, 0, 5); i.bl('carrega')
i.label('cs_f'); i.pop(['r4', 'r5']); i.pop(['r0']); i.bx('r0')
i.label('carrega')                            # r0 = batalhador: desenho de costas no buffer e paletas
i.push(['r4'], lr=True); mv(i, 4, 0)
i.ldr_lit('r1', POS_LIT); i.ldr_i('r1', 'r1', 0); i.ldrb_r('r1', 'r1', 'r4'); i.lsl('r1', 'r1', 2)
i.ldr_lit('r0', SPRITES_LIT); i.ldr_i('r0', 'r0', 0); i.ldr_i('r0', 'r0', 0); i.add_r('r1', 'r1', 'r0'); i.ldr_i('r1', 'r1', 4)
i.ldr_lit('r0', IMP_COSTAS); i.h(0xDF11)      # LZ77UnCompWram
i.lsl('r1', 'r4', 4); i.ldr_lit('r0', 0x100); i.add_r('r1', 'r1', 'r0'); i.ldr_lit('r0', IMP_CPAL); i.mov('r2', 32); i.ldr_lit('r3', LOADPAL | 1); i.bl('c3')
i.lsl('r1', 'r4', 4); i.addi('r1', 0x80); i.ldr_lit('r0', IMP_CPAL); i.mov('r2', 32); i.ldr_lit('r3', LOADPAL | 1); i.bl('c3')
i.pop(['r4']); i.pop(['r0']); i.bx('r0')
i.pool()

i.label('desenha')                            # fundo de gelo na tela, nas 2 telas do mapa, e as paletas 2, 3 e 4
i.ldr_lit('r0', IMP_FBLOCOS); i.ldr_lit('r1', 0x06008000); i.h(0xDF12)
i.ldr_lit('r0', IMP_FMAPA); i.ldr_lit('r1', 0x0600D000); i.h(0xDF12)
i.ldr_lit('r0', IMP_FMAPA); i.ldr_lit('r1', 0x0600D800); i.h(0xDF12)
i.ldr_lit('r0', IMP_FPAL); i.ldr_lit('r1', PLTT_BASE + 0x40); i.mov('r2', 0)
i.label('de_l'); i.ldrh_r('r3', 'r0', 'r2'); i.strh_r('r3', 'r1', 'r2'); i.addi('r2', 2); i.cmpi('r2', 96); i.bc('lo', 'de_l')
i.ldr_lit('r1', PLTT_BASE + 0x440); i.mov('r2', 0)
i.label('de_m'); i.ldrh_r('r3', 'r0', 'r2'); i.strh_r('r3', 'r1', 'r2'); i.addi('r2', 2); i.cmpi('r2', 96); i.bc('lo', 'de_m')
i.bx('lr')

i.label('garante')                            # recria a tarefa da tela (os menus apagam as tarefas)
i.push([], lr=True)
i.ldr_lit('r1', GTASKS); i.mov('r2', 0); i.ldr_lit('r3', IMP_TAREFA | 1)
i.label('ga_l'); i.ldrb_i('r0', 'r1', 4); i.cmpi('r0', 0); i.bc('eq', 'ga_p')
i.ldr_i('r0', 'r1', 0); i.alu('cmp', 'r0', 'r3'); i.bc('eq', 'ga_f')
i.label('ga_p'); i.addi('r1', 40); i.addi('r2', 1); i.cmpi('r2', 16); i.bc('lo', 'ga_l')
mv(i, 0, 3); i.mov('r1', 4); i.ldr_lit('r3', CREATETASK | 1); i.bl('c3')
i.label('ga_f'); i.pop(['r0']); i.bx('r0')
i.pool()

# fim de DrawMainBattleBackground: depois de menu ou de animação com fundo próprio, o gelo volta na hora
i.label('h_fundo')
i.push([], lr=True)
i.ldr_lit('r0', IMP + 15); i.ldrb_i('r0', 'r0', 0); i.mov('r1', 1); i.alu('tst', 'r0', 'r1'); i.bc('eq', 'hf_t')
i.bl('desenha')
i.label('hf_t')
i.ldr_lit('r0', IMP + 12); i.ldrb_i('r1', 'r0', 0); i.cmpi('r1', 0); i.bc('eq', 'hf_f'); i.bl('garante')
i.label('hf_f'); i.pop(['r0']); i.bx('r0')

# callnative do início do script: atributos, Sheer Cold e quanto de vida volta
i.label('n_pre')
i.push(['r4', 'r5', 'r6'], lr=True)
i.ldr_lit('r4', ALVO); i.ldrb_i('r4', 'r4', 0); mv(i, 0, 4); i.bl(L['mon']); mv(i, 5, 0)
i.ldr_i('r0', 'r5', M_PID); i.bl('busca'); mv(i, 6, 0)
mv(i, 1, 0); mv(i, 0, 4); i.bl('aplica')
i.ldr_lit('r1', IMP + 12); i.ldrb_r('r1', 'r1', 'r6'); i.mov('r2', 0x0F); i.alu('and_', 'r1', 'r2')
i.ldrh_i('r0', 'r5', M_MAX); i.cmpi('r1', 2); i.bc('eq', 'np_c')
i.mov('r1', 25); i.alu('mul', 'r0', 'r1'); i.addi('r0', 47); i.mov('r1', 48); swi_div(i)    # o mínimo da barra verde: 25 dos 48 pontos
i.label('np_c')
i.ldrh_i('r2', 'r5', M_HP); SUB3(i, 0, 0, 2); i.mov('r1', 0); SUB3(i, 0, 1, 0)
i.ldr_lit('r1', DMG); i.str_i('r0', 'r1', 0)
i.ldr_lit('r1', INSTR); i.ldr_i('r0', 'r1', 0); i.addi('r0', 5); i.str_i('r0', 'r1', 0)
i.pop(['r4', 'r5', 'r6']); i.pop(['r0']); i.bx('r0')
i.pool()

# callnative: rota 1 pula a fala do Sheer Cold (6 bytes)
i.label('n_fala')
i.push([], lr=True)
i.ldr_lit('r0', ALVO); i.ldrb_i('r0', 'r0', 0); i.bl(L['mon']); i.ldr_i('r0', 'r0', M_PID); i.bl('busca')
i.ldr_lit('r1', IMP + 12); i.ldrb_r('r1', 'r1', 'r0'); i.mov('r2', 0x0F); i.alu('and_', 'r1', 'r2')
i.ldr_lit('r3', INSTR); i.ldr_i('r0', 'r3', 0); i.addi('r0', 5); i.cmpi('r1', 2); i.bc('eq', 'nf_s'); i.addi('r0', 6)
i.label('nf_s'); i.str_i('r0', 'r3', 0); i.pop(['r0']); i.bx('r0')

# callnative do fim do script: devolve o alvo e liga a tarefa da tela
i.label('n_fim')
i.push([], lr=True)
i.ldr_lit('r1', IMP + 15); i.ldrb_i('r0', 'r1', 0); i.mov('r2', 0x0F); i.alu('and_', 'r2', 'r0'); i.strb_i('r2', 'r1', 0); lsr(i, 0, 0, 4)
i.ldr_lit('r1', ALVO); i.strb_i('r0', 'r1', 0)
i.ldr_lit('r1', IMP + 12); i.mov('r2', 0)
i.label('nz_l'); i.ldrb_r('r0', 'r1', 'r2'); i.mov('r3', 0x7F); i.alu('and_', 'r0', 'r3'); i.strb_r('r0', 'r1', 'r2'); i.addi('r2', 1); i.cmpi('r2', 3); i.bc('lo', 'nz_l')
i.bl('garante')
i.ldr_lit('r1', INSTR); i.ldr_i('r0', 'r1', 0); i.addi('r0', 5); i.str_i('r0', 'r1', 0)
i.pop(['r0']); i.bx('r0')
i.pool()

# animação da transformação: o fundo clareia e o sprite embaça; no meio (quadro 32) troca tudo; volta ao normal no 64
i.label('t_anim')
i.push(['r4', 'r5', 'r6', 'r7'], lr=True); mv(i, 7, 0)
i.lsl('r1', 'r0', 2); i.add_r('r1', 'r1', 'r0'); i.lsl('r1', 'r1', 3); i.ldr_lit('r6', GTASKS); i.add_r('r6', 'r6', 'r1')
i.ldr_lit('r4', ALVO); i.ldrb_i('r4', 'r4', 0)
i.ldr_lit('r0', SPRIDS_LIT); i.ldr_i('r0', 'r0', 0); i.ldrb_r('r0', 'r0', 'r4'); i.mov('r1', 68); i.alu('mul', 'r0', 'r1'); i.ldr_lit('r1', GSPRITES); i.add_r('r2', 'r0', 'r1')
i.ldrh_i('r5', 'r6', 8); i.cmpi('r5', 0); i.bc('ne', 'ta_1')
i.ldrh_i('r0', 'r2', 0); i.ldr_lit('r1', 0x1000); i.alu('orr', 'r0', 'r1'); i.strh_i('r0', 'r2', 0)
i.mov('r0', 0xA8); i.ldr_lit('r1', 0x04000050); i.strh_i('r0', 'r1', 0)   # só o fundo clareia
i.label('ta_1')
mv(i, 0, 5); i.cmpi('r5', 32); i.bc('lo', 'ta_2'); i.mov('r0', 64); SUB3(i, 0, 0, 5)
i.label('ta_2')
lsr(i, 0, 0, 1); i.ldr_lit('r1', 0x04000054); i.strh_i('r0', 'r1', 0)
i.cmpi('r0', 15); i.bc('ls', 'ta_3'); i.mov('r0', 15)
i.label('ta_3')
i.lsl('r1', 'r0', 4); i.alu('orr', 'r0', 'r1'); i.lsl('r0', 'r0', 8); i.ldr_lit('r1', 0x0400004C); i.strh_i('r0', 'r1', 0)
i.cmpi('r5', 32); i.bc('ne', 'ta_4')
mv(i, 0, 4); i.bl(L['mon']); i.ldr_i('r0', 'r0', M_ST2); i.ldr_lit('r1', 0x01000000); i.alu('tst', 'r0', 'r1'); i.bc('ne', 'ta_d')   # com substituto, o desenho muda quando ele sumir
mv(i, 0, 4); i.bl('carrega')
i.ldr_lit('r1', POS_LIT); i.ldr_i('r1', 'r1', 0); i.ldrb_r('r1', 'r1', 'r4'); i.lsl('r1', 'r1', 2)
i.ldr_lit('r0', SPRITES_LIT); i.ldr_i('r0', 'r0', 0); i.ldr_i('r0', 'r0', 0); i.add_r('r1', 'r1', 'r0'); i.ldr_i('r3', 'r1', 4)
i.ldr_lit('r0', SPRIDS_LIT); i.ldr_i('r0', 'r0', 0); i.ldrb_r('r0', 'r0', 'r4'); i.mov('r1', 68); i.alu('mul', 'r0', 'r1'); i.ldr_lit('r1', GSPRITES); i.add_r('r0', 'r0', 'r1')
i.ldrh_i('r0', 'r0', 4); i.lsl('r0', 'r0', 22); lsr(i, 0, 0, 17); i.ldr_lit('r1', 0x06010000); i.add_r('r0', 'r0', 'r1')
i.ldr_lit('r1', 0x040000D4); i.str_i('r3', 'r1', 0); i.str_i('r0', 'r1', 4); i.ldr_lit('r0', 0x84000200); i.str_i('r0', 'r1', 8); i.ldr_i('r0', 'r1', 8)
i.label('ta_d')
i.bl('desenha'); i.ldr_lit('r1', IMP + 15); i.ldrb_i('r0', 'r1', 0); i.mov('r2', 1); i.alu('orr', 'r0', 'r2'); i.strb_i('r0', 'r1', 0)
i.label('ta_4')
i.addi('r5', 1); i.strh_i('r5', 'r6', 8); i.cmpi('r5', 64); i.bc('ls', 'ta_f')
i.ldr_lit('r0', SPRIDS_LIT); i.ldr_i('r0', 'r0', 0); i.ldrb_r('r0', 'r0', 'r4'); i.mov('r1', 68); i.alu('mul', 'r0', 'r1'); i.ldr_lit('r1', GSPRITES); i.add_r('r2', 'r0', 'r1')
i.ldrh_i('r0', 'r2', 0); i.ldr_lit('r1', 0x1000); i.alu('bic', 'r0', 'r1'); i.strh_i('r0', 'r2', 0)
i.mov('r0', 0); i.ldr_lit('r1', 0x04000050); i.strh_i('r0', 'r1', 0); i.ldr_lit('r1', 0x04000054); i.strh_i('r0', 'r1', 0); i.ldr_lit('r1', 0x0400004C); i.strh_i('r0', 'r1', 0)
mv(i, 0, 7); i.ldr_lit('r3', DESTROYANIM); i.bl('c3')
i.label('ta_f'); i.pop(['r4', 'r5', 'r6', 'r7']); i.pop(['r0']); i.bx('r0')
i.pool()
assert i.here() <= IMP_TAREFA, hex(i.here())
_b = bytearray(i.build())
for _k, _n in enumerate(('h_mira', 'h_turno', 'h_fundo')):
    struct.pack_into('<HHI', _b, 8 * _k, 0x4B00, 0x4718, i.labels[_n] | 1)
put(IMP_CODE, bytes(_b))
IL = i.labels

# tarefa da tela: enquanto a batalha dura, o fundo de gelo acompanha o imperador em campo
t = Asm(IMP_TAREFA)
t.push(['r4', 'r5', 'r6', 'r7'], lr=True); mv(t, 7, 0)
t.lsl('r1', 'r0', 2); t.add_r('r1', 'r1', 'r0'); t.lsl('r1', 'r1', 3); t.ldr_lit('r6', GTASKS); t.add_r('r6', 'r6', 'r1')
t.ldr_lit('r0', 0x03002A99); t.ldrb_i('r0', 'r0', 0); t.mov('r1', 2); t.alu('and_', 'r0', 'r1'); t.cmpi('r0', 0); t.bc('ne', 'emb')
mv(t, 0, 7); t.ldr_lit('r3', DESTROYTASK | 1); t.bl('c3'); t.b('fim')
t.label('emb')
t.ldrh_i('r5', 'r6', 8); t.cmpi('r5', 0); t.bc('ne', 'clarao')
t.ldr_lit('r0', 0x03002664); t.ldr_i('r0', 'r0', 0); t.ldr_lit('r1', BATTLE_CB2); t.alu('cmp', 'r0', 'r1'); t.bc('ne', 'fim')
t.ldr_lit('r0', 0x02039EE5); t.ldrb_i('r0', 'r0', 0); t.cmpi('r0', 0); t.bc('ne', 'fim')
t.mov('r4', 0); t.mov('r5', 0)
t.label('laco')                               # r5 = imperador em campo
t.ldr_lit('r0', NBAT); t.ldrb_i('r0', 'r0', 0); t.alu('cmp', 'r4', 'r0'); t.bc('hs', 'viu')
mv(t, 0, 4); t.bl(IL['cubchoo']); t.cmpi('r0', 0); t.bc('eq', 'prox')
t.ldr_i('r0', 'r0', M_PID); t.bl(IL['busca']); t.cmpi('r0', 3); t.bc('hs', 'prox')
t.ldr_lit('r1', IMP + 12); t.ldrb_r('r1', 'r1', 'r0'); t.lsl('r1', 'r1', 24); t.cmpi('r1', 0); t.bc('lt', 'prox')   # animação ainda vai rodar
t.mov('r5', 1)
t.label('prox'); t.addi('r4', 1); t.b('laco')
t.label('viu')
t.ldr_lit('r0', IMP + 15); t.ldrb_i('r1', 'r0', 0); t.mov('r2', 1); t.alu('and_', 'r2', 'r1')
t.alu('cmp', 'r2', 'r5'); t.bc('eq', 'fim')
t.cmpi('r5', 0); t.bc('ne', 'volta')
# saiu de campo: mesma saída do Distúrbio
t.mov('r2', 0xFE); t.alu('and_', 'r1', 'r2'); t.strb_i('r1', 'r0', 0)
t.ldr_lit('r3', D_COBRE | 1); t.bl('c3'); t.ldr_lit('r3', DRAWBG | 1); t.bl('c3')
t.ldr_lit('r0', D_SAI | 1); t.mov('r1', 3); t.ldr_lit('r3', CREATETASK | 1); t.bl('c3')
t.b('fim')
t.label('volta')
t.mov('r0', 0xA8); t.ldr_lit('r1', 0x04000050); t.strh_i('r0', 'r1', 0); t.mov('r5', 0)
t.label('clarao')                             # voltou a campo: clareia, troca e escurece (32 quadros)
t.addi('r5', 1); t.strh_i('r5', 'r6', 8); mv(t, 0, 5); t.cmpi('r5', 16); t.bc('ls', 'cl_1'); t.mov('r0', 32); SUB3(t, 0, 0, 5)
t.label('cl_1'); t.ldr_lit('r1', 0x04000054); t.strh_i('r0', 'r1', 0)
t.cmpi('r5', 16); t.bc('ne', 'cl_2')
t.bl(IL['desenha']); t.ldr_lit('r1', IMP + 15); t.ldrb_i('r0', 'r1', 0); t.mov('r2', 1); t.alu('orr', 'r0', 'r2'); t.strb_i('r0', 'r1', 0)
t.label('cl_2')
t.cmpi('r5', 32); t.bc('lo', 'fim')
t.mov('r0', 0); t.strh_i('r0', 'r6', 8); t.ldr_lit('r1', 0x04000050); t.strh_i('r0', 'r1', 0); t.ldr_lit('r1', 0x04000054); t.strh_i('r0', 'r1', 0)
t.label('fim')
t.pop(['r4', 'r5', 'r6', 'r7']); t.pop(['r0']); t.bx('r0')
t.label('c3'); t.bx('r3')
t.pool()
assert t.here() <= IMP_ESCR, hex(t.here())
put(IMP_TAREFA, t.build())

# script da transformação (+0 volta ao golpe, +IMP_ESCR_T fim de turno)
def _imp_script(fim):
    return (b'\xff' + p32(IL['n_pre'] | 1) + bytes.fromhex('392000') + _falou(ID_IMP) + bytes([0x45, 0, N_GERAL + 3]) + p32(0x02023500) + b'\x0a'
            + b'\x35' + p32(HITMARKER) + p32(0x01000100) + bytes.fromhex('0b000c00') + b'\x38' + p32(HITMARKER) + p32(0x01000100)
            + b'\xff' + p32(IL['n_fala'] | 1) + _falou(ID_IMP_SC) + b'\xff' + p32(IL['n_fim'] | 1) + fim)
put(IMP_ESCR, _imp_script(b'\x3c'))
put(IMP_ESCR + IMP_ESCR_T, _imp_script(b'\x3e'))
assert len(_imp_script(b'\x3c')) <= IMP_ESCR_T
put(IMP_ANIM, bytes.fromhex('19980000') + b'\x03' + p32(IL['t_anim'] | 1) + bytes.fromhex('05000508'))

# ganchos
for _cmd, _orig, _nome in ((0x0B, CMD_HB, 'h_barra'), (0x49, CMD_ME, 'h_fimgolpe'), (0x4D, CMD_TR, 'h_troca'), (0x93, CMD_KO, 'h_ko')):
    assert w32(CMD_TAB + 4 * _cmd) == _orig
    put(CMD_TAB + 4 * _cmd, p32(IL[_nome] | 1))
assert ROM[0x93446:0x93450] == bytes.fromhex('03b038bc9846a146aa46')
put(0x08093446, struct.pack('<HHHI', 0x4B01, 0x4718, 0x46C0, IL['h_carga'] | 1))
