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
LAYOUT = 0x03005600          # gBackupMapLayout {largura, altura, mapa}: coordenadas do objeto direto (com o +7)
MAPHDR = 0x02038CB0          # gMapHeader.mapLayout -> +16 tileset primário, +20 secundário

HOP_SITE, HOP_BACK, HOP_ORIG = 0x0818CAB0, 0x0818CABE, 0x0818CA00   # "pula no lugar" (r4 = direção)
SIDE_SITE, SIDE_BACK, SIDE_OK, SIDE_ORIG = 0x0818CAFC, 0x0818CB34, 0x0818CB04, 0x0818C860   # (r5 = direção)
HOP1 = 0x080CC43C            # pulinho de 1 casa com a roda levantada (o do jogo quando está livre)
HOP2 = 0x080CC460            # pulo de 2 casas com a roda levantada (barranco)
JUMP2 = 0x080CC364           # pulo de barranco normal (2 casas)

PRIM, SEC = 0x087892D4, 0x0878934C
PLAT = [
    (PRIM, [0x0E2]),                                                     # pedrinha da areia
    (PRIM, [0x080, 0x081, 0x082, 0x088, 0x071, 0x08A, 0x090, 0x079, 0x092]),   # pedra grande marrom (3x3)
    (PRIM, [0x150, 0x151, 0x152, 0x153, 0x154, 0x158, 0x159, 0x15C]),    # pedras cinza do mar
    (SEC, [0x280, 0x282, 0x288, 0x28A, 0x291, 0x292]),                   # cerca de troncos
]


class A(Asm):
    def sub_r(self, d, n, m): self.h(0x1A00 | r(m) << 6 | r(n) << 3 | r(d))
    def lsr(self, d, m, imm): self.h(0x0800 | imm << 6 | r(m) << 3 | r(d))
    def asr(self, d, m, imm): self.h(0x1000 | imm << 6 | r(m) << 3 | r(d))
    def mvn(self, d, m): self.h(0x4000 | 15 << 6 | r(m) << 3 | r(d))
    def ldr_r(self, d, n, m): self.h(0x5800 | r(m) << 6 | r(n) << 3 | r(d))
    def build(self):
        # literais podem ser nomes de rótulos (endereços de dados definidos depois)
        self.items = [('word', self.labels[x]) if k == 'word' and isinstance(x, str) else (k, x) for k, x in self.items]
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
    # 1 casa
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7')
    a.bl('tile')
    if DEBUG: a.ldr_lit('r2', 0x0203FFF8); a.strh_i('r0', 'r2', 0)
    a.bl('plat')
    if DEBUG: a.ldr_lit('r2', 0x0203FFFA); a.strb_i('r0', 'r2', 0)
    a.cmpi('r0', 0); a.bc('eq', 'dois')
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7')
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'dois')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'um_hop')
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
    a.movh('r0', 'r9'); a.cmpi('r0', 0); a.bc('eq', 'nada')
    a.mov('r0', 0); a.mvn('r0', 'r0'); a.alu('cmp', 'r1', 'r0'); a.bc('eq', 'nada')
    a.lsr('r0', 'r1', 10); a.mov('r2', 3); a.alu('tst', 'r0', 'r2'); a.bc('ne', 'nada')
    a.lsr('r0', 'r1', 12); a.cmpi('r0', 2); a.bc('lo', 'nada'); a.cmpi('r0', 15); a.bc('eq', 'nada')
    a.label('dois_livre')
    a.movh('r0', 'r10'); a.add_r('r0', 'r0', 'r6'); a.add_r('r0', 'r0', 'r6')
    a.movh('r1', 'r11'); a.add_r('r1', 'r1', 'r7'); a.add_r('r1', 'r1', 'r7')
    a.bl('livre'); a.cmpi('r0', 0); a.bc('eq', 'nada')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'dois_hop')
    a.movh('r0', 'r4'); a.ldr_lit('r3', JUMP2 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')
    a.label('dois_hop')
    a.movh('r0', 'r4'); a.ldr_lit('r3', HOP2 | 1); a.bl('callr3b'); a.mov('r0', 1); a.b('fim')
    a.label('nada'); a.mov('r0', 0)
    a.label('fim')
    a.pop(['r2', 'r3']); a.movh('r10', 'r2'); a.movh('r11', 'r3')
    a.pop(['r2', 'r3']); a.movh('r8', 'r2'); a.movh('r9', 'r3')
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.bx('r1')
    a.label('callr3b'); a.bx('r3')
    a.pool()
    # dados
    a.label('dxy')
    for dx, dy in [(0, 1), (0, -1), (-1, 0), (1, 0)]: a.h((dx & 0xFF) | (dy & 0xFF) << 8)
    if a.here() % 4: a.h(0x46C0)
    a.label('tab')
    for ts, ids in PLAT:
        for i in ids: a.word(ts); a.word(i)
    a.word(0); a.word(0)
    return a


def site(at, to):
    s = A(at)
    s.ldr_lit('r0', to | 1); s.bx('r0'); s.pool()
    b = s.build(); assert len(b) == 8, len(b)
    return b


if __name__ == '__main__':
    R = open(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba'), 'rb').read()
    a = code(); data = a.build(); assert a.labels['tab'] % 4 == 0
    print('tamanho', hex(len(data)), 'hop', hex(a.labels['hop']), 'side', hex(a.labels['side']), file=sys.stderr)
    s1, s2 = site(HOP_SITE, a.labels['hop']), site(SIDE_SITE, a.labels['side'])
    o1, o2 = R[HOP_SITE - 0x08000000:][:8], R[SIDE_SITE - 0x08000000:][:8]
    print('    [0x%X, "%s", "%s"],   // Acro Bike: pulinho com a roda levantada sobe em pedra/cerca; fonte: hack-fonte/nuvem/acro/acro.py' % (HOP_SITE - 0x08000000, o1.hex(), s1.hex()))
    print('    [0x%X, "%s", "%s"],   // Acro Bike: pulo de lado sobe em pedra/cerca' % (SIDE_SITE - 0x08000000, o2.hex(), s2.hex()))
    print('    [0x%X, "%s"],   // Acro Bike sobe em pedras e cercas' % (CODE - 0x08000000, data.hex()))
