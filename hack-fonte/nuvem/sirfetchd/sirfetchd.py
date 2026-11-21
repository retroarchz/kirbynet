# Sirfetch'd (865) preto e dourado, com olhos dourados brilhando: gera as entradas do QZ_NUVEM (game.js) e prévias.
# Fontes: *_idx.bin = pixels (índices de cor) tirados da VRAM no motor: frente 64x64, costas 64x64, ícone 32x64.
# Uso: python sirfetchd.py ROM [pasta_previas]
import sys, os, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lzc import lz77_comp, lz77_dec, tiles4
AQUI = os.path.dirname(os.path.abspath(__file__))
rom = open(sys.argv[1], 'rb').read()
ESP = 865
def c555(r, g, b): return (r >> 3) | (g >> 3) << 5 | (b >> 3) << 10
def rgb(c): return ((c & 31) << 3, (c >> 5 & 31) << 3, (c >> 10 & 31) << 3)

# --- paleta da luta (frente e costas, também resumo/Pokédex): só a normal, a shiny fica como está
PAL_PTR = 0x4E35D4 + 8 * ESP
pal_at = struct.unpack_from('<I', rom, PAL_PTR)[0] - 0x08000000
pal_orig_lz = rom[pal_at:pal_at + 40]
pal = list(struct.unpack('<16H', lz77_dec(rom, pal_at)))
NOVAS = {4: (0, 0, 0), 5: (40, 38, 48), 6: (88, 88, 100), 7: (56, 54, 66), 8: (26, 24, 32), 12: (64, 64, 76),
         11: (112, 72, 24), 13: (176, 120, 16), 14: (240, 200, 72), 15: (248, 232, 128)}   # 15 = olhos brilhando (e garras)
for k, v in NOVAS.items(): pal[k] = c555(*v)
pal_lz = bytes([0x10, 32, 0, 0])
dados = struct.pack('<16H', *pal)
for k in range(0, 32, 8): pal_lz += b'\0' + dados[k:k + 8]
assert len(pal_lz) == len(pal_orig_lz) == 40

# --- frente: olhos maiores (2 pixels cada, cor 15) e sem o terceiro brilho branco
frente = bytearray(open(os.path.join(AQUI, 'sirfetchd_idx.bin'), 'rb').read())
def px(x, y, v): frente[y * 64 + x] = v
for x in range(23, 27): px(x, 25, 4)   # olho esquerdo: sobrancelha brava preta (desce para o bico)
px(26, 26, 4)
for x in range(23, 26): px(x, 26, 15)  #   e o olho dourado brilhando embaixo dela
for x in range(30, 34): px(x, 26, 4)   # olho direito: sobrancelha
px(30, 27, 4)
for x in range(31, 34): px(x, 27, 15)  #   e o olho
for x, y in ((26, 29), (27, 29), (32, 30), (33, 30)): px(x, y, 11)   # os brilhos brancos antigos viram a borda do bico
px(36, 30, 12)                         # brilho do rosto que parecia um 3º olho
frente_lz = lz77_comp(tiles4(frente, 64, 64))
FRENTE_PTR = 0x4F7FC8 + 8 * ESP

# --- Arboliva: o desenho novo dela (0x1FEC000) passa de LZ só com literais para LZ comprimido; o Sirfetch'd vai logo depois
import re
js = open(os.path.join(AQUI, '..', '..', '..', 'game.js'), encoding='utf-8').read()
arb_raw = bytes.fromhex(re.search(r'\[0x1FEC000, "([0-9a-f]+)"\]', js).group(1))
arb_lz = lz77_comp(lz77_dec(arb_raw))
assert lz77_dec(arb_lz) == lz77_dec(arb_raw)
SIRF_AT = 0x1FEC000 + len(arb_lz)
assert SIRF_AT % 4 == 0 and SIRF_AT + len(frente_lz) <= 0x1FECA00, hex(SIRF_AT + len(frente_lz))   # 0x1FECA00+ é do editor

# --- seguidor no mapa: paleta crua própria (entrada 1728 da tabela 0x090F6590)
SEG = 0xBC4F1C
seg_orig = rom[SEG:SEG + 32]
seg = list(struct.unpack('<16H', seg_orig))
for k, v in {2: (26, 24, 32), 4: (40, 38, 48), 6: (112, 72, 24), 8: (176, 120, 16), 10: (240, 200, 72), 11: (48, 46, 58),
             12: (56, 54, 66), 13: (64, 64, 76), 14: (88, 88, 100), 15: (88, 88, 100)}.items(): seg[k] = c555(*v)
seg_novo = struct.pack('<16H', *seg)

# --- ícone do time: paleta 1 de ícones é compartilhada, então o desenho troca de cor dentro dela
ICO = struct.unpack_from('<I', rom, 0x11CA724 + 4 * ESP)[0] - 0x08000000
ico_orig = rom[ICO:ICO + 0x400]
ico = bytes(open(os.path.join(AQUI, 'icone_idx.bin'), 'rb').read())
ico_novo_idx = bytes({3: 1, 2: 14, 14: 15}.get(v, v) for v in ico)
ico_novo = tiles4(ico_novo_idx, 32, 64)
assert tiles4(ico, 32, 64) == ico_orig

h = lambda b: b.hex()
le = lambda v: struct.pack('<I', v).hex()
print('    // Sirfetch\'d (865) preto e dourado com olhos dourados brilhando (frente, costas, resumo, seguidor, ícone); fonte: hack-fonte/nuvem/sirfetchd')
print(f'    [0x{PAL_PTR + 0:X}, "{h(rom[PAL_PTR:PAL_PTR+4])}", "{h(rom[PAL_PTR:PAL_PTR+4])}"],   // (paleta fica no mesmo lugar)') if False else None
print(f'    [0x{pal_at:X}, "{h(pal_orig_lz)}",\n               "{h(pal_lz)}"],   // paleta da luta (mesmo lugar)')
print(f'    [0x{FRENTE_PTR:X}, "{h(rom[FRENTE_PTR:FRENTE_PTR+4])}", "{le(0x08000000 + SIRF_AT)}"],   // imagem de frente -> 0x{0x08000000 + SIRF_AT:08X}')
print(f'    [0x{SEG:X}, "{h(seg_orig)}",\n               "{h(seg_novo)}"],   // seguidor no mapa')
print(f'    [0x{ICO:X}, "{h(ico_orig)}",\n               "{h(ico_novo)}"],   // ícone do time')
print('NOVO_ARBOLIVA', len(arb_lz)); open(os.path.join(AQUI, 'arboliva_lz.hex'), 'w').write(h(arb_lz))
print('NOVO_SIRF', hex(SIRF_AT), len(frente_lz)); open(os.path.join(AQUI, 'frente_lz.hex'), 'w').write(h(frente_lz))
open(os.path.join(AQUI, 'entradas.txt'), 'w', encoding='utf-8').write('\n'.join([
    f'[0x{pal_at:X}, "{h(pal_orig_lz)}", "{h(pal_lz)}"]',
    f'[0x{FRENTE_PTR:X}, "{h(rom[FRENTE_PTR:FRENTE_PTR+4])}", "{le(0x08000000 + SIRF_AT)}"]',
    f'[0x{SEG:X}, "{h(seg_orig)}", "{h(seg_novo)}"]',
    f'[0x{ICO:X}, "{h(ico_orig)}", "{h(ico_novo)}"]',
    f'NOVO [0x1FEC000, "{h(arb_lz)}"]',
    f'NOVO [0x{SIRF_AT:X}, "{h(frente_lz)}"]']))

# --- prévias
if len(sys.argv) > 2:
    from PIL import Image
    out = sys.argv[2]; os.makedirs(out, exist_ok=True)
    cores = [rgb(c) for c in pal]
    def img(idx, w, h_, cs):
        im = Image.new('RGBA', (w, h_)); im.putdata([(*cs[i], 255) if i else (0, 0, 0, 0) for i in idx]); return im
    img(frente, 64, 64, cores).resize((256, 256), Image.NEAREST).save(f'{out}/frente.png')
    img(open(os.path.join(AQUI, 'costas_idx.bin'), 'rb').read(), 64, 64, cores).resize((256, 256), Image.NEAREST).save(f'{out}/costas.png')
    icp = [rgb(c) for c in struct.unpack_from('<16H', rom, 0x1FDE6B0)]
    img(ico_novo_idx[:32*32], 32, 32, icp).resize((128, 128), Image.NEAREST).save(f'{out}/icone.png')
    img(ico[:32*32], 32, 32, icp).resize((128, 128), Image.NEAREST).save(f'{out}/icone-antes.png')
