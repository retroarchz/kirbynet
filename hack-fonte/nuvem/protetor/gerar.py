# Protetor Glacial: recorta os escudos dos prints do usuário (1536x1024 = tela do GBA x 6,4), reduz para pixels do GBA
# e gera as 4 imagens 4bpp + a paleta. uso: python gerar.py   -> escudos.bin, escudos.pal, previa.png
import struct
from PIL import Image, ImageDraw
D = 'C:/Users/Sandro/Downloads/'
F1 = Image.open(D + 'Batalha Pokémon com Escudos de Gelo.png').convert('RGB')    # fase 1: placa
F2 = Image.open(D + 'Batalha Pixelada com Escudos de Gelo.png').convert('RGB')   # fase 2: coroa
ESC = 6.4

def corta(img, poli, larg, alt, cx, cy):
    """poli em px do print; devolve larg x alt de (r, g, b) ou None, com o centro (cx,cy) do print no meio do sprite"""
    x0 = cx - larg * ESC / 2; y0 = cy - alt * ESC / 2
    mask = Image.new('L', img.size, 0); ImageDraw.Draw(mask).polygon(poli, fill=255)
    o = []
    for y in range(alt):
        for x in range(larg):
            bx = (int(x0 + x * ESC), int(y0 + y * ESC), int(x0 + (x + 1) * ESC), int(y0 + (y + 1) * ESC))
            if bx[1] >= img.size[1]: o.append(None); continue
            pm = list(mask.crop(bx).get_flattened_data())
            if sum(pm) / 255 / len(pm) < 0.5: o.append(None); continue
            px = [p for p, k in zip(img.crop(bx).get_flattened_data(), pm) if k]
            o.append(tuple(sum(c[i] for c in px) // len(px) for i in range(3)))
    return o

def faceta(x, y):
    return (235, 245, 255) if (x + y) % 19 == 0 else (214, 234, 252) if (x + y) // 7 % 3 == 0 else (190, 220, 248)

# o corpo do Cubchoo aparece nos dois recortes de costas: vira gelo, senão apareceria num aliado de outra espécie
PLACA = corta(F1, [(492, 462), (646, 505), (634, 690), (490, 640)], 32, 64, 568, 578)
for y in range(16, 54):
    for x in range(3, 16):
        if PLACA[y * 32 + x] is not None: PLACA[y * 32 + x] = faceta(x, y)
PLACA_I = corta(F1, [(925, 308), (1082, 350), (1078, 474), (925, 442)], 32, 64, 1000, 392)
COROA = corta(F2, [(268, 575), (302, 450), (345, 485), (470, 352), (560, 470), (628, 450), (640, 620), (690, 716), (225, 716)], 64, 64, 455, 540)
for y in range(20, 64):
    for x in range(14, 52):
        if COROA[y * 64 + x] is not None: COROA[y * 64 + x] = faceta(x, y)
COROA_I = corta(F2, [(895, 412), (908, 258), (932, 282), (982, 205), (1022, 272), (1062, 288), (1072, 455), (1084, 470), (1010, 472), (900, 442)], 32, 64, 990, 332)

# paleta única de 15 cores tirada dos próprios desenhos
todos = [p for img in (PLACA, PLACA_I, COROA, COROA_I) for p in img if p is not None]
amostra = Image.new('RGB', (len(todos), 1)); amostra.putdata(todos)
q = amostra.quantize(15, Image.MEDIANCUT)
pal = q.getpalette()[:45]
cores = [tuple(pal[i:i + 3]) for i in range(0, 45, 3)]
def idx(p):
    if p is None: return 0
    return 1 + min(range(15), key=lambda k: sum((a - b) ** 2 for a, b in zip(p, cores[k])))
def bpp4(img, larg, alt):
    px = [idx(p) for p in img]
    s = bytearray()
    for ty in range(alt // 8):
        for tx in range(larg // 8):
            for y in range(8):
                for x in range(0, 8, 2):
                    s.append(px[(ty * 8 + y) * larg + tx * 8 + x] | px[(ty * 8 + y) * larg + tx * 8 + x + 1] << 4)
    return bytes(s)
open('escudos.bin', 'wb').write(bpp4(PLACA, 32, 64) + bpp4(PLACA_I, 32, 64) + bpp4(COROA, 64, 64) + bpp4(COROA_I, 32, 64))
open('escudos.pal', 'wb').write(b'\xff\x7f' + b''.join(struct.pack('<H', r >> 3 | (g >> 3) << 5 | (b >> 3) << 10) for r, g, b in cores))
pv = Image.new('RGB', (160, 64), (120, 128, 120))
for img, l, ox in ((PLACA, 32, 0), (PLACA_I, 32, 32), (COROA, 64, 64), (COROA_I, 32, 128)):
    for y in range(64):
        for x in range(l):
            if img[y * l + x] is not None: pv.putpixel((ox + x, y), cores[idx(img[y * l + x]) - 1])
pv.resize((960, 384), Image.NEAREST).save('previa.png')
