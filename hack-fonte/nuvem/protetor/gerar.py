# Protetor Glacial: desenha as 4 imagens do escudo em pixel art, nas medidas dos prints do usuário em Downloads
# (ESCUDO OFC.png = placa, "Batalha Pixelada com Escudos de Gelo.png" = coroa; 1536x1024 = tela do GBA x 6,4).
# Encolher os prints apagava o contorno fino, por isso nada aqui vem direto da imagem.
# uso: python gerar.py   -> escudos.bin, escudos.pal, previa.png
import struct
from PIL import Image, ImageDraw

CONTORNO, CORPO, CORPO2, CLARO, BRANCO, FUNDO, BRILHO = (
    (92, 146, 226), (182, 212, 246), (166, 200, 243), (212, 232, 252), (240, 247, 255), (146, 188, 240), (205, 228, 250))
cores = [CONTORNO, CORPO, CORPO2, CLARO, BRANCO, FUNDO, BRILHO]
VAZIO = (0, 0, 0)

def placa(cantos, faixas):
    """cantos: cima-esq, cima-dir, baixo-dir, baixo-esq; faixas: (x + y inicial, largura) dos reflexos"""
    img = Image.new('RGB', (32, 64), VAZIO)
    ImageDraw.Draw(img).polygon(cantos, fill=CORPO, outline=CONTORNO)
    (xe, ye), (xd, yd) = cantos[0], cantos[1]
    for y in range(64):
        for x in range(32):
            if img.getpixel((x, y)) != CORPO: continue
            d = x + y; c = CORPO
            if d >= sum(cantos[2]) - 9: c = CORPO2                         # canto de baixo mais fundo
            for a, l in faixas:
                if a <= d < a + l: c = BRANCO if d - a < l - 1 else CLARO  # reflexos em diagonal
            if x == xe + 1 or x == xd - 2: c = CLARO                       # beira esquerda e dobra da direita
            if y <= ye + (yd - ye) * (x - xe) / (xd - xe) + 2: c = CLARO   # logo abaixo do contorno de cima
            img.putpixel((x, y), c)
    return img

def coroa(larg, contorno, faces, arestas, base):
    img = Image.new('RGB', (larg, 64), VAZIO)
    d = ImageDraw.Draw(img)
    d.ellipse(base, fill=BRILHO)                                           # gelo no chão
    d.polygon(contorno, fill=CLARO)
    for cor, poli in faces: d.polygon(poli, fill=cor)
    for a, b in arestas: d.line((a, b), fill=BRANCO)
    d.polygon(contorno, outline=CONTORNO)
    # filete branco por dentro do contorno
    v = img.copy()
    for y in range(64):
        for x in range(larg):
            if img.getpixel((x, y)) in (VAZIO, CONTORNO, BRILHO): continue
            for a, b in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= a < larg and 0 <= b < 64 and img.getpixel((a, b)) == CONTORNO:
                    v.putpixel((x, y), BRANCO); break
    return v

PLACA = placa([(5, 14), (27, 20), (27, 49), (5, 42)], ((33, 2), (46, 2)))
PLACA_I = placa([(4, 19), (28, 25), (28, 45), (4, 40)], ((36, 2), (47, 2)))
COROA = coroa(64,
    [(6, 56), (3, 35), (6, 28), (9, 18), (19, 22), (34, 3), (49, 24), (59, 18), (61, 37), (61, 56), (50, 60), (13, 60)],
    [(CORPO, [(34, 4), (48, 24), (42, 31), (34, 23)]),                     # face direita do cristal do meio
     (CORPO, [(20, 25), (34, 23), (34, 60), (20, 60)]),
     (CORPO2, [(34, 23), (42, 31), (48, 25), (48, 60), (34, 60)]),
     (FUNDO, [(24, 36), (44, 36), (44, 60), (24, 60)]),                    # o que fica atrás do Pokémon
     (CORPO2, [(8, 36), (12, 31), (18, 42), (18, 55), (10, 55)]),          # cristal da esquerda
     (FUNDO, [(10, 40), (13, 36), (17, 44), (17, 54), (11, 54)]),
     (CORPO2, [(51, 37), (58, 28), (58, 55), (51, 57)]),                   # cristal da direita
     (FUNDO, [(52, 41), (57, 33), (57, 54), (52, 56)])],
    [((34, 5), (34, 22)), ((19, 24), (19, 58)), ((49, 26), (49, 58))],
    (0, 53, 63, 66))
COROA_I = coroa(32,
    [(5, 44), (3, 34), (3, 21), (8, 25), (14, 12), (21, 26), (26, 25), (28, 49), (21, 52), (12, 51)],
    [(CORPO, [(6, 28), (13, 26), (13, 48), (7, 43)]),
     (CORPO2, [(6, 36), (12, 33), (12, 47), (8, 44)]),
     (CORPO, [(15, 26), (20, 29), (20, 50), (15, 50)]),
     (CORPO2, [(16, 34), (20, 33), (20, 50), (16, 50)]),
     (CORPO2, [(22, 30), (26, 28), (27, 47), (22, 50)]),
     (FUNDO, [(7, 39), (12, 37), (12, 46), (8, 44)]),
     (FUNDO, [(16, 38), (20, 37), (20, 49), (16, 49)])],
    [((14, 13), (14, 50)), ((21, 28), (21, 51))],
    (0, 44, 31, 56))

def bpp4(img, larg):
    px = [0 if img.getpixel((x, y)) == VAZIO else 1 + cores.index(img.getpixel((x, y))) for y in range(64) for x in range(larg)]
    s = bytearray()
    for ty in range(8):
        for tx in range(larg // 8):
            for y in range(8):
                for x in range(0, 8, 2):
                    s.append(px[(ty * 8 + y) * larg + tx * 8 + x] | px[(ty * 8 + y) * larg + tx * 8 + x + 1] << 4)
    return bytes(s)

open('escudos.bin', 'wb').write(bpp4(PLACA, 32) + bpp4(PLACA_I, 32) + bpp4(COROA, 64) + bpp4(COROA_I, 32))
open('escudos.pal', 'wb').write((b'\xff\x7f' + b''.join(struct.pack('<H', r >> 3 | (g >> 3) << 5 | (b >> 3) << 10) for r, g, b in cores)).ljust(32, b'\0'))
pv = Image.new('RGB', (160, 64), (120, 128, 120))
for img, ox in ((PLACA, 0), (PLACA_I, 32), (COROA, 64), (COROA_I, 128)):
    for y in range(64):
        for x in range(img.size[0]):
            if img.getpixel((x, y)) != VAZIO: pv.putpixel((ox + x, y), img.getpixel((x, y)))
pv.resize((960, 384), Image.NEAREST).save('previa.png')
