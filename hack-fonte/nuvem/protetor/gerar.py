# Protetor Glacial: recorta os escudos dos prints do usuário (1536x1024 = tela do GBA x 6,4), reduz para pixels do GBA
# e gera as 3 imagens 4bpp + a paleta. uso: python gerar.py   -> escudos.bin, escudos.pal, previa.png
import struct
from PIL import Image, ImageDraw
D = 'C:/Users/Sandro/Downloads/'
F1 = Image.open(D + 'Batalha Pokémon com Escudos de Gelo.png').convert('RGB')    # fase 1: placa
F2 = Image.open(D + 'Batalha Pixelada com Escudos de Gelo.png').convert('RGB')   # fase 2: coroa
ESC = 6.4
# tons do gelo: 0 transparente, depois do contorno ao brilho
RAMPA = [(248, 0, 248), (56, 112, 200), (88, 148, 224), (128, 184, 240), (168, 212, 248), (200, 228, 252), (224, 240, 255), (255, 255, 255)]
def corta(img, poli, larg, alt, cx, cy):
    """poli em px do print; devolve lista de índices larg x alt, com o centro (cx,cy) do print no meio"""
    x0 = cx - larg * ESC / 2; y0 = cy - alt * ESC / 2
    mask = Image.new('L', img.size, 0); ImageDraw.Draw(mask).polygon(poli, fill=255)
    o = []
    for y in range(alt):
        for x in range(larg):
            bx = (int(x0 + x * ESC), int(y0 + y * ESC), int(x0 + (x + 1) * ESC), int(y0 + (y + 1) * ESC))
            m = sum(mask.crop(bx).get_flattened_data()) / 255 / ((bx[2] - bx[0]) * (bx[3] - bx[1]))
            if m < 0.5: o.append(0); continue
            pix = list(img.crop(bx).get_flattened_data())
            r = sum(p[0] for p in pix) / len(pix); g = sum(p[1] for p in pix) / len(pix); b = sum(p[2] for p in pix) / len(pix)
            lum = (r + g + b) / 3
            if b - r > 90: lum = max(lum, 150)            # azul forte é o corpo do Cubchoo atrás: vira gelo médio
            t = (lum - 110) / (248 - 110)
            o.append(min(7, max(1, 1 + int(t * 6.99))))
    # contorno: pixel opaco com vizinho transparente = tom escuro
    v = list(o)
    for y in range(alt):
        for x in range(larg):
            if not o[y * larg + x]: continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = x + dx, y + dy
                if not (0 <= a < larg and 0 <= b < alt) or not o[b * larg + a]:
                    v[y * larg + x] = 2 if o[y * larg + x] > 3 else 1; break
    return v
def bpp4(px, larg, alt):
    """larg/alt múltiplos de 8; ordem de blocos de sprite 1D"""
    s = bytearray()
    for ty in range(alt // 8):
        for tx in range(larg // 8):
            for y in range(8):
                for x in range(0, 8, 2):
                    a = px[(ty * 8 + y) * larg + tx * 8 + x]; b = px[(ty * 8 + y) * larg + tx * 8 + x + 1]
                    s.append(a | b << 4)
    return bytes(s)
PLACA = corta(F1, [(492, 462), (646, 505), (634, 690), (490, 640)], 32, 64, 568, 578)
PLACA_I = corta(F1, [(925, 308), (1082, 350), (1078, 474), (925, 442)], 32, 64, 1000, 392)
COROA = corta(F2, [(268, 575), (302, 450), (345, 485), (470, 352), (560, 470), (628, 450), (640, 620), (610, 712), (290, 712)], 64, 64, 455, 540)
COROA_I = corta(F2, [(908, 258), (932, 282), (982, 205), (1022, 272), (1062, 288), (1072, 452), (1010, 462), (914, 392)], 32, 64, 990, 332)
# o corpo do Cubchoo aparece no recorte da coroa: pinta de gelo com facetas, senão ele apareceria num aliado de outra espécie
for y in range(20, 64):
    for x in range(14, 52):
        if COROA[y * 64 + x]: COROA[y * 64 + x] = 7 if (x + y) % 19 == 0 else 6 if (x + y) // 7 % 3 == 0 else 5
open('escudos.bin', 'wb').write(bpp4(PLACA_I, 32, 64) + bpp4(COROA, 64, 64) + bpp4(COROA_I, 32, 64))
open('escudos.pal', 'wb').write(b''.join(struct.pack('<H', r >> 3 | (g >> 3) << 5 | (b >> 3) << 10) for r, g, b in RAMPA) + b'\0' * 16)
pv = Image.new('RGB', (160, 64), (120, 128, 120))
for k, (px, l, a, ox) in enumerate(((PLACA_I, 32, 64, 32), (COROA, 64, 64, 64), (COROA_I, 32, 64, 128))):
    for y in range(a):
        for x in range(l):
            if px[y * l + x]: pv.putpixel((ox + x, y), RAMPA[px[y * l + x]])
pv.resize((960, 384), Image.NEAREST).save('previa.png')
