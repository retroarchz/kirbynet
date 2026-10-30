# Coop de 3 pessoas contra treinador. Aplica sobre a ROM da tripla (muda.py -> gancho.py -> coop3.py).
# uso: coop3.py rom_tripla rom_saida
import struct, sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'metaknight'))
from thumb import Asm
src, dst = sys.argv[1:3]
d = bytearray(open(src, 'rb').read()); B = 0x08000000
rd16 = lambda a: struct.unpack_from('<H', d, a - B)[0]
def h16(a, v, old):
    assert rd16(a) == old, (hex(a), hex(rd16(a)), hex(old))
    struct.pack_into('<H', d, a - B, v)
def w32(a, v): struct.pack_into('<I', d, a - B, v)

# ---------- 1) espera "Aguardando o outro jogador... Pressione R" ----------
# 0x08262BA4 "tem parceiro para batalha coop?" só aceitava exatamente 2 conectados: "cmp r0,#2; bne não" -> "blo não"
h16(0x08262BAC, 0xD316, 0xD116)
# 0x0826178C "algum parceiro pronto?" respondia só pelo 1º outro jogador da lista (com 3, o P1 olhava só o P2).
#    Agora: se o coop está ligado (0x0300456C), devolve 1 se QUALQUER outro tem 0x03004578[i] != 0; senão segue o laço.
#    (r1 = nº de jogadores não é mais estragado; o "ldrb" usa r0)
h16(0x082617A2, 0x46C0, 0x2100)   # movs r1,#0       -> nop
h16(0x082617A8, 0xD015, 0xD005)   # beq 0x082617B6   -> beq 0x082617D6 (devolve 0)
h16(0x082617AE, 0x7800, 0x7801)   # ldrb r1,[r0]     -> ldrb r0,[r0]
h16(0x082617B0, 0x2800, 0x4248)   # rsbs r0,r1,#0    -> cmp r0,#0
h16(0x082617B2, 0xD00B, 0x4308)   # orrs r0,r1       -> beq 0x082617CC (próximo jogador)
h16(0x082617B4, 0x2001, 0x0FC1)   # lsrs r1,r0,#31   -> movs r0,#1
h16(0x082617B6, 0xE00F, 0x1C08)   # adds r0,r1,#0    -> b 0x082617D8 (fim)

# ---------- código novo no fim da ROM ----------
FAR = [0x09FF0000]
def far(corpo):
    a = Asm(FAR[0]); corpo(a)
    a.pool(); a.label('_r3'); a.bx('r3')
    code = a.build(); ini = FAR[0]
    assert set(d[ini - B:ini - B + len(code)]) == {0xFF}
    d[ini - B:ini - B + len(code)] = code; FAR[0] = (ini + len(code) + 3) & ~3
    return ini
def call(a, f): a.ldr_lit('r3', f | 1); a.bl('_r3')          # chamada longa (estraga r3)
def desvia(f, alvo):
    # troca o começo da função f (alinhada em 4) por "bx pc; nop; ldr ip,=alvo; bx ip": o lr continua o do chamador
    assert f % 4 == 0
    d[f - B:f - B + 4] = struct.pack('<HH', 0x4778, 0x46C0)
    d[f - B + 4:f - B + 16] = struct.pack('<III', 0xE59FC000, 0xE12FFF1C, alvo | 1)

# ---------- 2) marcas "esperando resposta" da batalha pelo cabo (gBattleControllerExecFlags 0x02023040) ----------
# Antes: lugar b do jogador i no bit b + 4*i, "pendente" no bit 28 + b (só cabem 4 lugares).
# Agora: bit b + 6*i e pendente no bit 24 + b (6 lugares; até 4 jogadores = 24 bits + 6).
EXEC = 0x02023040
h16(0x0804BB1E, 0x0609, 0x0709)   # marca todos pendentes:   lsls r1,r1,#28 -> #24
h16(0x0804BB8A, 0x0600, 0x0700)   # lugar está pendente?:     lsls r0,r0,#28 -> #24
h16(0x0804BBDA, 0x0609, 0x0709)   # marca um lugar pendente:  lsls r1,r1,#28 -> #24
def recebeu(a):
    # MarkBattlerReceivedLinkData(b): para cada jogador i, marca (1<<b) << 6*i; tira o "pendente" (1<<24) << b
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    a.movh('r6', 'r0')
    call(a, 0x0800BCD8)                       # GetLinkPlayerCount
    a.movh('r7', 'r0')
    a.mov('r4', 0)                            # i*6
    a.mov('r5', 0)                            # i
    a.label('laco')
    a.alu('cmp', 'r5', 'r7'); a.bc('ge', 'fim')
    a.mov('r1', 1)
    a.h(0x4000 | 2 << 6 | 6 << 3 | 1)        # lsls r1,r6  (1 << b)
    a.h(0x4000 | 2 << 6 | 4 << 3 | 1)        # lsls r1,r4  (<< 6*i)
    a.ldr_lit('r2', EXEC); a.ldr_i('r0', 'r2', 0); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r2', 0)
    a.addi('r4', 6); a.addi('r5', 1); a.b('laco')
    a.label('fim')
    a.mov('r1', 1); a.lsl('r1', 'r1', 24)
    a.h(0x4000 | 2 << 6 | 6 << 3 | 1)        # lsls r1,r6
    a.ldr_lit('r2', EXEC); a.ldr_i('r0', 'r2', 0); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r2', 0)
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
desvia(0x0804BC0C, far(recebeu))
# escolha de ação (0x08044CF8...): espera com a máscara montada à mão no formato antigo
#   bit<<4 | 0xF<<28 | bit | bit<<8 | bit<<12   ->   bit<<6 | 0x3F<<24 | bit | bit<<12 | bit<<18
for s in (0x08044FEA, 0x0804580E, 0x08045CFA, 0x08045DA6, 0x08045E06, 0x08045EC8):
    for off, de, para in ((0, 4, 6), (10, 8, 12), (14, 12, 18)):
        h = rd16(s + off); assert h >> 11 == 0 and (h >> 6) & 0x1F == de and (h >> 3) & 7 == 2, (hex(s + off), hex(h))
        h16(s + off, (h & ~(0x1F << 6)) | para << 6, h)
    h = rd16(s + 2); assert h >> 11 == 0b00100 and h & 0xFF == 0xF0, hex(h); h16(s + 2, (h & 0xFF00) | 0x3F, h)
    assert rd16(s + 4) >> 6 & 0x1F == 24
# escolha de ação: o estado de cada lugar fica em gBattleCommunication[lugar] (0x0202339C), mas o índice 4 é também o
# contador de ações confirmadas, zerado a cada quadro -> o lugar 4 recomeçava sempre. O contador vai para +0x1C
# (0x020233B8, sobra da gProtectStructs antiga, que o muda.py levou para 0x0203F848).
for at, de, para in ((0x08044D08, 0x7101, 0x7701), (0x08045DC4, 0x7908, 0x7F08), (0x08045DC8, 0x7108, 0x7708), (0x08045F06, 0x7910, 0x7F10)):
    h16(at, para, de)
# rotina dos pacotes da batalha (0x08034308): aceita lugares 0..5
h16(0x08034384, 0x2F05, 0x2F03)   # lugar do pacote
h16(0x08034500, 0x2905, 0x2903)   # atacante
h16(0x08034504, 0x2B05, 0x2B03)   # alvo
h16(0x08034508, 0x2E05, 0x2E03)   # (byte 7)
# resposta "pronto" do jogador r2 para o lugar r7: tira (1<<r7) << 6*r2   [r1 = ((1<<r7) << 3*r2) << 3*r2]
for i, (v, old) in enumerate(((0x2101, 0x4905), (0x40B9, 0x00B8), (0x0050, 0x1840), (0x1812, 0x0092), (0x4091, 0x6801), (0x4091, 0x4091))):
    h16(0x0803456C + 2 * i, v, old)

# ---------- 3) preparação da batalha para 3 jogadores ----------
STATE, MYID = 0x0202339C, 0x02023515
PARTY, ENEMY, RECV = 0x020235CC, 0x02023AAC, 0x020223C4
LINKP = 0x020229F0                        # gLinkPlayers (0x24 cada)
CTRL, POS, PIDX, COUNT = 0x0203FA00, 0x0203F40C, 0x0203F400, 0x02023044
FLAG = 0x0203FE00                         # tripla ligada (gancho.py)
SALVA_LP2 = 0x0203FE40                    # cópia do gLinkPlayers[2] (P3) antes da etapa 1 original
ABSENT = 0x02023209                       # gAbsentBattlerFlags (vai no cabeçalho dos pacotes da batalha)
TYPE = 0x02022FBC
ORIG = 0x080499BD
F_STATUS, F_RESET, F_DONE, F_MASK, F_SEND = 0x0800C2A8, 0x0800C30C, 0x0800C278, 0x0800C1E8, 0x0800C204
F_MEMCPY, F_LEADER, F_ENEMYX = 0x082BEA08, 0x082618C4, 0x08261884
SET_PLAYER, SET_PARTNER, SET_OPP, SET_LINKOPP = 0x0808DA15, 0x081D4E5D, 0x08094719, 0x08099295
def prep3(a):
    # despachante: só 3 jogadores no cabo e etapas 2..13 ficam aqui; o resto vai para a preparação original
    a.ldr_lit('r0', 0x03003480); a.ldr_i('r0', 'r0', 0); a.lsl('r0', 'r0', 27); a.h(0x0F40)   # lsrs r0,r0,#29
    a.cmpi('r0', 3); a.bc('ne', 'orig')
    a.ldr_lit('r0', STATE); a.ldrb_i('r0', 'r0', 0)
    a.cmpi('r0', 2); a.bc('lo', 'antes'); a.cmpi('r0', 13); a.bc('ls', 'meu')
    a.label('orig'); a.ldr_lit('r0', ORIG); a.bx('r0')
    # etapa 0: guarda o lp[2] (o P3), porque a etapa 1 original escreve o treinador inimigo nessa vaga
    a.label('antes'); a.cmpi('r0', 0); a.bc('ne', 'orig')
    a.ldr_lit('r0', LINKP + 2 * 0x24); a.ldr_lit('r1', SALVA_LP2); a.mov('r2', 0x24)
    a.label('copia'); a.ldrb_i('r3', 'r0', 0); a.strb_i('r3', 'r1', 0); a.addi('r0', 1); a.addi('r1', 1); a.subi('r2', 1); a.bc('ne', 'copia')
    a.b('orig')
    a.label('meu')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    call(a, 0x080FAF0C); call(a, 0x08007180); call(a, 0x080071CC)           # tarefas, sprites, OAM
    call(a, 0x0800C1C0); a.ldr_lit('r1', MYID); a.strb_i('r0', 'r1', 0); a.movh('r4', 'r0')   # r4 = meu id
    a.ldr_lit('r5', STATE); a.ldrb_i('r6', 'r5', 0)                          # r6 = etapa
    for n, lab in ((2, 'e2'), (3, 'e3'), (4, 'e4'), (13, 'e13')):
        a.cmpi('r6', n); a.bfar('eq', lab)
    a.cmpi('r6', 7); a.bfar('eq', 'manda'); a.cmpi('r6', 9); a.bfar('eq', 'manda'); a.cmpi('r6', 11); a.bfar('eq', 'manda')
    a.b('recebe')
    a.pool()
    # etapa 2: dados de compatibilidade dos 3 (o bit 0x1000 tem que vir ligado)
    a.label('e2')
    # treinador inimigo da vaga 2 para a 3 (id 1 = lugar 1); a vaga 2 volta a ser o P3 com id 4 (lugar 4)
    a.ldr_lit('r0', LINKP + 2 * 0x24 + 0x18); a.ldrh_i('r0', 'r0', 0); a.cmpi('r0', 1); a.bc('ne', 'e2st')
    a.ldr_lit('r0', LINKP + 3 * 0x24); a.ldr_lit('r1', LINKP + 2 * 0x24); a.mov('r2', 0x24); call(a, F_MEMCPY)
    a.ldr_lit('r0', LINKP + 2 * 0x24); a.ldr_lit('r1', SALVA_LP2); a.mov('r2', 0x24); call(a, F_MEMCPY)
    a.ldr_lit('r0', LINKP + 2 * 0x24 + 0x18); a.mov('r1', 4); a.strh_i('r1', 'r0', 0)
    a.label('e2st')
    call(a, F_STATUS); a.mov('r1', 7); a.alu('and_', 'r0', 'r1'); a.cmpi('r0', 7); a.bfar('ne', 'sai')
    a.mov('r7', 0)
    a.label('e2laco')
    a.lsl('r0', 'r7', 8); a.ldr_lit('r1', RECV + 2); a.ldrh_r('r2', 'r1', 'r0'); a.h(0x0892)  # lsrs r2,r2,#2
    a.mov('r1', 0x80); a.lsl('r1', 'r1', 5); a.alu('tst', 'r2', 'r1'); a.bc('ne', 'e2ok')
    call(a, 0x0800A9AC); a.ldr_lit('r0', 0x0800CCE5); call(a, 0x0800055C); a.b('sai')
    a.label('e2ok')
    a.mov('r0', 0x24); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r1', LINKP + 2); a.add_r('r1', 'r1', 'r0')
    a.ldrh_i('r0', 'r1', 0); a.ldr_lit('r3', 0xE3FF); a.alu('and_', 'r0', 'r3')
    a.mov('r3', 0x07); a.lsl('r3', 'r3', 10); a.alu('and_', 'r2', 'r3'); a.alu('orr', 'r0', 'r2'); a.strh_i('r0', 'r1', 0)
    a.addi('r7', 1); a.cmpi('r7', 3); a.bc('lo', 'e2laco')
    call(a, F_RESET)
    a.mov('r0', 3); a.movh('r1', 'r4'); call(a, 0x0803DDE4)
    call(a, 0x0803DBCC)
    a.b('proxima')
    a.pool()
    # etapa 3: cada um manda os 2 primeiros Pokémon da equipe
    a.label('e3')
    call(a, F_DONE); a.cmpi('r0', 0); a.bfar('eq', 'sai')
    call(a, F_MASK); a.ldr_lit('r1', PARTY); a.mov('r2', 0xD0); call(a, F_SEND)
    a.b('proxima')
    # etapa 4: equipe da batalha = P1 nos espaços 0-1, P2 nos 2-3, P3 nos 4-5
    a.label('e4')
    call(a, F_STATUS); a.mov('r1', 7); a.alu('and_', 'r0', 'r1'); a.cmpi('r0', 7); a.bfar('ne', 'sai')
    call(a, F_RESET)
    a.mov('r7', 0)
    a.label('e4laco')
    a.mov('r0', 0xD0); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r1', PARTY); a.add_r('r0', 'r0', 'r1')
    a.lsl('r1', 'r7', 8); a.ldr_lit('r2', RECV); a.add_r('r1', 'r1', 'r2'); a.mov('r2', 0xD0); call(a, F_MEMCPY)
    a.addi('r7', 1); a.cmpi('r7', 3); a.bc('lo', 'e4laco')
    call(a, F_ENEMYX); a.mov('r1', 13); a.cmpi('r0', 0); a.bc('eq', 'e4fim'); a.mov('r1', 7)
    a.label('e4fim'); a.strb_i('r1', 'r5', 0); a.b('sai')
    a.pool()
    # etapas 7/9/11: o líder manda 2 Pokémon do treinador por vez; os outros mandam 1 byte
    a.label('manda')
    call(a, F_DONE); a.cmpi('r0', 0); a.bfar('eq', 'sai')
    call(a, F_LEADER); a.cmpi('r0', 0); a.bc('eq', 'l0'); a.mov('r0', 1)
    a.label('l0'); a.alu('cmp', 'r0', 'r4'); a.bc('ne', 'naolider')
    a.movh('r1', 'r6'); a.subi('r1', 7); a.mov('r0', 0x68); a.alu('mul', 'r1', 'r0'); a.ldr_lit('r0', ENEMY); a.add_r('r1', 'r1', 'r0')
    a.movh('r7', 'r1'); call(a, F_MASK); a.movh('r1', 'r7'); a.mov('r2', 0xD0); call(a, F_SEND); a.b('proxima')
    a.label('naolider')
    call(a, F_MASK); a.ldr_lit('r1', 0x030055F0); a.mov('r2', 1); call(a, F_SEND); a.b('proxima')
    # etapas 8/10/12: quem não é o líder copia a parte da equipe do treinador
    a.label('recebe')
    a.cmpi('r6', 8); a.bc('eq', 'rec'); a.cmpi('r6', 10); a.bc('eq', 'rec'); a.cmpi('r6', 12); a.bfar('ne', 'sai')
    a.label('rec')
    call(a, F_STATUS); a.mov('r1', 7); a.alu('and_', 'r0', 'r1'); a.cmpi('r0', 7); a.bfar('ne', 'sai')
    call(a, F_LEADER); a.cmpi('r0', 0); a.bc('eq', 'l1'); a.mov('r0', 1)
    a.label('l1'); a.movh('r7', 'r0')
    call(a, F_RESET)
    a.alu('cmp', 'r7', 'r4'); a.bfar('eq', 'proxima')
    a.movh('r0', 'r6'); a.subi('r0', 8); a.mov('r1', 0x68); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r1', ENEMY); a.add_r('r0', 'r0', 'r1')
    a.lsl('r1', 'r7', 8); a.ldr_lit('r2', RECV); a.add_r('r1', 'r1', 'r2'); a.mov('r2', 0xD0); call(a, F_MEMCPY)
    a.b('proxima')
    a.pool()
    # etapa 13: igual à original e depois os 6 lugares
    a.label('e13')
    call(a, F_ENEMYX); a.cmpi('r0', 0); a.bc('eq', 'e13a'); call(a, 0x0809FBC4)
    a.label('e13a')
    a.mov('r7', 0)
    a.label('e13laco')
    a.mov('r0', 0x68); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r1', PARTY); a.add_r('r0', 'r0', 'r1'); a.mov('r1', 0xC); call(a, 0x0809EAC4)
    a.ldr_lit('r1', 0x0202352C); a.ldr_i('r1', 'r1', 0); a.lsl('r2', 'r7', 2); a.add_r('r1', 'r1', 'r2'); a.ldr_lit('r2', 0x3E0); a.add_r('r1', 'r1', 'r2')
    a.ldrh_i('r2', 'r1', 0); a.ldr_lit('r3', 0x8000); a.alu('and_', 'r2', 'r3'); a.lsl('r0', 'r0', 17); a.h(0x0C40)  # lsrs r0,r0,#17
    a.alu('orr', 'r2', 'r0'); a.strh_i('r2', 'r1', 0)
    a.addi('r7', 1); a.cmpi('r7', 6); a.bc('lo', 'e13laco')
    a.ldr_lit('r0', FLAG); a.mov('r1', 1); a.strb_i('r1', 'r0', 0)                # liga a tripla
    call(a, EXTRA)                                                                # imagens dos lugares 4/5
    # paletas dos lugares 4/5 = slots 4/5: reservar 6 (gReservedSpritePaletteCount), senão as caixas de vida
    # (paleta com tag no slot 4) ficavam com as cores do Pokémon do lugar 4 (marrom/laranja)
    a.ldr_lit('r0', 0x030033BC); a.mov('r1', 6); a.strb_i('r1', 'r0', 0)
    call(a, 0x08032E98)                                                           # montagem original (4 lugares)
    # 6 lugares: pares = jogadores (o meu = Player, os outros = LinkPartner); ímpares = treinador
    a.ldr_lit('r0', TYPE); a.ldr_i('r0', 'r0', 0); a.mov('r1', 4); a.alu('and_', 'r0', 'r1'); a.movh('r6', 'r0')   # r6 = mestre?
    a.mov('r7', 0)
    a.label('lug')
    a.mov('r0', 1); a.alu('tst', 'r7', 'r0'); a.bc('ne', 'inimigo')
    a.lsl('r0', 'r7', 0); a.h(0x0840)                                             # lsrs r0,r0,#1 (jogador = lugar/2)
    a.ldr_lit('r1', SET_PARTNER); a.alu('cmp', 'r0', 'r4'); a.bc('ne', 'poe'); a.ldr_lit('r1', SET_PLAYER); a.b('poe')
    a.label('inimigo')
    a.ldr_lit('r1', SET_LINKOPP); a.cmpi('r6', 0); a.bc('eq', 'poe'); a.ldr_lit('r1', SET_OPP)
    a.label('poe')
    a.lsl('r0', 'r7', 2); a.ldr_lit('r2', CTRL); a.add_r('r2', 'r2', 'r0'); a.str_i('r1', 'r2', 0)
    a.ldr_lit('r2', POS); a.strb_r('r7', 'r2', 'r7')
    a.addi('r7', 1); a.cmpi('r7', 6); a.bc('lo', 'lug')
    # equipe de cada lugar: jogadores 0,2,4 -> espaços 0,2,4; treinador 1,3,5 -> 0,1,2
    a.ldr_lit('r2', PIDX)
    for b, v in enumerate((0, 0, 2, 1, 4, 2)):
        a.mov('r0', v); a.strh_i('r0', 'r2', 2 * b)
    a.ldr_lit('r2', COUNT); a.mov('r0', 6); a.strb_i('r0', 'r2', 0)
    # lugares sem Pokémon (treinador com menos de 3) ficam "ausentes" (gAbsentBattlerFlags)
    a.mov('r6', 0); a.mov('r7', 0)
    a.label('aus')
    a.lsl('r0', 'r7', 1); a.ldr_lit('r1', PIDX); a.ldrh_r('r0', 'r1', 'r0'); a.mov('r1', 0x68); a.alu('mul', 'r0', 'r1')
    a.ldr_lit('r1', PARTY); a.mov('r2', 1); a.alu('tst', 'r7', 'r2'); a.bc('eq', 'ausj'); a.ldr_lit('r1', ENEMY); a.label('ausj')
    a.add_r('r0', 'r0', 'r1'); a.mov('r1', 0xB); call(a, 0x0809EAC4)          # GetMonData(mon, MON_DATA_SPECIES)
    a.cmpi('r0', 0); a.bc('ne', 'ausp')
    a.mov('r0', 1); a.h(0x40B8 | 0)                                              # lsls r0,r7
    a.alu('orr', 'r6', 'r0')
    a.label('ausp'); a.addi('r7', 1); a.cmpi('r7', 6); a.bc('lo', 'aus')
    if not os.environ.get('SEM_AUS'): a.ldr_lit('r2', ABSENT); a.strb_i('r6', 'r2', 0)
    # treinador sem 3º Pokémon: a batalha fica com 5 lugares (o lugar 5 nem existe para os laços do jogo)
    a.mov('r0', 0x20); a.alu('tst', 'r6', 'r0'); a.bc('eq', 'seis')
    a.ldr_lit('r2', COUNT); a.mov('r0', 5); a.strb_i('r0', 'r2', 0)
    a.label('seis')
    a.ldr_lit('r2', 0x0202339D); a.mov('r0', 0); a.strb_i('r0', 'r2', 0); a.strb_i('r0', 'r2', 1)
    a.label('proxima')
    a.ldrb_i('r0', 'r5', 0); a.addi('r0', 1); a.strb_i('r0', 'r5', 0)
    a.label('sai')
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
# bloco extra de imagens dos lugares 4/5 (o mesmo do gancho.py, passo 10). O gancho só o monta se a tripla já
# está ligada quando a batalha aloca os gráficos (0x08094570); no coop ela só liga na etapa 13, então o bloco
# ficava vazio e o Pokémon do lugar 4 nascia sem imagem (mostrava restos da memória de vídeo: texto das caixas).
GPTR, EXTV, EXTBLK = 0x02023574, 0x0203FE04, 0x0203FC40
NEWTPL = struct.unpack_from('<I', d, 0x08094648 - B)[0]
def monta_extra(a):
    a.push(['r4', 'r5', 'r6'], lr=True)
    a.ldr_lit('r4', EXTBLK)
    a.ldr_lit('r2', GPTR); a.ldr_i('r2', 'r2', 0); a.ldr_i('r5', 'r2', 0); a.str_i('r5', 'r4', 0)
    a.ldr_lit('r0', 0x1000); a.add_r('r5', 'r5', 'r0')                 # metade de cima do buffer da posição 0
    a.ldr_lit('r6', 0x74); a.add_r('r6', 'r6', 'r4')                 # r6 = &quadros[0]
    for i in range(2):
        a.ldr_lit('r0', 0x2000 * i); a.add_r('r0', 'r0', 'r5'); a.str_i('r0', 'r4', 4 + 4 * i)
        for j in range(2):
            a.ldr_lit('r1', 0x800 * j); a.add_r('r1', 'r1', 'r0'); a.str_i('r1', 'r6', 0x10 * i + 8 * j)
            a.ldr_lit('r1', 0x800); a.strh_i('r1', 'r6', 0x10 * i + 8 * j + 4)
        a.ldr_lit('r1', NEWTPL + (4 + i) * 0x18)
        for w in range(6): a.ldr_i('r2', 'r1', 4 * w); a.str_i('r2', 'r4', 0x14 + i * 0x18 + 4 * w)
        a.ldr_lit('r1', 0x10 * i); a.add_r('r1', 'r1', 'r6'); a.str_i('r1', 'r4', 0x14 + i * 0x18 + 0xC)   # images
    a.ldr_lit('r2', GPTR); a.ldr_i('r2', 'r2', 0)
    for off in (0x134, 0x138, 0x13C):
        a.ldr_lit('r3', off); a.add_r('r1', 'r2', 'r3'); a.ldr_i('r0', 'r1', 0); a.add_r('r1', 'r4', 'r3'); a.str_i('r0', 'r1', 0)
    a.ldr_lit('r2', EXTV); a.str_i('r4', 'r2', 0)
    a.pop(['r4', 'r5', 'r6']); a.pop(['r0']); a.bx('r0')
EXTRA = far(monta_extra)
P3 = far(prep3)
assert struct.unpack_from('<I', d, 0x0803D4C8 - B)[0] == ORIG; w32(0x0803D4C8, P3 | 1)

# ---------- 4) lugares vazios na tripla (treinador com menos de 3 Pokémon) ----------
# Área livre perto do código da batalha (sobra da função morta 0x0808A35C que o gancho.py não usou): dá para "bl" direto.
LOW = [0x0808A498, 0x0808A35C + 0x222]
def baixo(corpo):
    a = Asm(LOW[0]); corpo(a); a.pool(); code = a.build(); ini = LOW[0]
    assert ini + len(code) <= LOW[1], 'sem espaço na área baixa'
    d[ini - B:ini - B + len(code)] = code; LOW[0] = (ini + len(code) + 3) & ~3
    return ini
MONS = 0x0203F424
SPRITES = 0x02020630                         # gBattleMons (0x60 cada), já mudado pelo muda.py
def bl_em(at, to, antigo):
    off = antigo - (at + 4); old = struct.pack('<HH', 0xF000 | ((off >> 12) & 0x7FF), 0xF800 | ((off >> 1) & 0x7FF))
    assert bytes(d[at - B:at - B + 4]) == old, hex(at)
    off = to - (at + 4); d[at - B:at - B + 4] = struct.pack('<HH', 0xF000 | ((off >> 12) & 0x7FF), 0xF800 | ((off >> 1) & 0x7FF))
# passo 6 do gancho (envio do 3º na entrada), no fim da tarefa de envio (Task_StartSendOutAnim 0x08039D18):
#  - lado do treinador: no fim do envio do lugar 1 manda o lugar 5 (se tem Pokémon);
#  - 3º jogador: no fim do envio do lugar 2 o treinador do lugar 4 faz a pose de arremesso e desliza para fora
#    (igual a BtlController_HandleIntroTrainerBallThrow 0x08039978); quando sai de cena (os outros dois já
#    saíram e liberaram a memória de vídeo) o callback envia4 manda o Pokémon e mostra a caixa de vida.
#    O "arremessar" normal da abertura não serve para o lugar 4: o controlador espera o "parceiro" b^2 = 6.
SPR_IDS, HB_IDS = 0x0203F664, 0x0203F9F8
def manda(a, reg_b, reg_mon):
    # BattleLoadMonSpriteGfx(mon, b); StartSendOutAnim(b, FALSE)
    a.movh('r0', reg_mon); a.movh('r1', reg_b); call(a, 0x080931C8)
    a.movh('r0', reg_b); a.mov('r1', 0); call(a, 0x08037B40)
def envia4(a):                                     # callback do fim do deslize do treinador do lugar 4 (r0 = sprite)
    a.push(['r4', 'r5'], lr=True)
    call(a, 0x08039F3C)                            # o do jogo: libera o treinador e carrega a imagem do Pokémon
    a.mov('r0', 4); a.mov('r1', 0); call(a, 0x08037B40)                 # StartSendOutAnim(4, FALSE)
    a.ldr_lit('r1', PIDX + 8); a.ldrh_i('r1', 'r1', 0); a.mov('r0', 0x68); a.alu('mul', 'r1', 'r0')
    a.ldr_lit('r0', PARTY); a.add_r('r5', 'r1', 'r0')
    a.ldr_lit('r4', HB_IDS); a.ldrb_i('r0', 'r4', 4); a.movh('r1', 'r5'); a.mov('r2', 0); call(a, 0x080AE0AC)   # UpdateHealthboxAttribute
    a.mov('r0', 4); call(a, 0x080B1254)                                  # StartHealthboxSlideIn(4)
    a.ldrb_i('r0', 'r4', 4); call(a, 0x080AB3A4)                         # SetHealthboxSpriteVisible
    a.pop(['r4', 'r5']); a.pop(['r0']); a.bx('r0')
ENVIA4 = far(envia4)
def envio3(a):
    a.push(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], lr=True)
    a.ldr_lit('r2', FLAG); a.ldrb_i('r2', 'r2', 0); a.cmpi('r2', 0); a.bfar('eq', 'out')
    a.mov('r2', 0x28); a.alu('mul', 'r2', 'r0'); a.ldr_lit('r3', 0x03005648); a.add_r('r2', 'r2', 'r3'); a.ldrh_i('r4', 'r2', 0)
    a.cmpi('r4', 2); a.bc('eq', 'jogador'); a.cmpi('r4', 1); a.bfar('ne', 'out'); a.addi('r4', 2)
    a.label('jogador'); a.addi('r4', 2)                                  # 1 -> 5, 2 -> 4
    # Pokémon do lugar pela equipe (a gBattleMons dele ainda não está pronta neste ponto da batalha coop)
    a.ldr_lit('r3', PIDX); a.lsl('r5', 'r4', 1); a.ldrh_r('r5', 'r3', 'r5')
    a.mov('r7', 0x68); a.alu('mul', 'r7', 'r5')
    a.ldr_lit('r3', PARTY); a.mov('r6', 1); a.alu('tst', 'r4', 'r6'); a.bc('eq', 'jog'); a.ldr_lit('r3', ENEMY); a.label('jog')
    a.add_r('r7', 'r7', 'r3')
    a.movh('r0', 'r7'); a.mov('r1', 0xB); call(a, 0x0809EAC4); a.cmpi('r0', 0); a.bfar('eq', 'out')   # espécie
    a.ldr_lit('r3', 0x02023538); a.ldr_i('r3', 'r3', 0); a.lsl('r6', 'r4', 9); a.add_r('r3', 'r3', 'r6'); a.addi('r3', 0x25); a.strb_i('r5', 'r3', 0)
    a.cmpi('r4', 4); a.bc('ne', 'direto')
    # treinador do lugar 4 (desenhado na abertura): id 1..63 (0 = nada criado, é a 1ª caixa de vida)
    a.ldr_lit('r3', SPR_IDS); a.ldrb_i('r0', 'r3', 4); a.cmpi('r0', 0); a.bc('eq', 'direto'); a.cmpi('r0', 64); a.bc('hs', 'direto')
    a.mov('r1', 0x44); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r1', SPRITES); a.add_r('r6', 'r0', 'r1')   # r6 = sprite do treinador
    a.movh('r0', 'r6'); call(a, 0x080F7678)
    a.mov('r0', 50); a.strh_i('r0', 'r6', 0x2E)                         # data[0] = duração
    a.ldr_lit('r0', 0xFFD8); a.strh_i('r0', 'r6', 0x32)                 # data[2] = -40 (sai pela esquerda)
    a.ldrh_i('r0', 'r6', 0x22); a.strh_i('r0', 'r6', 0x36)              # data[4] = y
    a.ldr_lit('r0', 0x080F7D09); a.str_i('r0', 'r6', 0x1C)              # StartAnimLinearTranslation
    a.mov('r0', 4); a.strh_i('r0', 'r6', 0x38)                          # data[5] = lugar
    a.movh('r0', 'r6'); a.ldr_lit('r1', ENVIA4 | 1); call(a, 0x080F6FDC)  # StoreSpriteCallbackInData6
    a.movh('r0', 'r6'); a.mov('r1', 1); call(a, 0x080090D4)            # StartSpriteAnim(treinador, 1) = pose
    a.b('out')
    a.label('direto'); manda(a, 'r4', 'r7')
    a.label('out')
    a.pop(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
    call(a, 0x080FB0B4)
    a.pop(['r3']); a.bx('r3')
# ponte curta nos 8 bytes finais da função morta 0x0803AF48 (o gancho.py não usa): ldr r3,=envio3; bx r3
PONTE_ENVIO = 0x0803B198
assert bytes(d[PONTE_ENVIO - B:PONTE_ENVIO - B + 8]) == bytes.fromhex('aa46f0bc01bc0047'), 'área da ponte em uso'
d[PONTE_ENVIO - B:PONTE_ENVIO - B + 8] = struct.pack('<HHI', 0x4B00, 0x4718, far(envio3) | 1)
bl_em(0x08039F20, PONTE_ENVIO, 0x0803AF80)
# carga dos sprites da batalha (0x08093714): lugar ausente não ganha caixa de vida (cada uma gasta 6 dos 64 sprites).
# No lugar dela fica um sprite invisível parado com todos os "links" (affineParam, data[0..7]) apontando para ele mesmo,
# e as funções que desenham/posicionam/escondem a caixa pulam esse sprite (reconhecido pelo callback parado).
HBIDS, SPRITES, CB_DUMMY = 0x0203F9F8, 0x02020630, 0x08007E59
def ponte(alvo):
    # chamada por "bl" de perto do código da batalha para o código no fim da ROM ("bx pc; nop; ldr ip,=alvo; bx ip")
    def corpo(a):
        a.h(0x4778); a.h(0x46C0); a.word(0xE59FC000); a.word(0xE12FFF1C); a.word(alvo | 1)
    return corpo
FALSA = 0xFA15                            # marca da caixa falsa em data[7]
def e_falsa(a, reg, pula):
    # pula se gSprites[reg].data[7] == FALSA (estraga r2, r3). Não dá para usar o callback: as caixas
    # verdadeiras do Quetzal também ficam com SpriteCallbackDummy, e eram todas puladas (sem posição/vida).
    a.mov('r3', 0x44); a.alu('mul', 'r3', reg); a.ldr_lit('r2', SPRITES); a.add_r('r3', 'r3', 'r2'); a.ldrh_i('r3', 'r3', 0x3C)
    a.ldr_lit('r2', FALSA); a.alu('cmp', 'r3', 'r2'); a.bc('eq', pula)
def cria_caixa(a):        # 0x080AACEC(b)
    a.push(['r4', 'r5'], lr=True); a.movh('r4', 'r0')
    a.ldr_lit('r1', ABSENT); a.ldrb_i('r1', 'r1', 0); a.h(0x40C1); a.lsl('r1', 'r1', 31)   # lsrs r1,r0 ; bit 0 -> 31
    a.bc('eq', 'cria')
    a.ldr_lit('r0', CB_DUMMY); call(a, 0x08007694); a.movh('r5', 'r0')                     # CreateInvisibleSpriteWithCallback
    a.cmpi('r5', 64); a.bc('eq', 'fim')
    a.mov('r1', 0x44); a.alu('mul', 'r1', 'r5'); a.ldr_lit('r2', SPRITES); a.add_r('r1', 'r1', 'r2')
    a.strh_i('r5', 'r1', 6)                                                                 # oam.affineParam
    for k in range(8): a.strh_i('r5', 'r1', 0x2E + 2 * k)                                  # data[0..7]
    a.strh_i('r4', 'r1', 0x2E + 12)                                                         # data[6] = lugar
    a.ldr_lit('r0', FALSA); a.strh_i('r0', 'r1', 0x3C)                                       # data[7] = marca
    a.label('fim'); a.movh('r0', 'r5'); a.pop(['r4', 'r5']); a.pop(['r1']); a.bx('r1')
    a.label('cria'); a.movh('r0', 'r4'); call(a, 0x080AACEC); a.movh('r5', 'r0'); a.b('fim')
def pula_lugar(f):        # f(b): pula se a caixa do lugar b é falsa
    def corpo(a):
        a.push(['r4'], lr=True); a.movh('r4', 'r0')
        a.ldr_lit('r1', HBIDS); a.ldrb_r('r1', 'r1', 'r0'); e_falsa(a, 'r1', 'fim')
        a.movh('r0', 'r4'); call(a, f)
        a.label('fim'); a.pop(['r4']); a.pop(['r1']); a.bx('r1')
    return corpo
def pula_caixa(f):        # f(caixa, r1, r2): pula se a caixa é falsa
    def corpo(a):
        a.push(['r1', 'r2'], lr=True)
        e_falsa(a, 'r0', 'fim')
        a.pop(['r1', 'r2']); call(a, f); a.pop(['r1']); a.bx('r1')
        a.label('fim'); a.pop(['r1', 'r2']); a.pop(['r1']); a.bx('r1')
    return corpo
if not os.environ.get('SEM_CAIXA'):
  bl_em(0x0809378A, baixo(ponte(far(cria_caixa))), 0x080AACEC)
bl_em(0x0809379E, baixo(ponte(far(pula_lugar(0x080AB720)))), 0x080AB720)
w = baixo(ponte(far(pula_caixa(0x080AE0AC)))); bl_em(0x0809380C, w, 0x080AE0AC); bl_em(0x08093840, w, 0x080AE0AC)
bl_em(0x0809384C, baixo(ponte(far(pula_caixa(0x080AB2D0)))), 0x080AB2D0)
# UpdateHealthboxAttribute (0x080AE0AC) desenha na memória de vídeo pelo tileNum da caixa: na caixa falsa isso estraga a
# memória (o mestre reiniciava). Interceptada na entrada: caixa falsa -> volta sem fazer nada.
def entrada(f, n=8):
    # as n primeiras meias-palavras de f (sem leituras relativas ao pc) vão para o código novo, que volta para f+2n
    orig = [rd16(f + 2 * i) for i in range(n)]
    assert all(h >> 11 != 0b01001 and h >> 12 != 0xD and h >> 11 not in (0x1C, 0x1E, 0x1F) for h in orig), [hex(h) for h in orig]
    def corpo(a):
        a.push(['r2', 'r3']); e_falsa(a, 'r0', 'falsa'); a.pop(['r2', 'r3'])
        for h in orig: a.h(h)
        if a.here() % 4: a.h(0x46C0)
        a.h(0x4778); a.h(0x46C0); a.word(0xE59FC000); a.word(0xE12FFF1C); a.word((f + 2 * n) | 1)
        a.label('falsa'); a.pop(['r2', 'r3']); a.bx('lr')
    desvia(f, far(corpo))
if not os.environ.get('SEM_CAIXA'):
    entrada(0x080AE0AC)
print('código novo até', hex(FAR[0]), ' área baixa até', hex(LOW[0]))
open(dst, 'wb').write(d); print('ok', dst)
