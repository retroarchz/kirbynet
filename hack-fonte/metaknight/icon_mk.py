# Rostinho 16x16 do Meta Knight para o ícone de vidas do HUD (BG, paleta 15).
# Cores 1..6 da paleta 15 (as da tinta do Kirby) viram as do Meta Knight no modo Meta Knight; 7..15 são fixas.
import struct
from PIL import Image
MKPAL = {1: 0x7f39, 2: 0x7e31, 3: 0x6d8e, 4: 0x4c1d, 5: 0x7c00, 6: 0x5804}
C = {'.': 0, 'a': 1, 'b': 2, 'c': 3, 'm': 4, 'u': 5, 'd': 6, 'k': 7, 'w': 8, 'y': 9, 'o': 11}
ROWS = [
    "....kkkkkkkk....",
    "..kkduuuuuudkk..",
    ".kyykduuuudkyyk.",
    "kywyykdaaadkywyk",
    "kyyyokaaaaakoyyk",
    ".kkkkbaaaaabkkk.",
    "...kbaaaaaaabk..",
    "...kkkkkkkkkkk..",
    "..kdkyykkyykdk..",
    "..kdbkkbbkkbdk..",
    "..kdcbbbbbbcdk..",
    "...kdccbbccdk...",
    "....kddddddk....",
    "...kmmkkkkmmk...",
    "..kmmmmk.kmmmmk.",
    "...kkkk...kkkk..",
]
# a metade de baixo à direita é o bloco de baixo à esquerda espelhado (é assim no mapa do HUD)
ROWS = ROWS[:8] + [r[:8] + r[:8][::-1] for r in ROWS[8:]]

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
    pal.update if False else None
    for k, v in MKPAL.items(): pal[k] = v
    rgb = [((c & 31) * 8, ((c >> 5) & 31) * 8, ((c >> 10) & 31) * 8) for c in pal]
    img = Image.new('RGB', (16, 16), (40, 140, 90))
    for y in range(16):
        for x in range(16):
            v = C[ROWS[y][x]]
            if v: img.putpixel((x, y), rgb[v])
    img.resize((160, 160), Image.NEAREST).save('icon_mk.png')
