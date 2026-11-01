# Ordem (golpe 682, no lugar do Sizzly Slide que ninguém aprende): só o Cub Imperador do golpe fatal tem.
# Roda dentro do protetor.py, antes do código do escudo: o escudo usa as funções daqui (OL). Regras no LEIA-ME.md.
#
# Estado na EWRAM livre (0x0203FF60+, limpo no início da batalha junto com o do escudo):
#   +0..+5   pontos do escudo Nv. 2, por batalhador (0x80 = não quebra)
#   +6       vagas da equipe inimiga expulsas pela Ordem e ainda fora de campo (um bit por vaga)
#   +8       personalidade de quem voltou e erra muito, 3 u32 (batalhador / 2 do lado inimigo)
ID_ORDEM, ID_SC_ = 682, 329
PG2, P_ESPERA, P_ATIVO = 0x0203FF60, 6, 8
ORD_ERRO = 70                                 # % de chance de errar
ORD_CODE, ORD_TAREFA, ORD_ANIM, ORD_PAL, ORD_RET, ORD_SW, ORD_DESC = 0x09FFC400, 0x09FFCA00, 0x09FFCA80, 0x09FFCAC0, 0x09FFCB00, 0x09FFCB40, 0x09FFCB60
CMD_FORCE, PARTY_LIT, RANDOM = w32(CMD_TAB + 4 * 0x8F), 0x08033038, 0x080A69D1
ROAR_SW, ROAR_RET = 0x084B0279, 0x084B02C6
ID_MOVE_ROAR, ID_MOVE_NOBLE, TAG_RUIDO = 46, 568, 0x2745
assert w32(0x08082640) == ROAR_SW
assert ROM[ROAR_SW - 0x08000000:ROAR_SW - 0x08000000 + 5] == b'\x41' + p32(ROAR_RET)
ROAR_ANIMA = ROAR_RET + 22                    # depois dos 2 desvios do Dragon Tail e afins
assert ROM[ROAR_ANIMA - 0x08000000:ROAR_ANIMA - 0x08000000 + 9] == bytes.fromhex('090ae2005800003a3c')
assert ROM[0x46654:0x4665C] == bytes.fromhex('f0b5474680b4071c')
def _lslr(a, d, s): a.h(0x4080 | s << 3 | d)  # lsl rd, rs

o = Asm(ORD_CODE)
o.label('c3'); o.bx('r3')
o.label('mon')                                # r0 = batalhador -> &gBattleMons[b]
o.mov('r1', 0x60); o.alu('mul', 'r0', 'r1'); o.ldr_lit('r1', MONS_LIT); o.ldr_i('r1', 'r1', 0); o.add_r('r0', 'r0', 'r1'); o.bx('lr')
o.label('lado')                               # r0 = batalhador -> 0 jogador, 1 oponente
o.ldr_lit('r1', POS_LIT); o.ldr_i('r1', 'r1', 0); o.ldrb_r('r0', 'r1', 'r0'); o.mov('r1', 1); o.alu('and_', 'r0', 'r1'); o.bx('lr')
o.label('vaga_eq')                            # r0 = batalhador -> vaga na equipe
o.ldr_lit('r1', PARTY_LIT); o.ldr_i('r1', 'r1', 0); o.lsl('r0', 'r0', 1); o.ldrh_r('r0', 'r1', 'r0'); o.bx('lr')
o.label('rota')                               # r0 = personalidade -> rota do Imperador (0 se não transformou)
o.ldr_lit('r1', IMP); o.mov('r2', 0); o.cmpi('r0', 0); o.bc('eq', 'ro_n')
o.label('ro_l'); o.ldr_i('r3', 'r1', 0); o.alu('cmp', 'r3', 'r0'); o.bc('eq', 'ro_s')
o.addi('r1', 4); o.addi('r2', 1); o.cmpi('r2', 3); o.bc('lo', 'ro_l')
o.label('ro_n'); o.mov('r0', 0); o.bx('lr')
o.label('ro_s'); o.ldr_lit('r1', IMP + 12); o.ldrb_r('r0', 'r1', 'r2'); o.mov('r1', 0x0F); o.alu('and_', 'r0', 'r1'); o.bx('lr')
o.label('rota_b')                             # r0 = batalhador -> rota
o.push([], lr=True); o.bl('mon'); o.ldr_i('r0', 'r0', 0x4C); o.bl('rota'); o.pop(['r1']); o.bx('r1')
o.pool()

# entrada de GetBattleMovePriority (r0 = batalhador, r1 = golpe): o Imperador do golpe fatal sempre sai primeiro
o.label('prio')
o.push(['r0', 'r1'], lr=True); o.bl('rota_b'); mv(o, 2, 0); o.pop(['r0', 'r1']); o.pop(['r3'])
o.cmpi('r2', 2); o.bc('ne', 'pr_s')
o.mov('r0', 7); o.bx('r3')
o.label('pr_s'); o.movh(14, 'r3')
o.h(0xB5F0); o.h(0x4647); o.h(0xB480); o.h(0x1C07)    # as 4 instruções trocadas pelo desvio
o.ldr_lit('r3', 0x0804665D); o.bx('r3')
o.pool()

# comando 0x8F (forcerandomswitch): deu certo com a Ordem? segue pelo script dela
o.label('h_force')
o.push(['r4'], lr=True)
o.ldr_lit('r3', CMD_FORCE); o.bl('c3')
o.ldr_lit('r0', CURMOVE); o.ldrh_i('r0', 'r0', 0); o.ldr_lit('r1', ID_ORDEM); o.alu('cmp', 'r0', 'r1'); o.bc('ne', 'hf_f')
o.ldr_lit('r4', INSTR); o.ldr_i('r0', 'r4', 0); o.ldr_lit('r1', ROAR_SW); o.alu('cmp', 'r0', 'r1'); o.bc('ne', 'hf_f')
o.ldr_lit('r0', ORD_SW); o.str_i('r0', 'r4', 0)
o.label('hf_f'); o.pop(['r4']); o.pop(['r0']); o.bx('r0')
o.pool()

# callnative do script: metade da vida máxima, sem matar, e marca quem saiu
o.label('n_perde')
o.push(['r4', 'r5'], lr=True)
o.ldr_lit('r4', ALVO); o.ldrb_i('r4', 'r4', 0); mv(o, 0, 4); o.bl('mon'); mv(o, 5, 0)
o.ldrh_i('r0', 'r5', 0x2E); lsr(o, 0, 0, 1)
o.ldrh_i('r1', 'r5', 0x2A); o.alu('cmp', 'r0', 'r1'); o.bc('lo', 'np_ok'); mv(o, 0, 1); o.subi('r0', 1)
o.label('np_ok'); o.ldr_lit('r1', DMG); o.str_i('r0', 'r1', 0)
mv(o, 0, 4); o.bl('lado'); o.cmpi('r0', 0); o.bc('eq', 'np_f')
mv(o, 0, 4); o.bl('vaga_eq'); o.mov('r1', 1); _lslr(o, 1, 0)
o.ldr_lit('r2', PG2 + P_ESPERA); o.ldrb_i('r3', 'r2', 0); o.alu('orr', 'r3', 'r1'); o.strb_i('r3', 'r2', 0)
o.label('np_f')
o.ldr_lit('r1', INSTR); o.ldr_i('r0', 'r1', 0); o.addi('r0', 5); o.str_i('r0', 'r1', 0)
o.pop(['r4', 'r5']); o.pop(['r0']); o.bx('r0')
o.pool()

# chamada pelo comando 0x4D, com r0 = batalhador que acabou de entrar: quem a Ordem expulsou volta errando
o.label('entra')
o.push(['r4', 'r5'], lr=True); mv(o, 4, 0)
o.bl('lado'); o.cmpi('r0', 0); o.bc('eq', 'en_f')
lsr(o, 5, 4, 1); o.lsl('r5', 'r5', 2); o.ldr_lit('r0', PG2 + P_ATIVO); o.add_r('r5', 'r5', 'r0')
o.mov('r0', 0); o.str_i('r0', 'r5', 0)
mv(o, 0, 4); o.bl('vaga_eq'); o.mov('r1', 1); _lslr(o, 1, 0)
o.ldr_lit('r2', PG2 + P_ESPERA); o.ldrb_i('r3', 'r2', 0); o.alu('tst', 'r3', 'r1'); o.bc('eq', 'en_f')
o.alu('bic', 'r3', 'r1'); o.strb_i('r3', 'r2', 0)
mv(o, 0, 4); o.bl('mon'); o.ldr_i('r0', 'r0', 0x4C); o.str_i('r0', 'r5', 0)
o.label('en_f'); o.pop(['r4', 'r5']); o.pop(['r0']); o.bx('r0')
o.pool()

# comando 1 (accuracycheck), depois das contas do escudo: quem voltou da Ordem erra muito contra o lado do jogador
o.label('mira')
o.push(['r4', 'r5'], lr=True)
o.ldr_lit('r4', ATK); o.ldrb_i('r4', 'r4', 0); mv(o, 0, 4); o.bl('lado'); o.cmpi('r0', 0); o.bc('eq', 'mi_o')
o.ldr_lit('r0', ALVO); o.ldrb_i('r0', 'r0', 0); o.bl('lado'); o.cmpi('r0', 0); o.bc('ne', 'mi_o')
lsr(o, 1, 4, 1); o.lsl('r1', 'r1', 2); o.ldr_lit('r0', PG2 + P_ATIVO); o.add_r('r1', 'r1', 'r0'); o.ldr_i('r5', 'r1', 0)
o.cmpi('r5', 0); o.bc('eq', 'mi_o')
mv(o, 0, 4); o.bl('mon'); o.ldr_i('r0', 'r0', 0x4C); o.alu('cmp', 'r0', 'r5'); o.bc('ne', 'mi_o')
o.ldr_lit('r5', INSTR); o.ldr_i('r5', 'r5', 0)
o.ldrb_i('r0', 'r5', 5); o.ldrb_i('r1', 'r5', 6); o.alu('and_', 'r0', 'r1'); o.cmpi('r0', 0xFF); o.bc('eq', 'mi_o')  # conferência sem chance
o.ldr_lit('r3', RANDOM); o.bl('c3'); o.lsl('r0', 'r0', 16); lsr(o, 0, 0, 16)
o.mov('r1', 100); swi_div(o); o.cmpi('r1', ORD_ERRO); o.bc('hs', 'mi_o')
o.ldr_lit('r2', RESULT); o.ldrh_i('r0', 'r2', 0); o.mov('r1', 1); o.alu('orr', 'r0', 'r1'); o.strh_i('r0', 'r2', 0)
o.ldrb_i('r0', 'r5', 1)                       # o golpe vai para o endereço de "errou" que está no próprio comando
o.ldrb_i('r1', 'r5', 2); o.lsl('r1', 'r1', 8); o.alu('orr', 'r0', 'r1')
o.ldrb_i('r1', 'r5', 3); o.lsl('r1', 'r1', 16); o.alu('orr', 'r0', 'r1')
o.ldrb_i('r1', 'r5', 4); o.lsl('r1', 'r1', 24); o.alu('orr', 'r0', 'r1')
o.ldr_lit('r1', INSTR); o.str_i('r0', 'r1', 0); o.b('mi_f')
o.label('mi_o'); o.ldr_lit('r3', CMD_ACC); o.bl('c3')
o.label('mi_f'); o.pop(['r4', 'r5']); o.pop(['r0']); o.bx('r0')
o.pool()

# Imperador do golpe fatal: Sheer Cold no lugar do Protetor (ou na vaga 4), Ordem e Protetor nas últimas vagas livres
o.label('vaga')                               # r0 = vaga, r1 = golpe, r4 = Pokémon, r5 = batalhador
o.lsl('r2', 'r0', 1); o.add_r('r2', 'r2', 'r4'); o.strh_i('r1', 'r2', 0x0C)
o.add_r('r2', 'r4', 'r0'); o.addi('r2', 0x25); o.mov('r3', 5); o.strb_i('r3', 'r2', 0)
o.ldr_lit('r2', DISABLE_LIT); o.ldr_i('r2', 'r2', 0); o.mov('r3', 0x2C); o.alu('mul', 'r3', 'r5'); o.add_r('r2', 'r2', 'r3')
o.ldrb_i('r3', 'r2', 0x1C); o.mov('r1', 4); _lslr(o, 1, 0); o.alu('orr', 'r3', 'r1'); o.strb_i('r3', 'r2', 0x1C)   # como o Mimic: o PP do time não muda
o.bx('lr')
o.label('acha')                               # r0 = golpe, r4 = Pokémon -> r0 = vaga, ou 4
o.mov('r2', 0)
o.label('ac_l'); o.lsl('r1', 'r2', 1); o.add_r('r1', 'r1', 'r4'); o.ldrh_i('r3', 'r1', 0x0C); o.alu('cmp', 'r3', 'r0'); o.bc('eq', 'ac_f')
o.addi('r2', 1); o.cmpi('r2', 4); o.bc('lo', 'ac_l')
o.label('ac_f'); mv(o, 0, 2); o.bx('lr')
o.label('golpes')                             # r0 = Pokémon, r1 = batalhador
o.push(['r4', 'r5', 'r6', 'r7'], lr=True); mv(o, 4, 0); mv(o, 5, 1)
o.ldr_lit('r0', ID_ORDEM); o.bl('acha'); o.cmpi('r0', 4); o.bc('ne', 'go_f')             # já tem: nada a fazer
o.ldr_lit('r0', ID_PG); o.bl('acha'); mv(o, 6, 0); o.cmpi('r0', 4); o.bc('ne', 'go_a')
o.ldr_lit('r0', ID_SC_); o.bl('acha'); mv(o, 6, 0); o.cmpi('r0', 4); o.bc('ne', 'go_a')
o.mov('r6', 3)
o.label('go_a')
o.mov('r7', 3); o.cmpi('r6', 3); o.bc('ne', 'go_b'); o.mov('r7', 2)
o.label('go_b')
mv(o, 0, 6); o.ldr_lit('r1', ID_SC_); o.bl('vaga')
mv(o, 0, 7); o.ldr_lit('r1', ID_ORDEM); o.bl('vaga')
o.subi('r7', 1); o.alu('cmp', 'r7', 'r6'); o.bc('ne', 'go_c'); o.subi('r7', 1)
o.label('go_c')
mv(o, 0, 7); o.ldr_lit('r1', ID_PG); o.bl('vaga')
o.label('go_f'); o.pop(['r4', 'r5', 'r6', 'r7']); o.pop(['r0']); o.bx('r0')
o.pool()
assert o.here() <= ORD_TAREFA, hex(o.here())
put(ORD_CODE, o.build())
OL = o.labels

# animação: a do Noble Roar, com as linhas do grito azuis (tarefa logo depois de carregar o gráfico)
_pr = 0x09128840                            # tabela de paletas de animação: {paleta, tag}, 8 bytes, tag 0x2710 = entrada 0
_pr += 8 * (TAG_RUIDO - 0x2710)
assert struct.unpack_from('<H', ROM, _pr + 4 - 0x08000000)[0] == TAG_RUIDO
_cs = list(struct.unpack('<16H', lz77(ROM, w32(_pr) - 0x08000000)[0][:32]))
_cs = [c & 0x8000 | (c & 31) << 10 | c & 0x3E0 | c >> 10 & 31 for c in _cs]    # troca vermelho com azul
put(ORD_PAL, struct.pack('<16H', *_cs))
t = Asm(ORD_TAREFA)
t.push(['r4'], lr=True); mv(t, 4, 0)
t.ldr_lit('r1', 0x03000CF0); t.mov('r2', 0); t.ldr_lit('r0', TAG_RUIDO)
t.label('laco'); t.ldr_i('r3', 'r1', 0); t.alu('cmp', 'r3', 'r0'); t.bc('eq', 'achou')
t.addi('r1', 4); t.addi('r2', 1); t.cmpi('r2', 16); t.bc('lo', 'laco'); t.b('fim')
t.label('achou')
t.lsl('r1', 'r2', 4); t.addi('r1', 0x80); t.addi('r1', 0x80)
t.ldr_lit('r0', ORD_PAL); t.mov('r2', 0x20); t.ldr_lit('r3', LOADPAL | 1); t.bl('c3')
t.label('fim')
mv(t, 0, 4); t.ldr_lit('r3', 0x080F43A9); t.bl('c3')
t.pop(['r4']); t.pop(['r0']); t.bx('r0')
t.label('c3'); t.bx('r3')
t.pool()
assert t.here() <= ORD_ANIM, hex(t.here())
put(ORD_TAREFA, t.build())
_nr = w32(0x0846AB1C + 4 * ID_MOVE_NOBLE)
assert ROM[_nr - 0x08000000:_nr - 0x08000000 + 3] == b'\x00\x45\x27'
put(ORD_ANIM, b'\x00\x45\x27\x03' + p32(ORD_TAREFA | 1) + b'\x05\x00\x13' + p32(_nr + 3))
put(0x0846AB1C + 4 * ID_ORDEM, p32(ORD_ANIM))

# scripts: anima, a vida cai (sem acertar substituto), volta para a Pokébola e segue a troca do Roar
_ret = bytes.fromhex('090a') + b'\xff' + p32(OL['n_perde'] | 1) + b'\x35' + p32(HITMARKER_) + p32(0x01000100) + bytes.fromhex('0b000c00') + b'\x38' + p32(HITMARKER_) + p32(0x01000100) + ROM[ROAR_ANIMA - 0x08000000 + 2:ROAR_ANIMA - 0x08000000 + 9]
assert ORD_RET + len(_ret) <= ORD_SW
put(ORD_RET, _ret)
put(ORD_SW, b'\x41' + p32(ORD_RET) + b'\x28' + p32(ROAR_SW + 5))
assert ROM[0x53AD34 + 24 * ID_ORDEM + 5] != 0

# o golpe: mesmos dados do Roar, sem a prioridade baixa, com 5 de PP
_mo = bytearray(ROM[0x53AD34 + 24 * ID_MOVE_ROAR:0x53AD34 + 24 * ID_MOVE_ROAR + 24]); _mo[5] = 5; _mo[10] = 0
put(0x0853AD34 + 24 * ID_ORDEM, bytes(_mo))
_nm = enc('Ordem')
put(0x085188EB - 17 + 17 * ID_ORDEM, _nm + b'\xff' * (17 - len(_nm)))
put(ORD_DESC, enc('O Imperador expulsa o\nalvo, que perde metade\nda vida e volta errando.'))
put(0x092DB0A4 + 4 * (ID_ORDEM - 1), p32(ORD_DESC))

# ganchos
assert w32(CMD_TAB + 4 * 0x8F) == CMD_FORCE
put(CMD_TAB + 4 * 0x8F, p32(OL['h_force'] | 1))
put(0x08046654, struct.pack('<HHI', 0x4B00, 0x4718, OL['prio'] | 1))
