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

# tabela nova: 0x40 entradas originais + 0x40 vazio + 0x41 escolha de golpe
tab = b''.join(struct.pack('<I', rd(0x08539780 + 4 * k)) for k in range(0x40)) + struct.pack('<II', a.labels['h40'] | 1, a.labels['h41'] | 1)
salta = lambda alvo: struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, alvo | 1)
lista = [
    [TAB - 0x08000000, list(tab)],
    [E - 0x08000000, list(code)],
    [0x0808DADE - 0x08000000, list(struct.pack('<H', 0x2841))],     # cmp r0,#0x41
    [0x0808DB00 - 0x08000000, list(struct.pack('<I', TAB))],        # literal da tabela
    [0x0808CA98 - 0x08000000, list(salta(a.labels['apA']))],
    [0x0808CE8C - 0x08000000, list(salta(a.labels['apP']))],
]
assert R[0x8DADE:0x8DAE0] == bytes.fromhex('3f28'), R[0x8DADE:0x8DAE0].hex()
assert rd(0x0808DB00) == 0x08539780
assert R[0x8CA98:0x8CAA8].hex() == 'f0b557464e464546e0b482b000060000'[:24] + R[0x8CAA4:0x8CAA8].hex(), R[0x8CA98:0x8CAA8].hex()
print('A', R[0x8CA98:0x8CAA8].hex(), 'P', R[0x8CE8C:0x8CE9C].hex())
json.dump(lista, open('aprende_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)), 'labels', {k: hex(v) for k, v in a.labels.items() if not k.startswith('_')})
