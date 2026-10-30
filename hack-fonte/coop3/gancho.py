# Aplica os ganchos da tripla numa ROM (já com as tabelas mudadas pelo muda.py).
import struct, sys
from pathlib import Path
src, dst = sys.argv[1:3]
d = bytearray(open(src, 'rb').read()); B = 0x08000000
def h16(a, *hs):
    for i, h in enumerate(hs): struct.pack_into('<H', d, a - B + 2 * i, h)
def w32(a, v): struct.pack_into('<I', d, a - B, v)
def bl(at, to):
    off = to - (at + 4); assert -0x400000 <= off < 0x400000
    h16(at, 0xF000 | ((off >> 12) & 0x7FF), 0xF800 | ((off >> 1) & 0x7FF))
FLAG = 0x0203FE00
# 1) montagem dos lugares (dupla normal): "movs r0,#4; mov r8,r0" -> bl H
H = 0x0803AF48
assert d[0x080331DE - B:0x080331E2 - B] == bytes.fromhex('04208046'), d[0x080331DE - B:0x080331E2 - B].hex()
h16(H, 0x4808, 0x7800, 0x2800, 0xD009,          # ldr r0,=FLAG; ldrb r0,[r0]; cmp r0,#0; beq normal
       0x6818, 0x6118, 0x615E,                    # ctrl[4] = ctrl[0]; ctrl[5] = r6 (controle do oponente)
       0x2004, 0x7128, 0x2005, 0x7168,            # pos[4] = 4; pos[5] = 5
       0x2006, 0xE001, 0x46C0,                    # r0 = 6; b done
       0x2004,                                    # normal: r0 = 4
       0x4680, 0x4770, 0x46C0)                    # done: mov r8,r0; bx lr
w32(H + 0x24, FLAG)
bl(0x080331DE, H)
# 2) dados de sprite/caixa de vida por batalhador: espaço para 6 (AllocateBattleSpritesData 0x08092518)
for a, old, new in ((0x08092524, 0x2010, 0x2018), (0x0809252E, 0x2030, 0x2048), (0x08092542, 0x2050, 0x2078)):
    assert struct.unpack_from('<H', d, a - B)[0] == old, hex(a); h16(a, new)
# 3) gBattleResources: bloco 0x1124 -> 0x1D24; bufferB de +0x824 para +0x1124 (bufferA[4..5] cabe antes do transferBuffer +0x1024)
assert struct.unpack_from('<I', d, 0x0808D5C4 - B)[0] == 0x1124; w32(0x0808D5C4, 0x1D24)
assert struct.unpack_from('<H', d, 0x0808D52A - B)[0] == 0x2010; h16(0x0808D52A, 0x2018)   # flags[6]
import bisect, collections
ldrs = []
for j in range(0, 0x800000, 2):
    hh = d[j] | d[j + 1] << 8
    if hh >> 11 == 0b01001:
        o = ((j + 4) & ~3) + (hh & 0xff) * 4
        if o + 4 <= len(d): ldrs.append((B + j, B + o, struct.unpack_from('<I', d, o)[0]))
pushes = [B + i for i in range(0, 0x800000, 2) if d[i + 1] == 0xb5]
fn = lambda a: pushes[bisect.bisect_right(pushes, a) - 1]
porf = collections.defaultdict(set)
for ins, lo, v in ldrs: porf[fn(ins)].add(v)
RES = 0x02023538
trocados = set()
for ins, lo, v in ldrs:
    if 0x824 <= v <= 0x829 and RES in porf[fn(ins)] and lo not in trocados:
        w32(lo, v + 0x900); trocados.add(lo)
print('literais do bufferB trocados:', len(trocados))
# 4) tabelas gráficas por posição estendidas para 6, no fim da ROM (área livre 0x09FE455C..)
LIVRE = [0x09FE4560]
def nova(dados):
    a = LIVRE[0]; d[a - B:a - B + len(dados)] = dados; LIVRE[0] = (a + len(dados) + 3) & ~3; return a
def repoint(old, new, onde):
    for lo in onde:
        assert struct.unpack_from('<I', d, lo - B)[0] == old, hex(lo); w32(lo, new)
rd = lambda a, n: bytes(d[a - B:a - B + n])
# coordenadas [simples 4][dupla 4] + posições 4 e 5 (x, y, 0, 0)
# linha 0 simples, 1 dupla, 2 tripla (posições 0..3) e em seguida posições 4 e 5 da tripla
TRI = [(20, 80), (212, 38), (112, 84), (164, 38), (66, 92), (116, 38)]
c = rd(0x091299E8, 32) + b''.join(bytes([x, y, 0, 0]) for x, y in TRI)
repoint(0x091299E8, nova(c), (0x080F6B40, 0x080F6B64, 0x080F6D74))
# tags novas das folhas das posições 4/5. Não usar 0xD708..0xD70C: são do jogo (0xD70C = TAG_STATUS_SUMMARY_BAR_TILE,
# a barra de bolinhas da abertura; ao ser destruída ela liberava os tiles da caixa 4, que o Pokémon do lugar 2 pegava)
TAG_BAR4, TAG_BAR5, TAG_BOX4, TAG_BOX5 = 0xD708, 0xD709, 0xD70C, 0xD70D   # TODO: trocar (ver RETOMAR-COOP3.md); 0xB7A0.. trava sem espaço de vídeo
# folhas da barra de vida (gfx, tamanho, tag): 4 e 5 iguais a 2 e 3 com tags novas
hb = bytearray(rd(0x085C3FB8, 32)); e4 = bytearray(hb[16:24]); e5 = bytearray(hb[24:32])
struct.pack_into('<H', e4, 6, TAG_BAR4); struct.pack_into('<H', e5, 6, TAG_BAR5)
HBS = nova(bytes(hb + e4 + e5)); repoint(0x085C3FB8, HBS, (0x080935B0, 0x080936E4))
# modelos de sprite da barra de vida: tileTag novo
ht = bytearray(rd(0x085C4070, 96)); t4 = bytearray(ht[48:72]); t5 = bytearray(ht[72:96])
struct.pack_into('<H', t4, 0, TAG_BAR4); struct.pack_into('<H', t5, 0, TAG_BAR5)
repoint(0x085C4070, nova(bytes(ht + t4 + t5)), (0x080AB034,))
# 5) posição das caixas de vida (GetBattlerHealthboxCoords 0x080AB6A0): switch de 4 posições -> tabela de 6 no mesmo lugar
assert rd(0x080AB6E2, 2) == bytes.fromhex('0128') and rd(0x080AB6F8, 2) == bytes.fromhex('9f20')
h16(0x080AB6E2, 0xA105, 0x0040, 0x1809, 0x7808, 0x8028, 0x7848, 0xE012, 0x46C0, 0x46C0)   # r1=tabela; x=t[pos*2]; y=t[pos*2+1]
d[0x080AB6F8 - B:0x080AB6F8 - B + 12] = bytes([159, 76, 32, 19, 159, 101, 32, 44, 159, 51, 32, 69])
# 6) mandar o 3º Pokémon na entrada: no fim da tarefa de envio (0x08039D18), antes de "bl 0x080FB0B4(tarefa, 3)",
#    se tripla e o batalhador da tarefa é 0/1, também manda o batalhador +4 (carrega gráfico + animação de envio)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'metaknight'))
from thumb import Asm
H2 = 0x0803AF80
a = Asm(H2)
a.push(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r2', FLAG); a.ldrb_i('r2', 'r2', 0); a.cmpi('r2', 0); a.bc('eq', 'out')
a.mov('r2', 0x28); a.alu('mul', 'r2', 'r0'); a.ldr_lit('r3', 0x03005648); a.add_r('r2', 'r2', 'r3'); a.ldrh_i('r4', 'r2', 0)
a.cmpi('r4', 1); a.bc('hi', 'out')
a.addi('r4', 4)
a.ldr_lit('r3', 0x0203F400); a.lsl('r5', 'r4', 1); a.ldrh_r('r5', 'r3', 'r5')            # índice na equipe
a.ldr_lit('r3', 0x02023538); a.ldr_i('r3', 'r3', 0); a.lsl('r6', 'r4', 9); a.add_r('r3', 'r3', 'r6'); a.addi('r3', 0x25); a.strb_i('r5', 'r3', 0)
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r5')
a.ldr_lit('r3', 0x020235CC); a.mov('r6', 1); a.alu('tst', 'r4', 'r6'); a.bc('eq', 'jog'); a.ldr_lit('r3', 0x02023AAC); a.label('jog')
a.add_r('r0', 'r0', 'r3'); a.movh('r1', 'r4')
a.bl(0x080931C8)                                   # BattleLoadMonSpriteGfx(mon, b)
a.movh('r0', 'r4'); a.mov('r1', 0); a.bl(0x08037B40) # StartSendOutAnim(b, FALSE)
a.label('out')
a.pop(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
a.bl(0x080FB0B4)
a.pop(['r3']); a.bx('r3')
a.pool()
code = a.build(); assert H2 + len(code) <= 0x0803AF48 + 0x258
d[H2 - B:H2 - B + len(code)] = code
assert rd(0x08039F20, 4) == bytes.fromhex('c1f0c8f8'); bl(0x08039F20, H2)
# 7) caixas de vida da 3ª posição de cada lado: modelos [2] -> [3] com tags novas e folhas carregadas no passo 5
P3, O3 = TAG_BOX4, TAG_BOX5
sp3 = nova(struct.pack('<IHH', 0x09AB4EC4, 0x800, P3)); so3 = nova(struct.pack('<IHH', 0x09AB5048, 0x800, O3))
tp = bytearray(rd(0x085C3FF0, 48)); x3 = bytearray(tp[24:48]); struct.pack_into('<H', x3, 0, P3)
repoint(0x085C3FF0, nova(bytes(tp + x3)), (0x080AAD80, 0x080AAE94))
to = bytearray(rd(0x085C4020, 48)); y3 = bytearray(to[24:48]); struct.pack_into('<H', y3, 0, O3)
repoint(0x085C4020, nova(bytes(to + y3)), (0x080AADFC, 0x080AB01C))
H3 = 0x0803B000
a = Asm(H3)
a.push(['r4'], lr=True)
a.bl(0x0803AD50)                                         # a folha original do passo 5
a.ldr_lit('r4', FLAG); a.ldrb_i('r4', 'r4', 0); a.cmpi('r4', 0); a.bc('eq', 'fim')
for folha in (sp3, so3, HBS + 32, HBS + 40):
    a.ldr_lit('r0', folha); a.bl(0x0803AD50)
a.label('fim')
a.pop(['r4']); a.pop(['r3']); a.bx('r3')
a.pool()
code = a.build(); assert H3 + len(code) <= 0x0803AF48 + 0x258
d[H3 - B:H3 - B + len(code)] = code
assert rd(0x08093692, 4) == bytes.fromhex('a7f75dfb'); bl(0x08093692, H3)
# 8) modelos de sprite dos Pokémon por posição (gBattlerSpriteTemplates 0x085BD0BC): 4 -> 6
bt = rd(0x085BD0BC, 96)
repoint(0x085BD0BC, nova(bt + bt[48:72] + bt[72:96]), (0x08094648, 0x0809E97C, 0x0809EA48, 0x0809EAB0, 0x080A4C28))
# 9) entrada da batalha (0x0804384C): switch(posição) para desenhar treinador/Pokémon -> pos 4 = como 2, pos 5 = como 3
assert rd(0x08043A5E, 10) == bytes.fromhex('022818d0032822d06be0')
h16(0x08043A5E, 0x2803, 0xD024, 0x2805, 0xD022, 0xE015)
# 10) bloco de imagens dos Pokémon (gMonSpritesGfxPtr 0x02023574, 4 posições): bloco EXTRA para as posições 4/5.
#     Envoltório nas funções que usam o bloco: se tripla e posição >= 4, troca o ponteiro pelo extra e usa posição-4.
GPTR, EXTV, POSV, EXTBLK = 0x02023574, 0x0203FE04, 0x0203F40C, 0x0203FC40
ALLOC, FREE = 0x08000BF8, 0x08000C20
NEWTPL = struct.unpack_from('<I', d, 0x08094648 - B)[0]   # tabela de modelos estendida (6) já repontada no passo 8
# funções mortas reaproveitadas como espaço de código (nada as chama; conferido por ponteiros e BL)
AREAS = [[0x0808B188, 0x0808B188 + 0x288], [0x0803B060, 0x0803AF48 + 0x258], [0x0808A35C, 0x0808A35C + 0x222]]
MORTAS = [(0x0808B188, 0x0808B188 + 0x288), (0x0803AF48, 0x0803AF48 + 0x258), (0x0808A35C, 0x0808A35C + 0x222)]
AREA = AREAS[0]
def bloco(asm_fn):
    for ar in AREAS:
        a = Asm(ar[0]); asm_fn(a); a.pool(); code = a.build()
        if ar[0] + len(code) <= ar[1]:
            d[ar[0] - B:ar[0] - B + len(code)] = code; ini = ar[0]; ar[0] = (ar[0] + len(code) + 3) & ~3; return ini
    raise Exception('sem espaço')
def deslocadas(a, F):
    # as 3 primeiras meias-palavras de F (ldr pc-relativo é recodificado com o valor)
    for k in range(3):
        hh = struct.unpack_from('<H', d, F - B + 2 * k)[0]
        if hh >> 11 == 0b01001:
            o = ((F + 2 * k + 4) & ~3) + (hh & 0xff) * 4
            a.ldr_lit((hh >> 8) & 7, struct.unpack_from('<I', d, o - B)[0])
        else: a.h(hh)
def envolve(F, tipo, depois=None):
    # tipo: 'pos' (r1 = posição), 'bat' (r1 = batalhador), None (só "depois")
    def corpo(a):
        a.push(['r4', 'r5', 'r6'])
        a.mov('r4', 0)
        if tipo:
            a.ldr_lit('r2', FLAG); a.ldrb_i('r2', 'r2', 0); a.cmpi('r2', 0); a.bc('eq', 'chama')
            if tipo == 'pos':
                a.cmpi('r1', 4); a.bc('lo', 'chama'); a.subi('r1', 4); a.mov('r4', 1)
            else:
                a.ldr_lit('r2', POSV); a.ldrb_r('r3', 'r2', 'r1'); a.cmpi('r3', 4); a.bc('lo', 'chama')
                a.subi('r3', 4); a.strb_r('r3', 'r2', 'r1'); a.movh('r6', 'r1'); a.mov('r4', 2)
            a.ldr_lit('r2', GPTR); a.ldr_i('r5', 'r2', 0); a.ldr_lit('r3', EXTV); a.ldr_i('r3', 'r3', 0); a.str_i('r3', 'r2', 0)
        a.label('chama')
        a.bl('tramp')
        if tipo:
            a.cmpi('r4', 0); a.bc('eq', 'feito')
            a.ldr_lit('r2', GPTR); a.str_i('r5', 'r2', 0)
            a.cmpi('r4', 2); a.bc('ne', 'feito')
            a.ldr_lit('r2', POSV); a.ldrb_r('r3', 'r2', 'r6'); a.addi('r3', 4); a.strb_r('r3', 'r2', 'r6')
            a.label('feito')
        if depois: depois(a)
        a.pop(['r4', 'r5', 'r6']); a.pop(['r3']); a.bx('r3')
        a.pool()
        a.label('tramp'); deslocadas(a, F); a.bl(F + 6)
    W = bloco(corpo)
    h16(F, 0xB500); bl(F + 2, W)
def aloca_extra(a):
    # depois da montagem original: se tripla, extra = Alloc(0x140); extra[0] = Alloc(0x4000);
    # spritesGfx[i] = extra[0] + i*0x2000; modelo[i] = modelos[4+i] com images = &quadros[i]; quadros[i][j] = {gfx + j*0x800, 0x800}
    a.push(['r0'])
    a.ldr_lit('r4', FLAG); a.ldrb_i('r4', 'r4', 0); a.cmpi('r4', 0); a.bc('eq', 'sem')
    # sem heap: bloco extra fixo em 0x0203FA40; imagens na metade de cima dos buffers das posições 0 e 1
    a.ldr_lit('r4', EXTBLK)
    a.ldr_lit('r2', GPTR); a.ldr_i('r2', 'r2', 0); a.ldr_i('r5', 'r2', 0); a.str_i('r5', 'r4', 0)
    a.ldr_lit('r0', 0x1000); a.add_r('r5', 'r5', 'r0')                 # r5 = 1º buffer + 0x1000
    a.ldr_lit('r6', 0x74); a.add_r('r6', 'r6', 'r4')                 # r6 = &quadros[0]
    for i in range(2):
        a.ldr_lit('r0', 0x2000 * i); a.add_r('r0', 'r0', 'r5'); a.str_i('r0', 'r4', 4 + 4 * i)
        for j in range(2):
            a.ldr_lit('r1', 0x800 * j); a.add_r('r1', 'r1', 'r0'); a.str_i('r1', 'r6', 0x10 * i + 8 * j)
            a.ldr_lit('r1', 0x800); a.strh_i('r1', 'r6', 0x10 * i + 8 * j + 4)
        a.ldr_lit('r1', NEWTPL + (4 + i) * 0x18)
        for w in range(6): a.ldr_i('r2', 'r1', 4 * w); a.str_i('r2', 'r4', 0x14 + i * 0x18 + 4 * w)
        a.ldr_lit('r1', 0x10 * i); a.add_r('r1', 'r1', 'r6'); a.str_i('r1', 'r4', 0x14 + i * 0x18 + 0xC)   # images
    a.ldr_lit('r2', GPTR); a.ldr_i('r2', 'r2', 0)                     # buffer compartilhado (+0x134) e +0x138/+0x13c
    for off in (0x134, 0x138, 0x13C):
        a.ldr_lit('r3', off); a.add_r('r1', 'r2', 'r3'); a.ldr_i('r0', 'r1', 0); a.add_r('r1', 'r4', 'r3'); a.str_i('r0', 'r1', 0)
    a.ldr_lit('r2', EXTV); a.str_i('r4', 'r2', 0)
    a.label('sem'); a.pop(['r0'])
def libera_extra(a):
    a.ldr_lit('r4', EXTV); a.mov('r0', 0); a.str_i('r0', 'r4', 0)
envolve(0x08094570, None, aloca_extra)       # montagem
envolve(0x0809464C, None, libera_extra)      # liberação
envolve(0x0809E9BC, 'pos'); envolve(0x0809EA50, 'pos'); envolve(0x0809E8F4, 'pos')   # modelo do sprite por posição
envolve(0x0809346C, 'bat'); envolve(0x080934B4, 'bat'); envolve(0x080931C8, 'bat')   # carregar gráfico
print('áreas:', [(hex(x), hex(y)) for x, y in AREAS])
def _nada(a): pass
# 11) mostrar a caixa de vida do 3º do jogador depois do envio (Intro_TryShinyAnimShowHealthbox 0x0808FD68):
#     no "SetHealthboxSpriteVisible(caixa[batalhador])" (bl em 0x0808FE86), também atualiza/desliza/mostra a do batalhador+4
HBIDS = 0x0203F9F8
def caixa4(a):
    a.push(['r4', 'r5', 'r6'], lr=True)
    a.movh('r4', 'r6')                                   # r6 = batalhador da tarefa (no chamador)
    a.bl(0x080AB3A4)                                     # original
    a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 'fim')
    a.cmpi('r4', 1); a.bc('hi', 'fim'); a.addi('r4', 4)
    a.ldr_lit('r5', HBIDS)
    a.ldr_lit('r1', 0x0203F400); a.lsl('r2', 'r4', 1); a.ldrh_r('r2', 'r1', 'r2'); a.mov('r1', 0x68); a.alu('mul', 'r1', 'r2')
    a.ldr_lit('r2', 0x020235CC); a.add_r('r1', 'r1', 'r2')
    a.ldrb_r('r0', 'r5', 'r4'); a.mov('r2', 0); a.bl(0x080AE0AC)        # UpdateHealthboxAttribute(caixa, mon, TUDO)
    a.movh('r0', 'r4'); a.bl(0x080B1254)                                 # StartHealthboxSlideIn(b)
    a.ldrb_r('r0', 'r5', 'r4'); a.bl(0x080AB3A4)                         # SetHealthboxSpriteVisible(caixa)
    a.label('fim')
    a.pop(['r4', 'r5', 'r6']); a.pop(['r3']); a.bx('r3')
H4 = bloco(caixa4)
assert rd(0x0808FE86, 4) == bytes.fromhex('1bf08dfa'), rd(0x0808FE86, 4).hex(); bl(0x0808FE86, H4)
# 12) qual Pokémon da equipe vai nos lugares 4/5 (SetBattlePartyIds 0x08033928): o 1º válido que não está em b-2 nem b-4
PIDX = 0x0203F400
def equipe45(a):
    a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 'fim')
    a.mov('r4', 4)                                     # b
    a.label('lugar')
    a.mov('r5', 0)                                     # j
    a.label('loop')
    a.ldr_lit('r6', PIDX); a.lsl('r0', 'r4', 1); a.add_r('r6', 'r6', 'r0')     # r6 = &idx[b]
    a.movh('r0', 'r6'); a.subi('r0', 4); a.ldrh_i('r1', 'r0', 0); a.cmpi('r1', 0); a.movh('r1', 'r1')
    a.ldrh_i('r1', 'r0', 0); a.alu('cmp', 'r1', 'r5'); a.bc('eq', 'prox')        # j == idx[b-2]
    a.movh('r0', 'r6'); a.subi('r0', 8); a.ldrh_i('r1', 'r0', 0); a.alu('cmp', 'r1', 'r5'); a.bc('eq', 'prox')   # j == idx[b-4]
    a.mov('r0', 0x68); a.alu('mul', 'r0', 'r5')
    a.ldr_lit('r1', 0x020235CC); a.mov('r2', 1); a.alu('tst', 'r4', 'r2'); a.bc('eq', 'jog'); a.ldr_lit('r1', 0x02023AAC); a.label('jog')
    a.add_r('r0', 'r0', 'r1'); a.bl(0x080338E8)                                # IsValidForBattle(mon)
    a.cmpi('r0', 0); a.bc('eq', 'prox')
    a.strh_i('r5', 'r6', 0); a.b('feito')
    a.label('prox'); a.addi('r5', 1); a.cmpi('r5', 6); a.bc('lo', 'loop')
    a.label('feito'); a.addi('r4', 1); a.cmpi('r4', 6); a.bc('lo', 'lugar')
    a.label('fim')
envolve(0x08033928, None, equipe45)
# 13) gravação de batalha (sBattleRecords[4][0x298] em 0x0203D814): lugares >= 4 não gravam
#     (gravavam em cima de sBattlerRecordSizes e travavam o jogo num laço)
def ignora_ge4(F):
    def corpo(a):
        a.cmpi('r0', 4); a.bc('hs', 'pula')
        a.bl('tramp')
        a.label('pula')
        a.pop(['r3']); a.bx('r3')
        a.pool()
        a.label('tramp'); deslocadas(a, F); a.bl(F + 6)
    W = bloco(corpo); h16(F, 0xB500); bl(F + 2, W)
ignora_ge4(0x08209934); ignora_ge4(0x08209980)
# 14) disposição da tripla: nas 3 leituras da tabela de coordenadas, a linha vira 2 quando a tripla está ligada
def linha_tripla(a):
    a.push(['r4'], lr=True)
    a.bl(0x080AAC88)                                   # WhichBattleCoords original (0/1)
    a.ldr_lit('r4', FLAG); a.ldrb_i('r4', 'r4', 0); a.cmpi('r4', 0); a.bc('eq', 'fim')
    a.cmpi('r0', 0); a.bc('eq', 'fim'); a.mov('r0', 2)
    a.label('fim'); a.pop(['r4']); a.pop(['r3']); a.bx('r3')
HL = bloco(linha_tripla)
for site in (0x080F6B2E, 0x080F6B52, 0x080F6D30):
    off = 0x080AAC88 - (site + 4)
    assert rd(site, 4) == struct.pack('<HH', 0xF000 | ((off >> 12) & 0x7FF), 0xF800 | ((off >> 1) & 0x7FF)), hex(site)
    bl(site, HL)
# 15) BattleStruct: tabelas por Pokémon do grupo 1 (distâncias < 0x100, todas "adds Rd,#imm") vão para uma área
#     de 0x100 bytes ANTES do bloco: o bloco é alocado com +0x100 e o jogo recebe o endereço +0x100; "adds #o" vira "subs #N".
import json
PRE = 0x100
def aloca_bs(a):
    a.push(['r4'], lr=True)
    a.ldr_lit('r4', PRE); a.add_r('r0', 'r0', 'r4'); a.bl(ALLOC)
    a.cmpi('r0', 0); a.bc('eq', 'fim'); a.add_r('r0', 'r0', 'r4')
    a.label('fim'); a.pop(['r4']); a.pop(['r3']); a.bx('r3')
def libera_bs(a):
    a.push(['r4'], lr=True)
    a.cmpi('r0', 0); a.bc('eq', 'fim'); a.ldr_lit('r4', PRE); a.h(0x1A00 | (4 << 6) | (0 << 3) | 0)   # subs r0,r0,r4
    a.bl(FREE)
    a.label('fim'); a.pop(['r4']); a.pop(['r3']); a.bx('r3')
assert rd(0x0808D510, 4) == bytes.fromhex('73f772fb') and rd(0x0808D5FE, 4) == bytes.fromhex('73f70ffb')
bl(0x0808D510, bloco(aloca_bs)); bl(0x0808D5FE, bloco(libera_bs))
FONTES = json.loads(Path(__file__).with_name('fontes_todos.json').read_text())
G1 = [(0x28, 1, 'wrappedBy'), (0x38, 1, 'battlerPartyIndexes'), (0x3C, 1, 'monToSwitchIntoId'), (0x40, 3, 'battlerPartyOrders'),
      (0x61, 1, 'chosenMovePositions'), (0x72, 2, 'lastTakenMove'), (0xA8, 2, 'chosenItem'), (0xB0, 2, 'choicedMove'), (0xB8, 2, 'changedItems')]
novo = -0x80; NOVO_BS = {}
for o, es, nm in G1:
    novo = (novo + es - 1) // es * es if es in (2, 4) else novo
    NOVO_BS[o] = (es, novo); novo += 6 * es
assert novo <= 0
feitos = set()
for o, (es, n) in NOVO_BS.items():
    for r in FONTES:
        if not (o <= r['off'] < o + 4 * es) or r['forma'] != 'A' or r['at'] in feitos: continue
        if any(ini <= r['at'] < fim for ini, fim in MORTAS): continue      # código de função morta (reaproveitada)
        hh = struct.unpack_from('<H', d, r['at'] - B)[0]
        assert hh >> 11 == 0b00110 and (hh & 0xFF) == r['off'], (hex(r['at']), hex(hh), hex(r['off']))
        alvo = n + (r['off'] - o)
        rdn = (hh >> 8) & 7
        h16(r['at'], (0x3800 | rdn << 8 | (-alvo)) if alvo < 0 else (0x3000 | rdn << 8 | alvo))
        feitos.add(r['at'])
# acessos fora da lista do Ghidra, achados seguindo o ponteiro por registrador (rastreia_bs.py) e conferidos um a um;
# 0x08203158/AA/D0 e 0x0820336C ficam de fora (base = gBattleStruct+0x16C / dados)
EXTRA = [0x080378C8, 0x080378E4, 0x080378F8, 0x08044E2C, 0x08045238, 0x080452EE, 0x080452F6, 0x0804531A, 0x08045322,
         0x08045A6C, 0x08045A92, 0x08045BAE, 0x0804F150, 0x08074914, 0x0807C52A, 0x0807CE82, 0x0807CE9E, 0x0807CEB8,
         0x08242874, 0x08293C58,
         0x08045264, 0x080452C2, 0x08045344, 0x0804546A, 0x08073CE8]     # "+off" somado no índice antes do ponteiro
for at in EXTRA:
    hh = struct.unpack_from('<H', d, at - B)[0]; off = hh & 0xFF
    assert hh >> 11 == 0b00110 and at not in feitos, (hex(at), hex(hh))
    (o, (es, n)), = [(o, v) for o, v in NOVO_BS.items() if o <= off < o + 4 * v[0]]
    alvo = n + (off - o); rdn = (hh >> 8) & 7
    h16(at, (0x3800 | rdn << 8 | (-alvo)) if alvo < 0 else (0x3000 | rdn << 8 | alvo))
    feitos.add(at)
print('BattleStruct grupo 1: %d instruções' % len(feitos), {('+%x' % o): hex(n) for o, (es, n) in NOVO_BS.items()})
open(dst, 'wb').write(d); print('ok', dst)
