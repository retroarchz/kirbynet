# Coop (luta pelo cabo): quem escolhe se aprende o golpe novo, e qual esquecer, é o DONO do Pokémon, na tela dele.
# No jogo original o comando de script 0x5A (aprender golpe?) e o 0x5B (parar de aprender?) desenham o Sim/Não e abrem a
# tela de golpes no próprio host. Aqui, em luta pelo cabo, o host manda pedidos ao controle do dono (lugar do campo
# gBattleStruct+0x23 bits 3-5) e espera a resposta:
#   - Sim/Não: comando novo 0x40 = o 0x13 do próprio jogo começando no Sim (resposta 0x0D = Sim, 0x0E = Não, bufferB);
#   - tela de golpes: comando novo 0x41 (só o controle do jogador conhece; os outros ignoram >0x3F), resposta = espaço 0-3
#     ou 4 (desistiu).
# O host continua o script do jogo (estado 4 = troca o golpe, 5 = não aprendeu), igual ao original.
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm

TAB = 0x09FF3EC0          # tabela nova do controle do jogador (0x42 entradas, até 0x09FF3FC8)
E = 0x09FF3800            # código
TMP = 0x0203F3F0          # pedido montado (4 bytes)
BATT = 0x0203F3F8         # lugar que está escolhendo (no dono)
ESTADO = 0x020234F0 + 0x1F   # gBattleScripting.learnMoveState
CURR = 0x0202320C         # gBattlescriptCurrInstr
GBS = 0x0202352C
RES = 0x02023538
EXEC = 0x02023040
TIPO = 0x02022FBC         # gBattleTypeFlags (bit 1 = cabo)
PREP = 0x08033AB8         # PrepareBufferDataTransfer(lugar, buffer, dados, tamanho)
MARCA = 0x0804BBC0        # MarkBattlerForControllerExec(lugar)
GOLPE = 0x02023582        # gMoveToLearn
ESPACO_GOLPE = 0x0203EE6D # sMoveSlotToReplace (GetMoveSlotToReplace 0x08296810)
FADE = 0x02039ABC + 7     # gPaletteFade.active (bit 7)
CB2 = 0x03002664          # gMain.callback2
BATTLE_CB2 = 0x0803F431
FUNCS = 0x0203FA00

R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
rd = lambda a: struct.unpack('<I', R[a - 0x08000000:a - 0x08000000 + 4])[0]

def monta(PRE):
    global a
    a = Asm(E)
    def chama(addr, reg='r7'):
        a.ldr_lit(reg, addr | 1); a.bl('via_' + reg)

    # ---------- comuns (host) ----------
    # r6 = lugar do dono
    a.label('campo')
    a.ldr_lit('r0', GBS); a.ldr_i('r0', 'r0', 0); a.addi('r0', 0x20); a.ldrb_i('r0', 'r0', 3); a.lsl('r0', 'r0', 26); a.h(0x0F40)  # lsrs r0,r0,#29
    a.movh('r6', 'r0'); a.bx('lr')
    # r0 = bufferB[r6][1]
    a.label('lerB')
    a.ldr_lit('r0', RES); a.ldr_i('r0', 'r0', 0); a.ldr_lit('r1', 0x1125); a.add_r('r0', 'r0', 'r1')
    a.lsl('r1', 'r6', 9); a.add_r('r0', 'r0', 'r1'); a.ldrb_i('r0', 'r0', 0); a.bx('lr')
    # manda o comando r0 ao lugar r6: [cmd, espaço, golpe lo, golpe hi]
    a.label('envia')
    a.push([], lr=True)
    a.ldr_lit('r1', TMP); a.strb_i('r0', 'r1', 0)
    a.ldr_lit('r2', GBS); a.ldr_i('r2', 'r2', 0); a.addi('r2', 0x20); a.ldrb_i('r2', 'r2', 2); a.strb_i('r2', 'r1', 1)
    a.ldr_lit('r2', GOLPE); a.ldrh_i('r2', 'r2', 0); a.strb_i('r2', 'r1', 2); a.h(0x0A12); a.strb_i('r2', 'r1', 3)  # lsrs r2,r2,#8
    a.movh('r0', 'r6'); a.mov('r1', 0); a.ldr_lit('r2', TMP); a.mov('r3', 4); chama(PREP)
    a.movh('r0', 'r6'); chama(MARCA)
    a.pop([], pc=True)
    a.label('via_r7'); a.bx('r7')
    a.label('via_r5'); a.bx('r5')
    a.pool()

    # ---------- host: tarefa "aprender o golpe?" do Quetzal (0x0808CA98, r0 = tarefa) ----------
    a.label('apA')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True); a.movh('r7', 'r0')
    a.ldr_lit('r0', TIPO); a.ldr_i('r0', 'r0', 0); a.mov('r1', 2); a.alu('tst', 'r0', 'r1'); a.bc('eq', 'aorig')
    a.ldr_lit('r4', ESTADO); a.ldrb_i('r5', 'r4', 0); a.bl('campo')
    a.cmpi('r5', 0); a.bc('ne', 'a10')
    a.mov('r0', 0x40); a.bl('envia'); a.mov('r0', 0x10); a.strb_i('r0', 'r4', 0); a.b('afim')
    a.label('a10')
    a.cmpi('r5', 0x10); a.bc('ne', 'a11')
    a.ldr_lit('r0', EXEC); a.ldr_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'afim')
    a.bl('lerB'); a.cmpi('r0', 0x0D); a.bc('ne', 'anao')
    a.mov('r0', 0x41); a.bl('envia'); a.mov('r0', 0x11); a.strb_i('r0', 'r4', 0); a.b('afim')
    a.label('anao'); a.mov('r0', 5); a.strb_i('r0', 'r4', 0); a.b('aorig')          # não quis: estado 5 do jogo
    a.label('a11')
    a.cmpi('r5', 0x11); a.bc('ne', 'aorig')
    a.ldr_lit('r0', EXEC); a.ldr_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'afim')
    a.bl('lerB'); a.cmpi('r0', 4); a.bc('hs', 'anao')
    a.ldr_lit('r1', ESPACO_GOLPE); a.strb_i('r0', 'r1', 0); a.mov('r0', 4); a.strb_i('r0', 'r4', 0); a.b('aorig')   # estado 4: troca
    a.label('afim'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.label('aorig'); a.movh('r0', 'r7'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.movh('lr', 'r1')
    for h in (0xB5F0, 0x4657, 0x464E, 0x4645, 0xB4E0, 0xB082, 0x0600, 0x0E00): a.h(h)   # as 8 trocadas de 0x0808CA98
    a.ldr_lit('r1', 0x0808CAA9); a.bx('r1')
    a.pool()

    # ---------- host: tarefa "parar de aprender?" (0x0808CE8C, r0 = tarefa). Sim -> data[0]=7, Não -> 0; segue 0x0808CFC8 ----------
    a.label('apP')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True); a.movh('r7', 'r0')
    a.ldr_lit('r0', TIPO); a.ldr_i('r0', 'r0', 0); a.mov('r1', 2); a.alu('tst', 'r0', 'r1'); a.bc('eq', 'porig')
    a.ldr_lit('r4', ESTADO); a.ldrb_i('r5', 'r4', 0); a.bl('campo')
    a.cmpi('r5', 0); a.bc('ne', 'p10')
    a.mov('r0', 0x40); a.bl('envia'); a.mov('r0', 0x10); a.strb_i('r0', 'r4', 0); a.b('pfim')
    a.label('p10')
    a.cmpi('r5', 0x10); a.bc('ne', 'porig')
    a.ldr_lit('r0', EXEC); a.ldr_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'pfim')
    a.bl('lerB'); a.mov('r2', 0); a.cmpi('r0', 0x0D); a.bc('ne', 'pnao'); a.mov('r2', 7)
    a.label('pnao')
    a.mov('r0', 40); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r1', 0x03005640); a.add_r('r0', 'r0', 'r1')
    a.strh_i('r2', 'r0', 8); a.ldr_lit('r1', 0x0808CFC9); a.str_i('r1', 'r0', 0)
    a.mov('r0', 1); a.strb_i('r0', 'r4', 0)
    a.label('pfim'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.label('porig'); a.movh('r0', 'r7'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.movh('lr', 'r1')
    for h in (0xB570, 0xB081, 0x0600, 0x0E06): a.h(h)                                     # trocadas de 0x0808CE8C
    a.ldr_lit('r5', 0x020234F0); a.ldrb_i('r4', 'r5', 0x1F); a.cmpi('r4', 0); a.bc('eq', 'porig0')
    a.ldr_lit('r0', 0x0808CE9D); a.bx('r0')
    a.label('porig0'); a.ldr_lit('r0', 0x0808CEA9); a.bx('r0')
    a.pool()

    # ---------- dono: comando 0x40 = Sim/Não do jogo (0x13) mas começando no Sim, como a pergunta original ----------
    a.label('h40')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    chama(0x080917D1)
    a.ldr_lit('r4', 0x03005570); a.ldrb_i('r0', 'r4', 0); a.cmpi('r0', 1); a.bc('ne', 'h40fim')
    a.mov('r0', 1); chama(0x08089048); a.mov('r0', 0); a.strb_i('r0', 'r4', 0); chama(0x08089010)
    a.label('h40fim'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.pool()

    # ---------- dono: comando 0x41 no controle do jogador (r0 = lugar) ----------
    a.label('h41')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    a.ldr_lit('r1', BATT); a.strb_i('r0', 'r1', 0)
    a.h(0xB081); a.mov('r0', 0); a.h(0x9000)                                         # sub sp,#4 ; str r0,[sp]
    a.ldr_lit('r0', 0xFFFFFFFF); a.mov('r1', 0); a.mov('r2', 0); a.mov('r3', 0x10); chama(0x080F1B08)   # BeginNormalPaletteFade
    a.addsp(4)
    a.label('poe_func')   # func[BATT] = r5 (preparado antes) -> aqui: e1
    a.ldr_lit('r1', BATT); a.ldrb_i('r0', 'r1', 0); a.lsl('r0', 'r0', 2); a.ldr_lit('r1', FUNCS); a.add_r('r0', 'r0', 'r1')
    a.ldr_lit('r2', PRE.get('e1', 0) | 1); a.str_i('r2', 'r0', 0)
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.pool()

    a.label('e1')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    a.h(0xB081)
    a.ldr_lit('r0', FADE); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 0x80); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'e1fim')
    chama(0x080036C4)                                                                # FreeAllWindowBuffers
    a.ldr_lit('r4', BATT); a.ldrb_i('r4', 'r4', 0)
    a.ldr_lit('r5', RES); a.ldr_i('r5', 'r5', 0); a.addi('r5', 0x24); a.lsl('r0', 'r4', 9); a.add_r('r5', 'r5', 'r0')
    a.ldrb_i('r1', 'r5', 2); a.ldrb_i('r2', 'r5', 3); a.lsl('r2', 'r2', 8); a.alu('orr', 'r1', 'r2'); a.h(0x9100)  # str r1,[sp]
    a.ldrb_i('r1', 'r5', 1)
    a.ldr_lit('r2', 0x020235C9); a.ldrb_i('r2', 'r2', 0); a.subi('r2', 1); a.lsl('r2', 'r2', 24); a.h(0x0E12)   # lsrs r2,r2,#24
    a.ldr_lit('r0', 0x020235CC); a.ldr_lit('r3', 0x080FB0F9)
    chama(0x0829686C, 'r5')                                                          # ShowSelectMovePokemonSummaryScreen
    a.lsl('r0', 'r4', 2); a.ldr_lit('r1', FUNCS); a.add_r('r0', 'r0', 'r1'); a.ldr_lit('r2', PRE.get('e2', 0) | 1); a.str_i('r2', 'r0', 0)
    a.label('e1fim'); a.addsp(4); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.pool()

    a.label('e2')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    a.ldr_lit('r0', FADE); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 0x80); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'e2fim')
    a.ldr_lit('r0', CB2); a.ldr_i('r0', 'r0', 0); a.ldr_lit('r1', BATTLE_CB2); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'e2fim')
    a.ldr_lit('r4', BATT); a.ldrb_i('r4', 'r4', 0)
    a.ldr_lit('r2', ESPACO_GOLPE); a.ldrb_i('r2', 'r2', 0)
    a.movh('r0', 'r4'); a.mov('r1', 1); a.mov('r3', 0); chama(0x08035668)          # EmitTwoReturnValues(lugar, B, espaço, 0)
    a.movh('r0', 'r4'); chama(0x0808DA4C)                                           # fim do comando
    a.label('e2fim'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.pool()


    return a
a = monta({})
a = monta(a.labels)
code = a.build()
assert E + len(code) <= 0x09FF3C00, hex(E + len(code))

# ---------- caixa de status do nível na tela do dono (comando 0x42) ----------
# O host roda a rotina 0x0808C6C8 (estado em gBattleScripting+0x1E, espera o A do host). Em luta pelo cabo, se o dono não é o
# próprio host, o host manda [0x42, espaço, 6 status de antes (12 bytes)] e espera; o dono roda a mesma rotina (com o A dele)
# e uma trava no fim (0x0808C8B4) impede que ela mexa na tarefa da experiência do dono.
E2 = 0x09FF3510
DONO = 0x0203F3F9; PRONTO = 0x0203F3FA; TMP2 = 0x0203F3E0
EST2 = 0x020234F0 + 0x1E
def monta2(PRE):
    c = Asm(E2)
    def chama2(addr, reg='r7'):
        c.ldr_lit(reg, addr | 1); c.bl('v_' + reg)
    # host
    c.label('hc')
    c.push(['r4', 'r5', 'r6', 'r7'], lr=True); c.movh('r7', 'r0')
    c.ldr_lit('r0', TIPO); c.ldr_i('r0', 'r0', 0); c.mov('r1', 2); c.alu('tst', 'r0', 'r1'); c.bc('eq', 'horig')
    c.ldr_lit('r0', GBS); c.ldr_i('r0', 'r0', 0); c.addi('r0', 0x20); c.ldrb_i('r6', 'r0', 3); c.lsl('r6', 'r6', 26); c.h(0x0F76)  # lsrs r6,r6,#29
    c.lsl('r0', 'r6', 2); c.ldr_lit('r1', FUNCS); c.add_r('r0', 'r0', 'r1'); c.ldr_i('r0', 'r0', 0); c.ldr_lit('r1', 0x0808DABD); c.alu('cmp', 'r0', 'r1'); c.bc('eq', 'horig')
    c.ldr_lit('r4', EST2); c.ldrb_i('r5', 'r4', 0)
    c.cmpi('r5', 0); c.bc('ne', 'h20')
    # monta [0x42, espaço, 12 bytes de status de antes] e manda ao lugar r6
    c.ldr_lit('r1', TMP2); c.mov('r0', 0x42); c.strb_i('r0', 'r1', 0)
    c.ldr_lit('r2', GBS); c.ldr_i('r2', 'r2', 0); c.addi('r2', 0x20); c.ldrb_i('r2', 'r2', 2); c.strb_i('r2', 'r1', 1)
    c.ldr_lit('r2', RES); c.ldr_i('r2', 'r2', 0); c.ldr_i('r2', 'r2', 0x10); c.mov('r3', 0)
    c.label('hcopia'); c.ldrb_r('r0', 'r2', 'r3'); c.add_r('r5', 'r1', 'r3'); c.strb_i('r0', 'r5', 2); c.addi('r3', 1); c.cmpi('r3', 12); c.bc('lo', 'hcopia')
    c.movh('r0', 'r6'); c.mov('r1', 0); c.ldr_lit('r2', TMP2); c.mov('r3', 14); chama2(PREP)
    c.movh('r0', 'r6'); chama2(MARCA)
    c.mov('r0', 0x20); c.strb_i('r0', 'r4', 0); c.b('hfim')
    c.label('h20')
    c.cmpi('r5', 0x20); c.bc('ne', 'horig')
    c.ldr_lit('r0', EXEC); c.ldr_i('r0', 'r0', 0); c.cmpi('r0', 0); c.bc('ne', 'hfim')
    c.mov('r0', 40); c.alu('mul', 'r0', 'r7'); c.ldr_lit('r1', 0x03005640); c.add_r('r0', 'r0', 'r1')   # o que o fim da rotina faz
    c.mov('r1', 1); c.strh_i('r1', 'r0', 0xA); c.mov('r1', 0); c.strh_i('r1', 'r0', 0xC); c.strh_i('r1', 'r0', 0xE)
    c.strh_i('r1', 'r0', 0x10); c.strh_i('r1', 'r0', 0x12); c.ldr_lit('r1', 0x0808C8E1); c.str_i('r1', 'r0', 0)
    c.mov('r0', 10); c.strb_i('r0', 'r4', 0)
    c.label('hfim'); c.pop(['r4', 'r5', 'r6', 'r7']); c.pop(['r0']); c.bx('r0')
    c.label('horig'); c.movh('r0', 'r7'); c.pop(['r4', 'r5', 'r6', 'r7']); c.pop(['r1']); c.movh('lr', 'r1')
    c.ldr_lit('r2', PRE.get('corig', 0) | 1); c.bx('r2')
    c.label('v_r7'); c.bx('r7')
    c.pool()
    return c
c = monta2({}); c = monta2(c.labels); code2 = c.build()
assert E2 + len(code2) <= 0x09FF3600, hex(E2 + len(code2))
print('caixa host/fim', hex(E2), '..', hex(E2 + len(code2)))

# dono: 0x42 no controle do jogador -> código no espaço que sobra depois de E (até 0x09FF3C00)
E3 = (E + len(code) + 3) & ~3
def monta3(PRE):
    d = Asm(E3)
    def chama3(addr, reg='r7'):
        d.ldr_lit(reg, addr | 1); d.bl('w_' + reg)
    d.label('h42')
    d.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    d.ldr_lit('r1', BATT); d.strb_i('r0', 'r1', 0)
    d.ldr_lit('r5', RES); d.ldr_i('r5', 'r5', 0); d.addi('r5', 0x24); d.lsl('r1', 'r0', 9); d.add_r('r5', 'r5', 'r1')   # bufferA
    d.ldrb_i('r1', 'r5', 1); d.ldr_lit('r2', GBS); d.ldr_i('r2', 'r2', 0); d.addi('r2', 0x20); d.strb_i('r1', 'r2', 2)  # espaço
    d.ldr_lit('r2', RES); d.ldr_i('r2', 'r2', 0); d.ldr_i('r2', 'r2', 0x10); d.mov('r3', 0)
    d.label('dcopia'); d.add_r('r1', 'r5', 'r3'); d.ldrb_i('r1', 'r1', 2); d.strb_r('r1', 'r2', 'r3'); d.addi('r3', 1); d.cmpi('r3', 12); d.bc('lo', 'dcopia')
    d.ldr_lit('r1', EST2); d.mov('r2', 0); d.strb_i('r2', 'r1', 0)
    d.ldr_lit('r1', PRONTO); d.strb_i('r2', 'r1', 0); d.ldr_lit('r1', DONO); d.mov('r2', 1); d.strb_i('r2', 'r1', 0)
    d.lsl('r0', 'r0', 2); d.ldr_lit('r1', FUNCS); d.add_r('r0', 'r0', 'r1'); d.ldr_lit('r2', PRE.get('e42', 0) | 1); d.str_i('r2', 'r0', 0)
    d.pop(['r4', 'r5', 'r6', 'r7']); d.pop(['r0']); d.bx('r0')
    d.pool()
    d.label('e42')
    d.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    d.mov('r0', 0); chama3(PRE.get('corig', 0))
    d.ldr_lit('r1', PRONTO); d.ldrb_i('r0', 'r1', 0); d.cmpi('r0', 0); d.bc('eq', 'e42fim')
    d.mov('r0', 0); d.strb_i('r0', 'r1', 0); d.ldr_lit('r1', DONO); d.strb_i('r0', 'r1', 0)
    d.ldr_lit('r0', BATT); d.ldrb_i('r0', 'r0', 0); chama3(0x0808DA4C)
    d.label('e42fim'); d.pop(['r4', 'r5', 'r6', 'r7']); d.pop(['r0']); d.bx('r0')
    d.label('w_r7'); d.bx('r7')
    d.pool()
    # fim da rotina (0x0808C8B4): no dono não mexe na tarefa, só avisa que acabou
    d.label('fimc')
    d.ldr_lit('r1', DONO); d.ldrb_i('r1', 'r1', 0); d.cmpi('r1', 0); d.bc('eq', 'forig')
    d.ldr_lit('r1', PRONTO); d.mov('r0', 1); d.strb_i('r0', 'r1', 0)
    d.ldr_lit('r1', 0x0808C8CF); d.bx('r1')
    d.label('forig')
    d.ldr_lit('r1', 0x03005640); d.lsl('r0', 'r5', 2); d.add_r('r0', 'r0', 'r5'); d.lsl('r0', 'r0', 3); d.add_r('r0', 'r0', 'r1')
    d.mov('r1', 1); d.strh_i('r1', 'r0', 0xA); d.strh_i('r4', 'r0', 0xC)
    d.ldr_lit('r1', 0x0808C8C5); d.bx('r1')
    d.pool()
    return d
E4 = 0x09FF3FD0   # depois da tabela (0x09FF3EC0..0x09FF3FCC)
e = Asm(E4)
e.label('corig')   # a rotina original da caixa (entrada sem o desvio)
for h in (0xB530, 0xB081, 0x0600, 0x0E05): e.h(h)
e.ldr_lit('r0', 0x020234F0); e.ldrb_i('r1', 'r0', 0x1E); e.movh('r4', 'r0'); e.cmpi('r1', 0)
e.ldr_lit('r2', 0x0808C6D9); e.bx('r2')
e.pool(); code4 = e.build(); assert E4 + len(code4) <= 0x09FF4000
d = monta3(dict(e.labels)); d = monta3({**d.labels, **e.labels}); code3 = d.build()
assert E3 + len(code3) <= 0x09FF3C00, hex(E3 + len(code3))
c = monta2(dict(e.labels)); code2 = c.build()
print('caixa dono', hex(E3), '..', hex(E3 + len(code3)))

# tabela nova: 0x40 entradas originais + 0x40 vazio + 0x41 escolha de golpe
tab = b''.join(struct.pack('<I', rd(0x08539780 + 4 * k)) for k in range(0x40)) + struct.pack('<III', a.labels['h40'] | 1, a.labels['h41'] | 1, d.labels['h42'] | 1)
salta = lambda alvo: struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, alvo | 1)
lista = [
    [TAB - 0x08000000, list(tab)],
    [E - 0x08000000, list(code)],
    [0x0808DADE - 0x08000000, list(struct.pack('<H', 0x2842))],     # cmp r0,#0x42
    [0x0808DB00 - 0x08000000, list(struct.pack('<I', TAB))],        # literal da tabela
    [0x0808CA98 - 0x08000000, list(salta(a.labels['apA']))],
    [0x0808CE8C - 0x08000000, list(salta(a.labels['apP']))],
    [E2 - 0x08000000, list(code2)],
    [E3 - 0x08000000, list(code3)],
    [E4 - 0x08000000, list(code4)],
    [0x0808C6C8 - 0x08000000, list(salta(c.labels['hc']))],
    [0x0808C8B4 - 0x08000000, list(salta(d.labels['fimc']))],
]
assert R[0x8C6C8:0x8C6D8].hex() == '30b581b00006050e0548817f041c0029'
assert R[0x8C8B4:0x8C8C4].hex() == '0849a8004019c0004018012141818481'
assert R[0x8DADE:0x8DAE0] == bytes.fromhex('3f28'), R[0x8DADE:0x8DAE0].hex()
assert rd(0x0808DB00) == 0x08539780
assert R[0x8CA98:0x8CAA8].hex() == 'f0b557464e464546e0b482b000060000'[:24] + R[0x8CAA4:0x8CAA8].hex(), R[0x8CA98:0x8CAA8].hex()
print('A', R[0x8CA98:0x8CAA8].hex(), 'P', R[0x8CE8C:0x8CE9C].hex())
json.dump(lista, open('aprende_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)), 'labels', {k: hex(v) for k, v in a.labels.items() if not k.startswith('_')})
