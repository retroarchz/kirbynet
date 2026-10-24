# Rostinho 16x16 do Meta Knight para o ícone de vidas do HUD (BG, paleta 15), adaptado do desenho do usuário
# (ref/icone_usuario.png, 22x15 -> 16x16: asas 2 colunas mais estreitas de cada lado, capacete 1 coluna de
# cada lado). A metade de baixo à direita é a da esquerda espelhada (o mapa do HUD repete esse bloco virado).
# Cores 1..6 da paleta 15 (as da tinta do Kirby) viram as do Meta Knight no modo Meta Knight; 7..15 são fixas.
import struct
from PIL import Image
MKPAL = {1: 0x6A52, 2: 0x5D6D, 3: 0x557F, 4: 0x2818, 5: 0x7C00, 6: 0x7E2B}   # lilás, lilás escuro, rosa, magenta, azul, azul médio
C = {'.': 0, 'M': 1, 'D': 2, 'P': 3, 'R': 4, 'B': 5, 'U': 6, 'k': 7, 'w': 8, 'Y': 9, 'L': 10, 'O': 11, 'b': 12,
     'N': 13, 'G': 13, 'E': 13, 'S': 15}
ROWS = [
    "................",
    ".k...kkkkkk...k.",
    "kYk.kBBBBBNk.kYk",
    "kwLkNNMLwMwNkUwk",
    "kYwUGwMMwLMDUUYk",
    "kOLbMMLMwLwwbUOk",
    ".kYbMMMMLwwwbOk.",
    "..ObMMMMLLwwbO..",
    "..kbMkYkkYkMbk..",
    "..EDMkYkkYkMDE..",
    ".kLkMLkkkkLMkLk.",
    ".kMkkMMMMMMkkMk.",
    "..kPRMMMMMMRPk..",
    "..PPPkDMMDkPPP..",
    "..RRRRkkkkRRRR..",
    "..kkkk....kkkk..",
]


def tiles():
    out = []
    for tx, ty in ((0, 0), (1, 0), (0, 1)):
        b = bytearray(32)
        for y in range(8):
            for x in range(8):
                b[y * 4 + x // 2] |= C[ROWS[ty * 8 + y][tx * 8 + x]] << (4 * (x & 1))
        out.append(bytes(b))
    return out


if __name__ == '__main__':
    p = open('pal_all.bin', 'rb').read()
    pal = [struct.unpack_from('<H', p, 2 * (15 * 16 + i))[0] for i in range(16)]
    for k, v in MKPAL.items(): pal[k] = v
    rgb = [((c & 31) * 8, ((c >> 5) & 31) * 8, ((c >> 10) & 31) * 8) for c in pal]
    img = Image.new('RGB', (16, 16), (40, 140, 90))
    for y in range(16):
        for x in range(16):
            v = C[ROWS[y][x]]
            if v: img.putpixel((x, y), rgb[v])
    img.resize((160, 160), Image.NEAREST).save('icon_mk.png')
