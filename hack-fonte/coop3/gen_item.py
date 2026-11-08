# Item usado pelo treinador (Super Potion etc.) travava a luta (08/11).
# O comando de script "callnative 0x0808A35D" (scripts de item do treinador em 0x084B3E3B e 0x084B3E9E) chama a rotina
# original que aplica o item (lê gLastUsedItem 0x02023200, gBattlerAttacker 0x02023204 e avança gBattlescriptCurrInstr).
# O coop3.py gravou código próprio em 0x0808A35C..0x0808A4D8 (achando que era livre): na luta solo o script repetia o
# callnative para sempre (travado em "LÍDER WATTSON usou Super Potion!"); pelo cabo a luta seguia mas a cura sumia.
# Correção: a rotina original inteira (0x0808A35C..0x0808A5A0, código + literais) vai para 0x09FF6E80 com os bl refeitos,
# e os dois callnative apontam para a cópia. O código do coop3 em 0x0808A35C fica onde está.
# Uso: python gen_item.py  -> imprime as linhas para TELA_COOP3 (linkhle.js); JSON=arquivo grava também em json
import json, struct, os
AQUI = os.path.dirname(os.path.abspath(__file__))
ORIG = os.path.join(AQUI, "..", "..", "roms", "PokemonQuetzalPtBrAlpha9v1.gba")
SITE = os.path.join(AQUI, "..", "..", "roms", "PokemonQuetzalCoop3Teste.gba")
INI, FIM, NOVO = 0x0808A35C, 0x0808A5A0, 0x09FF6E80
CHAMADAS = [0x084B3E3B, 0x084B3E9E]
R = 0x08000000
o = open(ORIG, "rb").read()
s = open(SITE, "rb").read()
assert NOVO % 4 == INI % 4, "literais lidos por pc precisam do mesmo alinhamento"
assert all(b == 0xFF for b in s[NOVO - R:NOVO - R + (FIM - INI)]), "área de destino não está livre"
for c in CHAMADAS:
    assert o[c - R - 1] == 0xFF and struct.unpack_from("<I", o, c - R)[0] == INI | 1, hex(c)
    assert s[c - R:c - R + 4] == o[c - R:c - R + 4], "o script mudou na ROM do site"
cod = bytearray(o[INI - R:FIM - R])
# bl não alcança a ROM baixa de 0x09FF...: cada destino ganha uma ponte depois da cópia (bx pc; ARM ldr ip, =destino; bx ip)
pontes = {}
def ponte(alvo):
    if alvo not in pontes:
        pontes[alvo] = NOVO + len(cod) + 16 * len(pontes)
    return pontes[alvo]
# fim do código: o último "bx r0" antes dos literais
fim_cod = INI + 0x222
assert struct.unpack_from("<H", cod, fim_cod - 2 - INI)[0] == 0x4700
k = 0
while INI + k < fim_cod:
    h = struct.unpack_from("<H", cod, k)[0]
    a = INI + k
    if (h & 0xF800) == 0xF000:   # bl (2 meias-palavras): destino absoluto fica, deslocamento muda
        l = struct.unpack_from("<H", cod, k + 2)[0]
        assert (l & 0xF800) == 0xF800
        off = ((h & 0x7FF) << 12) | ((l & 0x7FF) << 1)
        if off & 0x400000: off -= 0x800000
        alvo = a + 4 + off
        novo = ponte(alvo) - (NOVO + k + 4)
        assert -0x400000 <= novo < 0x400000
        n = novo & 0x7FFFFF
        struct.pack_into("<HH", cod, k, 0xF000 | (n >> 12), 0xF800 | ((n >> 1) & 0x7FF))
        k += 4; continue
    if (h & 0xF000) == 0xD000 and (h & 0x0F00) < 0x0E00:   # b condicional: tem que ficar dentro
        off = (h & 0xFF); off = off - 0x100 if off & 0x80 else off
        alvo = a + 4 + off * 2
        assert INI <= alvo < fim_cod, "b condicional para fora: %x -> %x" % (a, alvo)
    if (h & 0xF800) == 0xE000:   # b
        off = h & 0x7FF; off = off - 0x800 if off & 0x400 else off
        alvo = a + 4 + off * 2
        assert INI <= alvo < fim_cod, "b para fora: %x -> %x" % (a, alvo)
    if (h & 0xFF87) == 0x4687:   # mov pc, rX
        raise SystemExit("mov pc em %x" % a)
    k += 2
for alvo, at in sorted(pontes.items(), key=lambda x: x[1]):
    assert at == NOVO + len(cod)
    cod += bytes([0x78, 0x47, 0xC0, 0x46, 0x00, 0xC0, 0x9F, 0xE5, 0x1C, 0xFF, 0x2F, 0xE1]) + struct.pack("<I", alvo | 1)
assert all(b == 0xFF for b in s[NOVO - R:NOVO - R + len(cod)]), "área de destino não está livre"
print("    // destinos com ponte:", ", ".join(hex(a) for a in pontes), "fim", hex(NOVO + len(cod)))
patch = [[NOVO - R, list(cod)]] + [[c - R, list(struct.pack("<I", NOVO | 1))] for c in CHAMADAS]
if os.environ.get("JSON"): json.dump(patch, open(os.environ["JSON"], "w"))
for at, b in patch:
    print("    [0x%X, [%s]]," % (at, ", ".join("0x%02X" % x for x in b)))
