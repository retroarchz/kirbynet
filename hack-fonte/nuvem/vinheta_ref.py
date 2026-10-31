# Modelo (Python) da vinheta pixel a pixel do Distúrbio, com a MESMA conta inteira do código do GBA.
# Serve para gerar as tabelas da ROM (build.py importa) e para conferir a memória de vídeo no teste.
import math, struct

W, TOPO = 240, 112                  # área do fundo acima da caixa de texto
RAIO, FIM, FORCA = 0.55, 1.25, 0.85  # igual ao rascunho: começa a escurecer em 55% e chega a 15% de brilho
LIN_NUVEM, LIN_FIXO = 5, 9          # fileiras de blocos: 0-4 nuvens, 5-13 fundo fixo
COLS = 30
BASE_FIXO, BASE_NUVEM = 0, 270      # blocos: fixo 0..269, nuvens 270..419 (as fontes vão para 412..510)
BASE_FONTE = 412
PAL_NUVEM, PAL_FIXO = 7, 11
B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]


def kq(x, y):
    """brilho do pixel (0..64): 64 = normal"""
    dx = (x + 0.5 - W / 2) / (W / 2); dy = (y + 0.5 - TOPO / 2) / (TOPO / 2)
    d = math.hypot(dx, dy)
    v = 0.0 if d < RAIO else min(1.0, (d - RAIO) / (FIM - RAIO))
    return round((1 - FORCA * v) * 64)


def tabela_quarto():
    """KQ de um quarto da tela (120x56); o resto é espelhado"""
    return bytes(kq(x, y) for y in range(TOPO // 2) for x in range(W // 2))


def kq_esp(q, x, y):
    xm = x if x < 120 else 239 - x
    ym = y if y < 56 else 111 - y
    return q[ym * 120 + xm]


def lum(c): return (c & 31) + (c >> 5 & 31) + (c >> 10 & 31)


def fator(lm, n):
    """multiplicador para n tons: t = (lum * k * M) >> 16 dá 16x o tom"""
    return (n - 1) * 16384 // lm if lm else 0


def indice(lm_x_m, k, base, maximo, x, y):
    t = (lm_x_m * k) >> 16
    i = (t + B4[(y & 3) * 4 + (x & 3)]) >> 4
    return base + (maximo if i > maximo else i)


def rampa(hue, lm, n):
    """n tons do preto até o brilho lm, na cor 'hue' (cores de 5 bits)"""
    lh = lum(hue)
    out = []
    for j in range(n):
        c = 0
        for s in (0, 5, 10):
            ch = hue >> s & 31
            v = (ch * lm * j + lh * (n - 1) // 2) // (lh * (n - 1)) if lh else 0
            c |= (31 if v > 31 else v) << s
        out.append(c)
    return out


def nuvem_dados(faixa, pal):
    """paleta (15 tons) e lum*M por cor das nuvens (constantes)"""
    cnt = [0] * 16
    for w in struct.unpack('<%dI' % (len(faixa) // 4), faixa):
        for i in range(8): cnt[w >> (4 * i) & 15] += 1
    cores = struct.unpack('<16H', pal)
    n = sum(cnt[1:]); lm = max(lum(cores[i]) for i in range(1, 16) if cnt[i])
    hue = 0
    for s in (0, 5, 10):
        hue |= (sum(cnt[i] * (cores[i] >> s & 31) for i in range(1, 16)) // n) << s
    m = fator(lm, 15)
    return [0] + rampa(hue, lm, 15), [lum(c) * m for c in cores]


N_ESC, N_CHAO = 5, 10                       # paleta do fundo fixo: 1-5 escuro do céu, 6-15 chão


def fixo_dados(pal2, ceu_mask, cnt):
    """paleta do fundo fixo e, por cor da paleta 2, (lum*M, base, máximo)"""
    classe2 = lambda i: i != 0 and not (ceu_mask >> i & 1)
    esc_i = next((i for i in range(1, 16) if ceu_mask >> i & 1), 1)
    esc = pal2[esc_i]
    n2 = sum(cnt[i] for i in range(16) if classe2(i))
    if n2:
        lm2 = max(lum(pal2[i]) for i in range(16) if classe2(i) and cnt[i])
        hue2 = 0
        for s in (0, 5, 10):
            hue2 |= (sum(cnt[i] * (pal2[i] >> s & 31) for i in range(16) if classe2(i)) // n2) << s
    else:
        lm2, hue2 = lum(esc), esc
    lm1 = lum(esc)
    pal = [0] + rampa(esc, lm1, N_ESC) + rampa(hue2, lm2, N_CHAO)
    m1, m2 = fator(lm1, N_ESC), fator(lm2, N_CHAO)
    por_cor = [(lum(pal2[i]) * m2, 1 + N_ESC, N_CHAO - 1) if classe2(i) else (lum(pal2[i]) * m1, 1, N_ESC - 1)
               for i in range(16)]
    return pal, por_cor


def render_fixo(vram, pal2, ceu_mask, q):
    """fundo fixo (fileiras 5-13) a partir do mapa e dos blocos do terreno; devolve (blocos, paleta)"""
    mapa = lambda r, c: struct.unpack_from('<H', vram, 0xD000 + 2 * (r * 32 + c))[0]
    def nib(e, xx, yy):
        tn, hf, vf = e & 0x3FF, e >> 10 & 1, e >> 11 & 1
        sx = 7 - xx if hf else xx; sy = 7 - yy if vf else yy
        b = vram[0x8000 + tn * 32 + sy * 4 + sx // 2]
        return b >> 4 if sx & 1 else b & 15
    cnt = [0] * 16
    for r in range(LIN_NUVEM, LIN_NUVEM + LIN_FIXO):
        for c in range(COLS):
            e = mapa(r, c)
            for yy in range(8):
                for xx in range(8): cnt[nib(e, xx, yy)] += 1
    pal, por_cor = fixo_dados(pal2, ceu_mask, cnt)
    blocos = []
    for r in range(LIN_NUVEM, LIN_NUVEM + LIN_FIXO):
        for c in range(COLS):
            e = mapa(r, c)
            t = bytearray(32)
            for yy in range(8):
                for xx in range(8):
                    x, y = c * 8 + xx, r * 8 + yy
                    lmm, base, mx = por_cor[nib(e, xx, yy)]
                    v = indice(lmm, kq_esp(q, x, y), base, mx, x, y)
                    t[yy * 4 + xx // 2] |= v << (4 * (xx & 1))
            blocos.append(bytes(t))
    return blocos, pal


def render_nuvem_linha(faixa, lm0, q, linha, off):
    blocos = []
    for c in range(COLS):
        t = bytearray(32)
        for yy in range(8):
            y = linha * 8 + yy
            for xx in range(8):
                x = c * 8 + xx
                px = (x + off) & 255
                w = struct.unpack_from('<I', faixa, (y * 32 + px // 8) * 4)[0]
                ci = w >> (4 * (px & 7)) & 15
                v = indice(lm0[ci], kq_esp(q, x, y), 1, 14, x, y)
                t[yy * 4 + xx // 2] |= v << (4 * (xx & 1))
        blocos.append(bytes(t))
    return blocos


# ---------------- versão com tabela (é a que o jogo usa): brilho em 16 níveis por pixel
def kql(x, y): return min(15, round(kq(x, y) * 15 / 64))
KQV = [round(l * 64 / 15) for l in range(16)]


def tabela_quarto4():
    return bytes(kql(x, y) for y in range(TOPO // 2) for x in range(W // 2))


def kql_esp(q4, x, y):
    xm = x if x < 120 else 239 - x
    ym = y if y < 56 else 111 - y
    return q4[ym * 120 + xm]


def tabela_saida(por_cor):
    """OUT[(nível * 16 + pontilhado) * 16 + cor] = índice na paleta; por_cor[cor] = (lum*M, base, máximo)"""
    out = bytearray(4096)
    for lv in range(16):
        for b in range(16):
            for i in range(16):
                lmm, base, mx = por_cor[i]
                t = ((lmm * KQV[lv]) >> 16) + b >> 4
                out[(lv * 16 + b) * 16 + i] = base + (mx if t > mx else t)
    return bytes(out)


def render_tab(out, q4, cor_px, x0, y0):
    """um bloco 8x8 em (x0, y0); cor_px(xx, yy) dá a cor de origem"""
    t = bytearray(32)
    for yy in range(8):
        for xx in range(8):
            x, y = x0 + xx, y0 + yy
            v = out[(kql_esp(q4, x, y) * 16 + B4[(y & 3) * 4 + (x & 3)]) * 16 + cor_px(xx, yy)]
            t[yy * 4 + xx // 2] |= v << (4 * (xx & 1))
    return bytes(t)


def render_fixo_tab(vram, pal2, ceu_mask, q4):
    mapa = lambda r, c: struct.unpack_from('<H', vram, 0xD000 + 2 * (r * 32 + c))[0]
    def nib(e, xx, yy):
        tn, hf, vf = e & 0x3FF, e >> 10 & 1, e >> 11 & 1
        sx = 7 - xx if hf else xx; sy = 7 - yy if vf else yy
        b = vram[0x8000 + tn * 32 + sy * 4 + sx // 2]
        return b >> 4 if sx & 1 else b & 15
    cnt = [0] * 16
    for r in range(LIN_NUVEM, LIN_NUVEM + LIN_FIXO):
        for c in range(COLS):
            e = mapa(r, c)
            for yy in range(8):
                for xx in range(8): cnt[nib(e, xx, yy)] += 1
    pal, por_cor = fixo_dados(pal2, ceu_mask, cnt)
    out = tabela_saida(por_cor)
    blocos = [render_tab(out, q4, lambda xx, yy, e=mapa(r, c): nib(e, xx, yy), c * 8, r * 8)
              for r in range(LIN_NUVEM, LIN_NUVEM + LIN_FIXO) for c in range(COLS)]
    return blocos, pal, out


def render_nuvem_tab(faixa, outn, q4, linha, off):
    def cor(c):
        def f(xx, yy):
            px = (c * 8 + xx + off) & 255; y = linha * 8 + yy
            w = struct.unpack_from('<I', faixa, (y * 32 + px // 8) * 4)[0]
            return w >> (4 * (px & 7)) & 15
        return f
    return [render_tab(outn, q4, cor(c), c * 8, linha * 8) for c in range(COLS)]
