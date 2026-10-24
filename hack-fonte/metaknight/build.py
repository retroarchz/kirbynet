# Hack "Meta Knight" para Kirby & The Amazing Mirror (USA).
# Jogador humano com a tinta Sapphire (escolhida na Collection Room) é desenhado como Meta Knight, e a prévia
# "trocar cor" da Sapphire mostra o Meta Knight; sem tinta ou com outra tinta é o Kirby.
# O Kirby continua animando por baixo (a lógica do jogo não muda); só o desenho é trocado:
#  - no fim de sub_0803F46C (anima e desenha o Kirby) entra um desvio para o código novo;
#  - o código novo marca o sprite do Kirby (e o do chapéu) com o bit 0x80000 do unk8, que faz o jogo
#    não copiar os desenhos dele para a VRAM nem mostrá-lo, e anima/mostra um sprite-sombra (um por
#    jogador, na EWRAM livre) com a animação 0x390 (Meta Knight) escolhida pela tabela MAP;
#  - quando o jogador deixa a Sapphire, o bit é tirado e a animação do Kirby recomeça (recarrega os desenhos).
# Uso: python build.py entrada.gba saida.gba [patch.json]
import sys, struct, json
from thumb import Asm

HOOK = 0x08F40000          # espaço livre (0xFF) no fim da ROM, de 0x08F330A8 em diante
MAPA = 0x08F40800
SHADOW = 0x0203FF00        # 4 sprites de 0x28 bytes (EWRAM depois de ewram_end, nunca usada)
MARK = 0x0203FFA0          # 4 bytes: 1 = o hack marcou o sprite desse jogador
ANIM_STEP = 0x08155128     # sub_08155128(struct Sprite *) -> 0 quando a animação acabou
DISPLAY = 0x0815604C       # DisplaySprite(struct Sprite *)
MK_ANIM = 0x390
NUM_HUMANS = 0x0203AD30    # gNumHumanPlayers
PAINT = 0x0203AD1C         # gUnk_0203AD1C[jogador]: tinta escolhida (0xFF = nenhuma, a carinha do Kirby)
SAPPHIRE = 7               # tinta Sapphire (item 0x108 da Collection Room -> cor 0x108 - 0x101)
PREVIEW = 0x08386AF0       # gUnk_08386AF0[cor]: prévia "trocar cor" da Collection Room ({u16 anim, u8 variante, s8})
SITE = 0x0803F77C          # bl DisplaySprite(r7) + epílogo de sub_0803F46C
HOOK2 = 0x08F40900         # prévia da Collection Room
SITE2 = 0x081459C6         # sub_08145974: "DisplaySprite(&a1->unk40[0x2B])" (o Kirby "depois" da prévia)
PREV_TILES = 0x083868C8 + 6 * 0x35 + 4   # gUnk_083868C8[0x35][2]: blocos de VRAM dos Kirbys da prévia (9)
PREV_ANIM, PREV_VAR = 0x389, 18            # gUnk_083868C8[0x35]: animação do Kirby da prévia
ITEM_SAPPHIRE = 0x108

# animationIndex do Kirby (0..184) -> variante da animação 0x390. 0xFF = mostra a animação do próprio Kirby.
FF = 0xFF
MAP = [FF] * 185
def put(idx, v):
    for i in ([idx] if isinstance(idx, int) else idx): MAP[i] = v
put([0, 2, 4, 6, 8, 10, 29, 42, 44, 48, 49, 50, 51, 56, 58, 59, 60, 64, 65, 66, 67, 68, 69, 70, 71, 73,
     118, 119, 120, 121], 0x0)                       # parado
put([1, 3, 5, 7, 9, 14, 24, 41], 0x1C)             # agachado
put([12, 20, 46, 47], 0x1)                         # freada / aterrissagem
put([11, 57], 0x2)                                 # andando
put(25, 0x4)                                       # correndo
put(13, 0x23)                                      # deslizando
put(15, 0x9)                                       # pulo
put([16, 45, 61, 109], 0x15)                       # cambalhota
put([17, 40], 0xD)                                 # caindo
put(18, 0xA)
put([19, 63], 0xB)
put([22, 23], 0x24)                                # espremido
put([26, 27, 28, 31, 36, 38, 43, 106, 107], 0x13)  # aspirando
put([30, 37, 72], 0x1A)                            # engolindo
put([32, 33, 34, 35, 62], 0x14)                    # flutuando
put([39, 122], 0x16)                               # soprando / cuspindo estrela -> corte
put(55, 0x21)                                      # levando dano
put([52, 104], 0x16); put([53, 105], 0x17); put(54, 0x18); put(103, 0x19)   # ataques das habilidades -> cortes


def hook():
    a = Asm(HOOK)
    # entrada A: o jogo ia mostrar o Kirby (r0 = r7 = &kirby->base.sprite, r6 = kirby)
    a.label('A'); a.mov('r5', 1); a.b('common')
    # entrada B: o jogo não ia mostrar (piscando, escondido ou marcado por nós)
    a.label('B'); a.mov('r5', 0)
    a.label('common')
    a.movh('r8', 'r5')                     # r8 = mostrar o Kirby? (r8 volta no epílogo)
    a.movh('r4', 'r7'); a.subi('r4', 0x10) # r4 = kirby
    a.mov('r0', 0x56); a.ldrb_r('r5', 'r4', 'r0')     # r5 = jogador (base.unk56)
    a.ldr_lit('r1', NUM_HUMANS); a.ldrb_i('r1', 'r1', 0)
    a.alu('cmp', 'r5', 'r1'); a.bc('hs', 'notmk')    # só jogador humano (os ajudantes do computador não)
    a.ldr_lit('r1', PAINT); a.ldrb_r('r0', 'r1', 'r5')
    a.cmpi('r0', SAPPHIRE); a.bc('ne', 'notmk')      # tinta escolhida na Collection Room: Sapphire
    # --- Meta Knight ---
    a.ldr_lit('r1', 0x80000)
    a.ldr_i('r0', 'r7', 8); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r7', 8)     # Kirby: sem VRAM/sem desenho
    a.mov('r2', 0xA4); a.add_r('r2', 'r4', 'r2')                                 # chapéu (sprites[1])
    a.ldr_i('r0', 'r2', 8); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r2', 8)
    a.ldr_lit('r1', MARK); a.mov('r0', 1); a.strb_r('r0', 'r1', 'r5')
    a.ldr_i('r0', 'r4', 8); a.mov('r1', 0x80); a.lsl('r1', 'r1', 3)              # base.flags & 0x400: piscando
    a.alu('tst', 'r0', 'r1'); a.bc('ne', 'out')
    a.mov('r0', 0x28); a.alu('mul', 'r0', 'r5')
    a.ldr_lit('r6', SHADOW); a.add_r('r6', 'r6', 'r0')                           # r6 = sombra
    a.ldr_i('r0', 'r7', 0); a.str_i('r0', 'r6', 0)                               # tilesVram
    a.ldrh_i('r0', 'r7', 0x10); a.strh_i('r0', 'r6', 0x10)                       # x
    a.ldrh_i('r0', 'r7', 0x12); a.strh_i('r0', 'r6', 0x12)                       # y
    a.ldrh_i('r0', 'r7', 0x14); a.strh_i('r0', 'r6', 0x14)                       # unk14 (prioridade OAM)
    a.ldrb_i('r0', 'r7', 0x1C); a.strb_i('r0', 'r6', 0x1C)                       # velocidade
    a.ldrb_i('r0', 'r7', 0x1F); a.strb_i('r0', 'r6', 0x1F)                       # palId
    a.ldr_i('r0', 'r7', 8); a.ldr_lit('r1', 0xC4000); a.alu('bic', 'r0', 'r1')   # unk8 do Kirby sem 0x80000/0x40000/0x4000
    a.ldr_i('r2', 'r6', 8); a.mov('r3', 0x40); a.lsl('r3', 'r3', 8); a.alu('and_', 'r2', 'r3')
    a.alu('orr', 'r0', 'r2'); a.str_i('r0', 'r6', 8)                             # + o 0x4000 (parada) da sombra
    a.mov('r0', 0xD4); a.ldrh_r('r0', 'r4', 'r0')                                # animationIndex
    a.cmpi('r0', 184); a.bc('hi', 'pass')
    a.ldr_lit('r1', MAPA); a.ldrb_r('r1', 'r1', 'r0')
    a.cmpi('r1', 0xFF); a.bc('eq', 'pass')
    a.ldr_i('r2', 'r6', 8); a.mov('r3', 0x80); a.lsl('r3', 'r3', 3)              # o Meta Knight é desenhado
    a.alu('eor', 'r2', 'r3'); a.str_i('r2', 'r6', 8)                             # virado para o outro lado
    a.ldr_lit('r0', MK_ANIM); a.b('set')
    a.label('pass'); a.ldrh_i('r0', 'r7', 0xC); a.ldrb_i('r1', 'r7', 0x1A)       # a do próprio Kirby
    a.label('set')
    a.ldrh_i('r2', 'r6', 0xC); a.alu('cmp', 'r2', 'r0'); a.bc('ne', 'change')
    a.ldrb_i('r2', 'r6', 0x1A); a.alu('cmp', 'r2', 'r1'); a.bc('eq', 'step')
    a.label('change')
    a.strh_i('r0', 'r6', 0xC); a.strb_i('r1', 'r6', 0x1A); a.mov('r2', 0xFF); a.strb_i('r2', 'r6', 0x1B)
    a.label('step')
    a.movh('r0', 'r6'); a.ldr_lit('r3', ANIM_STEP | 1); a.bl('callr3')
    a.cmpi('r0', 0); a.bc('ne', 'disp')
    a.mov('r2', 0xFF); a.strb_i('r2', 'r6', 0x1B)                                # acabou: recomeça (laço)
    a.movh('r0', 'r6'); a.ldr_lit('r3', ANIM_STEP | 1); a.bl('callr3')
    a.label('disp')
    a.movh('r0', 'r6'); a.ldr_lit('r3', DISPLAY | 1); a.bl('callr3')
    a.b('out')
    # --- Kirby normal ---
    a.label('notmk')
    a.ldr_lit('r1', MARK); a.ldrb_r('r0', 'r1', 'r5'); a.cmpi('r0', 0); a.bc('eq', 'show')
    a.mov('r0', 0); a.strb_r('r0', 'r1', 'r5')
    a.ldr_lit('r1', 0x80000)
    a.ldr_i('r0', 'r7', 8); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r7', 8)
    a.mov('r2', 0xA4); a.add_r('r2', 'r4', 'r2')
    a.ldr_i('r0', 'r2', 8); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r2', 8)
    a.mov('r0', 0xFF); a.strb_i('r0', 'r7', 0x1B); a.strb_i('r0', 'r2', 0x1B)     # recarrega os desenhos
    a.label('show')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'out')
    a.movh('r0', 'r7'); a.ldr_lit('r3', DISPLAY | 1); a.bl('callr3')
    # --- epílogo original de sub_0803F46C ---
    a.label('out')
    a.addsp(4); a.pop(['r3', 'r4', 'r5'])
    a.movh('r8', 'r3'); a.movh('r9', 'r4'); a.movh('r10', 'r5')
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.label('callr3'); a.bx('r3')
    a.pool()
    return a


def hook2():
    # r4 = a1 (struct Unk_081434F8), r6 = gUnk_08386A50; o "depois" da prévia é a1->unk40[0x2B] (a1 + 0x6F8).
    # Cursor na Sapphire: o "depois" vira o Meta Knight (virado para a direita, como o Kirby); fora dela, volta.
    a = Asm(HOOK2)
    a.mov('r5', 0xDF); a.lsl('r5', 'r5', 3); a.add_r('r5', 'r4', 'r5')
    a.mov('r0', 0x2A); a.ldrb_r('r0', 'r4', 'r0'); a.lsl('r0', 'r0', 2); a.ldrh_r('r0', 'r6', 'r0')
    a.ldr_lit('r1', ITEM_SAPPHIRE); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'notsap')
    a.ldrh_i('r0', 'r5', 0xC); a.ldr_lit('r1', MK_ANIM); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'disp')
    a.strh_i('r1', 'r5', 0xC); a.mov('r0', 0); a.strb_i('r0', 'r5', 0x1A)
    a.ldr_i('r0', 'r5', 8); a.mov('r1', 0x80); a.lsl('r1', 'r1', 3); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r5', 8)
    a.b('restart')
    a.label('notsap')
    a.ldrh_i('r0', 'r5', 0xC); a.ldr_lit('r1', MK_ANIM); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'disp')
    a.ldr_lit('r1', PREV_ANIM); a.strh_i('r1', 'r5', 0xC); a.mov('r0', PREV_VAR); a.strb_i('r0', 'r5', 0x1A)
    a.ldr_i('r0', 'r5', 8); a.mov('r1', 0x80); a.lsl('r1', 'r1', 3); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r5', 8)
    a.label('restart')
    a.mov('r0', 0xFF); a.strb_i('r0', 'r5', 0x1B)
    # recomeça sem trocar a paleta (bit 0x40000): a da tinta já foi carregada pelo jogo
    a.ldr_lit('r1', 0x40000); a.ldr_i('r0', 'r5', 8); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r5', 8)
    a.movh('r0', 'r5'); a.ldr_lit('r3', ANIM_STEP | 1); a.bl('callr3')
    a.ldr_lit('r1', 0x40000); a.ldr_i('r0', 'r5', 8); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r5', 8)
    a.label('disp')
    a.movh('r0', 'r5'); a.ldr_lit('r3', DISPLAY | 1); a.bl('callr3')
    a.pop(['r4', 'r5', 'r6']); a.pop(['r0']); a.bx('r0')        # epílogo original de sub_08145974
    a.label('callr3'); a.bx('r3')
    a.pool()
    return a.build()


def site2():
    s = Asm(SITE2)
    s.movh('r0', 'r4')                         # 0x081459C6
    s.ldr_lit('r3', HOOK2 | 1); s.bx('r3')     # 0x081459C8, literal em 0x081459CC (no lugar do bl)
    s.pool()
    return s.build()


def site(a_addr, b_addr):
    s = Asm(SITE)
    s.ldr_lit('r3', a_addr | 1); s.bx('r3')  # literal em SITE+8
    s.ldr_lit('r3', b_addr | 1); s.bx('r3')  # literal em SITE+12
    s.pool()
    return s.build()


def patches():
    a = hook()
    code = a.build()
    assert len(code) < MAPA - HOOK
    st = site(a.labels['A'], a.labels['B'])
    assert len(st) == 16, len(st)
    prev = PREVIEW - 0x08000000 + 4 * SAPPHIRE
    s2 = site2()
    assert len(s2) == 10, len(s2)
    return [(SITE - 0x08000000, st), (SITE2 - 0x08000000, s2), (prev, struct.pack('<HBb', MK_ANIM, 0, 0)),
            (PREV_TILES - 0x08000000, struct.pack('<H', 20)),
            (HOOK - 0x08000000, code), (MAPA - 0x08000000, bytes(MAP)), (HOOK2 - 0x08000000, hook2())]


if __name__ == '__main__':
    rom = bytearray(open(sys.argv[1], 'rb').read())
    for off, data in patches():
        if off >= 0xF330A8: assert all(b == 0xFF for b in rom[off:off + len(data)]), hex(off)
        rom[off:off + len(data)] = data
    open(sys.argv[2], 'wb').write(rom)
    if len(sys.argv) > 3:
        json.dump([[off, data.hex()] for off, data in patches()], open(sys.argv[3], 'w'))
    print('ok', [(hex(o), len(d)) for o, d in patches()])
