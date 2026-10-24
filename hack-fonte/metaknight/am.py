# Leitor dos sprites do Kirby & The Amazing Mirror (USA), formato da decompilação katam (src/sprite.c).
import struct
from PIL import Image

ROM = open(__file__.rsplit('\\', 1)[0].rsplit('/', 1)[0] + '/am.gba', 'rb').read()
L = len(ROM)
TABLES = 0x3B909C
ANIMS, ATTRS, OAMDATA, PALETTE, TILES4, TILES8, _ = struct.unpack_from('<7I', ROM, TABLES)
NUM_ANIMS = 939
SIZES = {(0, 0): (8, 8), (0, 1): (16, 16), (0, 2): (32, 32), (0, 3): (64, 64),
         (1, 0): (16, 8), (1, 1): (32, 8), (1, 2): (32, 16), (1, 3): (64, 32),
         (2, 0): (8, 16), (2, 1): (8, 32), (2, 2): (16, 32), (2, 3): (32, 64)}
CMD_LEN = {-1: 3, -2: 3, -3: 2, -4: 1, -5: 2, -6: 3, -7: 2, -8: 3, -9: 2, -10: 4, -11: 2, -12: 2}


def u16(o): return struct.unpack_from('<H', ROM, o)[0]
def s16(o): return struct.unpack_from('<h', ROM, o)[0]
def u32(o): return struct.unpack_from('<I', ROM, o)[0]
def s32(o): return struct.unpack_from('<i', ROM, o)[0]
def R(p): return p - 0x08000000


def variants(anim):
    """Ponteiros das variantes de uma animação (até achar algo que não é ponteiro de ROM)."""
    base = R(u32(R(ANIMS) + 4 * anim))
    out = []
    while len(out) < 256:
        p = u32(base + 4 * len(out))
        if not (0x08000000 <= p < 0x08000000 + L): break
        if out and p in (u32(R(ANIMS) + 4 * a) for a in (anim, anim + 1)): break
        out.append(p)
    return out


def script(anim, var):
    """Comandos da variante: lista de (nome, args). Para no fim (salto pra trás ou -4 = fim)."""
    p = R(variants(anim)[var])
    cmds = []
    for _ in range(400):
        c = s32(p)
        if c >= 0:
            cmds.append(('show', c, s32(p + 4))); p += 8; continue
        if c == -1: cmds.append(('tiles', s32(p + 4), u32(p + 8)))
        elif c == -2: cmds.append(('pal', s32(p + 4), u16(p + 8), u16(p + 10)))
        elif c == -3: cmds.append(('jump', s32(p + 4))); break
        elif c == -4: cmds.append(('end',)); break
        elif c == -5: cmds.append(('sound', u16(p + 4)))
        elif c == -9: cmds.append(('setanim', u16(p + 4), u16(p + 6))); break
        else: cmds.append(('cmd', c, [s32(p + 4 * i) for i in range(1, CMD_LEN.get(c, 1))]))
        if c not in CMD_LEN: cmds.append(('?',)); break
        p += 4 * CMD_LEN[c]
    return cmds


def palette(idx, n=16):
    o = R(PALETTE) + 0x20 * idx
    return [u16(o + 2 * i) for i in range(n)]


def frame_attr(anim, f):
    if f >> 28:
        o = R(u32(R(ATTRS) + 4 * anim)) + 16 * (f & 0xFFFFFFF)
    else:
        o = R(u32(R(ATTRS) + 4 * anim)) + 12 * f
    bit, n, w, h, ox, oy = struct.unpack_from('<HHHHhh', ROM, o)
    return dict(oam=bit & 0x3FFF, hflip=bit >> 14 & 1, vflip=bit >> 15, n=n, w=w, h=h, ox=ox, oy=oy)


def render_frame(anim, f, tiles, pal, size=128):
    """tiles: bytes já carregados na VRAM do sprite (1D); pal: 16 cores GBA."""
    a = frame_attr(anim, f)
    rgb = [((c & 31) * 8, ((c >> 5) & 31) * 8, ((c >> 10) & 31) * 8, 0 if i == 0 else 255) for i, c in enumerate(pal)]
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    od = R(u32(R(OAMDATA) + 4 * anim)) + 6 * a['oam']
    cx, cy = size // 2, size * 3 // 4
    for k in range(a['n']):
        o0, o1, o2 = struct.unpack_from('<HHH', ROM, od + 6 * k)
        w, h = SIZES.get((o0 >> 14, o1 >> 14), (8, 8))
        y = (o0 & 0xFF); y = y - 256 if y >= 128 else y
        x = (o1 & 0x1FF); x = x - 512 if x >= 256 else x
        hf, vf = o1 >> 12 & 1, o1 >> 13 & 1
        t0 = o2 & 0x3FF
        for ty in range(h // 8):
            for tx in range(w // 8):
                ti = t0 + ty * (w // 8) + tx
                d = tiles[ti * 32:ti * 32 + 32]
                if len(d) < 32: continue
                for yy in range(8):
                    for xx in range(8):
                        v = d[yy * 4 + xx // 2] >> (4 * (xx & 1)) & 15
                        if not v: continue
                        px = (w - 1 - (tx * 8 + xx)) if hf else tx * 8 + xx
                        py = (h - 1 - (ty * 8 + yy)) if vf else ty * 8 + yy
                        X, Y = cx + x - a['ox'] + px, cy + y - a['oy'] + py
                        if 0 <= X < size and 0 <= Y < size: img.putpixel((X, Y), rgb[v])
    return img


def frames(anim, var, pal_fallback=None):
    """Executa a variante e devolve as imagens de cada 'show'."""
    vram = bytearray(0x8000)
    pal = list(palette(pal_fallback)) if pal_fallback is not None else [0] + [0x7FFF] * 15
    out = []
    for c in script(anim, var):
        if c[0] == 'tiles' and c[1] >= 0:
            src = R(TILES4) + 0x20 * c[1]
            vram[0:0x20 * c[2]] = ROM[src:src + 0x20 * c[2]]
        elif c[0] == 'pal':
            colors = palette(c[1], 16)
            for i in range(c[2]):
                if c[3] + i < 16: pal[c[3] + i] = colors[i]
        elif c[0] == 'show':
            out.append((c[1], render_frame(anim, c[2], bytes(vram), pal)))
    return out
