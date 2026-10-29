# Hack "Meta Knight" para Kirby & The Amazing Mirror (USA).
# Jogador humano com a tinta Sapphire (escolhida na Collection Room) vira o Meta Knight:
#  - desenho: o Kirby continua animando por baixo (a lógica do jogo não muda); no fim de sub_0803F46C (anima e
#    desenha o Kirby) entra um desvio para o código novo, que marca o sprite do Kirby e o do chapéu com o bit
#    0x80000 do unk8 (o jogo não copia os desenhos deles para a VRAM nem os mostra) e anima/mostra dois
#    sprites-sombra por jogador (EWRAM livre): o corpo (animação 0x390) e a espada Galaxia (0x391, mesma
#    variante), escolhidos pelas tabelas MAPA (sem espada) / MAPS (com a espada = habilidade Sword);
#  - espada: sacada por padrão (o jogador recebe a habilidade Master do próprio jogo, com os golpes dela:
#    segurar B carrega e soltar dispara a onda);
#  - defesa: segurando L (inclusive correndo ou no ar) ele para na pose de "parry" do Dark Meta Knight e não
#    leva dano (bit 0x8000 das flags, que o jogo já checa); golpe bloqueado toca o som de parry dele;
#    SELECT (Backspace no site) guarda/saca. Ao guardar, ou ao levar dano, a estrela da habilidade não sai
#    (desvio no começo de sub_080A9038); depois de levar dano a espada volta sozinha;
#  - o desenho do golpe da espada do Kirby (objeto à parte) some para o Meta Knight (desvio em sub_080753CC);
#  - paleta do Meta Knight reaplicada a cada quadro (o jogo recarrega a do Kirby ao trocar de habilidade);
#  - HUD: o rostinho das vidas vira o do Meta Knight (blocos 0x18F/0x190/0x19F do BG e cores 1..6 da paleta 15);
#  - Collection Room: a prévia "trocar cor" da Sapphire mostra o Meta Knight.
# Quando o jogador deixa a Sapphire, o bit é tirado e a animação do Kirby recomeça (recarrega os desenhos).
# Uso: python build.py entrada.gba saida.gba [patch.json]
import sys, struct, json
from thumb import Asm
from icon_mk import tiles as icon_tiles, MKPAL

HOOK = 0x08F40000          # espaço livre (0xFF) no fim da ROM, de 0x08F330A8 em diante
HOOK2 = 0x08F41000         # prévia da Collection Room
HOOK3 = 0x08F41200         # estrela da habilidade
HOOK4 = 0x08F41300         # objeto do golpe da espada da Sword (sub_080753CC)
HOOK5 = 0x08F41380         # objeto do golpe da espada da Master (sub_08075EDC)
HOOK6 = 0x08F41100         # golpe bloqueado pela defesa: som de "parry" do Dark Meta Knight
DATA = 0x08F41400
MAPA = DATA                # 185: animationIndex -> variante da 0x390 sem espada (0xFF = animação do Kirby)
MAPS = DATA + 0x100        # 185: idem com a espada (habilidade Sword)
BODYT = DATA + 0x200       # 41: blocos de VRAM do corpo em cada variante (a espada vai logo depois)
ICON = DATA + 0x240        # 96: blocos 0x18F, 0x190, 0x19F do rostinho
HUDPAL = DATA + 0x2A0      # 6 cores (1..6 da paleta 15 do BG)
SHADOW = 0x0203FF00        # 4 sprites de 0x28 bytes (corpo)
SWSH = 0x0203FE00          # 4 sprites de 0x28 bytes (espada)
MARK = 0x0203FFA0          # 4 bytes: 1 = o hack marcou o sprite desse jogador
SWOFF = 0x0203FFA4         # 4 bytes: 1 = espada guardada
PREVAB = 0x0203FFA8        # 4 bytes: habilidade no quadro anterior
GUARD = 0x0203FFAC         # 4 bytes: 1 = defendendo (o hack ligou o bit 0x8000 das flags: sem dano)
PARRYCD = 0x0203FFB0       # 4 bytes: quadros até poder tocar o "parry" de novo
HUDSAVED = 0x0203FFB4      # 1 = HUDBAK tem o ícone/cores originais do HUD (o hack trocou)
HUDBAK = 0x0203FD00        # 96 bytes dos blocos do ícone + 12 bytes das cores 1..6 da paleta 15 do BG
SONG_START = 0x0815011C    # m4aSongNumStart(num)
MASTER_FLAG = 0x0203AD34   # gUnk_0203AD34: 1 = a Master de verdade está liberada (luta final)
KIRBY_PAL = 0x0803E558     # sub_0803E558(jogador): recarrega a paleta da cor do Kirby
SE_DMK_PARRY = 0x1A6
SITE6 = 0x080365A0         # "flags & 0x8000 -> não aplica dano" (r4 = flags, r5 = kirby)
ANIM_STEP = 0x08155128     # sub_08155128(struct Sprite *) -> 0 quando a animação acabou
DISPLAY = 0x0815604C       # DisplaySprite(struct Sprite *)
SET_ANIMS = 0x0806F260     # tabelas de animação da habilidade
SET_PAL = 0x0806EFF8       # paleta do chapéu
SET_OBJ = 0x0806F288       # objeto da habilidade (a Sword cria o da espada)
MK_ANIM, SW_ANIM = 0x390, 0x391
MKPAL_ROM = 0x084BB0EC + 0x20 * 442   # paleta 442 (corpo do Meta Knight)
SWORD = 26                 # habilidade da espada sacada: KIRBY_ABILITY_MASTER (segurar B carrega e solta a onda)
GRANT = int(__import__('os').environ.get('MK_GRANT', SWORD))   # só para testes: dar outra habilidade
NUM_HUMANS = 0x0203AD30    # gNumHumanPlayers
PAINT = 0x0203AD1C         # gUnk_0203AD1C[jogador]: tinta escolhida (0xFF = nenhuma, a carinha do Kirby)
LOCAL = 0x0203AD3C         # gLocalPlayerId
MAINFLAGS = 0x03002440     # gMainFlags (1/2 = sincronizar paleta BG/OBJ; 0x30000 = paletas em transição)
OBJPAL = 0x03002C60        # gObjPalette
BGPAL = 0x030037A0         # gBgPalette
HUDMAP = 0x0600E000 + (18 * 32 + 7) * 2   # entrada do mapa do HUD onde fica o rostinho (0xF18F)
HUDTILE = 0x06004000 + 0x18F * 0x20
HUDTILE2 = 0x06004000 + 0x19F * 0x20
SAPPHIRE = 7               # tinta Sapphire (item 0x108 da Collection Room -> cor 0x108 - 0x101)
PREVIEW = 0x08386AF0       # gUnk_08386AF0[cor]: prévia "trocar cor" da Collection Room ({u16 anim, u8 variante, s8})
SITE = 0x0803F77C          # bl DisplaySprite(r7) + epílogo de sub_0803F46C
SITE2 = 0x081459C6         # sub_08145974: "DisplaySprite(&a1->unk40[0x2B])" (o Kirby "depois" da prévia)
SITE3 = 0x080A9038         # começo de sub_080A9038 (solta a estrela da habilidade)
SITE4 = 0x08075428         # sub_080753CC: "objBase->flags |= kirby->base.flags & 0x2405" (r4 obj, r6 kirby, r7 sprite)
SITE5 = 0x08075F36         # sub_08075EDC: o mesmo (r4 obj, r6 kirby, r8 sprite)
PREV_TILES = 0x083868C8 + 6 * 0x35 + 4   # gUnk_083868C8[0x35][2]: blocos de VRAM dos Kirbys da prévia (9)
PREV_ANIM, PREV_VAR = 0x389, 18            # gUnk_083868C8[0x35]: animação do Kirby da prévia
ITEM_SAPPHIRE = 0x108

FF = 0xFF


def table(entries):
    # sem 0xFF: toda pose do Kirby tem uma do Meta Knight (o padrão é "parado"), senão o desenho do Kirby
    # apareceria em golpes de outras habilidades, ao pegar itens etc.
    t = [0x0] * 185
    for idx, v in entries:
        for i in ([idx] if isinstance(idx, int) else idx): t[i] = v
    return t

# animationIndex do Kirby -> variante do Meta Knight (comum às duas tabelas)
COMMON = [
    ([1, 3, 5, 7, 9, 14, 24, 41], 0x1C),       # agachado
    ([12, 20, 21, 46, 47], 0x1),               # freada / aterrissagem
    ([11, 57], 0x2),                           # andando
    (25, 0x4),                                 # correndo
    (13, 0x6),                                 # deslizando (estocada)
    (15, 0x9),                                 # pulo
    ([16, 45, 61, 109], 0x15),                 # cambalhota / giro
    ([17, 40], 0xD),                           # caindo
    (18, 0xA),
    ([19, 63], 0xB),
    ([22, 23], 0x24),                          # espremido
    ([30, 37, 72], 0x1A),                      # engolindo
    ([32, 33, 34, 35, 62], 0xF),               # flutuando: capa-asas
    (55, 0x1E),                                # levando dano
    (list(range(74, 90)), 0x15),               # girando (canhão / estrela)
    ([93, 94, 100, 101, 102], 0xB),            # segurando item / baú: braços para cima
    (list(range(123, 141)), 0x1E),             # queimando / congelado / choque
    # golpes de outras habilidades (posições vistas no teste com cada uma): cortes sem espada.
    # 53 -> 52 -> 54 são os passos de UM golpe (4+4+5 quadros): a mesma variante para os três, senão o corte
    # do Meta Knight (preparação + meia-lua rosa só no ~8º quadro) recomeçava a cada passo e nunca aparecia
    ([52, 53, 54], 0x16), (103, 0x19), (104, 0x16), (105, 0x17), (108, 0x18), (110, 0x19),
    (111, 0x6), (112, 0x5), (list(range(113, 118)), 0x14), (147, 0x16),
]
MAP_A = table(COMMON + [
    ([26, 27, 28, 31, 36, 38, 43, 106, 107], 0x13),  # aspirando
    ([39, 122], 0x16),                               # soprando / cuspindo estrela -> corte
])
# Com a espada (Master; mesma tabela base da Sword, gUnk_0834C9AC) as posições 26..30 e 39 são "parado" (não
# aspira), 31/36/43 começam/terminam o voo, e de 103 em diante são golpes. Vistos no teste: B = 53/52/54/111,
# segurar B = 121 (carregando), soltar = 113/114 (onda), cima+B = 115..117, correndo+B = 118..120,
# baixo+B no ar = 103.
MAP_S = table(COMMON + [
    ([31, 36, 43], 0xF),                       # começa / termina o voo: capa-asas
    (66, 0x16), (67, 0x17), (68, 0x18),
    (106, 0x16), (107, 0x17), (108, 0x18), (110, 0x19),
    ([104, 105], 0x15),                        # no ar: giro
    (121, 0x0),                                # carregando: parado com a espada (o jogo põe o brilho)
    ([113, 114], 0x16),                        # solta a onda: corte para a frente
    ([115, 116, 117], 0x1B),                   # corte para cima
    (118, 0x5),                                # investida: corte em meia-lua (uma vez só)
    # depois do corte a Master gira acertando (119, ~33 quadros) e freia (120): a meia-lua (~27 quadros)
    # recomeçava em laço e parecia um segundo golpe. Desliza com a espada à frente e freia
    (119, 0x6), (120, 0x1),
])
GUARD_POSE, GUARD_POSE_AIR = 0x8, 0x9            # defesa (L): as poses de "parry" do Dark Meta Knight


def body_tiles():
    sys.path.insert(0, '.')
    from am import script
    out = []
    for v in range(41):
        out.append(max([c[2] for c in script(MK_ANIM, v) if c[0] == 'tiles'] + [0]))
    return bytes(out)


def copyh(a, dst, src, n):
    a.ldr_lit('r0', dst); a.ldr_lit('r1', src); a.mov('r2', n); a.bl('copyh')


def hook():
    a = Asm(HOOK)
    # entrada A: o jogo ia mostrar o Kirby (r0 = r7 = &kirby->base.sprite, r6 = kirby)
    a.label('A'); a.mov('r5', 1); a.b('common')
    # entrada B: o jogo não ia mostrar (piscando, escondido ou marcado por nós)
    a.label('B'); a.mov('r5', 0)
    a.label('common')
    a.movh('r8', 'r5')                     # r8 = mostrar o Kirby? (r8, r9, r10 voltam no epílogo)
    a.movh('r4', 'r7'); a.subi('r4', 0x10) # r4 = kirby
    a.mov('r0', 0x56); a.ldrb_r('r5', 'r4', 'r0')     # r5 = jogador (base.unk56)
    a.ldr_lit('r1', NUM_HUMANS); a.ldrb_i('r1', 'r1', 0)
    a.alu('cmp', 'r5', 'r1'); a.bfar('hs', 'notmk')  # só jogador humano (os ajudantes do computador não)
    a.ldr_lit('r1', PAINT); a.ldrb_r('r0', 'r1', 'r5')
    a.cmpi('r0', SAPPHIRE); a.bfar('ne', 'notmk')    # tinta escolhida na Collection Room: Sapphire
    # --- Meta Knight: esconde o Kirby e o chapéu ---
    a.ldr_lit('r1', 0x80000)
    a.ldr_i('r0', 'r7', 8); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r7', 8)
    a.mov('r2', 0xA4); a.add_r('r2', 'r4', 'r2')
    a.ldr_i('r0', 'r2', 8); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r2', 8)
    a.ldr_lit('r1', MARK); a.mov('r0', 1); a.strb_r('r0', 'r1', 'r5')
    # --- espada: SELECT guarda/saca; sacada = habilidade Sword ---
    a.ldr_lit('r0', 0x103); a.ldrb_r('r1', 'r4', 'r0')                 # r1 = habilidade
    a.ldr_lit('r6', SWOFF); a.add_r('r6', 'r6', 'r5')                  # r6 = &guardada[jogador]
    a.ldr_lit('r0', 0x11A); a.ldrh_r('r3', 'r4', 'r0'); a.mov('r0', 4); a.alu('and_', 'r3', 'r0')  # SELECT agora
    a.ldr_lit('r2', PREVAB); a.ldrb_r('r2', 'r2', 'r5')               # habilidade no quadro anterior
    a.cmpi('r3', 0); a.bc('eq', 'nosel')
    a.cmpi('r2', SWORD); a.bc('ne', 'selnotsw')
    a.cmpi('r1', 0); a.bc('eq', 'guardou')                             # o jogo soltou
    a.cmpi('r1', SWORD); a.bc('ne', 'nosel')
    a.mov('r0', 0xD4); a.ldrh_r('r0', 'r4', 'r0'); a.cmpi('r0', 25); a.bc('hi', 'nosel')   # no meio de um golpe: não
    a.mov('r0', 0); a.ldr_lit('r1', 0x103); a.strb_r('r0', 'r4', 'r1')   # o jogo não solta a Master: tira aqui
    a.movh('r0', 'r4'); a.ldr_lit('r3', SET_ANIMS | 1); a.bl('callr3')
    a.movh('r0', 'r4'); a.ldr_lit('r3', SET_PAL | 1); a.bl('callr3')
    a.mov('r1', 0)
    a.label('guardou')
    a.mov('r0', 1); a.strb_i('r0', 'r6', 0); a.b('nosel')             # guardou
    a.label('selnotsw')
    a.cmpi('r2', 0); a.bc('ne', 'nosel')                               # outra habilidade: o jogo solta ela
    a.ldrb_i('r0', 'r6', 0); a.mov('r3', 1); a.alu('eor', 'r0', 'r3'); a.strb_i('r0', 'r6', 0)
    a.label('nosel')
    a.ldrb_i('r0', 'r6', 0); a.cmpi('r0', 0); a.bc('ne', 'swdone')    # guardada
    a.cmpi('r1', 0); a.bc('ne', 'swdone')                              # já tem habilidade
    a.mov('r0', 0xD4); a.ldrh_r('r0', 'r4', 'r0'); a.cmpi('r0', 25); a.bc('hi', 'swdone')  # só parado/andando/pulando
    a.mov('r0', GRANT); a.ldr_lit('r1', 0x103); a.strb_r('r0', 'r4', 'r1')
    a.movh('r0', 'r4'); a.ldr_lit('r3', SET_ANIMS | 1); a.bl('callr3')
    a.movh('r0', 'r4'); a.ldr_lit('r3', SET_PAL | 1); a.bl('callr3')
    a.movh('r0', 'r4'); a.ldr_lit('r3', SET_OBJ | 1); a.bl('callr3')
    a.label('swdone')
    a.ldr_lit('r0', 0x103); a.ldrb_r('r0', 'r4', 'r0')
    a.ldr_lit('r2', PREVAB); a.strb_r('r0', 'r2', 'r5')
    a.ldr_lit('r2', PARRYCD); a.ldrb_r('r0', 'r2', 'r5'); a.cmpi('r0', 0); a.bc('eq', 'cd0')
    a.subi('r0', 1); a.strb_r('r0', 'r2', 'r5')
    a.label('cd0')
    # --- defesa: segurando L (parado, andando, correndo, pulando ou caindo; ele para). Flags 0x8000 = o jogo não aplica dano (ver 0x080365A6) ---
    a.ldr_lit('r0', 0x118); a.ldrh_r('r0', 'r4', 'r0'); a.ldr_lit('r1', 0x200); a.alu('tst', 'r0', 'r1')   # L (o R é o celular)
    a.bc('eq', 'noguard')
    a.mov('r0', 0xD4); a.ldrh_r('r0', 'r4', 'r0'); a.cmpi('r0', 25); a.bc('hi', 'noguard')   # andando, correndo, pulando...
    a.ldr_i('r0', 'r4', 8); a.ldr_lit('r1', 0x8000); a.alu('orr', 'r0', 'r1'); a.str_i('r0', 'r4', 8)
    a.mov('r0', 0); a.mov('r1', 0x50); a.strh_r('r0', 'r4', 'r1')                 # para de andar (base.xspeed)
    a.ldr_lit('r1', GUARD); a.mov('r0', 1); a.strb_r('r0', 'r1', 'r5'); a.b('pal')
    a.label('noguard')
    a.ldr_lit('r1', GUARD); a.ldrb_r('r0', 'r1', 'r5'); a.cmpi('r0', 0); a.bc('eq', 'pal')
    a.mov('r0', 0); a.strb_r('r0', 'r1', 'r5')
    a.ldr_i('r0', 'r4', 8); a.ldr_lit('r1', 0x8000); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r4', 8)
    a.b('pal')
    a.pool()
    # --- paleta do corpo a cada quadro (fora das transições de tela) ---
    a.label('pal')
    a.ldr_lit('r0', MAINFLAGS); a.ldr_i('r0', 'r0', 0); a.ldr_lit('r1', 0x30000); a.alu('tst', 'r0', 'r1')
    a.bc('ne', 'nopal')
    a.ldrb_i('r0', 'r7', 0x1F); a.lsl('r0', 'r0', 5); a.ldr_lit('r1', OBJPAL); a.add_r('r0', 'r0', 'r1')
    a.ldr_lit('r1', MKPAL_ROM); a.mov('r2', 16); a.bl('copyh')
    a.ldr_lit('r0', MAINFLAGS); a.ldr_i('r1', 'r0', 0); a.mov('r2', 3); a.alu('orr', 'r1', 'r2'); a.str_i('r1', 'r0', 0)
    # --- HUD do jogador deste aparelho: rostinho e cores ---
    a.ldr_lit('r0', LOCAL); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r0', 'r5'); a.bc('ne', 'nopal')
    a.ldr_lit('r0', HUDMAP); a.ldrh_i('r0', 'r0', 0); a.ldr_lit('r1', 0xF18F); a.alu('cmp', 'r0', 'r1')
    a.bc('ne', 'nopal')
    a.ldr_lit('r2', HUDSAVED); a.ldrb_i('r0', 'r2', 0); a.cmpi('r0', 0); a.bc('ne', 'hudcopy')
    a.mov('r0', 1); a.strb_i('r0', 'r2', 0)                                      # guarda o original uma vez
    copyh(a, HUDBAK, HUDTILE, 32)
    copyh(a, HUDBAK + 64, HUDTILE2, 16)
    copyh(a, HUDBAK + 96, BGPAL + 0xF1 * 2, 6)
    a.label('hudcopy')
    copyh(a, HUDTILE, ICON, 32)
    copyh(a, HUDTILE2, ICON + 64, 16)
    copyh(a, BGPAL + 0xF1 * 2, HUDPAL, 6)
    a.label('nopal')
    # --- piscando (dano): não mostra nada ---
    a.ldr_i('r0', 'r4', 8); a.mov('r1', 0x80); a.lsl('r1', 'r1', 3)
    a.alu('tst', 'r0', 'r1'); a.bfar('ne', 'out')
    # --- sombra do corpo ---
    a.mov('r0', 0x28); a.alu('mul', 'r0', 'r5')
    a.ldr_lit('r6', SHADOW); a.add_r('r6', 'r6', 'r0')                           # r6 = sombra do corpo
    a.ldr_i('r0', 'r7', 0); a.str_i('r0', 'r6', 0)                               # tilesVram
    a.ldrh_i('r0', 'r7', 0x10); a.strh_i('r0', 'r6', 0x10)                       # x
    a.ldrh_i('r0', 'r7', 0x12); a.strh_i('r0', 'r6', 0x12)                       # y
    a.ldrh_i('r0', 'r7', 0x14); a.strh_i('r0', 'r6', 0x14)                       # unk14 (prioridade OAM)
    a.ldrb_i('r0', 'r7', 0x1C); a.strb_i('r0', 'r6', 0x1C)                       # velocidade
    a.ldrb_i('r0', 'r7', 0x1F); a.strb_i('r0', 'r6', 0x1F)                       # palId
    a.ldr_i('r0', 'r7', 8); a.ldr_lit('r1', 0xC4000); a.alu('bic', 'r0', 'r1')   # unk8 do Kirby sem 0x80000/0x40000/0x4000
    a.ldr_i('r2', 'r6', 8); a.mov('r3', 0x40); a.lsl('r3', 'r3', 8); a.alu('and_', 'r2', 'r3')
    a.alu('orr', 'r0', 'r2'); a.str_i('r0', 'r6', 8)                             # + o 0x4000 (parada) da sombra
    a.mov('r0', 0); a.movh('r10', 'r0')                                          # r10 = recomeçou o corpo?
    a.mov('r0', 0xD4); a.ldrh_r('r0', 'r4', 'r0')                                # animationIndex
    a.cmpi('r0', 184); a.bc('ls', 'idxok')
    a.mov('r0', 0)                                                               # fora da tabela: parado
    a.label('idxok')
    a.ldr_lit('r1', MAPA)
    a.ldr_lit('r2', 0x103); a.ldrb_r('r2', 'r4', 'r2'); a.cmpi('r2', SWORD); a.bc('ne', 'nosw')
    a.ldr_lit('r1', MAPS)
    a.label('nosw')
    a.ldrb_r('r1', 'r1', 'r0')
    a.ldr_lit('r2', GUARD); a.ldrb_r('r2', 'r2', 'r5'); a.cmpi('r2', 0); a.bc('eq', 'noguardpose')
    a.mov('r1', GUARD_POSE)
    a.cmpi('r0', 15); a.bc('lo', 'noguardpose'); a.cmpi('r0', 19); a.bc('hi', 'noguardpose')
    a.mov('r1', GUARD_POSE_AIR)                                                  # 15..19: no ar
    a.label('noguardpose')
    a.ldr_i('r2', 'r6', 8); a.mov('r3', 0x80); a.lsl('r3', 'r3', 3)              # o Meta Knight é desenhado
    a.alu('eor', 'r2', 'r3'); a.str_i('r2', 'r6', 8)                             # virado para o outro lado
    a.movh('r9', 'r1')                                                           # r9 = variante
    a.ldr_lit('r0', MK_ANIM)
    a.ldrh_i('r2', 'r6', 0xC); a.alu('cmp', 'r2', 'r0'); a.bc('ne', 'change')
    a.ldrb_i('r2', 'r6', 0x1A); a.alu('cmp', 'r2', 'r1'); a.bc('eq', 'step')
    a.label('change')
    a.strh_i('r0', 'r6', 0xC); a.strb_i('r1', 'r6', 0x1A); a.mov('r2', 0xFF); a.strb_i('r2', 'r6', 0x1B)
    a.mov('r0', 1); a.movh('r10', 'r0')
    a.label('step')
    a.movh('r0', 'r6'); a.ldr_lit('r3', ANIM_STEP | 1); a.bl('callr3')
    a.cmpi('r0', 0); a.bc('ne', 'sword')
    a.mov('r2', 0xFF); a.strb_i('r2', 'r6', 0x1B)                                # acabou: recomeça (laço)
    a.movh('r0', 'r6'); a.ldr_lit('r3', ANIM_STEP | 1); a.bl('callr3')
    a.mov('r0', 1); a.movh('r10', 'r0')
    a.b('sword')
    a.pool()
    # --- espada (só com a habilidade Sword e variante do Meta Knight) ---
    a.label('sword')
    a.movh('r1', 'r9'); a.cmpi('r1', 36); a.bfar('hs', 'disp')                   # 0xFF (Kirby) ou sem espada
    a.ldr_lit('r2', 0x103); a.ldrb_r('r2', 'r4', 'r2'); a.cmpi('r2', SWORD); a.bfar('ne', 'disp')
    a.mov('r0', 0x28); a.alu('mul', 'r0', 'r5')
    a.ldr_lit('r3', SWSH); a.add_r('r3', 'r3', 'r0')                             # r3 = sombra da espada
    a.ldr_lit('r0', BODYT); a.ldrb_r('r0', 'r0', 'r1'); a.lsl('r0', 'r0', 5)
    a.ldr_i('r2', 'r6', 0); a.add_r('r0', 'r0', 'r2'); a.str_i('r0', 'r3', 0)    # VRAM logo depois do corpo
    a.ldrh_i('r0', 'r6', 0x10); a.strh_i('r0', 'r3', 0x10)
    a.ldrh_i('r0', 'r6', 0x12); a.strh_i('r0', 'r3', 0x12)
    a.ldrh_i('r0', 'r6', 0x14); a.strh_i('r0', 'r3', 0x14)
    a.ldrb_i('r0', 'r6', 0x1C); a.strb_i('r0', 'r3', 0x1C)
    a.mov('r0', 0xA4 + 0x1F); a.ldrb_r('r0', 'r4', 'r0'); a.strb_i('r0', 'r3', 0x1F)   # paleta do chapéu
    a.ldr_i('r0', 'r6', 8); a.mov('r2', 0x40); a.lsl('r2', 'r2', 8); a.alu('bic', 'r0', 'r2')
    a.ldr_i('r2', 'r3', 8); a.movh('r8', 'r3'); a.mov('r3', 0x40); a.lsl('r3', 'r3', 8); a.alu('and_', 'r2', 'r3')
    a.movh('r3', 'r8'); a.alu('orr', 'r0', 'r2'); a.str_i('r0', 'r3', 8)        # unk8 do corpo + 0x4000 da espada
    a.ldrh_i('r0', 'r3', 0xC); a.ldr_lit('r2', SW_ANIM); a.alu('cmp', 'r0', 'r2'); a.bc('ne', 'swchg')
    a.ldrb_i('r0', 'r3', 0x1A); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'swchg')
    a.movh('r0', 'r10'); a.cmpi('r0', 0); a.bc('eq', 'swstep')
    a.label('swchg')
    a.strh_i('r2', 'r3', 0xC); a.strb_i('r1', 'r3', 0x1A); a.mov('r0', 0xFF); a.strb_i('r0', 'r3', 0x1B)
    a.label('swstep')
    a.movh('r8', 'r3')
    a.movh('r0', 'r3'); a.ldr_lit('r3', ANIM_STEP | 1); a.bl('callr3')
    a.movh('r0', 'r8'); a.ldr_lit('r3', DISPLAY | 1); a.bl('callr3')         # espada na frente
    a.label('disp')
    a.movh('r0', 'r6'); a.ldr_lit('r3', DISPLAY | 1); a.bl('callr3')
    a.b('out')
    a.pool()
    # --- Kirby normal ---
    a.label('notmk')
    # Kirby (não Meta Knight) com a Master fora da luta final: foi o hack que deu (ex.: salvou como Meta Knight
    # e abriu de novo sem a tinta). Tira a espada e volta a ser o Kirby normal.
    a.ldr_lit('r0', 0x103); a.ldrb_r('r0', 'r4', 'r0'); a.cmpi('r0', SWORD); a.bc('ne', 'nomaster')
    a.ldr_lit('r0', MASTER_FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'nomaster')
    a.mov('r0', 0xD4); a.ldrh_r('r0', 'r4', 'r0'); a.cmpi('r0', 25); a.bc('hi', 'nomaster')
    a.mov('r0', 0); a.ldr_lit('r1', 0x103); a.strb_r('r0', 'r4', 'r1')
    a.movh('r0', 'r4'); a.ldr_lit('r3', SET_ANIMS | 1); a.bl('callr3')
    a.movh('r0', 'r4'); a.ldr_lit('r3', SET_PAL | 1); a.bl('callr3')
    a.movh('r0', 'r5'); a.ldr_lit('r3', KIRBY_PAL | 1); a.bl('callr3')
    a.label('nomaster')
    a.ldr_lit('r1', MARK); a.ldrb_r('r0', 'r1', 'r5'); a.cmpi('r0', 0); a.bc('eq', 'show')
    a.mov('r0', 0); a.strb_r('r0', 'r1', 'r5')
    a.ldr_lit('r1', 0x80000)
    a.ldr_i('r0', 'r7', 8); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r7', 8)
    a.mov('r2', 0xA4); a.add_r('r2', 'r4', 'r2')
    a.ldr_i('r0', 'r2', 8); a.alu('bic', 'r0', 'r1'); a.str_i('r0', 'r2', 8)
    a.mov('r0', 0xFF); a.strb_i('r0', 'r7', 0x1B); a.strb_i('r0', 'r2', 0x1B)     # recarrega os desenhos
    # devolve o ícone e as cores do HUD (se este aparelho é o desse jogador)
    a.ldr_lit('r0', LOCAL); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r0', 'r5'); a.bc('ne', 'show')
    a.ldr_lit('r2', HUDSAVED); a.ldrb_i('r0', 'r2', 0); a.cmpi('r0', 0); a.bc('eq', 'show')
    a.mov('r0', 0); a.strb_i('r0', 'r2', 0)
    a.ldr_lit('r0', HUDMAP); a.ldrh_i('r0', 'r0', 0); a.ldr_lit('r1', 0xF18F); a.alu('cmp', 'r0', 'r1')
    a.bc('ne', 'show')
    copyh(a, HUDTILE, HUDBAK, 32)
    copyh(a, HUDTILE2, HUDBAK + 64, 16)
    copyh(a, BGPAL + 0xF1 * 2, HUDBAK + 96, 6)
    a.ldr_lit('r0', MAINFLAGS); a.ldr_i('r1', 'r0', 0); a.mov('r2', 1); a.alu('orr', 'r1', 'r2'); a.str_i('r1', 'r0', 0)
    a.label('show')
    a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'out')
    a.movh('r0', 'r7'); a.ldr_lit('r3', DISPLAY | 1); a.bl('callr3')
    # --- epílogo original de sub_0803F46C ---
    a.label('out')
    a.addsp(4); a.pop(['r3', 'r4', 'r5'])
    a.movh('r8', 'r3'); a.movh('r9', 'r4'); a.movh('r10', 'r5')
    a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
    a.label('callr3'); a.bx('r3')
    # copyh: r0 = destino, r1 = origem, r2 = quantas meias-palavras (16 bits)
    a.label('copyh')
    a.label('copyh_l')
    a.ldrh_i('r3', 'r1', 0); a.strh_i('r3', 'r0', 0); a.addi('r0', 2); a.addi('r1', 2)
    a.subi('r2', 1); a.bc('ne', 'copyh_l'); a.bx('lr')
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


def hook3():
    # sub_080A9038(kirby, a2) solta a estrela da habilidade (SELECT ou dano). Meta Knight com a Sword: não solta.
    a = Asm(HOOK3)
    a.push(['r4', 'r5'])
    a.mov('r2', 0x56); a.ldrb_r('r2', 'r0', 'r2')
    a.ldr_lit('r3', NUM_HUMANS); a.ldrb_i('r3', 'r3', 0); a.alu('cmp', 'r2', 'r3'); a.bc('hs', 'normal')
    a.ldr_lit('r3', PAINT); a.ldrb_r('r3', 'r3', 'r2'); a.cmpi('r3', SAPPHIRE); a.bc('ne', 'normal')
    a.ldr_lit('r3', 0x103); a.ldrb_r('r3', 'r0', 'r3'); a.cmpi('r3', SWORD); a.bc('ne', 'normal')
    a.pop(['r4', 'r5']); a.bx('lr')                                  # não solta
    a.label('normal')
    a.pop(['r4', 'r5'])
    # as 4 instruções que o desvio tomou o lugar, e volta para SITE3 + 8
    a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
    a.movh('r7', 'r10'); a.movh('r6', 'r9'); a.movh('r5', 'r8')
    a.ldr_lit('r3', (SITE3 + 8) | 1); a.bx('r3')
    a.pool()
    return a.build()


def hide_obj(base, site, spr):
    # O golpe da espada do Kirby (Sword ou Master) é um objeto à parte (sprite em VRAM base+0x400, em cima da
    # Galaxia). Para o Meta Knight: some o desenho (flags 0x400, como quando o Kirby pisca) e não copia blocos
    # (sprite.unk8 0x80000); as áreas de acerto continuam (vêm da animação, que segue rodando).
    a = Asm(base)
    a.ldr_i('r0', 'r6', 8); a.ldr_lit('r2', 0x2405); a.alu('and_', 'r0', 'r2'); a.alu('orr', 'r1', 'r0')  # original
    a.mov('r0', 0x56); a.ldrb_r('r0', 'r6', 'r0')
    a.ldr_lit('r2', NUM_HUMANS); a.ldrb_i('r2', 'r2', 0); a.alu('cmp', 'r0', 'r2'); a.bc('hs', 'done')
    a.ldr_lit('r2', PAINT); a.ldrb_r('r2', 'r2', 'r0'); a.cmpi('r2', SAPPHIRE); a.bc('ne', 'done')
    a.mov('r0', 0x80); a.lsl('r0', 'r0', 3); a.alu('orr', 'r1', 'r0')
    a.movh('r3', spr)
    a.ldr_i('r0', 'r3', 8); a.ldr_lit('r2', 0x80000); a.alu('orr', 'r0', 'r2'); a.str_i('r0', 'r3', 8)
    a.label('done')
    a.str_i('r1', 'r4', 8)
    a.ldr_lit('r0', (site + 10) | 1); a.bx('r0')
    a.pool()
    return a.build()


def site_obj(site, hook):
    s = Asm(site)
    if site % 4 == 0:
        s.ldr_lit('r2', hook | 1); s.bx('r2')          # literal em site+4
    else:
        s.ldr_lit('r2', hook | 1); s.bx('r2'); s.h(0x46C0)   # nop; literal em site+6
    s.pool()
    out = s.build()
    return out + bytes([0xC0, 0x46]) * ((10 - len(out)) // 2)


def hook6():
    # Em 0x080365A0 o jogo testa "flags & 0x8000" para não aplicar dano. Se quem não tomou dano foi o Meta
    # Knight defendendo, toca o "parry" do Dark Meta Knight (no máximo a cada 30 quadros; só no aparelho dele).
    a = Asm(HOOK6)
    a.mov('r0', 0x80); a.lsl('r0', 'r0', 8); a.alu('and_', 'r4', 'r0'); a.cmpi('r4', 0); a.bc('ne', 'blocked')
    a.ldr_lit('r0', (SITE6 + 10) | 1); a.bx('r0')                    # segue para o dano, como antes
    a.label('blocked')
    a.mov('r0', 0x56); a.ldrb_r('r1', 'r5', 'r0')
    a.ldr_lit('r2', GUARD); a.ldrb_r('r0', 'r2', 'r1'); a.cmpi('r0', 0); a.bc('eq', 'skip')
    a.ldr_lit('r2', PARRYCD); a.ldrb_r('r0', 'r2', 'r1'); a.cmpi('r0', 0); a.bc('ne', 'skip')
    a.mov('r0', 30); a.strb_r('r0', 'r2', 'r1')
    a.ldr_lit('r2', LOCAL); a.ldrb_i('r2', 'r2', 0); a.alu('cmp', 'r1', 'r2'); a.bc('ne', 'skip')
    a.ldr_lit('r0', SE_DMK_PARRY); a.ldr_lit('r3', SONG_START | 1); a.bl('callr3')
    a.label('skip')
    a.ldr_lit('r0', 0x080365BA | 1); a.bx('r0')                     # não aplica o dano
    a.label('callr3'); a.bx('r3')
    a.pool()
    return a.build()


def site6():
    s = Asm(SITE6)
    s.ldr_lit('r0', HOOK6 | 1); s.bx('r0')     # literal em SITE6+4
    s.pool()
    return s.build()


def site(a_addr, b_addr):
    s = Asm(SITE)
    s.ldr_lit('r3', a_addr | 1); s.bx('r3')  # literal em SITE+8
    s.ldr_lit('r3', b_addr | 1); s.bx('r3')  # literal em SITE+12
    s.pool()
    return s.build()


def site2():
    s = Asm(SITE2)
    s.movh('r0', 'r4')                         # 0x081459C6
    s.ldr_lit('r3', HOOK2 | 1); s.bx('r3')     # 0x081459C8, literal em 0x081459CC (no lugar do bl)
    s.pool()
    return s.build()


def site3():
    s = Asm(SITE3)
    s.ldr_lit('r3', HOOK3 | 1); s.bx('r3')     # literal em SITE3+4
    s.pool()
    return s.build()


def patches():
    a = hook()
    code = a.build()
    assert len(code) <= HOOK2 - HOOK, hex(len(code))
    st = site(a.labels['A'], a.labels['B'])
    assert len(st) == 16, len(st)
    prev = PREVIEW - 0x08000000 + 4 * SAPPHIRE
    s2, s3, h2, h3 = site2(), site3(), hook2(), hook3()
    s4, h4 = site_obj(SITE4, HOOK4), hide_obj(HOOK4, SITE4, 'r7')
    s5, h5 = site_obj(SITE5, HOOK5), hide_obj(HOOK5, SITE5, 'r8')
    s6, h6 = site6(), hook6()
    assert len(s6) == 8 and len(h6) <= HOOK3 - HOOK6
    assert len(s2) == 10 and len(s3) == 8 and len(s4) == 10 and len(s5) == 10
    assert len(h2) <= HOOK6 - HOOK2 and len(h3) <= HOOK4 - HOOK3 and len(h4) <= HOOK5 - HOOK4 and len(h5) <= DATA - HOOK5
    data = bytearray(b'\xff' * 0x2B0)
    data[0:185] = bytes(MAP_A); data[0x100:0x100 + 185] = bytes(MAP_S)
    data[0x200:0x200 + 41] = body_tiles()
    data[0x240:0x240 + 96] = b''.join(icon_tiles())
    data[0x2A0:0x2AC] = struct.pack('<6H', *[MKPAL[i] for i in range(1, 7)])
    return [(SITE - 0x08000000, st), (SITE2 - 0x08000000, s2), (SITE3 - 0x08000000, s3), (SITE4 - 0x08000000, s4), (SITE5 - 0x08000000, s5), (SITE6 - 0x08000000, s6),
            (prev, struct.pack('<HBb', MK_ANIM, 0, 0)), (PREV_TILES - 0x08000000, struct.pack('<H', 20)),
            (HOOK - 0x08000000, code), (HOOK2 - 0x08000000, h2), (HOOK3 - 0x08000000, h3), (HOOK4 - 0x08000000, h4), (HOOK5 - 0x08000000, h5), (HOOK6 - 0x08000000, h6),
            (DATA - 0x08000000, bytes(data))]


if __name__ == '__main__':
    rom = bytearray(open(sys.argv[1], 'rb').read())
    ps = patches()
    for off, data in ps:
        if off >= 0xF330A8: assert all(b == 0xFF for b in rom[off:off + len(data)]), hex(off)
        rom[off:off + len(data)] = data
    open(sys.argv[2], 'wb').write(rom)
    if len(sys.argv) > 3:
        json.dump([[off, data.hex()] for off, data in ps], open(sys.argv[3], 'w'))
    print('ok', [(hex(o), len(d)) for o, d in ps])
