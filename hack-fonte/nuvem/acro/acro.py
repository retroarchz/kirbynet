# Acro Bike sobe em pedras e cercas (pedido do usuário, 02/11/2026).
# Pulo de lado (botão B + lado, AcroBikeTransition_SideJump 0x0818CAC4) ou pulinho com a roda levantada andando
# (AcroBikeTransition_WheelieHoppingMoving 0x0818CA40): quando o lado está bloqueado o jogo só pulava no lugar. Agora,
# se a casa da frente é uma "plataforma" (pedra ou cerca da lista), ele pula para cima dela; se a de 2 casas é
# plataforma (pedra no mar, com água no meio), pula 2 casas com o pulo de barranco do próprio jogo. Em cima de uma
# plataforma, o chão a 2 casas também vale (voltar para a areia por cima da água). Nada de procurar mais longe.
# Plataforma = (tileset, metatile) da tabela PLAT: só as peças conferidas uma a uma (cerca de troncos, pedrinha
# da areia, pedra grande marrom, pedras cinza do mar). Casas, árvores, muros e montanhas ficam de fora.
# uso: python acro.py  -> imprime as linhas do game.js (fix e novo)
import sys, os, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'metaknight'))
from thumb import Asm, r

DEBUG = bool(os.environ.get('DEBUG'))
CODE = 0x09FF4000            # livre nas duas ROMs do Quetzal mesmo com todos os mods do site
AVATAR = 0x02039070          # gPlayerAvatar (+5: objectEventId)
OBJS = 0x02038D10            # gObjectEvents (0x24 cada, 16)
SPRITES = 0x02020630         # gSprites (0x44 cada); gPlayerAvatar +4 = spriteId do jogador
LAYOUT = 0x03005600          # gBackupMapLayout {largura, altura, mapa}: coordenadas do objeto direto (com o +7)
MAPHDR = 0x02038CB0          # gMapHeader.mapLayout -> +16 tileset primário, +20 secundário

HOP_SITE, HOP_BACK, HOP_ORIG = 0x0818CAB0, 0x0818CABE, 0x0818CA00   # "pula no lugar" (r4 = direção)
SIDE_SITE, SIDE_BACK, SIDE_OK, SIDE_ORIG = 0x0818CAFC, 0x0818CB34, 0x0818CB04, 0x0818C860   # (r5 = direção)
# ObjectEventUpdateElevation (0x080DAE60, r4 = objeto, r5 = altura do quadrado novo): em 0x080DAE8C desvia. Pedra/cerca
# têm altura 0 (= "qualquer altura" para o jogo): sem isso, de cima da pedra a bike andava no mar. Para o jogador:
# altura da água (1) sem estar surfando (só no meio do pulo de 2 casas) não muda nada; pousando numa plataforma da
# lista com altura 0 ele fica com a altura de antes (a do chão).
ELEV_SITE, ELEV_BACK, ELEV_FIM = 0x080DAE8C, 0x080DAE94, 0x080DAEAE
# Pedras do mar: cada pedra fica no canto entre 4 quadrados (bloco 2x2). O desenho do jogador (callback do sprite dele,
# 0x080CAD60) desliza 1 px por quadro até ficar no centro da pedra. Só pelo x2/y2 do sprite (imagem): a CÂMERA segue o
# x/y do sprite (o objeto da câmera copia), e mexer no x/y deixava a câmera fora do passo de 16 px e o mapa redesenhava
# errado nas bordas. Quando o jogador troca de quadrado dentro da pedra, o x/y do sprite precisa andar 16 px: anda 1 px
# por quadro (como um passo) e a imagem compensa.
# Estado em DESL (16 bytes): +0 V (s8 x, y: deslocamento da imagem em relação ao quadrado), +2 P (s8 x, y: quanto o x/y
# do sprite ainda deve andar), +4/+6 último x/y do sprite, +8/+10 último x2/y2 escrito, +12/+14 x2/y2 do jogo (base).
# Se o x/y do sprite pular mais de 6 px de um quadro para o outro (jogo recriou/reposicionou: troca de mapa, montar ou
# descer da bike), V e P zeram.
CB_SITE, CB_MOVE, CB_ARG = 0x080CAD60, 0x080D7168, 0x080CAD85
DESL = 0x0203FF40
OFFS = [(0x150, 8, 8), (0x152, 8, 8), (0x154, 8, 8), (0x151, -8, 8), (0x153, -8, 8),
        (0x158, 8, -8), (0x15C, 8, -8), (0x159, -8, -8),
        (0x164, 8, 8), (0x16C, 8, -8), (0x15A, 8, -8), (0x15B, -8, -8),
        (0x175, 8, 8), (0x176, -8, 8), (0x17D, 8, -8), (0x17E, -8, -8)]   # quadrado do bloco -> onde fica o centro da pedra (px)
# A pé (pedido 02/11; 03/11 trocado de X para Z): virado para a pedra/cerca, apertando Z (= A do GBA) ele dá o pulinho do barranco para cima dela.
# PlayerNotOnBikeMoving (0x080CB538, r5 = direção, r6 = teclas seguradas): no "bate na parede" (0x080CB58C) desvia.
# Enquanto ele bate na parede o jogo não lê teclas, então o aperto do B fica guardado por 40 quadros (TRAVA_B, contado
# no callback do sprite). Item (bola) em cima da pedra é um objeto: o pulo não cai em cima dele (pega com A antes).
PE_SITE, PE_BATE, PE_FIM = 0x080CB58C, 0x080CC248, 0x080CB6AE
MAIN_HELD, MAIN_NEW = 0x0300268C, 0x0300268E   # gMain.heldKeys / newKeys
TRAVA_B = 0x0203FF3F
# Pokémon que segue: quando o jogador pula para as pedras do mar ele ia para a água atrás dele. O callback do sprite
# dele (0x080DC4F4) desvia: depois da atualização do jogo, se ele está num quadrado de água (altura 1) e o jogador não
# está surfando, a imagem fica invisível neste quadro (sprite +0x3E bit 2). O jogo recalcula a cada quadro.
SEG_SITE, SEG_ARG = 0x080DC4F4, 0x080DC519
SE_PULO, PLAY_SE, JUMP1, SET_ANIM = 0x0A, 0x080F3D84, 0x080D73E8, 0x080CC13C
# Andar em cima (pedido 02/11): CheckForObjectEventCollision (0x080CB798, chamada só pela colisão do jogador a pé
# 0x080CB70E e de bike 0x0818CFA2) é envolvida. Em cima de cerca/pedra da lista (menos as do mar): o quadrado vizinho
# que também é cerca/pedra fica livre (bloqueio 1..3 vira 0) e o chão comum fica bloqueado (0 vira 2): ele anda por cima
# e só desce com X + direção (o pulo aceita chão a 1 casa quando está numa plataforma).
# Entrada desviada com r12 (os 4 registradores são argumentos; o 5º vai na pilha); STUB refaz o começo original.
COL_SITE, COL_CONT = 0x080CB798, 0x080CB7A8
COL_ORIG = bytes.fromhex('f0b557464e464546e0b481b081460998')   # push..ldr r0,[sp,#0x24]
# Poeirinha: a pé o pulo não solta poeira ao pousar (bit disableJumpLandingGroundEffect, byte 3 bit 1 do objeto);
# o callback do jogador desliga o bit quando o movimento acaba (POEIRA = 1 enquanto ligado por nós).
POEIRA = 0x0203FF3D
HOP1 = 0x080CC43C            # pulinho de 1 casa com a roda levantada (o do jogo quando está livre)
HOP2 = 0x080CC460            # pulo de 2 casas com a roda levantada (barranco)
JUMP2 = 0x080CC364           # pulo de barranco normal (2 casas)

PRIM, SEC = 0x087892D4, 0x0878934C
PLAT = [
    (PRIM, [0x0E2]),                                                     # pedrinha da areia
    (PRIM, [0x080, 0x081, 0x082, 0x088, 0x071, 0x08A, 0x090, 0x079, 0x092]),   # pedra grande marrom (3x3)
    (PRIM, [0x150, 0x151, 0x152, 0x153, 0x154, 0x158, 0x159, 0x15C]),    # pedras cinza do mar
    (PRIM, [0x164, 0x16C, 0x15A, 0x15B]),                                # pedras do mar encostadas na margem (print 02/11 20:14)
    (PRIM, [0x175, 0x176, 0x17D, 0x17E]),                                # pedra pontuda do mar 2x2 (print 03/11 20:21, mapa 0.21)
    (PRIM, [0x172, 0x174, 0x17A, 0x17B, 0x17C, 0x182, 0x184, 0x0B4, 0x089]),   # pedra grande do mar (o meio é 0x071/0x079)
    (SEC, [0x280, 0x282, 0x288, 0x28A, 0x291, 0x292]),                   # cerca de troncos
]


class A(Asm):
    def sub_r(self, d, n, m): self.h(0x1A00 | r(m) << 6 | r(n) << 3 | r(d))
    def lsr(self, d, m, imm): self.h(0x0800 | imm << 6 | r(m) << 3 | r(d))
    def asr(self, d, m, imm): self.h(0x1000 | imm << 6 | r(m) << 3 | r(d))
    def mvn(self, d, m): self.h(0x4000 | 15 << 6 | r(m) << 3 | r(d))
    def ldr_r(self, d, n, m): self.h(0x5800 | r(m) << 6 | r(n) << 3 | r(d))
    def ldrsh_r(self, d, n, m): self.h(0x5E00 | r(m) << 6 | r(n) << 3 | r(d))
    def ldrsb_r(self, d, n, m): self.h(0x5600 | r(m) << 6 | r(n) << 3 | r(d))
    def str_sp(self, d, imm): assert imm % 4 == 0 and imm < 1024; self.h(0x9000 | r(d) << 8 | imm >> 2)
    def ldr_sp(self, d, imm): assert imm % 4 == 0 and imm < 1024; self.h(0x9800 | r(d) << 8 | imm >> 2)
    def subsp(self, imm): self.h(0xB080 | imm >> 2)
    def build(self):
        # literais podem ser nomes de rótulos (endereços de dados definidos depois)
        lab = lambda x: self.labels[x[:-2]] + 1 if x.endswith('+1') else self.labels[x]
        self.items = [('word', lab(x)) if k == 'word' and isinstance(x, str) else (k, x) for k, x in self.items]
        return super().build()


def chk(op, imm, lim, al=1):
    assert 0 <= imm <= lim and imm % al == 0, (op, imm)


def code():
    a = A(CODE)
    # ---------- desvio do pulinho andando (r4 = direção, r5 = objeto do jogador) ----------
    a.label('hop')
    if DEBUG: a.ldr_lit('r0', 0x0203FFF0); a.ldrb_i('r1', 'r0', 0); a.addi('r1', 1); a.strb_i('r1', 'r0', 0)
    a.movh('r0', 'r4'); a.mov('r1', 0); a.bl('pula')
    if DEBUG: a.ldr_lit('r1', 0x0203FFF1); a.strb_i('r0', 'r1', 0)
    a.cmpi('r0', 0); a.bc('ne', 'hopfim')
    a.movh('r0', 'r4'); a.ldr_lit('r3', HOP_ORIG | 1); a.bl('callr3')
    a.label('hopfim')
    a.ldr_lit('r0', HOP_BACK | 1); a.bx('r0')
    # ---------- desvio do pulo de lado (r5 = direção) ----------
    a.label('side')
    a.movh('r0', 'r5'); a.mov('r1', 1); a.bl('pula')
    a.cmpi('r0', 2); a.bc('eq', 'sideok')
    a.cmpi('r0', 0); a.bc('ne', 'sidefim')
    a.movh('r0', 'r5'); a.ldr_lit('r3', SIDE_ORIG | 1); a.bl('callr3')
    a.label('sidefim')
    a.ldr_lit('r0', SIDE_BACK | 1); a.bx('r0')
    a.label('sideok')
    a.ldr_lit('r0', SIDE_OK | 1); a.bx('r0')                 # pulo de lado do jogo (1 casa)
    a.label('callr3'); a.bx('r3')
    a.pool()
    # ---------- desvio da altura (r4 = objeto, r5 = altura nova) ----------
    a.label('elev')
    a.ldr_lit('r2', AVATAR); a.ldrb_i('r0', 'r2', 5); a.lsl('r0', 'r0', 25); a.lsr('r0', 'r0', 25)
    a.mov('r1', 0x24); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r1', OBJS); a.add_r('r0', 'r0', 'r1')
    a.alu('cmp', 'r0', 'r4'); a.bc('ne', 'eorig')                       # só o jogador
    a.cmpi('r5', 1); a.bc('ne', 'ezero')
    a.ldrb_i('r1', 'r2', 0); a.mov('r0', 0x18); a.alu('tst', 'r1', 'r0'); a.bc('ne', 'eorig')   # surfando/mergulho: normal
    a.ldr_lit('r0', ELEV_FIM | 1); a.bx('r0')                          # no ar sobre a água: não muda
    a.label('ezero')
    a.cmpi('r5', 0); a.bc('ne', 'eorig')
    a.ldrh_i('r0', 'r4', 0x10); a.ldrh_i('r1', 'r4', 0x12); a.bl('tile'); a.bl('plat')
    a.cmpi('r0', 0); a.bc('eq', 'eorig')
    a.ldrb_i('r5', 'r4', 0xB); a.lsr('r5', 'r5', 4)                     # pedra/cerca: fica a altura de antes
    a.label('eorig')
    a.mov('r3', 0xF); a.movh('r0', 'r5'); a.alu('and_', 'r0', 'r3'); a.ldrb_i('r1', 'r4', 0xB)
    a.ldr_lit('r2', ELEV_BACK | 1); a.bx('r2')
    a.pool()

    # ---------- a pé: bateu na parede (r5 = direção, r6 = teclas seguradas) ----------
    a.label('pe')
    a.mov('r0', 1); a.alu('tst', 'r6', 'r0'); a.bc('ne', 'petenta')
    a.ldr_lit('r1', TRAVA_B); a.ldrb_i('r0', 'r1', 0); a.cmpi('r0', 0); a.bc('eq', 'pebate')
    a.label('petenta')
    a.ldr_lit('r1', TRAVA_B); a.mov('r0', 0x80); a.strb_i('r0', 'r1', 0)    # gasto (o callback não guarda o mesmo aperto)
    a.movh('r0', 'r5'); a.mov('r1', 2); a.bl('pula'); a.cmpi('r0', 0); a.bc('ne', 'pefim')
    a.label('pebate')
    a.movh('r0', 'r5'); a.ldr_lit('r3', PE_BATE | 1); a.bl('callr3pe')
    a.label('pefim')
    a.ldr_lit('r0', PE_FIM | 1); a.bx('r0')
    a.label('callr3pe'); a.bx('r3')
    a.pool()

    # ---------- colisão do jogador: andar em cima de cerca/pedra ----------
    a.label('colstub')   # começo original de CheckForObjectEventCollision (mesma pilha) e segue no resto dela
    for k in range(0, len(COL_ORIG), 2): a.h(COL_ORIG[k] | COL_ORIG[k + 1] << 8)
    a.ldr_lit('r7', COL_CONT | 1); a.bx('r7')
    a.label('col')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True); a.subsp(4)
    a.movh('r4', 'r0'); a.movh('r5', 'r1'); a.movh('r6', 'r2'); a.movh('r7', 'r3')
    a.ldr_sp('r0', 24); a.str_sp('r0', 0)                                   # 5º argumento
    a.ldr_lit('r0', 'colstub+1'); a.movh('r12', 'r0')
    a.movh('r0', 'r4'); a.movh('r1', 'r5'); a.movh('r2', 'r6'); a.movh('r3', 'r7'); a.bl('bxip')
    a.lsl('r0', 'r0', 24); a.lsr('r7', 'r0', 24)                           # r7 = resultado
    a.bl('jogador_r0'); a.alu('cmp', 'r0', 'r4'); a.bc('ne', 'colfim')
    a.ldrh_i('r0', 'r4', 0x10); a.ldrh_i('r1', 'r4', 0x12); a.bl('tile'); a.str_sp('r0', 0)
    a.bl('plat'); a.cmpi('r0', 0); a.bc('eq', 'colfim')
    a.ldr_sp('r0', 0); a.bl('desloc'); a.cmpi('r0', 0); a.bc('ne', 'colfim')     # pedra do mar: como antes
    a.lsl('r0', 'r5', 16); a.lsr('r0', 'r0', 16); a.lsl('r1', 'r6', 16); a.lsr('r1', 'r1', 16)
    a.bl('tile'); a.str_sp('r0', 0); a.bl('plat'); a.cmpi('r0', 0); a.bc('eq', 'coltnao')
    a.ldr_sp('r0', 0); a.bl('desloc'); a.cmpi('r0', 0); a.bc('ne', 'colfim')
    a.cmpi('r7', 0); a.bc('eq', 'colfim'); a.cmpi('r7', 3); a.bc('hi', 'colfim')
    a.mov('r7', 0); a.b('colfim')                                           # cerca -> cerca: anda
    a.label('coltnao')
    a.cmpi('r7', 0); a.bc('ne', 'colfim'); a.mov('r7', 2)                    # cerca -> chão: só pulando
    a.label('colfim')
    a.movh('r0', 'r7'); a.addsp(4); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.bx('r1')
    a.label('bxip'); a.bx('r12')
    a.label('jogador_r0')
    a.ldr_lit('r0', AVATAR); a.ldrb_i('r0', 'r0', 5); a.lsl('r0', 'r0', 25); a.lsr('r0', 'r0', 25)
    a.mov('r1', 0x24); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r1', OBJS); a.add_r('r0', 'r0', 'r1'); a.bx('lr')
    a.pool()

    # ---------- tile(r0 = x, r1 = y) -> r0 = valor do mapa (u16) ou -1 fora ----------
    a.label('tile')
    a.ldr_lit('r2', LAYOUT)
    a.ldr_i('r3', 'r2', 0); a.alu('cmp', 'r0', 'r3'); a.bc('hs', 'tfora')
    a.ldr_i('r3', 'r2', 4); a.alu('cmp', 'r1', 'r3'); a.bc('hs', 'tfora')
    a.ldr_i('r3', 'r2', 0); a.alu('mul', 'r1', 'r3'); a.add_r('r1', 'r1', 'r0'); a.add_r('r1', 'r1', 'r1')
    a.ldr_i('r2', 'r2', 8); a.ldrh_r('r0', 'r2', 'r1'); a.bx('lr')
    a.label('tfora'); a.mov('r0', 0); a.mvn('r0', 'r0'); a.bx('lr')

    # ---------- plat(r0 = valor) -> r0 = 1 se é pedra/cerca da lista ----------
    a.label('plat')
    a.push(['r4'])
    a.lsl('r0', 'r0', 22); a.lsr('r0', 'r0', 22)            # metatile
    a.ldr_lit('r1', MAPHDR); a.ldr_i('r1', 'r1', 0)
    a.mov('r2', 0x80); a.lsl('r2', 'r2', 2); a.alu('cmp', 'r0', 'r2'); a.bc('hs', 'psec')
    a.ldr_i('r1', 'r1', 16); a.b('pgo')
    a.label('psec'); a.ldr_i('r1', 'r1', 20)
    a.label('pgo'); a.ldr_lit('r2', 'tab')
    a.label('ploop')
    a.ldr_i('r3', 'r2', 0); a.cmpi('r3', 0); a.bc('eq', 'pnao')
    a.alu('cmp', 'r3', 'r1'); a.bc('ne', 'pprox')
    a.ldrh_i('r4', 'r2', 4); a.alu('cmp', 'r4', 'r0'); a.bc('eq', 'psim')
    a.label('pprox'); a.addi('r2', 8); a.b('ploop')
    a.label('psim'); a.mov('r0', 1); a.pop(['r4']); a.bx('lr')
    a.label('pnao'); a.mov('r0', 0); a.pop(['r4']); a.bx('lr')

    # ---------- livre(r0 = x, r1 = y) -> r0 = 1 se nenhum outro objeto (pessoa, Pokémon) está lá ----------
    a.label('livre')
    a.push(['r4', 'r5', 'r6'])
    a.ldr_lit('r2', OBJS); a.mov('r3', 16)
    a.ldr_lit('r6', AVATAR); a.ldrb_i('r6', 'r6', 5); a.lsl('r6', 'r6', 25); a.lsr('r6', 'r6', 25)
    a.mov('r4', 0x24); a.alu('mul', 'r6', 'r4'); a.ldr_lit('r4', OBJS); a.add_r('r6', 'r6', 'r4')   # r6 = jogador
    a.label('lloop')
    a.alu('cmp', 'r2', 'r6'); a.bc('eq', 'lprox')
    a.ldrb_i('r4', 'r2', 0); a.mov('r5', 1); a.alu('tst', 'r4', 'r5'); a.bc('eq', 'lprox')
    a.ldrh_i('r4', 'r2', 0x10); a.alu('cmp', 'r4', 'r0'); a.bc('ne', 'lprox')
    a.ldrh_i('r4', 'r2', 0x12); a.alu('cmp', 'r4', 'r1'); a.bc('ne', 'lprox')
    a.mov('r0', 0); a.pop(['r4', 'r5', 'r6']); a.bx('lr')
    a.label('lprox'); a.addi('r2', 0x24); a.subi('r3', 1); a.bc('ne', 'lloop')
    a.mov('r0', 1); a.pop(['r4', 'r5', 'r6']); a.bx('lr')
    a.pool()

    # ---------- desloc(r0 = valor do mapa) -> r0 = deslocamento (byte 0 = x s8, byte 1 = y s8) ou 0 ----------
    a.label('desloc')
    a.push(['r4'], lr=True)
    a.movh('r4', 'r0'); a.bl('plat'); a.cmpi('r0', 0); a.bc('eq', 'dnao')
    a.lsl('r0', 'r4', 22); a.lsr('r0', 'r0', 22)
    a.ldr_lit('r1', 'offs')
    a.label('dloop')
    a.ldrh_i('r2', 'r1', 0); a.cmpi('r2', 0); a.bc('eq', 'dnao')
    a.alu('cmp', 'r2', 'r0'); a.bc('eq', 'dsim'); a.addi('r1', 4); a.b('dloop')
    a.label('dsim'); a.ldrh_i('r0', 'r1', 2); a.pop(['r4']); a.pop(['r1']); a.bx('r1')
    a.label('dnao'); a.mov('r0', 0); a.pop(['r4']); a.pop(['r1']); a.bx('r1')

    # ---------- callback do sprite do jogador (r0 = sprite) ----------
    a.label('cb')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    a.movh('r4', 'r0')
    a.mov('r1', 0x2E); a.ldrsh_r('r2', 'r4', 'r1')
    a.mov('r1', 0x24); a.alu('mul', 'r2', 'r1'); a.ldr_lit('r1', OBJS); a.add_r('r5', 'r2', 'r1')   # r5 = objeto
    a.movh('r0', 'r5'); a.movh('r1', 'r4'); a.ldr_lit('r2', CB_ARG); a.ldr_lit('r3', CB_MOVE | 1); a.bl('callr3c')
    a.ldr_lit('r2', POEIRA); a.ldrb_i('r0', 'r2', 0); a.cmpi('r0', 0); a.bc('eq', 'cpo')
    a.ldrb_i('r0', 'r5', 0); a.mov('r1', 0x80); a.alu('tst', 'r0', 'r1'); a.bc('eq', 'cpo')   # heldMovementFinished
    a.ldrb_i('r0', 'r5', 3); a.mov('r1', 2); a.alu('bic', 'r0', 'r1'); a.strb_i('r0', 'r5', 3)
    a.mov('r0', 0); a.strb_i('r0', 'r2', 0)
    a.label('cpo')
    a.ldrh_i('r0', 'r5', 0x10); a.ldrh_i('r1', 'r5', 0x12); a.bl('tile')
    # em cima de cerca/pedra o desenho vai para a frente da camada de cima do mapa (a borda da pedra grande cobria o
    # jogador): tabela de pedaços (subsprites) 2 = prioridade 1, como na altura 4 (o jogo recalcula todo quadro). Só olha a lista se o quadrado bloqueia ou tem altura 0/1
    a.movh('r7', 'r0')
    a.lsr('r1', 'r0', 10); a.mov('r2', 3); a.alu('tst', 'r1', 'r2'); a.bc('ne', 'cfr')
    a.lsr('r1', 'r0', 12); a.cmpi('r1', 1); a.bc('hi', 'cfrn')
    a.label('cfr')
    a.bl('plat'); a.cmpi('r0', 0); a.bc('eq', 'cfrn')
    a.mov('r1', 0x42); a.ldrb_r('r0', 'r4', 'r1'); a.mov('r2', 0x3F); a.alu('bic', 'r0', 'r2')
    a.mov('r2', 2); a.alu('orr', 'r0', 'r2'); a.strb_r('r0', 'r4', 'r1')      # tabela de pedaços 2 = prioridade 1
    a.label('cfrn')
    a.movh('r0', 'r7')
    # rápido (roda todo quadro): só procura na lista se o quadrado for 0x150..0x17E; sem alvo e sem deslocamento: nada
    a.lsl('r1', 'r0', 22); a.lsr('r1', 'r1', 22); a.mov('r2', 0xA8); a.lsl('r2', 'r2', 1); a.sub_r('r1', 'r1', 'r2')
    a.mov('r6', 0); a.cmpi('r1', 0x2E); a.bc('hi', 'csem')
    a.bl('desloc'); a.movh('r6', 'r0')                                     # alvo
    a.label('csem')
    a.ldr_lit('r2', MAIN_NEW); a.ldrh_i('r0', 'r2', 0); a.ldr_lit('r2', TRAVA_B); a.ldrb_i('r1', 'r2', 0)
    a.cmpi('r1', 0x80); a.bc('ne', 'tbn'); a.mov('r1', 0); a.b('tbok')      # gasto neste quadro: não guarda de novo
    a.label('tbn')
    a.mov('r3', 1); a.alu('tst', 'r0', 'r3'); a.bc('eq', 'tbx'); a.mov('r1', 41)
    a.label('tbx'); a.cmpi('r1', 0); a.bc('eq', 'tbok'); a.subi('r1', 1)
    a.label('tbok'); a.strb_i('r1', 'r2', 0)
    a.ldr_lit('r7', DESL)
    a.ldr_i('r0', 'r7', 0); a.mov('r1', 0); a.alu('cmp', 'r6', 'r1'); a.bc('ne', 'clento')
    a.cmpi('r0', 0); a.bc('eq', 'crapido')                                    # nada a fazer (rápido)
    a.label('clento')
    # jogo reposicionou o sprite? (pulo > 6 px em x ou y desde o último quadro) ou estado vazio: zera e pega a base nova
    a.cmpi('r0', 0); a.bc('eq', 'czera')
    for so, lo in ((0x20, 4), (0x22, 6)):
        a.ldrh_i('r0', 'r4', so); a.ldrh_i('r1', 'r7', lo); a.sub_r('r0', 'r0', 'r1'); a.lsl('r0', 'r0', 16); a.asr('r0', 'r0', 16)
        a.addi('r0', 6); a.cmpi('r0', 12); a.bc('hi', 'czera')
    a.b('cbase')
    a.label('czera')
    a.mov('r0', 0); a.str_i('r0', 'r7', 0)
    a.ldrh_i('r0', 'r4', 0x24); a.strh_i('r0', 'r7', 12); a.strh_i('r0', 'r7', 8)
    a.ldrh_i('r0', 'r4', 0x26); a.strh_i('r0', 'r7', 14); a.strh_i('r0', 'r7', 10)
    a.label('cbase')
    # x2/y2 que o jogo pôs (o pulo mexe no y2): se mudou desde a nossa escrita, é a base nova
    for so, lw, lb in ((0x24, 8, 12), (0x26, 10, 14)):
        a.ldrh_i('r0', 'r4', so); a.ldrh_i('r1', 'r7', lw); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'cb%d' % so)
        a.strh_i('r0', 'r7', lb)
        a.label('cb%d' % so)
    for eixo, (so, so2, lw, lb) in enumerate(((0x20, 0x24, 8, 12), (0x22, 0x26, 10, 14))):
        n = str(eixo)
        # P: o x/y do sprite anda 1 px para o lugar certo
        a.mov('r1', 2 + eixo); a.ldrsb_r('r0', 'r7', 'r1')
        a.cmpi('r0', 0); a.bc('eq', 'pp' + n)
        a.ldrh_i('r2', 'r4', so); a.bc('lt', 'pneg' + n)
        a.subi('r0', 1); a.addi('r2', 1); a.b('pg' + n)
        a.label('pneg' + n); a.addi('r0', 1); a.subi('r2', 1)
        a.label('pg' + n); a.strh_i('r2', 'r4', so); a.mov('r1', 2 + eixo); a.strb_r('r0', 'r7', 'r1')
        a.label('pp' + n)
        # V: a imagem anda 1 px na direção do centro da pedra (ou de 0)
        a.mov('r1', eixo); a.ldrsb_r('r0', 'r7', 'r1')
        a.lsl('r1', 'r6', 24 - 8 * eixo); a.asr('r1', 'r1', 24)
        a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'vv' + n); a.bc('lt', 'vmais' + n)
        a.subi('r0', 1); a.b('vg' + n)
        a.label('vmais' + n); a.addi('r0', 1)
        a.label('vg' + n); a.mov('r1', eixo); a.strb_r('r0', 'r7', 'r1')
        a.label('vv' + n)
        # x2 = base + V + P
        a.mov('r1', eixo); a.ldrsb_r('r0', 'r7', 'r1'); a.mov('r1', 2 + eixo); a.ldrsb_r('r1', 'r7', 'r1'); a.add_r('r0', 'r0', 'r1')
        a.ldrh_i('r1', 'r7', lb); a.add_r('r0', 'r0', 'r1'); a.strh_i('r0', 'r4', so2); a.strh_i('r0', 'r7', lw)
    a.ldrh_i('r0', 'r4', 0x20); a.strh_i('r0', 'r7', 4); a.ldrh_i('r0', 'r4', 0x22); a.strh_i('r0', 'r7', 6)
    a.b('cfim')
    a.label('crapido')
    a.label('cfim')
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.label('callr3c'); a.bx('r3')
    # ---------- callback do sprite do Pokémon que segue (r0 = sprite) ----------
    a.label('cbseg')
    a.push(['r4', 'r5'], lr=True)
    a.movh('r4', 'r0')
    a.mov('r1', 0x2E); a.ldrsh_r('r2', 'r4', 'r1')
    a.mov('r1', 0x24); a.alu('mul', 'r2', 'r1'); a.ldr_lit('r1', OBJS); a.add_r('r5', 'r2', 'r1')
    a.movh('r0', 'r5'); a.movh('r1', 'r4'); a.ldr_lit('r2', SEG_ARG); a.ldr_lit('r3', CB_MOVE | 1); a.bl('callr3c')
    a.ldr_lit('r2', AVATAR); a.ldrb_i('r2', 'r2', 0); a.mov('r3', 8); a.alu('tst', 'r2', 'r3'); a.bc('ne', 'sgfim')   # surfando
    a.ldrh_i('r0', 'r5', 0x10); a.ldrh_i('r1', 'r5', 0x12); a.bl('tile'); a.lsr('r0', 'r0', 12)
    a.cmpi('r0', 1); a.bc('ne', 'sgfim')
    a.mov('r1', 0x3E); a.ldrh_r('r0', 'r4', 'r1'); a.mov('r2', 4); a.alu('orr', 'r0', 'r2'); a.strh_r('r0', 'r4', 'r1')
    a.label('sgfim'); a.pop(['r4', 'r5']); a.pop(['r0']); a.bx('r0')
    a.pool()

    # ---------- pula(r0 = direção, r1 = 0 pulinho / 1 de lado) -> 0 nada, 1 pulou, 2 = pulo de lado do jogo ----------
    # r4 = direção, r5 = jogador, r6 = dx, r7 = dy, r8 = modo, r9 = está numa plataforma, r10 = x0, r11 = y0
    a.label('pula')
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    a.movh('r2', 'r8'); a.movh('r3', 'r9'); a.push(['r2', 'r3'])
    a.movh('r2', 'r10'); a.movh('r3', 'r11'); a.push(['r2', 'r3'])
    a.movh('r4', 'r0'); a.movh('r8', 'r1')
    a.subi('r0', 1); a.cmpi('r0', 3); a.bfar('hi', 'nada')     # só 1..4 (sul, norte, oeste, leste)
    a.lsl('r0', 'r0', 1); a.ldr_lit('r1', 'dxy')
    a.add_r('r1', 'r1', 'r0')
    a.ldrb_i('r6', 'r1', 0); a.lsl('r6', 'r6', 24); a.asr('r6', 'r6', 24)
    a.ldrb_i('r7', 'r1', 1); a.lsl('r7', 'r7', 24); a.asr('r7', 'r7', 24)
    a.ldr_lit('r5', AVATAR); a.ldrb_i('r5', 'r5', 5); a.lsl('r5', 'r5', 25); a.lsr('r5', 'r5', 25)
    a.mov('r0', 0x24); a.alu('mul', 'r5', 'r0'); a.ldr_lit('r0', OBJS); a.add_r('r5', 'r5', 'r0')
    a.ldrh_i('r0', 'r5', 0x10); a.movh('r10', 'r0')
    a.ldrh_i('r1', 'r5', 0x12); a.movh('r11', 'r1')
    if DEBUG: a.ldr_lit('r2', 0x0203FFF4); a.strh_i('r0', 'r2', 0); a.strh_i('r1', 'r2', 2)
    a.bl('tile'); a.bl('plat'); a.movh('r9', 'r0')            # já está numa pedra/cerca?
    a.movh('r0', 'r10'); a.movh('r1', 'r11'); a.bl('tile'); a.bl('desloc')
    a.cmpi('r0', 0); a.bfar('ne', 'pedra')                     # numa pedra do mar: lógica da pedra inteira
    # 1 casa
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7')
    a.bl('tile'); a.push(['r0'])
    a.bl('plat'); a.pop(['r1'])
    a.cmpi('r0', 0); a.bc('ne', 'umplat')
    # não é plataforma: em cima de uma, chão comum a 1 casa vale (descer da cerca)
    a.movh('r0', 'r9'); a.cmpi('r0', 0); a.bc('eq', 'dois')
    a.movh('r0', 'r1'); a.bl('chao'); a.cmpi('r0', 0); a.bc('eq', 'dois'); a.b('umok')
    a.label('umplat')
    # pedra do mar: os 4 quadrados são a mesma pedra; ir para outro quadrado dela não é pular para outra pedra
    a.movh('r0', 'r1'); a.bl('desloc'); a.cmpi('r0', 0); a.bc('eq', 'umok')
    a.push(['r0'])
    a.movh('r0', 'r10'); a.movh('r1', 'r11'); a.bl('tile'); a.bl('desloc'); a.movh('r2', 'r0'); a.pop(['r3'])
    a.cmpi('r2', 0); a.bc('eq', 'umok')
    # r2 = deslocamento do quadrado atual, r3 = do quadrado da frente; canto = x + (dx > 0), y + (dy > 0)
    a.movh('r0', 'r10'); a.lsl('r1', 'r2', 24); a.asr('r1', 'r1', 24); a.cmpi('r1', 0); a.bc('le', 'c1'); a.addi('r0', 1)
    a.label('c1')
    a.movh('r1', 'r10'); a.add_r('r1', 'r1', 'r6'); a.lsl('r5', 'r3', 24); a.asr('r5', 'r5', 24); a.cmpi('r5', 0); a.bc('le', 'c2'); a.addi('r1', 1)
    a.label('c2')
    a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'umok_r5')
    a.movh('r0', 'r11'); a.lsl('r1', 'r2', 16); a.asr('r1', 'r1', 24); a.cmpi('r1', 0); a.bc('le', 'c3'); a.addi('r0', 1)
    a.label('c3')
    a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7'); a.lsl('r5', 'r3', 16); a.asr('r5', 'r5', 24); a.cmpi('r5', 0); a.bc('le', 'c4'); a.addi('r1', 1)
    a.label('c4')
    a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'umok_r5')
    a.bl('jogador'); a.b('dois')                                            # mesma pedra: tenta 2 casas
    a.label('umok_r5'); a.bl('jogador')
    a.label('umok')
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7')
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'dois')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'um_hop')
    a.cmpi('r0', 2); a.bfar('eq', 'ape1')
    a.mov('r0', 2); a.b('fim')                               # de lado: o pulo de lado do próprio jogo
    a.label('um_hop')
    a.movh('r0', 'r4'); a.ldr_lit('r3', HOP1 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')
    # 2 casas
    a.label('dois')
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.add_r('r0', 'r0', 'r6')
    a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7'); a.add_r('r1', 'r1', 'r7')
    a.bl('tile'); a.movh('r2', 'r0')                          # r2 só para guardar o valor
    a.push(['r0'])
    a.bl('plat'); a.pop(['r1'])
    a.cmpi('r0', 0); a.bc('ne', 'dois_livre')
    # em cima de uma pedra/cerca: chão comum a 2 casas também serve (bloqueio 0, altura de chão: não água)
    a.movh('r0', 'r9'); a.cmpi('r0', 0); a.bc('eq', 'tres')
    a.mov('r0', 0); a.mvn('r0', 'r0'); a.alu('cmp', 'r1', 'r0'); a.bc('eq', 'tres')
    a.lsr('r0', 'r1', 10); a.mov('r2', 3); a.alu('tst', 'r0', 'r2'); a.bc('ne', 'tres')
    a.lsr('r0', 'r1', 12); a.cmpi('r0', 2); a.bc('lo', 'tres'); a.cmpi('r0', 15); a.bc('eq', 'tres')
    a.label('dois_livre')
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.add_r('r0', 'r0', 'r6')
    a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7'); a.add_r('r1', 'r1', 'r7')
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'tres')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'dois_hop')
    a.cmpi('r0', 2); a.bc('ne', 'dois_np'); a.bl('jogador'); a.bl('poeira')
    a.label('dois_np')
    a.movh('r0', 'r4'); a.ldr_lit('r3', JUMP2 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')
    a.label('dois_hop')
    a.movh('r0', 'r4'); a.ldr_lit('r3', HOP2 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')
    # 3 casas (pedido 03/11: pedra pontuda a 3 casas da areia). O jogo só pula 2: o jogador passa para o quadrado da
    # frente sem mexer no desenho (mesma troca de quadrado da pedra do mar, em 'pachou') e dá o pulo de 2 casas dali; o
    # desenho anda os 16 px que faltam 1 px por quadro (V vai a 0). Estado novo em DESL: o callback estava no caminho
    # rápido e não tinha x/y nem base guardados.
    a.label('tres')
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.add_r('r0', 'r0', 'r6'); a.add_r('r0', 'r0', 'r6')
    a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7'); a.add_r('r1', 'r1', 'r7'); a.add_r('r1', 'r1', 'r7')
    a.bl('tile'); a.push(['r0'])
    a.bl('plat'); a.pop(['r1'])
    a.cmpi('r0', 0); a.bc('ne', 'tres_ok')
    a.movh('r0', 'r9'); a.cmpi('r0', 0); a.bc('eq', 'nada')               # chão a 3 casas só saindo de pedra/cerca
    a.movh('r0', 'r1'); a.bl('chao'); a.cmpi('r0', 0); a.bc('eq', 'nada')
    a.label('tres_ok')
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.add_r('r0', 'r0', 'r6'); a.add_r('r0', 'r0', 'r6')
    a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7'); a.add_r('r1', 'r1', 'r7'); a.add_r('r1', 'r1', 'r7')
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'nada')
    a.bl('jogador')
    a.ldr_lit('r0', AVATAR); a.ldrb_i('r0', 'r0', 4); a.mov('r1', 0x44); a.alu('mul', 'r0', 'r1')
    a.ldr_lit('r1', SPRITES); a.add_r('r2', 'r0', 'r1')
    a.ldr_lit('r3', DESL); a.mov('r0', 0); a.str_i('r0', 'r3', 0)
    a.ldrh_i('r0', 'r2', 0x20); a.strh_i('r0', 'r3', 4); a.ldrh_i('r0', 'r2', 0x22); a.strh_i('r0', 'r3', 6)
    a.ldrh_i('r0', 'r2', 0x24); a.strh_i('r0', 'r3', 8); a.strh_i('r0', 'r3', 12)
    a.ldrh_i('r0', 'r2', 0x26); a.strh_i('r0', 'r3', 10); a.strh_i('r0', 'r3', 14)
    a.subsp(40)
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.str_sp('r0', 28)
    a.movh('r0', 'r11'); a.add_r('r0', 'r0', 'r7'); a.str_sp('r0', 32)
    a.mov('r0', 2); a.str_sp('r0', 36); a.b('pachou')
    a.pool()
    a.label('nada'); a.mov('r0', 0)
    a.label('fim')
    a.pop(['r2', 'r3']); a.movh('r10', 'r2'); a.movh('r11', 'r3')
    a.pop(['r2', 'r3']); a.movh('r8', 'r2'); a.movh('r9', 'r3')
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.bx('r1')
    a.label('callr3b'); a.bx('r3')
    a.label('poeira')   # a pé: pouso sem poeira (r5 = jogador)
    a.ldrb_i('r0', 'r5', 3); a.mov('r1', 2); a.alu('orr', 'r0', 'r1'); a.strb_i('r0', 'r5', 3)
    a.ldr_lit('r1', POEIRA); a.mov('r0', 1); a.strb_i('r0', 'r1', 0); a.bx('lr')
    a.label('ape1')   # a pé, 1 casa: som do barranco + pulinho de 1 casa do jogo
    a.bl('jogador'); a.bl('poeira')
    a.mov('r0', SE_PULO); a.ldr_lit('r3', PLAY_SE | 1); a.bl('callr3b')
    a.movh('r0', 'r4'); a.ldr_lit('r3', JUMP1 | 1); a.bl('callr3b')
    a.mov('r1', 2); a.ldr_lit('r3', SET_ANIM | 1); a.bl('callr3b')
    a.mov('r0', 1); a.b('fim')
    # ---------- em cima de uma pedra do mar (r0 = deslocamento do quadrado atual) ----------
    # A pedra ocupa um bloco 2x2 e o desenho está no centro dela. Procura, nas duas fileiras (ou colunas) da pedra, a
    # partir da borda da frente, pedra/cerca ou chão a 1 e depois a 2 casas; se for preciso, troca o quadrado do
    # jogador dentro da pedra (o desenho não se mexe: o deslocamento compensa) e pula dali.
    # pilha: 0 bx, 4 by, 8 frente, 12/16 início 1, 20/24 início 2, 28/32 escolhido, 36 valor/d
    a.label('pedra')
    a.subsp(40)
    a.lsl('r1', 'r0', 24); a.asr('r1', 'r1', 24); a.movh('r2', 'r10'); a.cmpi('r1', 0); a.bc('ge', 'pb1'); a.subi('r2', 1)
    a.label('pb1'); a.str_sp('r2', 0)
    a.lsl('r1', 'r0', 16); a.asr('r1', 'r1', 24); a.movh('r2', 'r11'); a.cmpi('r1', 0); a.bc('ge', 'pb2'); a.subi('r2', 1)
    a.label('pb2'); a.str_sp('r2', 4)
    a.cmpi('r6', 0); a.bc('eq', 'pvert')
    # horizontal: coluna da frente; fileira do jogador primeiro, depois a outra
    a.ldr_sp('r0', 0); a.cmpi('r6', 0); a.bc('le', 'ph1'); a.addi('r0', 1)
    a.label('ph1'); a.str_sp('r0', 12); a.str_sp('r0', 20)
    a.movh('r0', 'r11'); a.str_sp('r0', 16)
    a.ldr_sp('r1', 4); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'ph2'); a.addi('r1', 1)
    a.label('ph2'); a.str_sp('r1', 24)
    a.b('pbusca')
    a.label('pvert')
    a.ldr_sp('r0', 4); a.cmpi('r7', 0); a.bc('le', 'pv1'); a.addi('r0', 1)
    a.label('pv1'); a.str_sp('r0', 16); a.str_sp('r0', 24)
    a.movh('r0', 'r10'); a.str_sp('r0', 12)
    a.ldr_sp('r1', 0); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'pv2'); a.addi('r1', 1)
    a.label('pv2'); a.str_sp('r1', 20)
    a.label('pbusca')
    a.ldr_sp('r0', 12); a.ldr_sp('r1', 16)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('tile'); a.str_sp('r0', 36); a.bl('plat'); a.cmpi('r0', 0); a.bc('ne', 'pc1_12')
    a.ldr_sp('r0', 36); a.bl('chao'); a.cmpi('r0', 0); a.bc('eq', 'pn1_12')
    a.label('pc1_12')
    a.ldr_sp('r0', 12); a.ldr_sp('r1', 16)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'pn1_12')
    a.ldr_sp('r0', 12); a.str_sp('r0', 28); a.ldr_sp('r0', 16); a.str_sp('r0', 32); a.mov('r0', 1); a.str_sp('r0', 36)
    a.b('pachou')
    a.label('pn1_12')
    a.ldr_sp('r0', 20); a.ldr_sp('r1', 24)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('tile'); a.str_sp('r0', 36); a.bl('plat'); a.cmpi('r0', 0); a.bc('ne', 'pc1_20')
    a.ldr_sp('r0', 36); a.bl('chao'); a.cmpi('r0', 0); a.bc('eq', 'pn1_20')
    a.label('pc1_20')
    a.ldr_sp('r0', 20); a.ldr_sp('r1', 24)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'pn1_20')
    a.ldr_sp('r0', 20); a.str_sp('r0', 28); a.ldr_sp('r0', 24); a.str_sp('r0', 32); a.mov('r0', 1); a.str_sp('r0', 36)
    a.b('pachou')
    a.label('pn1_20')
    a.ldr_sp('r0', 12); a.ldr_sp('r1', 16)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('tile'); a.str_sp('r0', 36); a.bl('plat'); a.cmpi('r0', 0); a.bc('ne', 'pc2_12')
    a.ldr_sp('r0', 36); a.bl('chao'); a.cmpi('r0', 0); a.bc('eq', 'pn2_12')
    a.label('pc2_12')
    a.ldr_sp('r0', 12); a.ldr_sp('r1', 16)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'pn2_12')
    a.ldr_sp('r0', 12); a.str_sp('r0', 28); a.ldr_sp('r0', 16); a.str_sp('r0', 32); a.mov('r0', 2); a.str_sp('r0', 36)
    a.b('pachou')
    a.label('pn2_12')
    a.ldr_sp('r0', 20); a.ldr_sp('r1', 24)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('tile'); a.str_sp('r0', 36); a.bl('plat'); a.cmpi('r0', 0); a.bc('ne', 'pc2_20')
    a.ldr_sp('r0', 36); a.bl('chao'); a.cmpi('r0', 0); a.bc('eq', 'pn2_20')
    a.label('pc2_20')
    a.ldr_sp('r0', 20); a.ldr_sp('r1', 24)
    a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7'); 
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'pn2_20')
    a.ldr_sp('r0', 20); a.str_sp('r0', 28); a.ldr_sp('r0', 24); a.str_sp('r0', 32); a.mov('r0', 2); a.str_sp('r0', 36)
    a.b('pachou')
    a.label('pn2_20')
    # 3 casas: escolhe o quadrado da frente da pedra (água) e pula 2 de lá (o desenho compensa, como em 'tres')
    for sx, sy in ((12, 16), (20, 24)):
        n = '%d' % sx
        a.ldr_sp('r0', sx); a.ldr_sp('r1', sy)
        for _ in range(3): a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7')
        a.bl('tile'); a.str_sp('r0', 36); a.bl('plat'); a.cmpi('r0', 0); a.bc('ne', 'pc3_' + n)
        a.ldr_sp('r0', 36); a.bl('chao'); a.cmpi('r0', 0); a.bc('eq', 'pn3_' + n)
        a.label('pc3_' + n)
        a.ldr_sp('r0', sx); a.ldr_sp('r1', sy)
        for _ in range(3): a.add_r('r0', 'r0', 'r6'); a.add_r('r1', 'r1', 'r7')
        a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'pn3_' + n)
        a.ldr_sp('r0', sx); a.add_r('r0', 'r0', 'r6'); a.str_sp('r0', 28)
        a.ldr_sp('r0', sy); a.add_r('r0', 'r0', 'r7'); a.str_sp('r0', 32); a.mov('r0', 2); a.str_sp('r0', 36)
        a.b('pachou')
        a.label('pn3_' + n)
    a.addsp(40); a.b('nada')
    a.label('pachou')
    # troca o quadrado do jogador dentro da pedra (se precisar) sem mexer no desenho
    a.ldr_lit('r3', DESL)
    for eixo, (sl, reg) in enumerate(((28, 'r10'), (32, 'r11'))):
        a.ldr_sp('r0', sl); a.movh('r2', reg); a.sub_r('r2', 'r2', 'r0'); a.lsl('r2', 'r2', 4)       # (x0 - sx) * 16
        a.mov('r1', eixo); a.ldrsb_r('r0', 'r3', 'r1'); a.add_r('r0', 'r0', 'r2'); a.strb_r('r0', 'r3', 'r1')   # V
        a.mov('r1', 2 + eixo); a.ldrsb_r('r0', 'r3', 'r1'); a.sub_r('r0', 'r0', 'r2'); a.strb_r('r0', 'r3', 'r1')   # P
    a.ldr_sp('r0', 28); a.ldr_sp('r1', 32)
    a.strh_i('r0', 'r5', 0x10); a.strh_i('r1', 'r5', 0x12); a.strh_i('r0', 'r5', 0x14); a.strh_i('r1', 'r5', 0x16)
    a.ldr_sp('r0', 36); a.addsp(40)
    a.cmpi('r0', 1); a.bc('ne', 'pdois')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'pum_hop')
    a.cmpi('r0', 2); a.bfar('eq', 'ape1')
    a.mov('r0', 2); a.b('fim')
    a.label('pum_hop'); a.movh('r0', 'r4'); a.ldr_lit('r3', HOP1 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')
    a.label('pdois')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'pdois_hop')
    a.cmpi('r0', 2); a.bc('ne', 'pdois_np'); a.bl('poeira')
    a.label('pdois_np')
    a.movh('r0', 'r4'); a.ldr_lit('r3', JUMP2 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')
    a.label('pdois_hop'); a.movh('r0', 'r4'); a.ldr_lit('r3', HOP2 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')

    # ---------- chao(r0 = valor) -> 1 se é chão comum (sem bloqueio, altura de chão) ----------
    a.label('chao')
    a.mov('r1', 0); a.mvn('r1', 'r1'); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'chnao')
    a.lsr('r1', 'r0', 10); a.mov('r2', 3); a.alu('tst', 'r1', 'r2'); a.bc('ne', 'chnao')
    a.lsr('r1', 'r0', 12); a.cmpi('r1', 2); a.bc('lo', 'chnao'); a.cmpi('r1', 15); a.bc('eq', 'chnao')
    a.mov('r0', 1); a.bx('lr')
    a.label('chnao'); a.mov('r0', 0); a.bx('lr')
    a.label('jogador')   # r5 = objeto do jogador (não mexe em r4, r6..r11)
    a.ldr_lit('r5', AVATAR); a.ldrb_i('r5', 'r5', 5); a.lsl('r5', 'r5', 25); a.lsr('r5', 'r5', 25)
    a.mov('r0', 0x24); a.alu('mul', 'r5', 'r0'); a.ldr_lit('r0', OBJS); a.add_r('r5', 'r5', 'r0'); a.bx('lr')
    a.pool()
    # dados
    a.label('dxy')
    for dx, dy in [(0, 1), (0, -1), (-1, 0), (1, 0)]: a.h((dx & 0xFF) | (dy & 0xFF) << 8)
    if a.here() % 4: a.h(0x46C0)
    a.label('offs')
    for i, dx, dy in OFFS: a.h(i); a.h((dx & 0xFF) | (dy & 0xFF) << 8)
    a.h(0); a.h(0)
    a.label('tab')
    for ts, ids in PLAT:
        for i in ids: a.word(ts); a.word(i)
    a.word(0); a.word(0)
    return a


def site_r12(at, to):
    s = A(at)
    s.push(['r4']); s.h(0x4C02)          # ldr r4, [pc, #8]
    s.movh('r12', 'r4'); s.pop(['r4']); s.bx('r12'); s.h(0x46C0); s.word(to | 1)
    b = s.build(); assert len(b) == 16, len(b)
    return b


def site(at, to, reg='r0'):
    s = A(at)
    s.ldr_lit(reg, to | 1); s.bx(reg); s.pool()
    b = s.build(); assert len(b) == 8, len(b)
    return b


if __name__ == '__main__':
    R = open(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba'), 'rb').read()
    a = code(); data = a.build(); assert a.labels['tab'] % 4 == 0
    print('tamanho', hex(len(data)), 'hop', hex(a.labels['hop']), 'side', hex(a.labels['side']), file=sys.stderr)
    s1, s2, s3 = site(HOP_SITE, a.labels['hop']), site(SIDE_SITE, a.labels['side']), site(ELEV_SITE, a.labels['elev'])
    o1, o2, o3 = R[HOP_SITE - 0x08000000:][:8], R[SIDE_SITE - 0x08000000:][:8], R[ELEV_SITE - 0x08000000:][:8]
    s4, o4 = site(CB_SITE, a.labels['cb'], 'r3'), R[CB_SITE - 0x08000000:][:8]
    s5, o5 = site(PE_SITE, a.labels['pe']), R[PE_SITE - 0x08000000:][:8]
    s6, o6 = site(SEG_SITE, a.labels['cbseg'], 'r3'), R[SEG_SITE - 0x08000000:][:8]
    s7, o7 = site_r12(COL_SITE, a.labels['col']), R[COL_SITE - 0x08000000:][:16]
    assert o7 == COL_ORIG, o7.hex()
    print('    [0x%X, "%s", "%s"],   // Acro Bike: pulinho com a roda levantada sobe em pedra/cerca; fonte: hack-fonte/nuvem/acro/acro.py' % (HOP_SITE - 0x08000000, o1.hex(), s1.hex()))
    print('    [0x%X, "%s", "%s"],   // Acro Bike: pulo de lado sobe em pedra/cerca' % (SIDE_SITE - 0x08000000, o2.hex(), s2.hex()))
    print('    [0x%X, "%s", "%s"],   // Acro Bike: em cima da pedra/cerca fica a altura do chão (mar continua bloqueado)' % (ELEV_SITE - 0x08000000, o3.hex(), s3.hex()))
    print('    [0x%X, "%s", "%s"],   // Acro Bike: em cima da pedra do mar o desenho fica no centro dela' % (CB_SITE - 0x08000000, o4.hex(), s4.hex()))
    print('    [0x%X, "%s", "%s"],   // a pé: virado para a pedra/cerca, Z dá o pulinho para cima dela' % (PE_SITE - 0x08000000, o5.hex(), s5.hex()))
    print('    [0x%X, "%s", "%s"],   // o Pokémon que segue some na água enquanto o jogador está nas pedras' % (SEG_SITE - 0x08000000, o6.hex(), s6.hex()))
    print('    [0x%X, "%s", "%s"],   // em cima da cerca/pedra anda por cima e só desce com Z' % (COL_SITE - 0x08000000, o7.hex(), s7.hex()))
    print('    [0x%X, "%s"],   // Acro Bike sobe em pedras e cercas' % (CODE - 0x08000000, data.hex()))
